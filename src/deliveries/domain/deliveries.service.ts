import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Delivery,
  DeliveryFailureReason,
  DeliveryMethod,
  PickupCodeStatus,
  Prisma,
} from '@prisma/client';
import { CodesService } from '../../codes/domain/codes.service';
import { ValidationError } from '../../codes/domain/pickup-code.types';
import { CodesRepository } from '../../codes/infra/codes.repository';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { OrderProjectionService } from '../../events/projections/order-projection.service';
import { StoreStaffProjectionService } from '../../events/projections/store-staff-projection.service';
import { OutboxService } from '../../outbox/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveriesRepository } from '../infra/deliveries.repository';

export interface ManualDeliveryInput {
  reason: string;
  note?: string;
}

export interface DeliveryFailureInput {
  reason: DeliveryFailureReason;
  note?: string;
}

interface ConfirmedEventInput {
  orderId: string;
  buyerId: string;
  storeId: string;
  method: DeliveryMethod;
  deliveredAt: Date;
  correlationId?: string;
}

/** Filtros del historial por tienda (UC-10), ya desacoplados del DTO HTTP. */
export interface ListStoreDeliveriesInput {
  page: number;
  limit: number;
  order: 'ASC' | 'DESC';
  method?: DeliveryMethod;
  from?: string;
  to?: string;
  confirmedByUserId?: string;
}

/** Estado del proceso de retiro de un pedido (UC-09), objeto de dominio plano. */
export interface FulfillmentStatusResult {
  orderId: string;
  code: { status: PickupCodeStatus; expiresAt: Date; usedAt: Date | null } | null;
  delivery: { method: DeliveryMethod; deliveredAt: Date; confirmedByUserId: string } | null;
  failure: { reason: DeliveryFailureReason; occurredAt: Date; note: string | null } | null;
}

