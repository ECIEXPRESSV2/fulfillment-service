import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { OutboxStatus } from '../common/enums';
import { OutboxEventEntity } from '../database/entities/outbox-event.entity';
import { OutboxWorker } from './outbox.worker';
import { RabbitmqService } from './rabbitmq.service';

const MAX_RETRIES = 3;
const POLL_INTERVAL = 5000;

function buildWorker() {
  const find = jest.fn();
  const update = jest.fn().mockResolvedValue(undefined);
  const repo = {
    find,
    update,
  } as unknown as jest.Mocked<Repository<OutboxEventEntity>>;

  const publish = jest.fn();
  const rabbitmq = { publish } as unknown as RabbitmqService;

  const config = {
    get: (key: string) =>
      key === 'OUTBOX_MAX_RETRIES' ? MAX_RETRIES : POLL_INTERVAL,
  } as unknown as ConfigService;

  const worker = new OutboxWorker(repo, rabbitmq, config);
  return { worker, find, update, publish };
}

const baseEvent = {
  id: 'evt-1',
  routingKey: 'fulfillment.qr.generated',
  payload: { orderId: 'ord-1' },
  retryCount: 0,
  idempotencyKey: 'idem-1',
} as OutboxEventEntity;

describe('OutboxWorker', () => {
  it('publica eventos pendientes y los marca PUBLISHED', async () => {
    const { worker, find, update, publish } = buildWorker();
    find.mockResolvedValue([baseEvent]);
    publish.mockResolvedValue(undefined);

    await worker.drain();

    expect(publish).toHaveBeenCalledWith(baseEvent.routingKey, baseEvent.payload);
    // TypeORM: repo.update(id, partialEntity)
    expect(update).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ status: OutboxStatus.PUBLISHED }),
    );
  });

  it('ante fallo transitorio incrementa retryCount y agenda backoff (sigue PENDING)', async () => {
    const { worker, find, update, publish } = buildWorker();
    find.mockResolvedValue([{ ...baseEvent, retryCount: 0 }]);
    publish.mockRejectedValue(new Error('broker caído'));

    await worker.drain();

    // segundo argumento de update: partial update data
    const data = update.mock.calls[0][1] as Partial<OutboxEventEntity>;
    expect(data.retryCount).toBe(1);
    expect(data.lastError).toContain('broker caído');
    expect(data.nextRetryAt).toBeInstanceOf(Date);
    expect((data as Record<string, unknown>).status).toBeUndefined();
  });

  it('marca FAILED cuando se agotan los reintentos', async () => {
    const { worker, find, update, publish } = buildWorker();
    find.mockResolvedValue([{ ...baseEvent, retryCount: MAX_RETRIES - 1 }]);
    publish.mockRejectedValue(new Error('broker caído'));

    await worker.drain();

    const data = update.mock.calls[0][1] as Partial<OutboxEventEntity>;
    expect(data.status).toBe(OutboxStatus.FAILED);
    expect(data.retryCount).toBe(MAX_RETRIES);
  });

  it('no procesa en paralelo si ya hay un ciclo corriendo', async () => {
    const { worker, find } = buildWorker();
    let resolveFind!: (v: OutboxEventEntity[]) => void;
    find.mockReturnValue(new Promise((r) => (resolveFind = r)));

    const first = worker.drain();
    await worker.drain(); // debe salir inmediatamente sin segundo find

    expect(find).toHaveBeenCalledTimes(1);
    resolveFind([]);
    await first;
  });
});
