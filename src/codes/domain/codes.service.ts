import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { EnvironmentVariables } from '../../config/env.config';
import { AuditAction, PickupCodeStatus } from '../../common/enums';
import { PickupCodeEntity } from '../../database/entities/pickup-code.entity';
import { StoreStaffProjectionService } from '../../events/projections/store-staff-projection.service';
import { OutboxService } from '../../outbox/outbox.service';
import { OrderProjectionService } from '../../events/projections/order-projection.service';
import { BlobStorageService } from '../../storage/blob-storage.service';
import { QrService } from '../../qr/domain/qr.service';
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
 * Marcador de versión del build. Se imprime en cada generación de QR para confirmar
 * por logs qué imagen está realmente desplegada (grep de este tag) y si el QR salió por
 * blob o por el endpoint de fallback. Súbelo cuando cambies algo del path del QR.
 */
const QR_GEN_BUILD_TAG = 'qr-gen:v2-blob-logging';

/**
 * Lógica de los códigos de retiro (CLAUDE.md §6). Generación idempotente (UC-01),
 * validación de solo lectura con motivos tipificados (UC-03) y consulta del comprador (UC-02).
 * La confirmación de entrega (UC-04) vive en el módulo `deliveries` (crea la `Delivery`).
 */
@Injectable()
export class CodesService {
  private readonly logger = new Logger(CodesService.name);
  private readonly fallbackExpiryHours: number;
  private readonly publicBaseUrl: string;
  private readonly qrContainer: string;
  private readonly qrSasTtlHours: number;

  constructor(
    private readonly repo: CodesRepository,
    private readonly outbox: OutboxService,
    private readonly storeStaff: StoreStaffProjectionService,
    private readonly rateLimiter: ShortCodeRateLimiter,
    private readonly orderProjection: OrderProjectionService,
    private readonly audit: AuditService,
    private readonly qr: QrService,
    private readonly blob: BlobStorageService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.fallbackExpiryHours = config.get('PICKUP_CODE_FALLBACK_EXPIRY_HOURS', {
      infer: true,
    });
    this.publicBaseUrl = config.get('PUBLIC_BASE_URL', { infer: true });
    this.qrContainer = config.get('AZURE_STORAGE_ORDERS_CONTAINER', {
      infer: true,
    });
    this.qrSasTtlHours = config.get('QR_SAS_TTL_HOURS', { infer: true });
  }

  /**
   * UC-01: genera el código `ACTIVE` del pedido y encola `fulfillment.qr.generated` en el
   * outbox, todo dentro del manager transaccional. Idempotente: si ya hay un código `ACTIVE`, lo
   * devuelve sin crear otro ni republicar (RN-02).
   */
  async generateForOrder(
    manager: EntityManager,
    input: GenerateCodeInput,
  ): Promise<{ created: boolean; code: PickupCodeEntity }> {
    const existing = await this.repo.findActiveByOrderId(
      input.orderId,
      manager,
    );
    if (existing) {
      return { created: false, code: existing };
    }

    const token = generateToken();
    const shortCode = generateShortCode();
    const expiresAt = this.computeExpiresAt(input.pickupExpiresAt);

    const code = await this.repo.create(
      {
        orderId: input.orderId,
        buyerId: input.buyerId,
        storeId: input.storeId,
        token,
        shortCode,
        expiresAt,
      },
      manager,
    );

    // Sube el PNG del QR al blob privado y firma su SAS de lectura. Notification lo manda como
    // imagen por WhatsApp (Meta descarga la URL). Si el blob no está configurado o falla, se cae
    // al endpoint público de fallback para no bloquear la confirmación del pedido.
    const qrImageUrl = await this.buildQrImageUrl(
      input.orderId,
      token,
      expiresAt,
    );

    // Log de confirmación de versión + origen de la imagen (blob vs fallback). Sirve para
    // verificar tras un redeploy que corre el build final y para diagnosticar la entrega
    // del QR por WhatsApp. No loguea el SAS completo, solo el host.
    this.logger.log(
      `[${QR_GEN_BUILD_TAG}] QR generado order=${input.orderId} ` +
        `via=${qrImageUrl.includes('blob.core.windows.net') ? 'blob' : 'fallback'} ` +
        `blobEnabled=${this.blob.enabled} host=${this.safeHost(qrImageUrl)}`,
    );

    await this.outbox.enqueue(manager, {
      aggregateId: input.orderId,
      aggregateType: 'PickupCode',
      eventType: 'qr.generated',
      routingKey: 'fulfillment.qr.generated',
      business: {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        buyerId: input.buyerId,
        qrCode: qrImageUrl,
        imageUrl: qrImageUrl,
        shortCode,
        expiresAt: expiresAt.toISOString(),
      },
      correlationId: input.correlationId,
    });

    await this.audit.record(
      {
        action: AuditAction.CODE_GENERATED,
        orderId: input.orderId,
        pickupCodeId: code.id,
        correlationId: input.correlationId,
      },
      manager,
    );

    return { created: true, code };
  }

