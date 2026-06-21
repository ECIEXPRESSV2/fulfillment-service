import { Module } from '@nestjs/common';
import { CodesModule } from '../codes/codes.module';
import { ConsumerService } from './consumer.service';
import { EventsModule } from './events.module';
import { IdentityHandler } from './handlers/identity.handler';
import { OrderHandler } from './handlers/order.handler';

/**
 * Consumo de eventos del bus: el `ConsumerService` (cola/bindings/DLQ) y los handlers
 * (`OrderHandler`, `IdentityHandler`). Se separa de `EventsModule` para romper el ciclo de
 * módulos: importa `CodesModule` (generar/invalidar el código) y `EventsModule` (proyecciones
 * e idempotencia), que a su vez `CodesModule` ya usa.
 */
@Module({
  imports: [EventsModule, CodesModule],
  providers: [ConsumerService, OrderHandler, IdentityHandler],
})
export class ConsumerModule {}
