import { Injectable } from '@nestjs/common';
import { OrderProjection, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Permite ejecutar dentro de la tx del handler o, si no se pasa, con el cliente base. */
type PrismaLike = Prisma.TransactionClient | PrismaService;

export interface OrderConfirmedProjectionInput {
  orderId: string;
  buyerId: string;
  storeId: string;
  pickupExpiresAt?: Date | null;
}

/**
 * Proyección local del contexto del pedido (CLAUDE.md §12), construida desde
 * `order.order.confirmed` / `order.order.cancelled`. Da `buyerId`/`storeId`/`pickupExpiresAt`
 * para generar el código y autorizar por tienda, sin llamadas síncronas a Order.
 */
@Injectable()
export class OrderProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea o actualiza la proyección al confirmarse el pedido (idempotente por `orderId`). */
  async upsertFromConfirmed(
    input: OrderConfirmedProjectionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const data = {
      buyerId: input.buyerId,
      storeId: input.storeId,
      pickupExpiresAt: input.pickupExpiresAt ?? null,
      status: 'CONFIRMED',
    };
    await this.db(tx).orderProjection.upsert({
      where: { orderId: input.orderId },
      create: { orderId: input.orderId, ...data },
      update: data,
    });
  }

  /** Marca la proyección como cancelada. Tolerante: no falla si el pedido no existe localmente. */
  async markCancelled(orderId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.db(tx).orderProjection.updateMany({
      where: { orderId },
      data: { status: 'CANCELLED' },
    });
  }

  /** Lectura del contexto del pedido (para generar código y autorizar por tienda). */
  getByOrderId(orderId: string): Promise<OrderProjection | null> {
    return this.prisma.orderProjection.findUnique({ where: { orderId } });
  }

  private db(tx?: Prisma.TransactionClient): PrismaLike {
    return tx ?? this.prisma;
  }
}
