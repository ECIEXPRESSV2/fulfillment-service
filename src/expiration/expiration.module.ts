import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CodesModule } from '../codes/codes.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ExpirationScheduler } from './expiration.scheduler';
import { ExpirationService } from './expiration.service';

/**
 * Expiración programada de códigos vencidos (UC-07). Importa `ScheduleModule` (cron),
 * `CodesModule` (repositorio) y `OutboxModule` (publicar `qr.expired`).
 */
@Module({
  imports: [ScheduleModule.forRoot(), CodesModule, OutboxModule],
  providers: [ExpirationService, ExpirationScheduler],
})
export class ExpirationModule {}
