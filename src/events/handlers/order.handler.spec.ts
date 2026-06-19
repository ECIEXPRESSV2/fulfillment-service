import { Prisma } from '@prisma/client';
import { CodesService } from '../../codes/domain/codes.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../idempotency.service';
import { OrderProjectionService } from '../projections/order-projection.service';
import { OrderHandler, ORDER_ROUTING_KEYS } from './order.handler';

function build() {
  const txMock = {} as Prisma.TransactionClient;
  const prisma = {
    $transaction: jest.fn((cb: (tx: Prisma.TransactionClient) => Promise<unknown>) => cb(txMock)),
  } as unknown as PrismaService;

  const orderProjection = {
    upsertFromConfirmed: jest.fn().mockResolvedValue(undefined),
    markCancelled: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<OrderProjectionService>;

  const codesService = {
    generateForOrder: jest.fn().mockResolvedValue({ created: true }),
    invalidateByOrder: jest.fn().mockResolvedValue({ invalidated: true }),
  } as unknown as jest.Mocked<CodesService>;

  const idempotency = {
    isProcessed: jest.fn().mockResolvedValue(false),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    isDuplicateError: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<IdempotencyService>;

  const handler = new OrderHandler(prisma, orderProjection, codesService, idempotency);
  return { handler, orderProjection, codesService, idempotency };
}

describe('OrderHandler', () => {
  it('confirmed: proyecta el pedido y genera el código (UC-01)', async () => {
    const { handler, orderProjection, codesService, idempotency } = build();

    await handler.handle(ORDER_ROUTING_KEYS.confirmed, {
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      storeId: 'str-1',
      pickupExpiresAt: '2026-07-01T12:00:00.000Z',
      idempotencyKey: 'idem-1',
    });

    expect(orderProjection.upsertFromConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'ord-1', pickupExpiresAt: new Date('2026-07-01T12:00:00.000Z') }),
      expect.anything(),
    );
    expect(codesService.generateForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'ord-1', buyerId: 'buyer-1', storeId: 'str-1' }),
    );
    expect(idempotency.markProcessed).toHaveBeenCalledWith(expect.anything(), 'idem-1', ORDER_ROUTING_KEYS.confirmed);
  });

  it('cancelled: marca cancelado e invalida el código (UC-08)', async () => {
    const { handler, orderProjection, codesService } = build();

    await handler.handle(ORDER_ROUTING_KEYS.cancelled, { orderId: 'ord-1', idempotencyKey: 'idem-2' });

    expect(orderProjection.markCancelled).toHaveBeenCalledWith('ord-1', expect.anything());
    expect(codesService.invalidateByOrder).toHaveBeenCalledWith(expect.anything(), 'ord-1');
  });

  it('no reprocesa un evento ya procesado', async () => {
    const { handler, codesService, idempotency } = build();
    (idempotency.isProcessed as jest.Mock).mockResolvedValue(true);

    await handler.handle(ORDER_ROUTING_KEYS.confirmed, {
      orderId: 'ord-1', buyerId: 'b', storeId: 's', idempotencyKey: 'idem-1',
    });

    expect(codesService.generateForOrder).not.toHaveBeenCalled();
  });

  it('ignora un confirmed incompleto sin lanzar', async () => {
    const { handler, codesService } = build();

    await expect(
      handler.handle(ORDER_ROUTING_KEYS.confirmed, { orderId: 'ord-1', idempotencyKey: 'x' }),
    ).resolves.toBeUndefined();
    expect(codesService.generateForOrder).not.toHaveBeenCalled();
  });

  it('usa el fallback de expiración cuando pickupExpiresAt no viene', async () => {
    const { handler, codesService } = build();

    await handler.handle(ORDER_ROUTING_KEYS.confirmed, {
      orderId: 'ord-1', buyerId: 'b', storeId: 's', idempotencyKey: 'k',
    });

    expect(codesService.generateForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pickupExpiresAt: undefined }),
    );
  });
});
