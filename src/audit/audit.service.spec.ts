import { Repository } from 'typeorm';
import { AuditAction } from '../common/enums';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { AuditService } from './audit.service';

function buildService(repoOverrides: Partial<jest.Mocked<Repository<AuditLogEntity>>> = {}) {
  const repo = {
    create: jest.fn().mockImplementation((data) => ({ ...data })),
    save: jest.fn().mockResolvedValue(undefined),
    ...repoOverrides,
  } as unknown as jest.Mocked<Repository<AuditLogEntity>>;
  return { service: new AuditService(repo), repo };
}

describe('AuditService', () => {
  it('record escribe la entrada en el repositorio', async () => {
    const { service, repo } = buildService();

    await service.record({
      action: AuditAction.DELIVERY_CONFIRMED,
      actorId: 'seller-1',
      orderId: 'ord-1',
      deliveryId: 'dlv-1',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.DELIVERY_CONFIRMED,
        actorId: 'seller-1',
        orderId: 'ord-1',
        deliveryId: 'dlv-1',
      }),
    );
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('safeRecord no lanza si la escritura falla (best-effort)', async () => {
    const { service } = buildService({
      save: jest.fn().mockRejectedValue(new Error('db caída')),
    });

    await expect(
      service.safeRecord({ action: AuditAction.CODE_VALIDATED, actorId: 'seller-1' }),
    ).resolves.toBeUndefined();
  });
});
