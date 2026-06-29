import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEventEntity } from '../database/entities/outbox-event.entity';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';
import { ServiceBusPublisherService } from './service-bus-publisher.service';

/**
 * Módulo del Transactional Outbox. Expone `OutboxService` para que los dominios encolen
 * eventos dentro de su transacción; el `OutboxWorker` los publica por `ServiceBusPublisherService`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEventEntity])],
  providers: [OutboxService, OutboxWorker, ServiceBusPublisherService],
  exports: [OutboxService],
})
export class OutboxModule {}
