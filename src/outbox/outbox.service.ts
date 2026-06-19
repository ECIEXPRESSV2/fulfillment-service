import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { OutboxEventEntity } from '../database/entities/outbox-event.entity';

/** Datos para encolar un evento de salida en el outbox. */
export interface EnqueueOutboxInput {
  /** Id de la entidad raíz (ej. orderId o pickupCodeId). */
  aggregateId: string;
  /** Tipo de la entidad raíz (ej. 'PickupCode', 'Delivery'). */
  aggregateType: string;
  /** Tipo de evento sin prefijo (ej. 'qr.generated'). */
  eventType: string;
  /** Routing key completo (ej. 'fulfillment.qr.generated'). */
  routingKey: string;
  /** Campos de negocio que van al primer nivel del sobre (CLAUDE.md §9). */
  business: Record<string, unknown>;
  /** Versión del contrato del evento. */
  eventVersion?: number;
  /** Id de correlación del request/flujo que originó el evento. */
  correlationId?: string;
  /** Clave de idempotencia; si no se da, se genera. Es única en el outbox (evita republicar). */
  idempotencyKey?: string;
}

const SOURCE = 'fulfillment-service';

/**
 * Transactional Outbox (CLAUDE.md §13, RN-16): ningún evento se publica directo. Se escribe
 * en `outbox_events` dentro de la MISMA transacción que el cambio de negocio; el
 * `OutboxWorker` lo publica luego. Garantiza que eventos como `delivery.confirmed` no se pierdan.
 */
@Injectable()
export class OutboxService {
  /**
   * Encola un evento dentro del EntityManager transaccional `manager`. Construye el sobre plano
   * (campos de negocio al primer nivel + metadata) y lo persiste como `PENDING`.
   */
  async enqueue(manager: EntityManager, input: EnqueueOutboxInput): Promise<void> {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const eventVersion = input.eventVersion ?? 1;

    const payload = {
      ...input.business,
      eventVersion,
      source: SOURCE,
      correlationId: input.correlationId ?? null,
      occurredAt: new Date().toISOString(),
      idempotencyKey,
    };

    const repo = manager.getRepository(OutboxEventEntity);
    const entity = repo.create({
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      eventType: input.eventType,
      routingKey: input.routingKey,
      eventVersion,
      payload,
      idempotencyKey,
    });
    await repo.save(entity);
  }
}
