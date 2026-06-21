import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { AuditService } from './audit.service';

/**
 * Auditoría. Global para inyectar `AuditService` desde cualquier dominio (codes, deliveries,
 * expiration, consumer) sin acoplar imports.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
