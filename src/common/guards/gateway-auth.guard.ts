import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CurrentUserData } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Headers que el API Gateway inyecta tras autenticar al usuario. */
export const GATEWAY_HEADERS = {
  userId: 'x-user-id',
  role: 'x-user-role',
  storeId: 'x-user-store',
} as const;

/**
 * Exige `x-user-id` en las rutas protegidas y reconstruye `request.user` desde los headers
 * del gateway (CLAUDE.md §11). No valida Firebase: confía en el gateway, que en producción
 * debe estar aislado a nivel de red para que nadie falsifique estos headers.
 */
@Injectable()
export class GatewayAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: CurrentUserData }>();
    const userId = this.header(request, GATEWAY_HEADERS.userId);

    if (!userId) {
      throw new UnauthorizedException({
        code: 'GATEWAY_AUTH_REQUIRED',
        message: 'No pudimos identificar tu sesión. Inicia sesión e inténtalo de nuevo.',
      });
    }

    request.user = {
      userId,
      role: this.header(request, GATEWAY_HEADERS.role),
      storeId: this.header(request, GATEWAY_HEADERS.storeId),
    };

    return true;
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
