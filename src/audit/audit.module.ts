import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Auditoría. Global para inyectar `AuditService` desde cualquier dominio (codes, deliveries,
 * expiration, consumer) sin acoplar imports.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
