import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Between, EntityManager, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { PickupCodeEntity } from '../../database/entities/pickup-code.entity';
import { PickupCodeStatus } from '../../common/enums';

export type CreatePickupCodeInput = {
  orderId: string;
  buyerId: string;
  storeId: string;
  token: string;
  shortCode: string;
  expiresAt: Date;
};

/**
 * Acceso a `pickup_codes` vía TypeORM. Única capa donde vive el ORM para este dominio
 * (CLAUDE.md §4). Los métodos de escritura aceptan un EntityManager para componer con el outbox.
 */
@Injectable()
export class CodesRepository {
  constructor(
    @InjectRepository(PickupCodeEntity)
    private readonly repo: Repository<PickupCodeEntity>,
  ) {}

  private r(manager?: EntityManager): Repository<PickupCodeEntity> {
    return manager ? manager.getRepository(PickupCodeEntity) : this.repo;
  }

  /** Crea el código (estado `ACTIVE` por defecto del schema) dentro de la tx dada. */
  async create(
    data: CreatePickupCodeInput,
    manager?: EntityManager,
  ): Promise<PickupCodeEntity> {
    const now = new Date();
    const entity = this.repo.create({ ...data, id: randomUUID(), updatedAt: now });
    return this.r(manager).save(entity);
  }

  /** Código `ACTIVE` del pedido, si existe (invariante: a lo sumo uno). */
  async findActiveByOrderId(
    orderId: string,
    manager?: EntityManager,
  ): Promise<PickupCodeEntity | null> {
    return this.r(manager).findOne({
      where: { orderId, status: PickupCodeStatus.ACTIVE },
    });
  }

  /** Último código del pedido (cualquier estado), para consulta del comprador (UC-02). */
  async findLatestByOrderId(orderId: string): Promise<PickupCodeEntity | null> {
    return this.repo.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Busca exclusivamente por token (el valor que codifica el QR). */
  async findByToken(token: string): Promise<PickupCodeEntity | null> {
    return this.repo.findOne({ where: { token } });
  }

  /** Busca por token (del QR) o por código corto legible. */
  async findByTokenOrShortCode(code: string): Promise<PickupCodeEntity | null> {
    return this.repo
      .createQueryBuilder('pc')
      .where('pc.token = :code OR pc.short_code = :code', { code })
      .getOne();
  }

  /** Marca un código como `USED` con la hora de uso (confirmación de entrega). */
  async markUsedById(id: string, manager?: EntityManager): Promise<void> {
    await this.r(manager).update(id, {
      status: PickupCodeStatus.USED,
      usedAt: new Date(),
    });
  }

  /** Códigos `ACTIVE` ya vencidos (`expiresAt <= now`), en lotes (UC-07). */
  async findActiveExpired(now: Date, take: number): Promise<PickupCodeEntity[]> {
    return this.repo.find({
      where: {
        status: PickupCodeStatus.ACTIVE,
        expiresAt: LessThanOrEqual(now),
      },
      take,
      order: { expiresAt: 'ASC' },
    });
  }

  /**
   * Marca un código como `EXPIRED` **solo si sigue `ACTIVE`** (idempotente y seguro ante
   * carreras con confirmación/cancelación). Devuelve cuántas filas cambiaron (0 o 1).
   */
  async markExpiredIfActive(id: string, manager?: EntityManager): Promise<number> {
    const result = await this.r(manager).update(
      { id, status: PickupCodeStatus.ACTIVE },
      { status: PickupCodeStatus.EXPIRED },
    );
    return result.affected ?? 0;
  }

  /**
   * Códigos `ACTIVE` que vencen entre `now` y `threshold` y todavía no recibieron el aviso de
   * "por vencer" (`expiryWarningSentAt IS NULL`), en lotes.
   */
  async findActiveExpiringSoon(now: Date, threshold: Date, take: number): Promise<PickupCodeEntity[]> {
    return this.repo.find({
      where: {
        status: PickupCodeStatus.ACTIVE,
        expiresAt: Between(now, threshold),
        expiryWarningSentAt: IsNull(),
      },
      take,
      order: { expiresAt: 'ASC' },
    });
  }

  /**
   * Marca que ya se avisó del vencimiento próximo **solo si sigue `ACTIVE` y sin aviso previo**
   * (idempotente ante carreras). Devuelve cuántas filas cambiaron (0 o 1).
   */
  async markExpiryWarningSent(id: string, manager?: EntityManager): Promise<number> {
    const result = await this.r(manager).update(
      { id, status: PickupCodeStatus.ACTIVE, expiryWarningSentAt: IsNull() },
      { expiryWarningSentAt: new Date() },
    );
    return result.affected ?? 0;
  }

  /**
   * Invalida el código `ACTIVE` del pedido (UC-08). Idempotente: solo afecta `ACTIVE`.
   * Devuelve cuántas filas cambiaron (0 si ya no había código activo).
   */
  async invalidateActiveByOrderId(
    orderId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const result = await this.r(manager).update(
      { orderId, status: PickupCodeStatus.ACTIVE },
      { status: PickupCodeStatus.INVALIDATED },
    );
    return result.affected ?? 0;
  }
}
