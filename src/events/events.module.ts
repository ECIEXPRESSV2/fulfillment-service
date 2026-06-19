import { Module } from '@nestjs/common';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { IdempotencyService } from './idempotency.service';
import { OrderProjectionService } from './projections/order-projection.service';
import { StoreStaffProjectionService } from './projections/store-staff-projection.service';

/**
 * Proyecciones e idempotencia de consumo (CLAUDE.md §12), más el `StoreAccessGuard`. Es la
 * base que usan `codes`, `deliveries` y el `ConsumerModule`. El consumo en sí (cola, bindings,
 * DLQ y handlers) vive en `ConsumerModule`, que importa este módulo y `CodesModule`.
 */
@Module({
  providers: [
    OrderProjectionService,
    StoreStaffProjectionService,
    IdempotencyService,
    StoreAccessGuard,
  ],
  exports: [
    OrderProjectionService,
    StoreStaffProjectionService,
    IdempotencyService,
    StoreAccessGuard,
  ],
})
export class EventsModule {}
