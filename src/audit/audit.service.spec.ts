import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('record escribe la entrada dentro de la tx', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
    const service = new AuditService({} as PrismaService);

    await service.record(tx, {
      action: AuditAction.DELIVERY_CONFIRMED,
      actorId: 'seller-1',
      orderId: 'ord-1',
      deliveryId: 'dlv-1',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AuditAction.DELIVERY_CONFIRMED,
        actorId: 'seller-1',
        orderId: 'ord-1',
        deliveryId: 'dlv-1',
      }),
    });
  });

  it('safeRecord no lanza si la escritura falla (best-effort)', async () => {
    const prisma = {
      auditLog: { create: jest.fn().mockRejectedValue(new Error('db caída')) },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await expect(
      service.safeRecord({ action: AuditAction.CODE_VALIDATED, actorId: 'seller-1' }),
    ).resolves.toBeUndefined();
  });
});
