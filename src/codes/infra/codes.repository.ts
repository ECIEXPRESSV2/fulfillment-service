import { Injectable } from '@nestjs/common';
import { PickupCode, PickupCodeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Datos para persistir un nuevo código de retiro `ACTIVE`. */
export interface CreatePickupCodeData {
  orderId: string;
  buyerId: string;
  storeId: string;
  token: string;
  shortCode: string;
  expiresAt: Date;
}

/**
 * Acceso a `pickup_codes` vía Prisma. Única capa donde vive Prisma para este dominio
 * (CLAUDE.md §4). Los métodos de escritura aceptan una tx para componer con el outbox.
 */
@Injectable()
export class CodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea el código (estado `ACTIVE` por defecto del schema) dentro de la tx dada. */
  create(tx: Prisma.TransactionClient, data: CreatePickupCodeData): Promise<PickupCode> {
    return tx.pickupCode.create({ data });
  }

  /** Código `ACTIVE` del pedido, si existe (invariante: a lo sumo uno). */
  findActiveByOrderId(
    orderId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<PickupCode | null> {
    return client.pickupCode.findFirst({
      where: { orderId, status: PickupCodeStatus.ACTIVE },
    });
  }

  /** Último código del pedido (cualquier estado), para consulta del comprador (UC-02). */
  findLatestByOrderId(orderId: string): Promise<PickupCode | null> {
    return this.prisma.pickupCode.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Busca exclusivamente por token (el valor que codifica el QR). */
  findByToken(token: string): Promise<PickupCode | null> {
    return this.prisma.pickupCode.findUnique({ where: { token } });
  }

  /** Busca por token (del QR) o por código corto legible. */
  findByTokenOrShortCode(code: string): Promise<PickupCode | null> {
    return this.prisma.pickupCode.findFirst({
      where: { OR: [{ token: code }, { shortCode: code }] },
    });
  }

  /** Marca un código como `USED` con la hora de uso (confirmación de entrega). */
  async markUsedById(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.pickupCode.update({
      where: { id },
      data: { status: PickupCodeStatus.USED, usedAt: new Date() },
    });
  }

  /** Invalida el código `ACTIVE` del pedido (UC-08). Idempotente: solo afecta `ACTIVE`. */
  async invalidateActiveByOrderId(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<number> {
    const { count } = await tx.pickupCode.updateMany({
      where: { orderId, status: PickupCodeStatus.ACTIVE },
      data: { status: PickupCodeStatus.INVALIDATED },
    });
    return count;
  }
}
