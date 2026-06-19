import { PickupCode, PickupCodeStatus, Prisma } from '@prisma/client';
import { CodesRepository } from '../codes/infra/codes.repository';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpirationService } from './expiration.service';

const tx = {} as Prisma.TransactionClient;

function buildCode(overrides: Partial<PickupCode> = {}): PickupCode {
  return {
    id: 'code-1',
    orderId: 'ord-1',
    buyerId: 'buyer-1',
    storeId: 'str-1',
    token: 'tok',
    shortCode: 'A7K9-P2MX',
    status: PickupCodeStatus.ACTIVE,
    expiresAt: new Date(Date.now() - 1000),
    usedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build() {
  const prisma = {
    $transaction: jest.fn((cb: (t: Prisma.TransactionClient) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;

  const codesRepo = {
    findActiveExpired: jest.fn(),
    markExpiredIfActive: jest.fn(),
  } as unknown as jest.Mocked<CodesRepository>;

  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<OutboxService>;

  const service = new ExpirationService(prisma, codesRepo, outbox);
  return { service, codesRepo, outbox };
}

describe('ExpirationService', () => {
  it('expira cada código ACTIVE vencido y publica qr.expired', async () => {
    const { service, codesRepo, outbox } = build();
    codesRepo.findActiveExpired.mockResolvedValue([
      buildCode({ id: 'c1', orderId: 'o1', buyerId: 'b1' }),
      buildCode({ id: 'c2', orderId: 'o2', buyerId: 'b2' }),
    ]);
    codesRepo.markExpiredIfActive.mockResolvedValue(1);

    const result = await service.expireDueCodes();

    expect(result.expired).toBe(2);
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        routingKey: 'fulfillment.qr.expired',
        business: { orderId: 'o1', buyerId: 'b1' },
      }),
    );
  });

  it('no publica evento si el código ya no estaba ACTIVE (carrera): idempotente', async () => {
    const { service, codesRepo, outbox } = build();
    codesRepo.findActiveExpired.mockResolvedValue([buildCode()]);
    codesRepo.markExpiredIfActive.mockResolvedValue(0); // ya no estaba ACTIVE

    const result = await service.expireDueCodes();

    expect(result.expired).toBe(0);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('no hace nada cuando no hay códigos vencidos', async () => {
    const { service, codesRepo, outbox } = build();
    codesRepo.findActiveExpired.mockResolvedValue([]);

    const result = await service.expireDueCodes();

    expect(result.expired).toBe(0);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
