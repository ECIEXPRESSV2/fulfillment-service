import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { AuditAction } from '../common/enums';

/** Una entrada de auditoría de una acción sensible (CLAUDE.md §5, RN-12). */
export interface AuditEntry {
  action: AuditAction;
  actorId?: string;
  orderId?: string;
  pickupCodeId?: string;
  deliveryId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Log append-only de acciones sensibles. Para acciones transaccionales se escribe con
 * `record(entry, manager)` dentro de la MISMA transacción del cambio de negocio (atómico). Para
 * acciones de solo lectura (validar) se usa `safeRecord`, best-effort: un fallo de auditoría
 * no debe romper la operación.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  private r(manager?: EntityManager): Repository<AuditLogEntity> {
    return manager ? manager.getRepository(AuditLogEntity) : this.repo;
  }

  /** Registra la acción dentro de la transacción de negocio (atómico). */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const entity = this.repo.create({
      action: entry.action,
      actorId: entry.actorId ?? null,
      orderId: entry.orderId ?? null,
      pickupCodeId: entry.pickupCodeId ?? null,
      deliveryId: entry.deliveryId ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? null,
      correlationId: entry.correlationId ?? null,
    });
    await this.r(manager).save(entity);
  }

  /** Registra la acción de forma independiente y best-effort: nunca lanza. */
  async safeRecord(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (error) {
      this.logger.warn({ err: error, action: entry.action }, 'No se pudo registrar auditoría');
    }
  }
}
