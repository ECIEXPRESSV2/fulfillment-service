import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { IdempotencyService } from '../idempotency.service';
import { StoreStaffProjectionService } from '../projections/store-staff-projection.service';

/** Routing keys de Identity que alimentan la proyección de autorización. */
export const IDENTITY_ROUTING_KEYS = {
  storeCreated: 'identity.store.created',
  staffChanged: 'identity.store.staff_changed',
} as const;

type EventRecord = Record<string, unknown>;

/**
 * Handler de eventos de Identity (CLAUDE.md §9, §12). Mantiene `store_staff` desde
 * `identity.store.created` (owner) y `identity.store.staff_changed` (assigned/removed).
 * Idempotente por `idempotencyKey` y tolerante a campos desconocidos/faltantes.
 */
@Injectable()
export class IdentityHandler {
  private readonly logger = new Logger(IdentityHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storeStaff: StoreStaffProjectionService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async handle(routingKey: string, event: EventRecord): Promise<void> {
    const idempotencyKey = this.str(event.idempotencyKey);
    if (idempotencyKey && (await this.idempotency.isProcessed(idempotencyKey))) {
      return;
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        switch (routingKey) {
          case IDENTITY_ROUTING_KEYS.storeCreated:
            await this.onStoreCreated(event, manager);
            break;
          case IDENTITY_ROUTING_KEYS.staffChanged:
            await this.onStaffChanged(event, manager);
            break;
          default:
            this.logger.debug({ routingKey }, 'Evento de Identity ignorado (no aplica)');
            return;
        }
        if (idempotencyKey) {
          await this.idempotency.markProcessed(manager, idempotencyKey, routingKey);
        }
      });
    } catch (error) {
      if (this.idempotency.isDuplicateError(error)) {
        // Otro consumidor lo procesó en paralelo: no es error.
        return;
      }
      throw error;
    }
  }

  private async onStoreCreated(event: EventRecord, manager: EntityManager): Promise<void> {
    const storeId = this.str(event.storeId);
    const ownerId = this.str(event.ownerId);
    if (!storeId || !ownerId) {
      this.logger.warn({ event }, 'identity.store.created sin storeId/ownerId; se ignora');
      return;
    }
    await this.storeStaff.upsertOwner(storeId, ownerId, manager);
  }

  private async onStaffChanged(event: EventRecord, manager: EntityManager): Promise<void> {
    const storeId = this.str(event.storeId);
    const userId = this.str(event.userId);
    const action = this.str(event.action);
    if (!storeId || !userId || !action) {
      this.logger.warn({ event }, 'identity.store.staff_changed incompleto; se ignora');
      return;
    }

    if (action === 'assigned') {
      await this.storeStaff.assignStaff(storeId, userId, manager);
    } else if (action === 'removed') {
      await this.storeStaff.removeStaff(storeId, userId, manager);
    } else {
      this.logger.warn({ action }, 'Acción de staff_changed desconocida; se ignora');
    }
  }

  private str(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
