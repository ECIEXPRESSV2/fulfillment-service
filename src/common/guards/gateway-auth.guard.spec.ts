import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GatewayAuthGuard, GATEWAY_HEADERS } from './gateway-auth.guard';

function context(headers: Record<string, unknown>) {
  const request: any = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function guardWith(isPublic: boolean) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
  return new GatewayAuthGuard(reflector);
}

describe('GatewayAuthGuard', () => {
  it('deja pasar rutas públicas sin exigir headers', () => {
    const guard = guardWith(true);
    const { ctx } = context({});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('reconstruye request.user desde los headers del gateway', () => {
    const guard = guardWith(false);
    const { ctx, request } = context({
      [GATEWAY_HEADERS.userId]: 'u1',
      [GATEWAY_HEADERS.role]: 'SELLER',
      [GATEWAY_HEADERS.storeId]: 'str-1',
    });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.user).toEqual({ userId: 'u1', role: 'SELLER', storeId: 'str-1' });
  });

  it('toma el primer valor cuando un header llega como arreglo', () => {
    const guard = guardWith(false);
    const { ctx, request } = context({ [GATEWAY_HEADERS.userId]: ['u1', 'u2'] });
    guard.canActivate(ctx);
    expect(request.user.userId).toBe('u1');
  });

  it('lanza 401 cuando falta x-user-id en ruta protegida', () => {
    const guard = guardWith(false);
    const { ctx } = context({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
