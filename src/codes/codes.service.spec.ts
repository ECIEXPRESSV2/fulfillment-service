import { ConfigService } from '@nestjs/config';
import { PickupCode, PickupCodeStatus, Prisma } from '@prisma/client';
import { StoreStaffProjectionService } from '../events/projections/store-staff-projection.service';
import { OutboxService } from '../outbox/outbox.service';
import { CodesService } from './domain/codes.service';
import { ValidationError } from './domain/pickup-code.types';
import { ShortCodeRateLimiter } from './domain/short-code-rate-limiter';
import { CodesRepository } from './infra/codes.repository';

const FALLBACK_HOURS = 8;
const BASE_URL = 'http://localhost:3005';
const tx = {} as Prisma.TransactionClient;

function buildCode(overrides: Partial<PickupCode> = {}): PickupCode {
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
  };
}

function build() {
  const repo = {
    findActiveByOrderId: jest.fn(),
    create: jest.fn(),
    findLatestByOrderId: jest.fn(),
    findByTokenOrShortCode: jest.fn(),
    invalidateActiveByOrderId: jest.fn(),
  } as unknown as jest.Mocked<CodesRepository>;

  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<OutboxService>;
  const storeStaff = { isAuthorized: jest.fn().mockResolvedValue(true) } as unknown as jest.Mocked<StoreStaffProjectionService>;
  const rateLimiter = { consume: jest.fn().mockReturnValue(true) } as unknown as jest.Mocked<ShortCodeRateLimiter>;
  const config = {
    get: (key: string) => (key === 'PICKUP_CODE_FALLBACK_EXPIRY_HOURS' ? FALLBACK_HOURS : BASE_URL),
  } as unknown as ConfigService;

  const service = new CodesService(repo, outbox, storeStaff, rateLimiter, config);
  return { service, repo, outbox, storeStaff, rateLimiter };
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

    it('es idempotente: si ya hay un código ACTIVE no crea otro ni republica', async () => {
      const { service, repo, outbox } = build();
      repo.findActiveByOrderId.mockResolvedValue(buildCode());

      const result = await service.generateForOrder(tx, {
        orderId: 'ord-1',
        buyerId: 'buyer-1',
        storeId: 'str-1',
      });

      expect(result.created).toBe(false);
      expect(repo.create).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('usa el fallback de expiración cuando no viene pickupExpiresAt', async () => {
      const { service, repo } = build();
      repo.findActiveByOrderId.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildCode());

      await service.generateForOrder(tx, { orderId: 'ord-1', buyerId: 'b', storeId: 's' });

      const data = repo.create.mock.calls[0][1];
      const expectedMs = Date.now() + FALLBACK_HOURS * 3600 * 1000;
      expect(Math.abs(data.expiresAt.getTime() - expectedMs)).toBeLessThan(5000);
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
        pickupExpiresAt,
      });

      expect(repo.create.mock.calls[0][1].expiresAt).toEqual(pickupExpiresAt);
    });
  });

  describe('validateCode (UC-03)', () => {
    it('CODE_NOT_FOUND cuando no existe', async () => {
      const { service, repo } = build();
      repo.findByTokenOrShortCode.mockResolvedValue(null);

      const result = await service.validateCode('opaque-token', 'seller-1');
      expect(result).toEqual({ valid: false, validationError: ValidationError.CODE_NOT_FOUND });
    });

    it('WRONG_STORE cuando el vendedor no pertenece a la tienda', async () => {
      const { service, repo, storeStaff } = build();
      repo.findByTokenOrShortCode.mockResolvedValue(buildCode());
      storeStaff.isAuthorized.mockResolvedValue(false);

      const result = await service.validateCode('opaque-token', 'seller-x');
      expect(result).toEqual({ valid: false, validationError: ValidationError.WRONG_STORE });
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
      expect(result).toEqual({ valid: false, validationError: ValidationError.CODE_EXPIRED });
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

      await expect(service.validateCode('A7K9-P2MX', 'seller-1')).rejects.toMatchObject({
        response: { code: 'RATE_LIMITED' },
      });
    });
  });

  describe('getCodeForBuyer (UC-02)', () => {
    it('404 cuando el pedido no tiene código', async () => {
      const { service, repo } = build();
      repo.findLatestByOrderId.mockResolvedValue(null);
      await expect(service.getCodeForBuyer('ord-1', 'buyer-1')).rejects.toMatchObject({
        response: { code: 'CODE_NOT_FOUND' },
      });
    });

    it('403 cuando quien consulta no es el dueño', async () => {
      const { service, repo } = build();
      repo.findLatestByOrderId.mockResolvedValue(buildCode({ buyerId: 'otro' }));
      await expect(service.getCodeForBuyer('ord-1', 'buyer-1')).rejects.toMatchObject({
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
      expect(await service.invalidateByOrder(tx, 'ord-1')).toEqual({ invalidated: true });
    });

    it('invalidated:false cuando no había código ACTIVE (idempotente)', async () => {
      const { service, repo } = build();
      repo.invalidateActiveByOrderId.mockResolvedValue(0);
      expect(await service.invalidateByOrder(tx, 'ord-1')).toEqual({ invalidated: false });
    });
  });
});
