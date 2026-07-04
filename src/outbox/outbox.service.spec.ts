import { EntityManager } from 'typeorm';
import { OutboxEventEntity } from '../database/entities/outbox-event.entity';
import { OutboxService } from './outbox.service';

function managerMock() {
  const created: Record<string, unknown>[] = [];
  const repo = {
    create: jest.fn((e: Record<string, unknown>) => {
      created.push(e);
      return e;
    }),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const manager = { getRepository: jest.fn().mockReturnValue(repo) } as unknown as EntityManager;
  return { manager, repo, created };
}

describe('OutboxService', () => {
  const service = new OutboxService();

  it('encola el sobre con los campos de negocio al primer nivel + metadata', async () => {
    const { manager, repo } = managerMock();
    await service.enqueue(manager, {
      aggregateId: 'ord-1',
      aggregateType: 'PickupCode',
      eventType: 'qr.generated',
      routingKey: 'fulfillment.qr.generated',
      business: { orderId: 'ord-1', imageUrl: 'https://blob/qr.png?sas' },
      correlationId: 'corr-1',
    });
    expect(manager.getRepository).toHaveBeenCalledWith(OutboxEventEntity);
    const entity = repo.create.mock.calls[0][0];
    expect(entity.routingKey).toBe('fulfillment.qr.generated');
    expect(entity.payload).toEqual(
      expect.objectContaining({
        orderId: 'ord-1',
        imageUrl: 'https://blob/qr.png?sas',
        source: 'fulfillment-service',
        correlationId: 'corr-1',
        eventVersion: 1,
      }),
    );
    expect(entity.payload.occurredAt).toEqual(expect.any(String));
    expect(entity.idempotencyKey).toEqual(expect.any(String));
    expect(repo.save).toHaveBeenCalled();
  });

  it('respeta la idempotencyKey y eventVersion provistas', async () => {
    const { manager, repo } = managerMock();
    await service.enqueue(manager, {
      aggregateId: 'ord-1',
      aggregateType: 'Delivery',
      eventType: 'delivery.confirmed',
      routingKey: 'fulfillment.delivery.confirmed',
      business: { orderId: 'ord-1' },
      idempotencyKey: 'fixed-key',
      eventVersion: 3,
    });
    const entity = repo.create.mock.calls[0][0];
    expect(entity.idempotencyKey).toBe('fixed-key');
    expect(entity.eventVersion).toBe(3);
    expect(entity.payload.correlationId).toBeNull();
  });
});
