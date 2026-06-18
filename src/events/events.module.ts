import { Module } from '@nestjs/common';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { IdentityHandler } from './handlers/identity.handler';
import { IdempotencyService } from './idempotency.service';
import { OrderProjectionService } from './projections/order-projection.service';
import { StoreStaffProjectionService } from './projections/store-staff-projection.service';

/**
 * Consumo de eventos y proyecciones (CLAUDE.md §12). Por ahora expone las proyecciones,
 * la idempotencia de consumo y el `StoreAccessGuard`. El `consumer.service` (cola/bindings/
 * DLQ) y el `order.handler` se agregan cuando exista el módulo `codes` (genera el código).
 */
@Module({
  providers: [
    OrderProjectionService,
    StoreStaffProjectionService,
    IdempotencyService,
    IdentityHandler,
    StoreAccessGuard,
  ],
  exports: [
    OrderProjectionService,
    StoreStaffProjectionService,
    IdempotencyService,
    IdentityHandler,
    StoreAccessGuard,
  ],
})
export class EventsModule {}
