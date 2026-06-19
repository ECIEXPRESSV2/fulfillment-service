import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { StoreStaffProjectionEntity } from '../../database/entities/store-staff-projection.entity';
import { StoreStaffRole } from '../../common/enums';

/**
 * Proyección de autorización de tienda (CLAUDE.md §12), construida desde
 * `identity.store.created` (owner) y `identity.store.staff_changed` (assigned/removed).
 * Es la fuente para verificar pertenencia vendedor↔tienda sin llamar a Identity.
 */
@Injectable()
export class StoreStaffProjectionService {
  constructor(
    @InjectRepository(StoreStaffProjectionEntity)
    private readonly repo: Repository<StoreStaffProjectionEntity>,
  ) {}

  private r(manager?: EntityManager): Repository<StoreStaffProjectionEntity> {
    return manager ? manager.getRepository(StoreStaffProjectionEntity) : this.repo;
  }

  /** Registra al dueño de la tienda (desde `identity.store.created`). */
  async upsertOwner(
    storeId: string,
    ownerId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.r(manager).upsert(
      { storeId, userId: ownerId, role: StoreStaffRole.OWNER, isActive: true },
      { conflictPaths: ['storeId', 'userId'], skipUpdateIfNoValuesChanged: false },
    );
  }

  /** Alta/reactivación de un colaborador (action 'assigned'). */
  async assignStaff(
    storeId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.r(manager).upsert(
      { storeId, userId, role: StoreStaffRole.STAFF, isActive: true },
      { conflictPaths: ['storeId', 'userId'], skipUpdateIfNoValuesChanged: false },
    );
  }

  /** Baja lógica de un colaborador (action 'removed'): conserva la fila e `isActive=false`. */
  async removeStaff(
    storeId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.r(manager).update({ storeId, userId }, { isActive: false });
  }

  /** ¿El usuario es owner o staff activo de la tienda? (RN-04). */
  async isAuthorized(storeId: string, userId: string): Promise<boolean> {
    const record = await this.repo.findOne({
      where: { storeId, userId, isActive: true },
    });
    return record !== null;
  }
}
