import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../idempotency.service';
import { StoreStaffProjectionService } from '../projections/store-staff-projection.service';
import { IdentityHandler, IDENTITY_ROUTING_KEYS } from './identity.handler';

function build() {
  const txMock = {} as Prisma.TransactionClient;
  const prisma = {
    $transaction: jest.fn((cb: (tx: Prisma.TransactionClient) => Promise<unknown>) => cb(txMock)),
  } as unknown as PrismaService;

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

  const handler = new IdentityHandler(prisma, storeStaff, idempotency);
  return { handler, storeStaff, idempotency, prisma };
}

describe('IdentityHandler', () => {
  it('store.created registra al owner y marca el evento como procesado', async () => {
    const { handler, storeStaff, idempotency } = build();

    await handler.handle(IDENTITY_ROUTING_KEYS.storeCreated, {
      storeId: 'str-1',
      ownerId: 'usr-owner',
      idempotencyKey: 'idem-1',
    });

    expect(storeStaff.upsertOwner).toHaveBeenCalledWith(
      { storeId: 'str-1', userId: 'usr-owner' },
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

    expect(storeStaff.assignStaff).toHaveBeenCalledWith(
      { storeId: 'str-1', userId: 'usr-2' },
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

    expect(storeStaff.removeStaff).toHaveBeenCalledWith(
      { storeId: 'str-1', userId: 'usr-2' },
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
    const { handler, idempotency, prisma } = build();
    const dupError = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '7.8.0',
    });
    (prisma.$transaction as jest.Mock).mockRejectedValue(dupError);
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
