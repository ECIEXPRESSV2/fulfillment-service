import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreAccessGuard } from '../common/guards/store-access.guard';
import { OrderProjectionEntity } from '../database/entities/order-projection.entity';
import { ProcessedEventEntity } from '../database/entities/processed-event.entity';
import { StoreStaffProjectionEntity } from '../database/entities/store-staff-projection.entity';
import { IdempotencyService } from './idempotency.service';
import { OrderProjectionService } from './projections/order-projection.service';
import { StoreStaffProjectionService } from './projections/store-staff-projection.service';

/**
 * Proyecciones e idempotencia de consumo (CLAUDE.md §12), más el `StoreAccessGuard`. Es la
 * base que usan `codes`, `deliveries` y el `ConsumerModule`. El consumo en sí (cola, bindings,
 * DLQ y handlers) vive en `ConsumerModule`, que importa este módulo y `CodesModule`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderProjectionEntity,
      StoreStaffProjectionEntity,
      ProcessedEventEntity,
    ]),
  ],
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
