import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DeliveryFailureReason,
  PickupCodeStatus,
  StoreStaffRole,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ConsumerService } from './../src/events/consumer.service';
import { ExpirationScheduler } from './../src/expiration/expiration.scheduler';
import { OutboxWorker } from './../src/outbox/outbox.worker';
import { RabbitmqService } from './../src/outbox/rabbitmq.service';
import { PrismaService } from './../src/prisma/prisma.service';

// Stubs no-op para no tocar RabbitMQ ni el cron en e2e (se prueba HTTP + DB + dominio).
const noopLifecycle = {
  onApplicationBootstrap: jest.fn(),
  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
};
const rabbitStub = { ...noopLifecycle, publish: jest.fn().mockResolvedValue(undefined) };

// Datos de prueba (ids con prefijo e2e- para poder limpiarlos al final).
const STORE = 'e2e-store';
const OWNER = 'e2e-owner';
const OTHER = 'e2e-other';
const BUYER = 'e2e-buyer';

const ORD_CONFIRM = 'e2e-ord-confirm';
const ORD_MANUAL = 'e2e-ord-manual';
const TOKEN_CONFIRM = 'e2e-token-confirm';

describe('Fulfillment (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RabbitmqService)
      .useValue(rabbitStub)
      .overrideProvider(ConsumerService)
      .useValue(noopLifecycle)
      .overrideProvider(OutboxWorker)
      .useValue(noopLifecycle)
      .overrideProvider(ExpirationScheduler)
      .useValue(noopLifecycle)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: '', method: RequestMethod.GET },
        { path: 'health', method: RequestMethod.GET },
        { path: 'fulfillment/qr/:file', method: RequestMethod.GET },
      ],
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await cleanup(prisma);
    await seed(prisma);
  });

  afterAll(async () => {
    if (prisma) await cleanup(prisma);
    if (app) await app.close();
  });

  it('GET /health responde ok (fuera del prefijo)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  describe('Validar código (UC-03)', () => {
    it('401 sin header del gateway', () => {
      return request(app.getHttpServer())
        .post('/api/v1/fulfillment/codes/validate')
        .send({ code: TOKEN_CONFIRM })
        .expect(401);
    });

    it('valid:true para el staff de la tienda', () => {
      return request(app.getHttpServer())
        .post('/api/v1/fulfillment/codes/validate')
        .set('x-user-id', OWNER)
        .send({ code: TOKEN_CONFIRM })
        .expect(201)
        .expect((res) => {
          expect(res.body.valid).toBe(true);
          expect(res.body.order.orderId).toBe(ORD_CONFIRM);
        });
    });

    it('valid:false WRONG_STORE para un usuario de otra tienda', () => {
      return request(app.getHttpServer())
        .post('/api/v1/fulfillment/codes/validate')
        .set('x-user-id', OTHER)
        .send({ code: TOKEN_CONFIRM })
        .expect(201)
        .expect((res) => {
          expect(res.body.valid).toBe(false);
          expect(res.body.validationError).toBe('WRONG_STORE');
        });
    });
  });

  describe('Consultar código (UC-02)', () => {
    it('el comprador dueño ve su código', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/fulfillment/orders/${ORD_CONFIRM}/code`)
        .set('x-user-id', BUYER)
        .expect(200)
        .expect((res) => expect(res.body.orderId).toBe(ORD_CONFIRM));
    });

    it('403 para quien no es el dueño', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/fulfillment/orders/${ORD_CONFIRM}/code`)
        .set('x-user-id', OTHER)
        .expect(403);
    });
  });

  describe('Confirmar entrega (UC-04)', () => {
    it('confirma por QR y es idempotente al repetir', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/v1/fulfillment/codes/confirm')
        .set('x-user-id', OWNER)
        .send({ code: TOKEN_CONFIRM })
        .expect(201);
      expect(first.body.method).toBe('QR');

      // El código quedó USED en DB.
      const code = await prisma.pickupCode.findUnique({ where: { token: TOKEN_CONFIRM } });
      expect(code?.status).toBe(PickupCodeStatus.USED);

      // Se encoló el evento delivery.confirmed en el outbox.
      const outbox = await prisma.outboxEvent.findFirst({
        where: { aggregateId: ORD_CONFIRM, routingKey: 'fulfillment.delivery.confirmed' },
      });
      expect(outbox).not.toBeNull();

      const second = await request(app.getHttpServer())
        .post('/api/v1/fulfillment/codes/confirm')
        .set('x-user-id', OWNER)
        .send({ code: TOKEN_CONFIRM })
        .expect(201);
      expect(second.body.id).toBe(first.body.id); // misma entrega, no se duplica
    });
  });

  describe('Entrega manual (UC-05) y fallida (UC-06)', () => {
    it('registra entrega manual con acceso a la tienda', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/fulfillment/orders/${ORD_MANUAL}/manual-delivery`)
        .set('x-user-id', OWNER)
        .send({ reason: 'La cámara no escaneaba el QR.' })
        .expect(201)
        .expect((res) => expect(res.body.method).toBe('MANUAL'));
    });

    it('403 sin acceso a la tienda del pedido', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/fulfillment/orders/${ORD_MANUAL}/delivery-failure`)
        .set('x-user-id', OTHER)
        .send({ reason: DeliveryFailureReason.CUSTOMER_NO_SHOW })
        .expect(403);
    });

    it('400 cuando reason=OTHER sin nota', () => {
      return request(app.getHttpServer())
        .post(`/api/v1/fulfillment/orders/${ORD_MANUAL}/delivery-failure`)
        .set('x-user-id', OWNER)
        .send({ reason: DeliveryFailureReason.OTHER })
        .expect(400);
    });
  });

  describe('Estado (UC-09) e historial (UC-10)', () => {
    it('el comprador ve el estado de fulfillment', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/fulfillment/orders/${ORD_CONFIRM}`)
        .set('x-user-id', BUYER)
        .expect(200)
        .expect((res) => expect(res.body.orderId).toBe(ORD_CONFIRM));
    });

    it('historial paginado por tienda', () => {
      return request(app.getHttpServer())
        .get(`/api/v1/fulfillment/stores/${STORE}/deliveries`)
        .set('x-user-id', OWNER)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body).toMatchObject({ page: 1, limit: 20 });
        });
    });
  });
});

async function seed(prisma: PrismaService): Promise<void> {
  await prisma.storeStaffProjection.create({
    data: { storeId: STORE, userId: OWNER, role: StoreStaffRole.OWNER, isActive: true },
  });

  await prisma.orderProjection.createMany({
    data: [
      { orderId: ORD_CONFIRM, buyerId: BUYER, storeId: STORE, status: 'CONFIRMED' },
      { orderId: ORD_MANUAL, buyerId: BUYER, storeId: STORE, status: 'CONFIRMED' },
    ],
  });

  await prisma.pickupCode.createMany({
    data: [
      {
        orderId: ORD_CONFIRM,
        buyerId: BUYER,
        storeId: STORE,
        token: TOKEN_CONFIRM,
        shortCode: 'E2EA-CNFM',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        orderId: ORD_MANUAL,
        buyerId: BUYER,
        storeId: STORE,
        token: 'e2e-token-manual',
        shortCode: 'E2EA-MNUL',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ],
  });
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { orderId: { in: [ORD_CONFIRM, ORD_MANUAL] } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: [ORD_CONFIRM, ORD_MANUAL] } } });
  await prisma.delivery.deleteMany({ where: { storeId: STORE } });
  await prisma.pickupCode.deleteMany({ where: { storeId: STORE } });
  await prisma.orderProjection.deleteMany({ where: { storeId: STORE } });
  await prisma.storeStaffProjection.deleteMany({ where: { storeId: STORE } });
}
