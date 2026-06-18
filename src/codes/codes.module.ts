import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { OutboxModule } from '../outbox/outbox.module';
import { CodesService } from './domain/codes.service';
import { ShortCodeRateLimiter } from './domain/short-code-rate-limiter';
import { CodesController } from './http/codes.controller';
import { CodesRepository } from './infra/codes.repository';

/**
 * Códigos de retiro (generar, consultar, validar). Importa `OutboxModule` para encolar
 * `qr.generated` y `EventsModule` para la proyección de staff (autorización por tienda).
 * Exporta `CodesService` para que el `order.handler` lo use al consumir `order.order.*`.
 */
@Module({
  imports: [OutboxModule, EventsModule],
  controllers: [CodesController],
  providers: [CodesService, CodesRepository, ShortCodeRateLimiter],
  exports: [CodesService, CodesRepository],
})
export class CodesModule {}
