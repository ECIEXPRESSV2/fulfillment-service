import { Injectable } from '@nestjs/common';
import {
  Delivery,
  DeliveryFailureReason,
  DeliveryMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Datos para registrar una entrega (exitosa con `method`, o fallida con `failureReason`). */
export interface CreateDeliveryData {
  orderId: string;
  storeId: string;
  confirmedByUserId: string;
  method?: DeliveryMethod | null;
  failureReason?: DeliveryFailureReason | null;
  note?: string | null;
}

/**
 * Acceso a `deliveries` vía Prisma (única capa con Prisma en este dominio, CLAUDE.md §4).
 */
@Injectable()
export class DeliveriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra una entrega dentro de la tx dada. */
  create(tx: Prisma.TransactionClient, data: CreateDeliveryData): Promise<Delivery> {
    return tx.delivery.create({ data });
  }

  /**
   * Entrega **exitosa** más reciente del pedido (con `method` no nulo). Sirve para la
   * idempotencia de la confirmación (no crear una segunda entrega).
   */
  findSuccessfulByOrderId(
    orderId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Delivery | null> {
    return client.delivery.findFirst({
      where: { orderId, method: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Todas las entregas (exitosas y fallidas) de un pedido, más recientes primero (UC-09). */
  findAllByOrderId(orderId: string): Promise<Delivery[]> {
    return this.prisma.delivery.findMany({
      where: { orderId },
      orderBy: { deliveredAt: 'desc' },
    });
  }

  /** Historial paginado de entregas de una tienda con filtros (UC-10). */
  async listByStore(storeId: string, filters: DeliveryListFilters): Promise<{ data: Delivery[]; total: number }> {
    const where: Prisma.DeliveryWhereInput = {
      storeId,
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.confirmedByUserId ? { confirmedByUserId: filters.confirmedByUserId } : {}),
      ...(filters.from || filters.to
        ? { deliveredAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        orderBy: { deliveredAt: filters.order },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.delivery.count({ where }),
    ]);

    return { data, total };
  }
}

/** Filtros normalizados (fechas como Date) para `listByStore`. */
export interface DeliveryListFilters {
  page: number;
  limit: number;
  order: 'asc' | 'desc';
  method?: DeliveryMethod | null;
  confirmedByUserId?: string | null;
  from?: Date | null;
  to?: Date | null;
}
