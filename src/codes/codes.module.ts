import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PickupCodeEntity } from '../database/entities/pickup-code.entity';
import { EventsModule } from '../events/events.module';
import { OutboxModule } from '../outbox/outbox.module';
import { StorageModule } from '../storage/storage.module';
import { CodesService } from './domain/codes.service';
import { QrService } from '../qr/domain/qr.service';
import { ShortCodeRateLimiter } from './domain/short-code-rate-limiter';
import { CodesController } from './http/codes.controller';
import { CodesRepository } from './infra/codes.repository';

/**
 * Códigos de retiro (generar, consultar, validar). Importa `OutboxModule` para encolar
 * `qr.generated`, `EventsModule` para la proyección de staff (autorización por tienda) y
 * `StorageModule` para subir el PNG del QR al blob privado y firmar su SAS. Provee `QrService`
 * (render del PNG) y lo exporta para que `QrModule` sirva la imagen sin ciclo de módulos.
 * Exporta `CodesService` para que el `order.handler` lo use al consumir `order.order.*`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PickupCodeEntity]), OutboxModule, EventsModule, StorageModule],
  controllers: [CodesController],
  providers: [CodesService, CodesRepository, ShortCodeRateLimiter, QrService],
  exports: [CodesService, CodesRepository, QrService],
})
export class CodesModule {}