  /**
   * UC-03: valida un código (token o código corto) **sin cambiar su estado** (RN-03).
   * La autorización de tienda se resuelve aquí (`WRONG_STORE`), no por guard. El código corto
   * pasa por rate-limit (RN-11).
   */
  async validateCode(
    code: string,
    sellerUserId: string,
  ): Promise<ValidationResult> {
    const { code: found, error } = await this.resolveForValidation(
      code,
      sellerUserId,
    );
    const projection = found
      ? await this.orderProjection.getByOrderId(found.orderId)
      : null;
    const result: ValidationResult =
      error !== null || found === null
        ? {
            valid: false,
            validationError: error ?? ValidationError.CODE_NOT_FOUND,
          }
        : {
            valid: true,
            order: {
              orderId: found.orderId,
              buyerId: found.buyerId,
              storeId: found.storeId,
              expiresAt: found.expiresAt,
              orderNumber: projection?.orderNumber ?? found.orderId,
            },
          };

    // Auditoría best-effort (validar es solo lectura, RN-03): no debe romper la respuesta.
    await this.audit.safeRecord({
      action: AuditAction.CODE_VALIDATED,
      actorId: sellerUserId,
      orderId: found?.orderId,
      pickupCodeId: found?.id,
      metadata: {
        valid: result.valid,
        validationError: result.valid ? null : result.validationError,
      },
    });

    return result;
  }

  /**
   * Resuelve y verifica un código (lookup + tienda + estado), devolviendo el registro y el
   * primer error encontrado (o `null`). Lo reutilizan tanto la validación (UC-03) como la
   * confirmación (UC-04). Aplica rate-limit al código corto.
   */
  async resolveForValidation(
    code: string,
    sellerUserId: string,
  ): Promise<{ code: PickupCodeEntity | null; error: ValidationError | null }> {
    const isShort = looksLikeShortCode(code);
    const lookup = isShort ? normalizeShortCode(code) : code.trim();

    if (isShort && !this.rateLimiter.consume(lookup)) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message:
            'Demasiados intentos con este código. Espera un momento e inténtalo de nuevo.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const found = await this.repo.findByTokenOrShortCode(lookup);
    if (!found) {
      return { code: null, error: ValidationError.CODE_NOT_FOUND };
    }

    const authorized = await this.storeStaff.isAuthorized(
      found.storeId,
      sellerUserId,
    );
    if (!authorized) {
      return { code: found, error: ValidationError.WRONG_STORE };
    }

    return { code: found, error: this.checkState(found) };
  }

  /** Marca el código como `USED` (transición de confirmación de entrega, UC-04/UC-05). */
  async markUsed(manager: EntityManager, codeId: string): Promise<void> {
    await this.repo.markUsedById(codeId, manager);
  }

  /** UC-02: el comprador consulta el código de su pedido. */
  async getCodeForBuyer(
    orderId: string,
    buyerUserId: string,
  ): Promise<PickupCodeView> {
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
    manager: EntityManager,
    orderId: string,
  ): Promise<{ invalidated: boolean; alreadyDelivered: boolean }> {
    const count = await this.repo.invalidateActiveByOrderId(orderId, manager);
    if (count > 0) {
      return { invalidated: true, alreadyDelivered: false };
    }
    // No había código ACTIVE. Si el último ya estaba USED, el pedido se entregó: la
    // cancelación llega tarde y no se revierte (RN-15); el handler lo audita.
    const latest = await this.repo.findLatestByOrderId(orderId);
    return {
      invalidated: false,
      alreadyDelivered: latest?.status === PickupCodeStatus.USED,
    };
  }

  /** Devuelve el primer error de estado del código, o `null` si es válido. */
  private checkState(code: PickupCodeEntity): ValidationError | null {
    if (code.status === PickupCodeStatus.INVALIDATED) {
      return ValidationError.CODE_INVALIDATED;
    }
    if (code.status === PickupCodeStatus.USED) {
      return ValidationError.CODE_ALREADY_USED;
    }
    if (
      code.status === PickupCodeStatus.EXPIRED ||
      code.expiresAt.getTime() <= Date.now()
    ) {
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

  /**
   * Sube el PNG del QR al contenedor privado y devuelve su URL con SAS de lectura. El SAS vive lo
   * suficiente para que el usuario abra el correo/WhatsApp: el mayor entre `QR_SAS_TTL_HOURS` y lo
   * que falte para que el código expire, más una holgura. Ante blob deshabilitado o error, cae al
   * endpoint público (`/fulfillment/qr/:token.png`) para no romper el flujo de confirmación.
   */
  private async buildQrImageUrl(
    orderId: string,
    token: string,
    expiresAt: Date,
  ): Promise<string> {
    if (!this.blob.enabled) {
      // Rama silenciosa histórica: sin este log no había forma de distinguir "blob
      // deshabilitado" de "subida fallida". AZURE_STORAGE_ACCOUNT vacío cae aquí.
      this.logger.warn(
        `[${QR_GEN_BUILD_TAG}] blob deshabilitado (AZURE_STORAGE_ACCOUNT vacío); QR por fallback order=${orderId}`,
      );
      return this.buildQrUrl(token);
    }
    try {
      const png = await this.qr.generatePng(token);
      const minutesUntilExpiry = Math.ceil(
        (expiresAt.getTime() - Date.now()) / 60_000,
      );
      const ttlMinutes = Math.max(
        this.qrSasTtlHours * 60,
        minutesUntilExpiry + 120,
      );
      const url = await this.blob.uploadWithReadSas({
        container: this.qrContainer,
        blobName: `${orderId}/qr/${token}.png`,
        content: png,
        contentType: 'image/png',
        ttlMinutes,
      });
      this.logger.log(
        `[${QR_GEN_BUILD_TAG}] QR subido a blob order=${orderId} container=${this.qrContainer} host=${this.safeHost(url)}`,
      );
      return url;
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'No se pudo subir el QR al blob; se usa el endpoint público de fallback',
      );
      return this.buildQrUrl(token);
    }
  }

  /** Host de una URL para loguear sin exponer token/SAS; string vacío si no parsea. */
  private safeHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }
}
