import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PickupCode, PickupCodeStatus, Prisma } from '@prisma/client';
import { EnvironmentVariables } from '../../config/env.config';
import { StoreStaffProjectionService } from '../../events/projections/store-staff-projection.service';
import { OutboxService } from '../../outbox/outbox.service';
import { CodesRepository } from '../infra/codes.repository';
import {
  generateShortCode,
  generateToken,
  looksLikeShortCode,
  normalizeShortCode,
} from './code-generator';
import {
  GenerateCodeInput,
  ValidationError,
  ValidationResult,
} from './pickup-code.types';
import { ShortCodeRateLimiter } from './short-code-rate-limiter';

/** Vista del código que ve el comprador (UC-02). */
export interface PickupCodeView {
  orderId: string;
  token: string;
  shortCode: string;
  qrCode: string;
  status: PickupCodeStatus;
  expiresAt: Date;
  usedAt: Date | null;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Lógica de los códigos de retiro (CLAUDE.md §6). Generación idempotente (UC-01),
 * validación de solo lectura con motivos tipificados (UC-03) y consulta del comprador (UC-02).
 * La confirmación de entrega (UC-04) vive en el módulo `deliveries` (crea la `Delivery`).
 */
@Injectable()
export class CodesService {
  private readonly fallbackExpiryHours: number;
  private readonly publicBaseUrl: string;

  constructor(
    private readonly repo: CodesRepository,
    private readonly outbox: OutboxService,
    private readonly storeStaff: StoreStaffProjectionService,
    private readonly rateLimiter: ShortCodeRateLimiter,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.fallbackExpiryHours = config.get('PICKUP_CODE_FALLBACK_EXPIRY_HOURS', { infer: true });
    this.publicBaseUrl = config.get('PUBLIC_BASE_URL', { infer: true });
  }

  /**
   * UC-01: genera el código `ACTIVE` del pedido y encola `fulfillment.qr.generated` en el
   * outbox, todo dentro de la tx del handler. Idempotente: si ya hay un código `ACTIVE`, lo
   * devuelve sin crear otro ni republicar (RN-02).
   */
  async generateForOrder(
    tx: Prisma.TransactionClient,
    input: GenerateCodeInput,
  ): Promise<{ created: boolean; code: PickupCode }> {
    const existing = await this.repo.findActiveByOrderId(input.orderId, tx);
    if (existing) {
      return { created: false, code: existing };
    }

    const token = generateToken();
    const shortCode = generateShortCode();
    const expiresAt = this.computeExpiresAt(input.pickupExpiresAt);

    const code = await this.repo.create(tx, {
      orderId: input.orderId,
      buyerId: input.buyerId,
      storeId: input.storeId,
      token,
      shortCode,
      expiresAt,
    });

    await this.outbox.enqueue(tx, {
      aggregateId: input.orderId,
      aggregateType: 'PickupCode',
      eventType: 'qr.generated',
      routingKey: 'fulfillment.qr.generated',
      business: {
        orderId: input.orderId,
        buyerId: input.buyerId,
        qrCode: this.buildQrUrl(token),
        shortCode,
        expiresAt: expiresAt.toISOString(),
      },
      correlationId: input.correlationId,
    });

    return { created: true, code };
  }

  /**
   * UC-03: valida un código (token o código corto) **sin cambiar su estado** (RN-03).
   * La autorización de tienda se resuelve aquí (`WRONG_STORE`), no por guard. El código corto
   * pasa por rate-limit (RN-11).
   */
  async validateCode(code: string, sellerUserId: string): Promise<ValidationResult> {
    const isShort = looksLikeShortCode(code);
    const lookup = isShort ? normalizeShortCode(code) : code.trim();

    if (isShort && !this.rateLimiter.consume(lookup)) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Demasiados intentos con este código. Espera un momento e inténtalo de nuevo.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const found = await this.repo.findByTokenOrShortCode(lookup);
    if (!found) {
      return { valid: false, validationError: ValidationError.CODE_NOT_FOUND };
    }

    // Verifica la tienda antes de revelar el estado del código (evita fuga entre tiendas).
    const authorized = await this.storeStaff.isAuthorized(found.storeId, sellerUserId);
    if (!authorized) {
      return { valid: false, validationError: ValidationError.WRONG_STORE };
    }

    const stateError = this.checkState(found);
    if (stateError) {
      return { valid: false, validationError: stateError };
    }

    return {
      valid: true,
      order: {
        orderId: found.orderId,
        buyerId: found.buyerId,
        storeId: found.storeId,
        expiresAt: found.expiresAt,
      },
    };
  }

  /** UC-02: el comprador consulta el código de su pedido. */
  async getCodeForBuyer(orderId: string, buyerUserId: string): Promise<PickupCodeView> {
    const code = await this.repo.findLatestByOrderId(orderId);
    if (!code) {
      throw new NotFoundException({
        code: 'CODE_NOT_FOUND',
        message: 'Aún no hay un código de retiro para este pedido.',
      });
    }
    if (code.buyerId !== buyerUserId) {
      throw new ForbiddenException({
        code: 'NOT_ORDER_OWNER',
        message: 'Este código de retiro no corresponde a tu pedido.',
      });
    }

    return {
      orderId: code.orderId,
      token: code.token,
      shortCode: code.shortCode,
      qrCode: this.buildQrUrl(code.token),
      status: code.status,
      expiresAt: code.expiresAt,
      usedAt: code.usedAt,
    };
  }

  /**
   * UC-08: invalida el código `ACTIVE` del pedido al cancelarse. Idempotente y seguro ante
   * estados finales (solo afecta `ACTIVE`). Devuelve si hubo cambio para que el handler decida
   * si registrar inconsistencia en auditoría cuando el pedido ya estaba entregado (RN-15).
   */
  async invalidateByOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<{ invalidated: boolean }> {
    const count = await this.repo.invalidateActiveByOrderId(tx, orderId);
    return { invalidated: count > 0 };
  }

  /** Devuelve el primer error de estado del código, o `null` si es válido. */
  private checkState(code: PickupCode): ValidationError | null {
    if (code.status === PickupCodeStatus.INVALIDATED) {
      return ValidationError.CODE_INVALIDATED;
    }
    if (code.status === PickupCodeStatus.USED) {
      return ValidationError.CODE_ALREADY_USED;
    }
    if (code.status === PickupCodeStatus.EXPIRED || code.expiresAt.getTime() <= Date.now()) {
      return ValidationError.CODE_EXPIRED;
    }
    return null;
  }

  private computeExpiresAt(pickupExpiresAt?: Date | null): Date {
    if (pickupExpiresAt) {
      return pickupExpiresAt;
    }
    return new Date(Date.now() + this.fallbackExpiryHours * MS_PER_HOUR);
  }

  private buildQrUrl(token: string): string {
    return `${this.publicBaseUrl}/fulfillment/qr/${token}.png`;
  }
}
