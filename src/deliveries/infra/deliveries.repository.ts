import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  EntityManager,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { DeliveryEntity } from '../../database/entities/delivery.entity';
import { DeliveryMethod } from '../../common/enums';

export type CreateDeliveryInput = {
  orderId: string;
  storeId: string;
  confirmedByUserId: string;
  method: DeliveryMethod | null;
  failureReason?: string | null;
  note?: string | null;
};

/** Filtros normalizados (fechas como Date) para `listByStore`. */
export type DeliveryListFilters = {
  page: number;
  limit: number;
  order?: 'ASC' | 'DESC';
  method?: DeliveryMethod | null;
  confirmedByUserId?: string | null;
  from?: Date | null;
  to?: Date | null;
};

/**
 * Acceso a `deliveries` vía TypeORM (única capa con ORM en este dominio, CLAUDE.md §4).
 */
@Injectable()
export class DeliveriesRepository {
  constructor(
    @InjectRepository(DeliveryEntity)
    private readonly repo: Repository<DeliveryEntity>,
  ) {}

  private r(manager?: EntityManager): Repository<DeliveryEntity> {
    return manager ? manager.getRepository(DeliveryEntity) : this.repo;
  }

  /** Registra una entrega dentro de la tx dada. */
  async create(
    data: CreateDeliveryInput,
    manager?: EntityManager,
  ): Promise<DeliveryEntity> {
    const entity = this.repo.create(data as Partial<DeliveryEntity>);
    return this.r(manager).save(entity);
  }

  /**
   * Entrega **exitosa** más reciente del pedido (con `method` no nulo). Sirve para la
   * idempotencia de la confirmación (no crear una segunda entrega).
   */
  async findSuccessfulByOrderId(orderId: string): Promise<DeliveryEntity | null> {
    return this.repo.findOne({
      where: { orderId, method: Not(IsNull()) },
    });
  }

  /** Todas las entregas (exitosas y fallidas) de un pedido, más recientes primero (UC-09). */
  async findAllByOrderId(orderId: string): Promise<DeliveryEntity[]> {
    return this.repo.find({
      where: { orderId },
      order: { deliveredAt: 'DESC' },
    });
  }

  /** Historial paginado de entregas de una tienda con filtros (UC-10). */
  async listByStore(
    storeId: string,
    filters: DeliveryListFilters,
  ): Promise<{ data: DeliveryEntity[]; total: number }> {
    const where: Record<string, unknown> = { storeId };

    if (filters.method) {
      where['method'] = filters.method;
    }
    if (filters.confirmedByUserId) {
      where['confirmedByUserId'] = filters.confirmedByUserId;
    }
    if (filters.from && filters.to) {
      where['deliveredAt'] = Between(filters.from, filters.to);
    }

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { deliveredAt: filters.order ?? 'DESC' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    });

    return { data, total };
  }
}
