import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxStatus, Prisma } from '@prisma/client';
import { EnvironmentVariables } from '../config/env.config';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitmqService } from './rabbitmq.service';

/** Cuántos eventos pendientes se intentan publicar por tick. */
const BATCH_SIZE = 20;

/**
 * Worker del Outbox (CLAUDE.md §13): hace poll de `outbox_events` PENDING vencidos, los
 * publica por RabbitMQ y los marca PUBLISHED. Ante fallo transitorio reintenta con backoff
 * exponencial (`2^retryCount`); agotados los reintentos pasa a FAILED para revisión manual.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly maxRetries: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitmqService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxRetries = config.get('OUTBOX_MAX_RETRIES', { infer: true });
    this.pollIntervalMs = config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.drain();
    }, this.pollIntervalMs);
    // No bloquear el cierre del proceso por el timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Procesa un lote de eventos vencidos. Evita ejecuciones solapadas. */
  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await this.prisma.outboxEvent.findMany({
        where: {
          status: OutboxStatus.PENDING,
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const event of due) {
        await this.publishOne(event);
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Error en el ciclo del outbox worker');
    } finally {
      this.running = false;
    }
  }

  private async publishOne(event: {
    id: string;
    routingKey: string;
    payload: Prisma.JsonValue;
    retryCount: number;
    idempotencyKey: string;
  }): Promise<void> {
    try {
      await this.rabbitmq.publish(event.routingKey, event.payload);
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxStatus.PUBLISHED, publishedAt: new Date(), lastError: null },
      });
      this.logger.debug(
        { routingKey: event.routingKey, idempotencyKey: event.idempotencyKey },
        'Evento publicado',
      );
    } catch (error) {
      await this.handleFailure(event, error);
    }
  }

  private async handleFailure(
    event: { id: string; routingKey: string; retryCount: number },
    error: unknown,
  ): Promise<void> {
    const retryCount = event.retryCount + 1;
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = retryCount >= this.maxRetries;

    if (exhausted) {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxStatus.FAILED, retryCount, lastError: message },
      });
      this.logger.error(
        { routingKey: event.routingKey, retryCount },
        'Evento agotó reintentos: marcado FAILED',
      );
      return;
    }

    // Backoff exponencial: 2^retryCount segundos.
    const delayMs = 2 ** retryCount * 1000;
    const nextRetryAt = new Date(Date.now() + delayMs);
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: { retryCount, lastError: message, nextRetryAt },
    });
    this.logger.warn(
      { routingKey: event.routingKey, retryCount, nextRetryAt },
      'Fallo publicando evento; se reintentará con backoff',
    );
  }
}
