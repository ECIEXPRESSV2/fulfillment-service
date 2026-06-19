import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { CodesService } from '../../codes/domain/codes.service';
import { IdempotencyService } from '../idempotency.service';
import { OrderProjectionService } from '../projections/order-projection.service';
import { OrderHandler, ORDER_ROUTING_KEYS } from './order.handler';

function build() {
  const tx = {} as EntityManager;
  const dataSource = {
    transaction: jest.fn((cb: (manager: EntityManager) => Promise<unknown>) => cb(tx)),
  } as unknown as DataSource;

  const orderProjection = {
    upsertFromConfirmed: jest.fn().mockResolvedValue(undefined),
    markCancelled: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<OrderProjectionService>;

  const codesService = {
    generateForOrder: jest.fn().mockResolvedValue({ created: true }),
    invalidateByOrder: jest.fn().mockResolvedValue({ invalidated: true, alreadyDelivered: false }),
  } as unknown as jest.Mocked<CodesService>;

  const idempotency = {
    isProcessed: jest.fn().mockResolvedValue(false),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    isDuplicateError: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<IdempotencyService>;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;

  const handler = new OrderHandler(dataSource, orderProjection, codesService, idempotency, audit);
  return { handler, orderProjection, codesService, idempotency, audit, dataSource };
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
    const { handler, orderProjection, codesService, audit } = build();

    await handler.handle(ORDER_ROUTING_KEYS.cancelled, { orderId: 'ord-1', idempotencyKey: 'idem-2' });

    expect(orderProjection.markCancelled).toHaveBeenCalledWith('ord-1', expect.anything());
    expect(codesService.invalidateByOrder).toHaveBeenCalledWith(expect.anything(), 'ord-1');
    // audit.record: entry primero, manager después
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CODE_INVALIDATED', orderId: 'ord-1' }),
      expect.anything(),
    );
  });

  it('cancelled tras entrega: audita la inconsistencia y no falla (RN-15)', async () => {
    const { handler, codesService, audit } = build();
    (codesService.invalidateByOrder as jest.Mock).mockResolvedValue({
      invalidated: false,
      alreadyDelivered: true,
    });

    await handler.handle(ORDER_ROUTING_KEYS.cancelled, { orderId: 'ord-1', idempotencyKey: 'idem-9' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CODE_INVALIDATED',
        metadata: { inconsistency: 'cancelled_after_delivery' },
      }),
      expect.anything(),
    );
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
