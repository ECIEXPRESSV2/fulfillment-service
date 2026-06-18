import { ConfigService } from '@nestjs/config';
import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxWorker } from './outbox.worker';
import { RabbitmqService } from './rabbitmq.service';

const MAX_RETRIES = 3;
const POLL_INTERVAL = 5000;

function buildWorker() {
  const update = jest.fn().mockResolvedValue(undefined);
  const findMany = jest.fn();
  const prisma = {
    outboxEvent: { findMany, update },
  } as unknown as PrismaService;

  const publish = jest.fn();
  const rabbitmq = { publish } as unknown as RabbitmqService;

  const config = {
    get: (key: string) =>
      key === 'OUTBOX_MAX_RETRIES' ? MAX_RETRIES : POLL_INTERVAL,
  } as unknown as ConfigService;

  const worker = new OutboxWorker(prisma, rabbitmq, config);
  return { worker, findMany, update, publish };
}

const baseEvent = {
  id: 'evt-1',
  routingKey: 'fulfillment.qr.generated',
  payload: { orderId: 'ord-1' },
  retryCount: 0,
  idempotencyKey: 'idem-1',
};

describe('OutboxWorker', () => {
  it('publica eventos pendientes y los marca PUBLISHED', async () => {
    const { worker, findMany, update, publish } = buildWorker();
    findMany.mockResolvedValue([baseEvent]);
    publish.mockResolvedValue(undefined);

    await worker.drain();

    expect(publish).toHaveBeenCalledWith(baseEvent.routingKey, baseEvent.payload);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt-1' },
        data: expect.objectContaining({ status: OutboxStatus.PUBLISHED }),
      }),
    );
  });

  it('ante fallo transitorio incrementa retryCount y agenda backoff (sigue PENDING)', async () => {
    const { worker, findMany, update, publish } = buildWorker();
    findMany.mockResolvedValue([{ ...baseEvent, retryCount: 0 }]);
    publish.mockRejectedValue(new Error('broker caído'));

    await worker.drain();

    const data = update.mock.calls[0][0].data;
    expect(data.retryCount).toBe(1);
    expect(data.lastError).toContain('broker caído');
    expect(data.nextRetryAt).toBeInstanceOf(Date);
    expect(data.status).toBeUndefined(); // permanece PENDING
  });

  it('marca FAILED cuando se agotan los reintentos', async () => {
    const { worker, findMany, update, publish } = buildWorker();
    findMany.mockResolvedValue([{ ...baseEvent, retryCount: MAX_RETRIES - 1 }]);
    publish.mockRejectedValue(new Error('broker caído'));

    await worker.drain();

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe(OutboxStatus.FAILED);
    expect(data.retryCount).toBe(MAX_RETRIES);
  });

  it('no procesa en paralelo si ya hay un ciclo corriendo', async () => {
    const { worker, findMany } = buildWorker();
    let resolveFind!: (v: unknown[]) => void;
    findMany.mockReturnValue(new Promise((r) => (resolveFind = r)));

    const first = worker.drain();
    await worker.drain(); // debe salir inmediatamente sin segundo findMany

    expect(findMany).toHaveBeenCalledTimes(1);
    resolveFind([]);
    await first;
  });
});
