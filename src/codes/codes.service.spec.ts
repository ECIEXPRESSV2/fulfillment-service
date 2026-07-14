import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { PickupCodeStatus } from '../common/enums';
import { PickupCodeEntity } from '../database/entities/pickup-code.entity';
import { OrderProjectionService } from '../events/projections/order-projection.service';
import { StoreStaffProjectionService } from '../events/projections/store-staff-projection.service';
import { OutboxService } from '../outbox/outbox.service';
import { BlobStorageService } from '../storage/blob-storage.service';
import { QrService } from '../qr/domain/qr.service';
import { CodesService } from './domain/codes.service';
import { ValidationError } from './domain/pickup-code.types';
import { ShortCodeRateLimiter } from './domain/short-code-rate-limiter';
import { CodesRepository } from './infra/codes.repository';

const FALLBACK_HOURS = 8;
const BASE_URL = 'http://localhost:3005';
const tx = {} as EntityManager;

function buildCode(
  overrides: Partial<PickupCodeEntity> = {},
): PickupCodeEntity {
  return {
    id: 'code-1',
    orderId: 'ord-1',
    buyerId: 'buyer-1',
    storeId: 'str-1',
    token: 'opaque-token',
    shortCode: 'A7K9-P2MX',
    status: PickupCodeStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    usedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PickupCodeEntity;
}

function build(blobOverride: Record<string, unknown> = {}) {
  const repo = {
    findActiveByOrderId: jest.fn(),
    create: jest.fn(),
    findLatestByOrderId: jest.fn(),
    findByTokenOrShortCode: jest.fn(),
    invalidateActiveByOrderId: jest.fn(),
  } as unknown as jest.Mocked<CodesRepository>;

  const outbox = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<OutboxService>;
  const storeStaff = {
    isAuthorized: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<StoreStaffProjectionService>;
  const rateLimiter = {
    consume: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<ShortCodeRateLimiter>;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
    safeRecord: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
  const orderProjection = {
    getByOrderId: jest
      .fn()
      .mockResolvedValue({ orderNumber: 'OC-20260713-6632' }),
  } as unknown as jest.Mocked<OrderProjectionService>;

  const config = {
    get: (key: string) => {
      if (key === 'PICKUP_CODE_FALLBACK_EXPIRY_HOURS') return FALLBACK_HOURS;
      if (key === 'QR_SAS_TTL_HOURS') return 24;
      if (key === 'AZURE_STORAGE_QR_CONTAINER') return 'qr-codes';
      return BASE_URL;
    },
  } as unknown as ConfigService;

  const qr = {
    generatePng: jest.fn().mockResolvedValue(Buffer.from('png')),
  } as unknown as jest.Mocked<QrService>;

  // Por defecto blob deshabilitado: el QR cae al endpoint público de fallback (sin Azure).
  const blob = {
    enabled: false,
    uploadWithReadSas: jest.fn(),
    ...blobOverride,
  } as unknown as jest.Mocked<BlobStorageService>;

  const service = new CodesService(
    repo,
    outbox,
    storeStaff,
    rateLimiter,
    orderProjection,
    audit,
    qr,
    blob,
    config,
  );
  return { service, repo, outbox, storeStaff, rateLimiter, audit, qr, blob };
}

describe('CodesService', () => {
  describe('generateForOrder (UC-01)', () => {
    it('crea el código y encola qr.generated cuando no hay uno ACTIVE', async () => {
      const { service, repo, outbox } = build();
      repo.findActiveByOrderId.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildCode());

      const result = await service.generateForOrder(tx, {
        orderId: 'ord-1',
        buyerId: 'buyer-1',
        storeId: 'str-1',
        orderNumber: 'ord-1',
      });

      expect(result.created).toBe(true);
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(outbox.enqueue).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          routingKey: 'fulfillment.qr.generated',
          business: expect.objectContaining({
            qrCode: expect.stringContaining(`${BASE_URL}/fulfillment/qr/`),
          }),
        }),
      );
    });

    it('con blob habilitado sube el QR y publica la SAS URL como imageUrl', async () => {
      const { service, repo, outbox, qr } = build({
        enabled: true,
        uploadWithReadSas: jest
          .fn()
          .mockResolvedValue('https://blob/qr.png?sig=abc'),
      });
      repo.findActiveByOrderId.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildCode());

      await service.generateForOrder(tx, {
        orderId: 'ord-1',
        buyerId: 'buyer-1',
        storeId: 'str-1',
        orderNumber: 'ord-1',
      });

      expect(qr.generatePng).toHaveBeenCalled();
      expect(outbox.enqueue).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          business: expect.objectContaining({
            imageUrl: 'https://blob/qr.png?sig=abc',
            qrCode: 'https://blob/qr.png?sig=abc',
          }),
        }),
      );
    });

    it('si la subida al blob falla, cae al endpoint público sin romper la confirmación', async () => {
      const { service, repo, outbox } = build({
        enabled: true,
        uploadWithReadSas: jest.fn().mockRejectedValue(new Error('blob down')),
      });
      repo.findActiveByOrderId.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildCode());

      const result = await service.generateForOrder(tx, {
        orderId: 'ord-1',
        buyerId: 'buyer-1',
        storeId: 'str-1',
        orderNumber: 'ord-1',
      });

      expect(result.created).toBe(true);
      expect(outbox.enqueue).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          business: expect.objectContaining({
            imageUrl: expect.stringContaining(`${BASE_URL}/fulfillment/qr/`),
          }),
        }),
      );
    });

    it('es idempotente: si ya hay un código ACTIVE no crea otro ni republica', async () => {
      const { service, repo, outbox } = build();
      repo.findActiveByOrderId.mockResolvedValue(buildCode());

      const result = await service.generateForOrder(tx, {
        orderId: 'ord-1',
        buyerId: 'buyer-1',
        storeId: 'str-1',
        orderNumber: 'ord-1',
      });

      expect(result.created).toBe(false);
      expect(repo.create).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('usa el fallback de expiración cuando no viene pickupExpiresAt', async () => {
      const { service, repo } = build();
      repo.findActiveByOrderId.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildCode());

      await service.generateForOrder(tx, {
        orderId: 'ord-1',
        buyerId: 'b',
        storeId: 's',
        orderNumber: 'ord-1',
      });

      // repo.create(data, manager): primer argumento es data
      const data = repo.create.mock.calls[0][0] as { expiresAt: Date };
      const expectedMs = Date.now() + FALLBACK_HOURS * 3600 * 1000;
      expect(Math.abs(data.expiresAt.getTime() - expectedMs)).toBeLessThan(
        5000,
      );
    });

    it('respeta pickupExpiresAt cuando viene en el evento', async () => {
      const { service, repo } = build();
      repo.findActiveByOrderId.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildCode());
      const pickupExpiresAt = new Date('2026-07-01T12:00:00.000Z');

      await service.generateForOrder(tx, {
        orderId: 'ord-1',
        buyerId: 'b',
        storeId: 's',
        orderNumber: 'ord-1',
        pickupExpiresAt,
      });

      const data = repo.create.mock.calls[0][0] as { expiresAt: Date };
      expect(data.expiresAt).toEqual(pickupExpiresAt);
    });
  });

  describe('validateCode (UC-03)', () => {
    it('CODE_NOT_FOUND cuando no existe', async () => {
      const { service, repo } = build();
      repo.findByTokenOrShortCode.mockResolvedValue(null);

      const result = await service.validateCode('opaque-token', 'seller-1');
      expect(result).toEqual({
        valid: false,
        validationError: ValidationError.CODE_NOT_FOUND,
      });
    });

    it('WRONG_STORE cuando el vendedor no pertenece a la tienda', async () => {
      const { service, repo, storeStaff } = build();
      repo.findByTokenOrShortCode.mockResolvedValue(buildCode());
      storeStaff.isAuthorized.mockResolvedValue(false);

      const result = await service.validateCode('opaque-token', 'seller-x');
      expect(result).toEqual({
        valid: false,
        validationError: ValidationError.WRONG_STORE,
      });
    });

    it.each([
      [PickupCodeStatus.USED, ValidationError.CODE_ALREADY_USED],
      [PickupCodeStatus.INVALIDATED, ValidationError.CODE_INVALIDATED],
      [PickupCodeStatus.EXPIRED, ValidationError.CODE_EXPIRED],
    ])('rechaza un código %s con %s', async (status, expected) => {
      const { service, repo } = build();
      repo.findByTokenOrShortCode.mockResolvedValue(buildCode({ status }));

      const result = await service.validateCode('opaque-token', 'seller-1');
      expect(result).toEqual({ valid: false, validationError: expected });
    });

    it('CODE_EXPIRED cuando está ACTIVE pero ya pasó expiresAt', async () => {
      const { service, repo } = build();
      repo.findByTokenOrShortCode.mockResolvedValue(
        buildCode({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const result = await service.validateCode('opaque-token', 'seller-1');
      expect(result).toEqual({
        valid: false,
        validationError: ValidationError.CODE_EXPIRED,
      });
    });

    it('valid:true con datos del pedido para un código ACTIVE vigente de su tienda', async () => {
      const { service, repo } = build();
      repo.findByTokenOrShortCode.mockResolvedValue(buildCode());

      const result = await service.validateCode('opaque-token', 'seller-1');
      expect(result).toEqual({
        valid: true,
        order: expect.objectContaining({ orderId: 'ord-1', storeId: 'str-1' }),
      });
    });

    it('aplica rate-limit en el código corto', async () => {
      const { service, rateLimiter } = build();
      rateLimiter.consume.mockReturnValue(false);

      await expect(
        service.validateCode('A7K9-P2MX', 'seller-1'),
      ).rejects.toMatchObject({
        response: { code: 'RATE_LIMITED' },
      });
    });
  });

  describe('getCodeForBuyer (UC-02)', () => {
    it('404 cuando el pedido no tiene código', async () => {
      const { service, repo } = build();
      repo.findLatestByOrderId.mockResolvedValue(null);
      await expect(
        service.getCodeForBuyer('ord-1', 'buyer-1'),
      ).rejects.toMatchObject({
        response: { code: 'CODE_NOT_FOUND' },
      });
    });

    it('403 cuando quien consulta no es el dueño', async () => {
      const { service, repo } = build();
      repo.findLatestByOrderId.mockResolvedValue(
        buildCode({ buyerId: 'otro' }),
      );
      await expect(
        service.getCodeForBuyer('ord-1', 'buyer-1'),
      ).rejects.toMatchObject({
        response: { code: 'NOT_ORDER_OWNER' },
      });
    });

    it('devuelve la vista con la URL del QR para el dueño', async () => {
      const { service, repo } = build();
      repo.findLatestByOrderId.mockResolvedValue(buildCode());
      const view = await service.getCodeForBuyer('ord-1', 'buyer-1');
      expect(view.qrCode).toContain(`${BASE_URL}/fulfillment/qr/`);
      expect(view.shortCode).toBe('A7K9-P2MX');
    });
  });

  describe('invalidateByOrder (UC-08)', () => {
    it('invalidated:true cuando había un código ACTIVE', async () => {
      const { service, repo } = build();
      repo.invalidateActiveByOrderId.mockResolvedValue(1);
      expect(await service.invalidateByOrder(tx, 'ord-1')).toEqual({
        invalidated: true,
        alreadyDelivered: false,
      });
    });

    it('invalidated:false cuando no había código ACTIVE (idempotente)', async () => {
      const { service, repo } = build();
      repo.invalidateActiveByOrderId.mockResolvedValue(0);
      repo.findLatestByOrderId.mockResolvedValue(null);
      expect(await service.invalidateByOrder(tx, 'ord-1')).toEqual({
        invalidated: false,
        alreadyDelivered: false,
      });
    });

    it('alreadyDelivered:true cuando el código ya estaba USED (cancelación tardía, RN-15)', async () => {
      const { service, repo } = build();
      repo.invalidateActiveByOrderId.mockResolvedValue(0);
      repo.findLatestByOrderId.mockResolvedValue(
        buildCode({ status: PickupCodeStatus.USED }),
      );
      expect(await service.invalidateByOrder(tx, 'ord-1')).toEqual({
        invalidated: false,
        alreadyDelivered: true,
      });
    });
  });
});