/**
 * Confirmación y registro de entregas (CLAUDE.md §UC-04/05/06). Todas las mutaciones escriben
 * la `Delivery` y encolan el evento de salida en la MISMA transacción (Outbox, RN-16).
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codesService: CodesService,
    private readonly codesRepo: CodesRepository,
    private readonly deliveriesRepo: DeliveriesRepository,
    private readonly orderProjection: OrderProjectionService,
    private readonly storeStaff: StoreStaffProjectionService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * UC-04: confirma la entrega por QR. Revalida el código (no confía en una validación previa,
   * RN-10), lo marca `USED`, crea la entrega y publica `delivery.confirmed`. Idempotente ante
   * doble confirmación: si el código ya estaba `USED` y hay entrega, la devuelve sin duplicar.
   */
  async confirmByCode(
    code: string,
    sellerUserId: string,
    correlationId?: string,
  ): Promise<Delivery> {
    const { code: found, error } = await this.codesService.resolveForValidation(code, sellerUserId);

    if (!found) {
      throw new NotFoundException({
        code: 'CODE_NOT_FOUND',
        message: 'No encontramos un código de retiro con ese valor.',
      });
    }
    if (error === ValidationError.WRONG_STORE) {
      throw new ForbiddenException({
        code: 'WRONG_STORE',
        message: 'Este código de retiro no pertenece a tu tienda.',
      });
    }
    if (error === ValidationError.CODE_ALREADY_USED) {
      const existing = await this.deliveriesRepo.findSuccessfulByOrderId(found.orderId);
      if (existing) {
        return existing; // idempotente
      }
      throw new ConflictException({
        code: 'CODE_ALREADY_USED',
        message: 'Este código de retiro ya fue utilizado.',
      });
    }
    if (error === ValidationError.CODE_EXPIRED) {
      throw new ConflictException({
        code: 'CODE_EXPIRED',
        message: 'Este código de retiro ya venció.',
      });
    }
    if (error === ValidationError.CODE_INVALIDATED) {
      throw new ConflictException({
        code: 'CODE_INVALIDATED',
        message: 'Este código de retiro fue anulado porque el pedido se canceló.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.codesService.markUsed(tx, found.id);
      const delivery = await this.deliveriesRepo.create(tx, {
        orderId: found.orderId,
        storeId: found.storeId,
        confirmedByUserId: sellerUserId,
        method: DeliveryMethod.QR,
      });
      await this.enqueueConfirmed(tx, {
        orderId: found.orderId,
        buyerId: found.buyerId,
        storeId: found.storeId,
        method: DeliveryMethod.QR,
        deliveredAt: delivery.deliveredAt,
        correlationId,
      });
      // Auditoría DELIVERY_CONFIRMED: se añade al integrar el módulo de auditoría.
      return delivery;
    });
  }

  /**
   * UC-05: entrega manual (fallback). La autorización por tienda la garantiza `StoreAccessGuard`
   * en la ruta. `reason` es obligatorio. Marca el código `USED` si existe y publica el mismo
   * evento `delivery.confirmed` con `method: MANUAL` (RN-07).
   */
  async registerManualDelivery(
    orderId: string,
    sellerUserId: string,
    input: ManualDeliveryInput,
    correlationId?: string,
  ): Promise<Delivery> {
    const projection = await this.orderProjection.getByOrderId(orderId);
    if (!projection) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No encontramos información de retiro para este pedido.',
      });
    }

    const existing = await this.deliveriesRepo.findSuccessfulByOrderId(orderId);
    if (existing) {
      return existing; // idempotente: ya se entregó
    }

    return this.prisma.$transaction(async (tx) => {
      const activeCode = await this.codesRepo.findActiveByOrderId(orderId, tx);
      if (activeCode) {
        await this.codesService.markUsed(tx, activeCode.id);
      }
      const note = input.note ? `${input.reason} — ${input.note}` : input.reason;
      const delivery = await this.deliveriesRepo.create(tx, {
        orderId,
        storeId: projection.storeId,
        confirmedByUserId: sellerUserId,
        method: DeliveryMethod.MANUAL,
        note,
      });
      await this.enqueueConfirmed(tx, {
        orderId,
        buyerId: projection.buyerId,
        storeId: projection.storeId,
        method: DeliveryMethod.MANUAL,
        deliveredAt: delivery.deliveredAt,
        correlationId,
      });
      // Auditoría MANUAL_DELIVERY: se añade al integrar el módulo de auditoría.
      return delivery;
    });
  }

  /**
   * UC-06: registra una entrega fallida con motivo tipificado y publica `delivery.failed`.
   * `OTHER` exige nota (RN-13). No marca el código como `USED` (sigue su curso hasta expirar).
   */
  async registerDeliveryFailure(
    orderId: string,
    sellerUserId: string,
    input: DeliveryFailureInput,
    correlationId?: string,
  ): Promise<Delivery> {
    const projection = await this.orderProjection.getByOrderId(orderId);
    if (!projection) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No encontramos información de retiro para este pedido.',
      });
    }
    if (input.reason === DeliveryFailureReason.OTHER && !input.note) {
      throw new BadRequestException({
        code: 'NOTE_REQUIRED',
        message: 'Cuando el motivo es "Otro", debes describir qué pasó.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const delivery = await this.deliveriesRepo.create(tx, {
        orderId,
        storeId: projection.storeId,
        confirmedByUserId: sellerUserId,
        method: null,
        failureReason: input.reason,
        note: input.note ?? null,
      });
      await this.outbox.enqueue(tx, {
        aggregateId: orderId,
        aggregateType: 'Delivery',
        eventType: 'delivery.failed',
        routingKey: 'fulfillment.delivery.failed',
        business: { orderId, buyerId: projection.buyerId, reason: input.reason },
        correlationId,
      });
      // Auditoría DELIVERY_FAILED: se añade al integrar el módulo de auditoría.
      return delivery;
    });
  }

  /**
   * UC-09: estado del proceso de retiro de un pedido (no el estado del pedido). Lo puede ver
   * el comprador dueño, owner/staff de la tienda, o ADMIN; cualquier otro recibe 403.
   */
  async getFulfillmentStatus(
    orderId: string,
    user: CurrentUserData,
  ): Promise<FulfillmentStatusResult> {
    const projection = await this.orderProjection.getByOrderId(orderId);
    const code = await this.codesRepo.findLatestByOrderId(orderId);
    if (!projection && !code) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No encontramos información de retiro para este pedido.',
      });
    }

    const storeId = projection?.storeId ?? code!.storeId;
    const buyerId = projection?.buyerId ?? code!.buyerId;
    await this.assertCanViewStatus(user, buyerId, storeId);

    const deliveries = await this.deliveriesRepo.findAllByOrderId(orderId);
    const successful = deliveries.find((d) => d.method !== null) ?? null;
    const failure = deliveries.find((d) => d.failureReason !== null) ?? null;

    return {
      orderId,
      code: code
        ? { status: code.status, expiresAt: code.expiresAt, usedAt: code.usedAt }
        : null,
      delivery: successful?.method
        ? {
            method: successful.method,
            deliveredAt: successful.deliveredAt,
            confirmedByUserId: successful.confirmedByUserId,
          }
        : null,
      failure: failure?.failureReason
        ? { reason: failure.failureReason, occurredAt: failure.deliveredAt, note: failure.note }
        : null,
    };
  }

  /** UC-10: historial paginado de entregas de una tienda. La autoriza `StoreAccessGuard`. */
  async listStoreDeliveries(
    storeId: string,
    input: ListStoreDeliveriesInput,
  ): Promise<{ data: Delivery[]; total: number; page: number; limit: number }> {
    const { data, total } = await this.deliveriesRepo.listByStore(storeId, {
      page: input.page,
      limit: input.limit,
      order: input.order === 'ASC' ? 'asc' : 'desc',
      method: input.method ?? null,
      confirmedByUserId: input.confirmedByUserId ?? null,
      from: input.from ? new Date(input.from) : null,
      to: input.to ? new Date(input.to) : null,
    });
    return { data, total, page: input.page, limit: input.limit };
  }

  private async assertCanViewStatus(
    user: CurrentUserData,
    buyerId: string,
    storeId: string,
  ): Promise<void> {
    if (user.role === 'ADMIN' || user.userId === buyerId) {
      return;
    }
    if (await this.storeStaff.isAuthorized(storeId, user.userId)) {
      return;
    }
    throw new ForbiddenException({
      code: 'FULFILLMENT_ACCESS_DENIED',
      message: 'No tienes acceso a la información de retiro de este pedido.',
    });
  }

  private enqueueConfirmed(
    tx: Prisma.TransactionClient,
    event: ConfirmedEventInput,
  ): Promise<void> {
    return this.outbox.enqueue(tx, {
      aggregateId: event.orderId,
      aggregateType: 'Delivery',
      eventType: 'delivery.confirmed',
      routingKey: 'fulfillment.delivery.confirmed',
      business: {
        orderId: event.orderId,
        buyerId: event.buyerId,
        storeId: event.storeId,
        method: event.method,
        deliveredAt: event.deliveredAt.toISOString(),
      },
      correlationId: event.correlationId,
    });
  }
}
