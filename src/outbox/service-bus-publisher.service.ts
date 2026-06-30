import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceBusClient, ServiceBusSender } from '@azure/service-bus';
import { DefaultAzureCredential } from '@azure/identity';
import { EnvironmentVariables } from '../config/env.config';

/**
 * Publisher de Azure Service Bus (Managed Identity / DefaultAzureCredential). Mantiene
 * un sender sobre el topic compartido y publica esperando confirmación del broker
 * (sendMessages resuelve cuando Service Bus acepta el mensaje). El consumo de eventos
 * vive en el módulo de eventos, no aquí. Reemplaza al publisher de amqplib.
 */
@Injectable()
export class ServiceBusPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ServiceBusPublisherService.name);
  private client?: ServiceBusClient;
  private sender?: ServiceBusSender;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.sender?.close();
      await this.client?.close();
    } catch (error) {
      this.logger.warn({ err: error }, 'Error cerrando la conexión a Service Bus');
    }
  }

  /** Conexión idempotente: crea el cliente y el sender del topic compartido. */
  private connect(): void {
    if (this.sender) return;

    const connStr = process.env.SERVICE_BUS_CONNECTION_STRING;
    const fqns = this.config.get('SERVICE_BUS_FULLY_QUALIFIED_NAMESPACE', {
      infer: true,
    });
    const topic = this.config.get('SERVICE_BUS_TOPIC', { infer: true });

    this.client = connStr
      ? new ServiceBusClient(connStr)
      : new ServiceBusClient(fqns!, new DefaultAzureCredential());
    this.sender = this.client.createSender(topic);
    this.logger.log(`Publisher Service Bus listo (topic "${topic}")`);
  }

  /**
   * Publica un evento en el topic compartido (subject = routingKey) y espera la
   * confirmación de Service Bus. Lanza si el broker rechaza (el worker reintenta).
   */
  async publish(routingKey: string, payload: unknown): Promise<void> {
    this.connect();
    if (!this.sender) {
      throw new Error('Sender de Service Bus no disponible');
    }

    await this.sender.sendMessages({
      body: payload,
      subject: routingKey,
      applicationProperties: { routingKey },
      contentType: 'application/json',
    });
  }
}
