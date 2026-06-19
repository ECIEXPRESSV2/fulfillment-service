import { Delivery, DeliveryFailureReason, DeliveryMethod, PickupCode, PickupCodeStatus, Prisma } from '@prisma/client';
import { CodesService } from '../codes/domain/codes.service';
import { ValidationError } from '../codes/domain/pickup-code.types';
import { AuditService } from '../audit/audit.service';
import { CodesRepository } from '../codes/infra/codes.repository';
import { OrderProjectionService } from '../events/projections/order-projection.service';
import { StoreStaffProjectionService } from '../events/projections/store-staff-projection.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveriesService } from './domain/deliveries.service';
import { DeliveriesRepository } from './infra/deliveries.repository';

const tx = {} as Prisma.TransactionClient;

function buildCode(overrides: Partial<PickupCode> = {}): PickupCode {
  return {
    id: 'code-1',
    orderId: 'ord-1',
    buyerId: 'buyer-1',
    storeId: 'str-1',
    token: 'tok',
    shortCode: 'A7K9-P2MX',
    status: PickupCodeStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 3_600_000),
    usedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'dlv-1',
    orderId: 'ord-1',
    storeId: 'str-1',
    confirmedByUserId: 'seller-1',
    method: DeliveryMethod.QR,
    deliveredAt: new Date(),
    failureReason: null,
    note: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function build() {
  const prisma = {
    $transaction: jest.fn((cb: (t: Prisma.TransactionClient) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;

  const codesService = {
    resolveForValidation: jest.fn(),
    markUsed: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<CodesService>;

  const codesRepo = {
    findActiveByOrderId: jest.fn(),
    findLatestByOrderId: jest.fn(),
  } as unknown as jest.Mocked<CodesRepository>;

  const deliveriesRepo = {
    create: jest.fn().mockResolvedValue(buildDelivery()),
    findSuccessfulByOrderId: jest.fn().mockResolvedValue(null),
    findAllByOrderId: jest.fn().mockResolvedValue([]),
    listByStore: jest.fn(),
  } as unknown as jest.Mocked<DeliveriesRepository>;

  const orderProjection = {
    getByOrderId: jest.fn(),
  } as unknown as jest.Mocked<OrderProjectionService>;

  const storeStaff = {
    isAuthorized: jest.fn().mockResolvedValue(false),
  } as unknown as jest.Mocked<StoreStaffProjectionService>;

  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<OutboxService>;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;

  const service = new DeliveriesService(
    prisma,
    codesService,
    codesRepo,
    deliveriesRepo,
    orderProjection,
    storeStaff,
    outbox,
    audit,
  );
  return { service, codesService, codesRepo, deliveriesRepo, orderProjection, storeStaff, outbox, audit };
}

describe('DeliveriesService', () => {
  describe('confirmByCode (UC-04)', () => {
    it('confirma: marca USED, crea entrega QR y publica delivery.confirmed', async () => {
      const { service, codesService, deliveriesRepo, outbox } = build();
      codesService.resolveForValidation.mockResolvedValue({ code: buildCode(), error: null });

      const result = await service.confirmByCode('tok', 'seller-1', 'corr-1');

      expect(codesService.markUsed).toHaveBeenCalledWith(tx, 'code-1');
      expect(deliveriesRepo.create).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ method: DeliveryMethod.QR, orderId: 'ord-1' }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          routingKey: 'fulfillment.delivery.confirmed',
          business: expect.objectContaining({ method: DeliveryMethod.QR, buyerId: 'buyer-1' }),
        }),
      );
      expect(result.id).toBe('dlv-1');
    });

    it('es idempotente: código ya USED con entrega existente la devuelve sin duplicar', async () => {
      const { service, codesService, deliveriesRepo, outbox } = build();
      codesService.resolveForValidation.mockResolvedValue({
        code: buildCode({ status: PickupCodeStatus.USED }),
        error: ValidationError.CODE_ALREADY_USED,
      });
      deliveriesRepo.findSuccessfulByOrderId.mockResolvedValue(buildDelivery({ id: 'dlv-prev' }));

      const result = await service.confirmByCode('tok', 'seller-1');

      expect(result.id).toBe('dlv-prev');
      expect(deliveriesRepo.create).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('rechaza con 404 si el código no existe', async () => {
      const { service, codesService } = build();
      codesService.resolveForValidation.mockResolvedValue({ code: null, error: ValidationError.CODE_NOT_FOUND });
      await expect(service.confirmByCode('tok', 'seller-1')).rejects.toMatchObject({
        response: { code: 'CODE_NOT_FOUND' },
      });
    });

    it('rechaza con 403 (WRONG_STORE) si el código es de otra tienda', async () => {
      const { service, codesService } = build();
      codesService.resolveForValidation.mockResolvedValue({ code: buildCode(), error: ValidationError.WRONG_STORE });
      await expect(service.confirmByCode('tok', 'seller-x')).rejects.toMatchObject({
        response: { code: 'WRONG_STORE' },
      });
    });

    it('rechaza con conflicto si el código está vencido', async () => {
      const { service, codesService } = build();
      codesService.resolveForValidation.mockResolvedValue({ code: buildCode(), error: ValidationError.CODE_EXPIRED });
      await expect(service.confirmByCode('tok', 'seller-1')).rejects.toMatchObject({
        response: { code: 'CODE_EXPIRED' },
      });
    });
  });

  describe('registerManualDelivery (UC-05)', () => {
    it('crea entrega MANUAL, marca el código activo USED y publica el evento', async () => {
      const { service, codesService, codesRepo, deliveriesRepo, orderProjection, outbox } = build();
      orderProjection.getByOrderId.mockResolvedValue({
        orderId: 'ord-1', buyerId: 'buyer-1', storeId: 'str-1', pickupExpiresAt: null, status: 'CONFIRMED', createdAt: new Date(), updatedAt: new Date(),
      });
      codesRepo.findActiveByOrderId.mockResolvedValue(buildCode());
      deliveriesRepo.create.mockResolvedValue(buildDelivery({ method: DeliveryMethod.MANUAL }));

      const result = await service.registerManualDelivery('ord-1', 'seller-1', { reason: 'cámara falló' });

      expect(codesService.markUsed).toHaveBeenCalledWith(tx, 'code-1');
      expect(deliveriesRepo.create).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ method: DeliveryMethod.MANUAL, note: 'cámara falló' }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ business: expect.objectContaining({ method: DeliveryMethod.MANUAL }) }),
      );
      expect(result.method).toBe(DeliveryMethod.MANUAL);
    });

    it('404 si el pedido no existe en la proyección', async () => {
      const { service, orderProjection } = build();
      orderProjection.getByOrderId.mockResolvedValue(null);
      await expect(
        service.registerManualDelivery('ord-x', 'seller-1', { reason: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_FOUND' } });
    });
  });

  describe('registerDeliveryFailure (UC-06)', () => {
    const projection = {
      orderId: 'ord-1', buyerId: 'buyer-1', storeId: 'str-1', pickupExpiresAt: null, status: 'CONFIRMED', createdAt: new Date(), updatedAt: new Date(),
    };

    it('registra el fallo y publica delivery.failed (sin marcar USED)', async () => {
      const { service, codesService, deliveriesRepo, orderProjection, outbox } = build();
      orderProjection.getByOrderId.mockResolvedValue(projection);
      deliveriesRepo.create.mockResolvedValue(
        buildDelivery({ method: null, failureReason: DeliveryFailureReason.CUSTOMER_NO_SHOW }),
      );

      const result = await service.registerDeliveryFailure('ord-1', 'seller-1', {
        reason: DeliveryFailureReason.CUSTOMER_NO_SHOW,
      });

      expect(codesService.markUsed).not.toHaveBeenCalled();
      expect(deliveriesRepo.create).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ method: null, failureReason: DeliveryFailureReason.CUSTOMER_NO_SHOW }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          routingKey: 'fulfillment.delivery.failed',
          business: expect.objectContaining({ reason: DeliveryFailureReason.CUSTOMER_NO_SHOW }),
        }),
      );
      expect(result.failureReason).toBe(DeliveryFailureReason.CUSTOMER_NO_SHOW);
    });

    it('400 si reason=OTHER sin nota', async () => {
      const { service, orderProjection } = build();
      orderProjection.getByOrderId.mockResolvedValue(projection);
      await expect(
        service.registerDeliveryFailure('ord-1', 'seller-1', { reason: DeliveryFailureReason.OTHER }),
      ).rejects.toMatchObject({ response: { code: 'NOTE_REQUIRED' } });
    });
  });

  describe('getFulfillmentStatus (UC-09)', () => {
    const projection = {
      orderId: 'ord-1', buyerId: 'buyer-1', storeId: 'str-1', pickupExpiresAt: null, status: 'CONFIRMED', createdAt: new Date(), updatedAt: new Date(),
    };

    it('404 cuando no hay proyección ni código', async () => {
      const { service, orderProjection, codesRepo } = build();
      orderProjection.getByOrderId.mockResolvedValue(null);
      codesRepo.findLatestByOrderId.mockResolvedValue(null);
      await expect(
        service.getFulfillmentStatus('ord-x', { userId: 'u' }),
      ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_FOUND' } });
    });

    it('el comprador dueño ve el estado (código + entrega)', async () => {
      const { service, orderProjection, codesRepo, deliveriesRepo } = build();
      orderProjection.getByOrderId.mockResolvedValue(projection);
      codesRepo.findLatestByOrderId.mockResolvedValue(buildCode({ status: PickupCodeStatus.USED }));
      deliveriesRepo.findAllByOrderId.mockResolvedValue([buildDelivery({ method: DeliveryMethod.QR })]);

      const status = await service.getFulfillmentStatus('ord-1', { userId: 'buyer-1' });
      expect(status.code?.status).toBe(PickupCodeStatus.USED);
      expect(status.delivery?.method).toBe(DeliveryMethod.QR);
    });

    it('un staff autorizado de la tienda ve el estado', async () => {
      const { service, orderProjection, codesRepo, storeStaff } = build();
      orderProjection.getByOrderId.mockResolvedValue(projection);
      codesRepo.findLatestByOrderId.mockResolvedValue(buildCode());
      storeStaff.isAuthorized.mockResolvedValue(true);

      const status = await service.getFulfillmentStatus('ord-1', { userId: 'seller-9' });
      expect(status.orderId).toBe('ord-1');
    });

    it('403 para un usuario que no es dueño ni staff ni admin', async () => {
      const { service, orderProjection, codesRepo, storeStaff } = build();
      orderProjection.getByOrderId.mockResolvedValue(projection);
      codesRepo.findLatestByOrderId.mockResolvedValue(buildCode());
      storeStaff.isAuthorized.mockResolvedValue(false);

      await expect(
        service.getFulfillmentStatus('ord-1', { userId: 'intruso' }),
      ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_ACCESS_DENIED' } });
    });
  });

  describe('listStoreDeliveries (UC-10)', () => {
    it('pasa filtros normalizados al repo y devuelve el formato paginado', async () => {
      const { service, deliveriesRepo } = build();
      deliveriesRepo.listByStore.mockResolvedValue({ data: [buildDelivery()], total: 1 });

      const result = await service.listStoreDeliveries('str-1', {
        page: 2,
        limit: 10,
        order: 'ASC',
        method: DeliveryMethod.QR,
        from: '2026-06-01T00:00:00.000Z',
      });

      expect(deliveriesRepo.listByStore).toHaveBeenCalledWith(
        'str-1',
        expect.objectContaining({ page: 2, limit: 10, order: 'asc', method: DeliveryMethod.QR, from: expect.any(Date) }),
      );
      expect(result).toEqual({ data: expect.any(Array), total: 1, page: 2, limit: 10 });
    });
  });
});
