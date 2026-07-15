import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../common/enums';
import { CodesRepository } from '../codes/infra/codes.repository';
import { OutboxService } from '../outbox/outbox.service';
import { OrderProjectionService } from '../events/projections/order-projection.service';

/** Cuántos códigos vencidos se procesan por corrida del job. */
const BATCH_SIZE = 100;

/** Cuánto antes de vencer se avisa por WhatsApp/SMS. */
const EXPIRY_WARNING_LEAD_MS = 5 * 60_000;

/**
 * Expiración de códigos vencidos (UC-07, RN-08, RN-14). Por cada código `ACTIVE` con
 * `expiresAt <= now` lo marca `EXPIRED` y encola `fulfillment.qr.expired` en la misma
 * transacción. Idempotente y seguro ante carreras: solo expira si el código sigue `ACTIVE`.
 */
@Injectable()
export class ExpirationService {
  private readonly logger = new Logger(ExpirationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly codesRepo: CodesRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly orderProjection: OrderProjectionService,
  ) {}

  /** Expira los códigos vencidos. Devuelve cuántos se expiraron efectivamente. */
  async expireDueCodes(): Promise<{ expired: number }> {
    const now = new Date();
    const due = await this.codesRepo.findActiveExpired(now, BATCH_SIZE);

    let expired = 0;
    for (const code of due) {
      const didExpire = await this.dataSource.transaction(async (manager) => {
        const count = await this.codesRepo.markExpiredIfActive(code.id, manager);
        if (count === 0) {
          return false; // otro proceso ya lo cambió: no emitir evento
        }
        const projection = await this.orderProjection.getByOrderId(code.orderId);
        const orderNumber = projection?.orderNumber ?? undefined;
        await this.outbox.enqueue(manager, {
          aggregateId: code.orderId,
          aggregateType: 'PickupCode',
          eventType: 'qr.expired',
          routingKey: 'fulfillment.qr.expired',
          business: { orderId: code.orderId, orderNumber, buyerId: code.buyerId },
        });
        await this.audit.record(
          {
            action: AuditAction.CODE_EXPIRED,
            orderId: code.orderId,
            pickupCodeId: code.id,
          },
          manager,
        );
        return true;
      });
      if (didExpire) {
        expired += 1;
      }
    }

    if (expired > 0) {
      this.logger.log({ expired }, 'Códigos de retiro expirados');
    }
    return { expired };
  }

  /**
   * Avisa por WhatsApp/SMS los códigos `ACTIVE` que vencen en los próximos 5 minutos y todavía
   * no recibieron el aviso. Idempotente: marca `expiryWarningSentAt` en la misma transacción
   * que encola el evento, así que un código nunca se avisa dos veces aunque el cron corra cada
   * minuto durante toda la ventana de 5 minutos.
   */
  async warnExpiringSoonCodes(): Promise<{ warned: number }> {
    const now = new Date();
    const threshold = new Date(now.getTime() + EXPIRY_WARNING_LEAD_MS);
    const due = await this.codesRepo.findActiveExpiringSoon(now, threshold, BATCH_SIZE);

    let warned = 0;
    for (const code of due) {
      const didWarn = await this.dataSource.transaction(async (manager) => {
        const count = await this.codesRepo.markExpiryWarningSent(code.id, manager);
        if (count === 0) {
          return false; // otro proceso ya lo marcó: no emitir evento
        }
        await this.outbox.enqueue(manager, {
          aggregateId: code.orderId,
          aggregateType: 'PickupCode',
          eventType: 'qr.expiring_soon',
          routingKey: 'fulfillment.qr.expiring_soon',
          business: {
            orderId: code.orderId,
            buyerId: code.buyerId,
            storeId: code.storeId,
            expiresAt: code.expiresAt.toISOString(),
          },
        });
        return true;
      });
      if (didWarn) {
        warned += 1;
      }
    }

    if (warned > 0) {
      this.logger.log({ warned }, 'Avisos de vencimiento próximo de códigos de retiro enviados');
    }
    return { warned };
  }
}
