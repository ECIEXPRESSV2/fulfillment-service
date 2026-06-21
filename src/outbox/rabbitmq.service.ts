import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { EnvironmentVariables } from '../config/env.config';

/**
 * Publisher de RabbitMQ (amqplib). Mantiene una conexión y un canal de confirmación;
 * solo declara el exchange compartido y publica con `persistent: true`. El consumo de
 * eventos (cola/bindings/DLQ) vive en el módulo de eventos, no aquí (CLAUDE.md §10).
 */
@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (error) {
      this.logger.warn({ err: error }, 'Error cerrando la conexión a RabbitMQ');
    }
  }

  /** Conexión idempotente: declara el exchange topic durable compartido. */
  private async connect(): Promise<void> {
    if (this.channel) return;

    const url = this.config.get('RABBITMQ_URL', { infer: true });
    const exchange = this.config.get('RABBITMQ_EXCHANGE', { infer: true });

    this.connection = await amqp.connect(url);
    this.connection.on('error', (err) =>
      this.logger.error({ err }, 'Conexión a RabbitMQ con error'),
    );
    this.connection.on('close', () => {
      this.logger.warn('Conexión a RabbitMQ cerrada');
      this.channel = undefined;
      this.connection = undefined;
    });

    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(exchange, 'topic', { durable: true });
    this.logger.log(`Publisher RabbitMQ listo (exchange "${exchange}")`);
  }

  /**
   * Publica un evento ya serializado en el exchange compartido y espera la confirmación
   * del broker. Lanza si el broker rechaza la publicación (el worker reintenta).
   */
  async publish(routingKey: string, payload: unknown): Promise<void> {
    await this.connect();
    if (!this.channel) {
      throw new Error('Canal de RabbitMQ no disponible');
    }

    const exchange = this.config.get('RABBITMQ_EXCHANGE', { infer: true });
    const content = Buffer.from(JSON.stringify(payload));

    this.channel.publish(exchange, routingKey, content, {
      persistent: true,
      contentType: 'application/json',
    });

    await this.channel.waitForConfirms();
  }
}
