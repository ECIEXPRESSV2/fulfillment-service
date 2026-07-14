import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../common/enums';
import { CodesService } from '../../codes/domain/codes.service';
import { IdempotencyService } from '../idempotency.service';
import { OrderProjectionService } from '../projections/order-projection.service';

/** Routing keys de Order que consume Fulfillment. */
export const ORDER_ROUTING_KEYS = {
  confirmed: 'order.order.confirmed',
  readyForPickup: 'order.order.ready_for_pickup',
  cancelled: 'order.order.cancelled',
} as const;

type EventRecord = Record<string, unknown>;

/**
 * Handler de eventos de Order (CLAUDE.md §9). `order.order.confirmed` → actualiza la
 * proyección del pedido y genera el código de retiro (UC-01). `order.order.cancelled` →
 * invalida el código (UC-08). Idempotente por `idempotencyKey` y tolerante a campos faltantes.
 */
@Injectable()
export class OrderHandler {
  private readonly logger = new Logger(OrderHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orderProjection: OrderProjectionService,
    private readonly codesService: CodesService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async handle(routingKey: string, event: EventRecord): Promise<void> {
    const idempotencyKey = this.str(event.idempotencyKey);

    try {
      await this.dataSource.transaction(async (manager) => {
        // Lock de advisory de Postgres (liberado solo al terminar la tx) que serializa
        // entregas concurrentes del MISMO evento. Sin esto, dos entregas casi simultáneas
        // pasaban el chequeo de idempotencia ANTES de que cualquiera terminara (ninguna
        // veía la otra como "ya procesada" todavía) y ambas corrían onReadyForPickup —
        // que invalida el código ACTIVE previo y genera uno nuevo, así que la restricción
        // única de "un solo código activo por pedido" nunca las hacía chocar: cada una
        // limpiaba la cancha para sí misma y generaba su propio QR duplicado.
        const lockKey =
          idempotencyKey ?? `${routingKey}:${this.str(event.orderId) ?? ''}`;
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          lockKey,
        ]);

        if (idempotencyKey && (await this.idempotency.isProcessed(idempotencyKey))) {
          return; // la otra entrega ya terminó mientras esperábamos el lock
        }

        switch (routingKey) {
          case ORDER_ROUTING_KEYS.confirmed:
            await this.onConfirmed(event, manager);
            break;
          case ORDER_ROUTING_KEYS.readyForPickup:
            await this.onReadyForPickup(event, manager);
            break;
          case ORDER_ROUTING_KEYS.cancelled:
            await this.onCancelled(event, manager);
            break;
          default:
            this.logger.debug(
              { routingKey },
              'Evento de Order ignorado (no aplica)',
            );
            return;
        }
        if (idempotencyKey) {
          await this.idempotency.markProcessed(
            manager,
            idempotencyKey,
            routingKey,
          );
        }
      });
    } catch (error) {
      if (this.idempotency.isDuplicateError(error)) {
        return; // procesado en paralelo por otro consumidor
      }
      throw error;
    }
  }

  /** Proyecta el pedido cuando se confirma (sin generar QR aún). */
  private async onConfirmed(
    event: EventRecord,
    manager: EntityManager,
  ): Promise<void> {
    const orderId = this.str(event.orderId);
    const orderNumber = this.str(event.orderNumber);
    const buyerId = this.str(event.buyerId);
    const storeId = this.str(event.storeId);
    if (!orderId || !buyerId || !storeId) {
      this.logger.warn(
        { event },
        'order.order.confirmed incompleto; se ignora',
      );
      return;
    }
    const pickupExpiresAt = this.date(event.pickupExpiresAt);

    await this.orderProjection.upsertFromConfirmed(
      { orderId, orderNumber, buyerId, storeId, pickupExpiresAt },
      manager,
    );
  }

  /** Genera el QR cuando la tienda marca el pedido como listo para entregar. */
  private async onReadyForPickup(
    event: EventRecord,
    manager: EntityManager,
  ): Promise<void> {
    const orderId = this.str(event.orderId);
    const orderNumber = this.str(event.orderNumber);
    const buyerId = this.str(event.buyerId);
    const storeId = this.str(event.storeId);
    if (!orderId || !buyerId || !storeId) {
      this.logger.warn(
        { event },
        'order.order.ready_for_pickup incompleto; se ignora',
      );
      return;
    }
    const pickupExpiresAt = this.date(event.pickupExpiresAt);

    await this.orderProjection.upsertFromConfirmed(
      { orderId, orderNumber, buyerId, storeId, pickupExpiresAt },
      manager,
    );
    // Invalida cualquier código ACTIVE previo (generado al CONFIRMED con otro expiry)
    // para forzar la generación del QR con el pickupExpiresAt correcto.
    await this.codesService.invalidateByOrder(manager, orderId);
    await this.codesService.generateForOrder(manager, {
      orderId,
      orderNumber: orderNumber ?? orderId,
      buyerId,
      storeId,
      pickupExpiresAt,
      correlationId: this.str(event.correlationId),
    });
  }

  /** UC-08: marca el pedido cancelado e invalida su código `ACTIVE`. */
  private async onCancelled(
    event: EventRecord,
    manager: EntityManager,
  ): Promise<void> {
    const orderId = this.str(event.orderId);
    if (!orderId) {
      this.logger.warn(
        { event },
        'order.order.cancelled sin orderId; se ignora',
      );
      return;
    }

    await this.orderProjection.markCancelled(orderId, manager);
    const { invalidated, alreadyDelivered } =
      await this.codesService.invalidateByOrder(manager, orderId);
    const correlationId = this.str(event.correlationId);

    if (invalidated) {
      await this.audit.record(
        { action: AuditAction.CODE_INVALIDATED, orderId, correlationId },
        manager,
      );
    } else if (alreadyDelivered) {
      // RN-15: el pedido ya se entregó; la cancelación no se revierte, se deja la inconsistencia.
      await this.audit.record(
        {
          action: AuditAction.CODE_INVALIDATED,
          orderId,
          reason: 'Cancelación recibida tras la entrega; no se revierte.',
          metadata: { inconsistency: 'cancelled_after_delivery' },
          correlationId,
        },
        manager,
      );
    }
  }

  private str(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private date(value: unknown): Date | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
