import { EntityManager, Repository } from 'typeorm';
import { OrderProjectionEntity } from '../../database/entities/order-projection.entity';
import { StoreStaffProjectionEntity } from '../../database/entities/store-staff-projection.entity';
import { StoreStaffRole } from '../../common/enums';
import { OrderProjectionService } from './order-projection.service';
import { StoreStaffProjectionService } from './store-staff-projection.service';

describe('OrderProjectionService', () => {
  function build() {
    const repo = {
      upsert: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<OrderProjectionEntity>>;
    return { service: new OrderProjectionService(repo), repo };
  }

  it('upsertFromConfirmed hace upsert con conflictPaths orderId', async () => {
    const { service, repo } = build();
    await service.upsertFromConfirmed({ orderId: 'o1', buyerId: 'b1', storeId: 's1' });
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', buyerId: 'b1', storeId: 's1', status: 'confirmed' }),
      expect.objectContaining({ conflictPaths: ['orderId'] }),
    );
  });

  it('usa el manager transaccional cuando se pasa', async () => {
    const { service } = build();
    const mgrRepo = { upsert: jest.fn() };
    const manager = { getRepository: jest.fn().mockReturnValue(mgrRepo) } as unknown as EntityManager;
    await service.upsertFromConfirmed({ orderId: 'o1', buyerId: 'b1', storeId: 's1' }, manager);
    expect(mgrRepo.upsert).toHaveBeenCalled();
  });

  it('markCancelled actualiza el status a cancelled', async () => {
    const { service, repo } = build();
    await service.markCancelled('o1');
    expect(repo.update).toHaveBeenCalledWith({ orderId: 'o1' }, { status: 'cancelled' });
  });

  it('getByOrderId consulta por orderId', async () => {
    const { service, repo } = build();
    repo.findOne.mockResolvedValue({ orderId: 'o1' } as OrderProjectionEntity);
    const res = await service.getByOrderId('o1');
    expect(res?.orderId).toBe('o1');
    expect(repo.findOne).toHaveBeenCalledWith({ where: { orderId: 'o1' } });
  });
});

describe('StoreStaffProjectionService', () => {
  function build() {
    const repo = {
      upsert: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<StoreStaffProjectionEntity>>;
    return { service: new StoreStaffProjectionService(repo), repo };
  }

  it('upsertOwner registra al dueño con rol OWNER', async () => {
    const { service, repo } = build();
    await service.upsertOwner('s1', 'owner-1', 'Andrea Ruiz');
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 's1', userId: 'owner-1', userName: 'Andrea Ruiz', role: StoreStaffRole.OWNER, isActive: true }),
      expect.objectContaining({ conflictPaths: ['storeId', 'userId'] }),
    );
  });

  it('assignStaff registra colaborador activo con rol STAFF', async () => {
    const { service, repo } = build();
    await service.assignStaff('s1', 'u1', 'Laura Gomez');
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userName: 'Laura Gomez', role: StoreStaffRole.STAFF, isActive: true }),
      expect.anything(),
    );
  });

  it('removeStaff hace baja lógica (isActive=false)', async () => {
    const { service, repo } = build();
    await service.removeStaff('s1', 'u1');
    expect(repo.update).toHaveBeenCalledWith({ storeId: 's1', userId: 'u1' }, { isActive: false });
  });

  it('isAuthorized es true solo si hay fila activa', async () => {
    const { service, repo } = build();
    repo.findOne.mockResolvedValueOnce({ id: 'x' } as StoreStaffProjectionEntity);
    expect(await service.isAuthorized('s1', 'u1')).toBe(true);
    repo.findOne.mockResolvedValueOnce(null);
    expect(await service.isAuthorized('s1', 'u2')).toBe(false);
  });
});
