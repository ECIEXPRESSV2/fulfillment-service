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
}
