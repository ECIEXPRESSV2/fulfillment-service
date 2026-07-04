import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OrderProjectionService } from '../../events/projections/order-projection.service';
import { StoreStaffProjectionService } from '../../events/projections/store-staff-projection.service';
import { StoreAccessGuard } from './store-access.guard';

function context(user: unknown, params: Record<string, string>) {
  const request: any = { user, params };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function build() {
  const orderProjection = { getByOrderId: jest.fn() } as unknown as jest.Mocked<OrderProjectionService>;
  const storeStaff = { isAuthorized: jest.fn() } as unknown as jest.Mocked<StoreStaffProjectionService>;
  return { guard: new StoreAccessGuard(orderProjection, storeStaff), orderProjection, storeStaff };
}

describe('StoreAccessGuard', () => {
  it('lanza 401 si no hay usuario en el request', async () => {
    const { guard } = build();
    await expect(guard.canActivate(context(undefined, {}))).rejects.toThrow(UnauthorizedException);
  });

  it('deja pasar a ADMIN sin verificar la tienda', async () => {
    const { guard, storeStaff } = build();
    const ok = await guard.canActivate(context({ userId: 'a1', role: 'ADMIN' }, { storeId: 'str-1' }));
    expect(ok).toBe(true);
    expect(storeStaff.isAuthorized).not.toHaveBeenCalled();
  });

  it('autoriza por :storeId directo cuando el staff pertenece', async () => {
    const { guard, storeStaff } = build();
    storeStaff.isAuthorized.mockResolvedValue(true);
    const ok = await guard.canActivate(context({ userId: 'u1', role: 'SELLER' }, { storeId: 'str-1' }));
    expect(ok).toBe(true);
    expect(storeStaff.isAuthorized).toHaveBeenCalledWith('str-1', 'u1');
  });

  it('deriva la tienda desde :orderId vía la proyección', async () => {
    const { guard, orderProjection, storeStaff } = build();
    orderProjection.getByOrderId.mockResolvedValue({ storeId: 'str-9' } as never);
    storeStaff.isAuthorized.mockResolvedValue(true);
    const ok = await guard.canActivate(context({ userId: 'u1', role: 'SELLER' }, { orderId: 'ord-1' }));
    expect(ok).toBe(true);
    expect(storeStaff.isAuthorized).toHaveBeenCalledWith('str-9', 'u1');
  });

  it('lanza 404 si el pedido no está en la proyección', async () => {
    const { guard, orderProjection } = build();
    orderProjection.getByOrderId.mockResolvedValue(null);
    await expect(
      guard.canActivate(context({ userId: 'u1', role: 'SELLER' }, { orderId: 'ord-x' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('lanza 403 si no hay ni storeId ni orderId', async () => {
    const { guard } = build();
    await expect(
      guard.canActivate(context({ userId: 'u1', role: 'SELLER' }, {})),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lanza 403 si el staff no está autorizado en la tienda', async () => {
    const { guard, storeStaff } = build();
    storeStaff.isAuthorized.mockResolvedValue(false);
    await expect(
      guard.canActivate(context({ userId: 'u1', role: 'SELLER' }, { storeId: 'str-1' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
