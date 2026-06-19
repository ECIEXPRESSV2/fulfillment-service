import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OrderProjectionEntity } from '../../database/entities/order-projection.entity';

export type OrderProjectionInput = {
  orderId: string;
  buyerId: string;
  storeId: string;
  pickupExpiresAt?: Date | null;
  status?: string;
};

/**
 * Proyección local del contexto del pedido (CLAUDE.md §12), construida desde
 * `order.order.confirmed` / `order.order.cancelled`. Da `buyerId`/`storeId`/`pickupExpiresAt`
 * para generar el código y autorizar por tienda, sin llamadas síncronas a Order.
 */
@Injectable()
export class OrderProjectionService {
  constructor(
    @InjectRepository(OrderProjectionEntity)
    private readonly repo: Repository<OrderProjectionEntity>,
  ) {}

  private r(manager?: EntityManager): Repository<OrderProjectionEntity> {
    return manager ? manager.getRepository(OrderProjectionEntity) : this.repo;
  }

  /** Crea o actualiza la proyección al confirmarse el pedido (idempotente por `orderId`). */
  async upsertFromConfirmed(
    input: OrderProjectionInput,
    manager?: EntityManager,
  ): Promise<void> {
    await this.r(manager).upsert(
      {
        orderId: input.orderId,
        buyerId: input.buyerId,
        storeId: input.storeId,
        pickupExpiresAt: input.pickupExpiresAt ?? null,
        status: input.status ?? 'confirmed',
      },
      { conflictPaths: ['orderId'], skipUpdateIfNoValuesChanged: false },
    );
  }

  /** Marca la proyección como cancelada. Tolerante: no falla si el pedido no existe localmente. */
  async markCancelled(orderId: string, manager?: EntityManager): Promise<void> {
    await this.r(manager).update({ orderId }, { status: 'cancelled' });
  }

  /** Lectura del contexto del pedido (para generar código y autorizar por tienda). */
  async getByOrderId(orderId: string): Promise<OrderProjectionEntity | null> {
    return this.repo.findOne({ where: { orderId } });
  }
}
