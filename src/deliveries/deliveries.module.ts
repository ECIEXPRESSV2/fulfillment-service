import { Module } from '@nestjs/common';
import { CodesModule } from '../codes/codes.module';
import { EventsModule } from '../events/events.module';
import { OutboxModule } from '../outbox/outbox.module';
import { DeliveriesService } from './domain/deliveries.service';
import { DeliveriesController } from './http/deliveries.controller';
import { DeliveriesRepository } from './infra/deliveries.repository';

/**
 * Entregas (confirmar, manual, fallida). Importa `CodesModule` (revalidar y marcar el código
 * `USED`), `EventsModule` (proyección del pedido + `StoreAccessGuard`) y `OutboxModule`
 * (publicar `delivery.confirmed` / `delivery.failed`).
 */
@Module({
  imports: [CodesModule, EventsModule, OutboxModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveriesRepository],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
