import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { IdempotencyService } from '../idempotency.service';
import { StoreStaffProjectionService } from '../projections/store-staff-projection.service';
import { IdentityHandler, IDENTITY_ROUTING_KEYS } from './identity.handler';

function build() {
  const tx = {} as EntityManager;
  const dataSource = {
    transaction: jest.fn((cb: (manager: EntityManager) => Promise<unknown>) => cb(tx)),
  } as unknown as DataSource;

  const storeStaff = {
    upsertOwner: jest.fn().mockResolvedValue(undefined),
    assignStaff: jest.fn().mockResolvedValue(undefined),
    removeStaff: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<StoreStaffProjectionService>;

  const idempotency = {
    isProcessed: jest.fn().mockResolvedValue(false),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    isDuplicateError: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<IdempotencyService>;

  const handler = new IdentityHandler(dataSource, storeStaff, idempotency);
  return { handler, storeStaff, idempotency, dataSource };
}

describe('IdentityHandler', () => {
  it('store.created registra al owner y marca el evento como procesado', async () => {
    const { handler, storeStaff, idempotency } = build();

    await handler.handle(IDENTITY_ROUTING_KEYS.storeCreated, {
      storeId: 'str-1',
      ownerId: 'usr-owner',
      idempotencyKey: 'idem-1',
    });

    // upsertOwner(storeId, ownerId, manager) — parámetros aplanados
    expect(storeStaff.upsertOwner).toHaveBeenCalledWith(
      'str-1',
      'usr-owner',
      expect.anything(),
    );
    expect(idempotency.markProcessed).toHaveBeenCalledWith(
      expect.anything(),
      'idem-1',
      IDENTITY_ROUTING_KEYS.storeCreated,
    );
  });

  it('staff_changed assigned da de alta al colaborador', async () => {
    const { handler, storeStaff } = build();

    await handler.handle(IDENTITY_ROUTING_KEYS.staffChanged, {
      storeId: 'str-1',
      userId: 'usr-2',
      action: 'assigned',
      idempotencyKey: 'idem-2',
    });

    // assignStaff(storeId, userId, manager) — parámetros aplanados
    expect(storeStaff.assignStaff).toHaveBeenCalledWith(
      'str-1',
      'usr-2',
      expect.anything(),
    );
  });

  it('staff_changed removed da de baja lógica al colaborador', async () => {
    const { handler, storeStaff } = build();

    await handler.handle(IDENTITY_ROUTING_KEYS.staffChanged, {
      storeId: 'str-1',
      userId: 'usr-2',
      action: 'removed',
      idempotencyKey: 'idem-3',
    });

    // removeStaff(storeId, userId, manager) — parámetros aplanados
    expect(storeStaff.removeStaff).toHaveBeenCalledWith(
      'str-1',
      'usr-2',
      expect.anything(),
    );
  });

  it('no reprocesa un evento ya procesado (idempotencia)', async () => {
    const { handler, storeStaff, idempotency } = build();
    (idempotency.isProcessed as jest.Mock).mockResolvedValue(true);

    await handler.handle(IDENTITY_ROUTING_KEYS.storeCreated, {
      storeId: 'str-1',
      ownerId: 'usr-owner',
      idempotencyKey: 'idem-1',
    });

    expect(storeStaff.upsertOwner).not.toHaveBeenCalled();
  });

  it('ignora un evento incompleto sin lanzar', async () => {
    const { handler, storeStaff } = build();

    await expect(
      handler.handle(IDENTITY_ROUTING_KEYS.storeCreated, { idempotencyKey: 'idem-x' }),
    ).resolves.toBeUndefined();
    expect(storeStaff.upsertOwner).not.toHaveBeenCalled();
  });

  it('traga la violación de unicidad si otro consumidor procesó en paralelo', async () => {
    const { handler, idempotency, dataSource } = build();
    // Simula QueryFailedError de TypeORM con pg unique violation code 23505
    const dupError = Object.assign(
      new QueryFailedError('INSERT INTO processed_events ...', [], new Error('duplicate key')),
      { code: '23505' },
    );
    (dataSource.transaction as jest.Mock).mockRejectedValue(dupError);
    (idempotency.isDuplicateError as jest.Mock).mockReturnValue(true);

    await expect(
      handler.handle(IDENTITY_ROUTING_KEYS.staffChanged, {
        storeId: 'str-1',
        userId: 'usr-2',
        action: 'assigned',
        idempotencyKey: 'idem-dup',
      }),
    ).resolves.toBeUndefined();
  });
});
