import { Injectable } from '@nestjs/common';
import { Prisma, StoreStaffRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type PrismaLike = Prisma.TransactionClient | PrismaService;

export interface StoreStaffInput {
  storeId: string;
  userId: string;
}

/**
 * Proyección de autorización de tienda (CLAUDE.md §12), construida desde
 * `identity.store.created` (owner) y `identity.store.staff_changed` (assigned/removed).
 * Es la fuente para verificar pertenencia vendedor↔tienda sin llamar a Identity.
 */
@Injectable()
export class StoreStaffProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra al dueño de la tienda (desde `identity.store.created`). */
  upsertOwner(input: StoreStaffInput, tx?: Prisma.TransactionClient): Promise<unknown> {
    return this.upsert(input, StoreStaffRole.OWNER, tx);
  }

  /** Alta/reactivación de un colaborador (action 'assigned'). */
  assignStaff(input: StoreStaffInput, tx?: Prisma.TransactionClient): Promise<unknown> {
    return this.upsert(input, StoreStaffRole.STAFF, tx);
  }

  /** Baja lógica de un colaborador (action 'removed'): conserva la fila e `isActive=false`. */
  async removeStaff(input: StoreStaffInput, tx?: Prisma.TransactionClient): Promise<void> {
    await this.db(tx).storeStaffProjection.updateMany({
      where: { storeId: input.storeId, userId: input.userId },
      data: { isActive: false },
    });
  }

  /** ¿El usuario es owner o staff activo de la tienda? (RN-04). */
  async isAuthorized(storeId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.storeStaffProjection.findUnique({
      where: { storeId_userId: { storeId, userId } },
    });
    return Boolean(row?.isActive);
  }

  private upsert(
    input: StoreStaffInput,
    role: StoreStaffRole,
    tx?: Prisma.TransactionClient,
  ): Promise<unknown> {
    return this.db(tx).storeStaffProjection.upsert({
      where: { storeId_userId: { storeId: input.storeId, userId: input.userId } },
      create: { storeId: input.storeId, userId: input.userId, role, isActive: true },
      update: { role, isActive: true },
    });
  }

  private db(tx?: Prisma.TransactionClient): PrismaLike {
    return tx ?? this.prisma;
  }
}
