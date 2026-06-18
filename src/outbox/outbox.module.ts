import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';
import { RabbitmqService } from './rabbitmq.service';

/**
 * Módulo del Transactional Outbox. Expone `OutboxService` para que los dominios encolen
 * eventos dentro de su transacción; el `OutboxWorker` los publica por `RabbitmqService`.
 */
@Module({
  providers: [OutboxService, OutboxWorker, RabbitmqService],
  exports: [OutboxService],
})
export class OutboxModule {}
