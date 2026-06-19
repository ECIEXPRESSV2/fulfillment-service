import { Injectable, Logger } from '@nestjs/common';
import { CodesRepository } from '../codes/infra/codes.repository';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';

/** Cuántos códigos vencidos se procesan por corrida del job. */
const BATCH_SIZE = 100;

/**
 * Expiración de códigos vencidos (UC-07, RN-08, RN-14). Por cada código `ACTIVE` con
 * `expiresAt <= now` lo marca `EXPIRED` y encola `fulfillment.qr.expired` en la misma
 * transacción. Idempotente y seguro ante carreras: solo expira si el código sigue `ACTIVE`.
 */
@Injectable()
export class ExpirationService {
  private readonly logger = new Logger(ExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly codesRepo: CodesRepository,
    private readonly outbox: OutboxService,
  ) {}

  /** Expira los códigos vencidos. Devuelve cuántos se expiraron efectivamente. */
  async expireDueCodes(): Promise<{ expired: number }> {
    const now = new Date();
    const due = await this.codesRepo.findActiveExpired(now, BATCH_SIZE);

    let expired = 0;
    for (const code of due) {
      const didExpire = await this.prisma.$transaction(async (tx) => {
        const count = await this.codesRepo.markExpiredIfActive(tx, code.id);
        if (count === 0) {
          return false; // otro proceso ya lo cambió: no emitir evento
        }
        await this.outbox.enqueue(tx, {
          aggregateId: code.orderId,
          aggregateType: 'PickupCode',
          eventType: 'qr.expired',
          routingKey: 'fulfillment.qr.expired',
          business: { orderId: code.orderId, buyerId: code.buyerId },
        });
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
}
