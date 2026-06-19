import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
 * `record(tx, ...)` dentro de la MISMA transacción del cambio de negocio (atómico). Para
 * acciones de solo lectura (validar) se usa `safeRecord`, best-effort: un fallo de auditoría
 * no debe romper la operación.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Registra la acción dentro de la transacción de negocio (atómico). */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toData(entry) });
  }

  /** Registra la acción de forma independiente y best-effort: nunca lanza. */
  async safeRecord(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toData(entry) });
    } catch (error) {
      this.logger.warn({ err: error, action: entry.action }, 'No se pudo registrar auditoría');
    }
  }

  private toData(entry: AuditEntry): Prisma.AuditLogCreateInput {
    return {
      action: entry.action,
      actorId: entry.actorId ?? null,
      orderId: entry.orderId ?? null,
      pickupCodeId: entry.pickupCodeId ?? null,
      deliveryId: entry.deliveryId ?? null,
      reason: entry.reason ?? null,
      metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      correlationId: entry.correlationId ?? null,
    };
  }
}
