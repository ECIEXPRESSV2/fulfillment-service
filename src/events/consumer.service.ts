import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { EnvironmentVariables } from '../config/env.config';
import { IdentityHandler, IDENTITY_ROUTING_KEYS } from './handlers/identity.handler';
import { ORDER_ROUTING_KEYS, OrderHandler } from './handlers/order.handler';

const RETRY_COUNT_HEADER = 'x-retry-count';
const ORIGINAL_ROUTING_KEY_HEADER = 'x-original-routing-key';
const PREFETCH = 10;

/**
 * Consumer de eventos (CLAUDE.md §10). Declara DLX→DLQ y la cola propia con
 * `x-dead-letter-exchange`, enlaza `order.#` e `identity.#`, consume con ack/nack manual y
 * despacha a los handlers. Error transitorio → reintento con backoff exponencial republicando
 * a la propia cola (preservando el routing key en un header); agotados → nack al DLQ.
 */
@Injectable()
export class ConsumerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConsumerService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;
  private readonly maxRetries: number;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly orderHandler: OrderHandler,
    private readonly identityHandler: IdentityHandler,
  ) {
    this.maxRetries = config.get('OUTBOX_MAX_RETRIES', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.connectAndConsume();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (error) {
      this.logger.warn({ err: error }, 'Error cerrando el consumer de RabbitMQ');
    }
  }

  private async connectAndConsume(): Promise<void> {
    const url = this.config.get('RABBITMQ_URL', { infer: true });
    const exchange = this.config.get('RABBITMQ_EXCHANGE', { infer: true });
    const queue = this.config.get('RABBITMQ_QUEUE', { infer: true });
    const dlx = `${queue}.dlx`;
    const dlq = `${queue}.dlq`;

    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();

    await this.channel.assertExchange(exchange, 'topic', { durable: true });

    // DLX → DLQ para mensajes que agotan reintentos (revisión manual).
    await this.channel.assertExchange(dlx, 'topic', { durable: true });
    await this.channel.assertQueue(dlq, { durable: true });
    await this.channel.bindQueue(dlq, dlx, '#');

    // Cola propia, con dead-letter hacia el DLX.
    await this.channel.assertQueue(queue, { durable: true, deadLetterExchange: dlx });
    await this.channel.bindQueue(queue, exchange, 'order.#');
    await this.channel.bindQueue(queue, exchange, 'identity.#');

    await this.channel.prefetch(PREFETCH);
    await this.channel.consume(queue, (msg) => void this.handleMessage(msg, queue), { noAck: false });

    this.logger.log(`Consumer escuchando "${queue}" (order.#, identity.#)`);
  }

  private async handleMessage(msg: amqp.ConsumeMessage | null, queue: string): Promise<void> {
    if (!msg || !this.channel) return;

    const headers = msg.properties.headers ?? {};
    const routingKey =
      (headers[ORIGINAL_ROUTING_KEY_HEADER] as string | undefined) ?? msg.fields.routingKey;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(msg.content.toString()) as Record<string, unknown>;
    } catch (error) {
      // Mensaje no parseable: no es transitorio, va directo al DLQ.
      this.logger.error({ err: error, routingKey }, 'Mensaje no parseable; al DLQ');
      this.channel.nack(msg, false, false);
      return;
    }

    try {
      await this.dispatch(routingKey, event);
      this.channel.ack(msg);
    } catch (error) {
      this.retryOrDeadLetter(msg, queue, routingKey, error);
    }
  }

  private dispatch(routingKey: string, event: Record<string, unknown>): Promise<void> {
    if (routingKey === ORDER_ROUTING_KEYS.confirmed || routingKey === ORDER_ROUTING_KEYS.cancelled) {
      return this.orderHandler.handle(routingKey, event);
    }
    if (
      routingKey === IDENTITY_ROUTING_KEYS.storeCreated ||
      routingKey === IDENTITY_ROUTING_KEYS.staffChanged
    ) {
      return this.identityHandler.handle(routingKey, event);
    }
    // Routing key sin handler (llegó por el binding amplio): se ignora.
    return Promise.resolve();
  }

  private retryOrDeadLetter(
    msg: amqp.ConsumeMessage,
    queue: string,
    routingKey: string,
    error: unknown,
  ): void {
    if (!this.channel) return;

    const retryCount = Number(msg.properties.headers?.[RETRY_COUNT_HEADER] ?? 0);

    if (retryCount >= this.maxRetries) {
      this.logger.error({ err: error, routingKey, retryCount }, 'Evento agotó reintentos; al DLQ');
      this.channel.nack(msg, false, false);
      return;
    }

    // Backoff exponencial: se reencola en la propia cola tras un retraso, conservando el
    // routing key original en un header (sendToQueue lo perdería).
    const delayMs = 2 ** retryCount * 1000;
    this.logger.warn(
      { err: error, routingKey, retryCount, delayMs },
      'Fallo procesando evento; se reintentará con backoff',
    );
    this.channel.ack(msg);
    setTimeout(() => {
      this.channel?.sendToQueue(queue, msg.content, {
        persistent: true,
        headers: {
          ...(msg.properties.headers ?? {}),
          [RETRY_COUNT_HEADER]: retryCount + 1,
          [ORIGINAL_ROUTING_KEY_HEADER]: routingKey,
        },
      });
    }, delayMs);
  }
}
