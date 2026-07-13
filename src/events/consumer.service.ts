import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ServiceBusClient,
  ServiceBusReceiver,
  ServiceBusReceivedMessage,
  ProcessErrorArgs,
} from '@azure/service-bus';
import { DefaultAzureCredential } from '@azure/identity';
import { EnvironmentVariables } from '../config/env.config';
import { IdentityHandler, IDENTITY_ROUTING_KEYS } from './handlers/identity.handler';
import { ORDER_ROUTING_KEYS, OrderHandler } from './handlers/order.handler';

const MAX_CONCURRENT = 10;

/**
 * Consumer de eventos sobre Azure Service Bus. Abre un receiver sobre la subscription
 * propia (`fulfillment-service`) y despacha a los handlers por routing-key (Subject del
 * mensaje). El filtro por dominio (order.* / identity.*) vive en la regla SQL de la
 * subscription (Terraform).
 *
 * Reintentos/DLQ: NATIVOS de Service Bus. Si el handler lanza (error transitorio), el
 * mensaje se abandona y Service Bus lo reentrega; al superar maxDeliveryCount (definido
 * en la subscription) va automáticamente a la dead-letter queue. Reemplaza al manejo
 * manual de DLX/backoff que hacía amqplib.
 */
@Injectable()
export class ConsumerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ConsumerService.name);
  private client?: ServiceBusClient;
  private receiver?: ServiceBusReceiver;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly orderHandler: OrderHandler,
    private readonly identityHandler: IdentityHandler,
  ) {}

  onApplicationBootstrap(): void {
    const connStr = process.env.SERVICE_BUS_CONNECTION_STRING;
    const fqns = this.config.get('SERVICE_BUS_FULLY_QUALIFIED_NAMESPACE', {
      infer: true,
    });
    const topic = this.config.get('SERVICE_BUS_TOPIC', { infer: true });
    const subscription = this.config.get('SERVICE_BUS_SUBSCRIPTION', {
      infer: true,
    });

    this.client = connStr
      ? new ServiceBusClient(connStr)
      : new ServiceBusClient(fqns!, new DefaultAzureCredential());
    this.receiver = this.client.createReceiver(topic, subscription);

    this.receiver.subscribe(
      {
        processMessage: async (msg: ServiceBusReceivedMessage) => {
          const routingKey = (
            msg.subject ??
            (msg.applicationProperties?.routingKey as string | undefined) ??
            ''
          ).toString();
          const event = (
            typeof msg.body === 'object' && msg.body !== null ? msg.body : {}
          ) as Record<string, unknown>;
          // Si dispatch lanza, NO lo capturamos: Service Bus abandona y reentrega
          // (retry/DLQ nativos).
          await this.dispatch(routingKey, event);
        },
        processError: async (args: ProcessErrorArgs) => {
          this.logger.error(
            { err: args.error, entity: args.entityPath },
            'Error en el receiver de Service Bus',
          );
        },
      },
      { maxConcurrentCalls: MAX_CONCURRENT },
    );

    this.logger.log(
      `Consumer escuchando subscription "${subscription}" (order.*, identity.*)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.receiver?.close();
      await this.client?.close();
    } catch (error) {
      this.logger.warn({ err: error }, 'Error cerrando el consumer de Service Bus');
    }
  }

  private dispatch(
    routingKey: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    if (
      routingKey === ORDER_ROUTING_KEYS.confirmed ||
      routingKey === ORDER_ROUTING_KEYS.readyForPickup ||
      routingKey === ORDER_ROUTING_KEYS.cancelled
    ) {
      return this.orderHandler.handle(routingKey, event);
    }
    if (
      routingKey === IDENTITY_ROUTING_KEYS.storeCreated ||
      routingKey === IDENTITY_ROUTING_KEYS.staffChanged
    ) {
      return this.identityHandler.handle(routingKey, event);
    }
    // Routing key sin handler (llegó por el filtro amplio): se ignora.
    return Promise.resolve();
  }
}
