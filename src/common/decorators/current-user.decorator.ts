import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Roles que el gateway puede inyectar en `x-user-role`. */
export type UserRole = 'BUYER' | 'SELLER' | 'ADMIN' | string;

/**
 * Identidad del solicitante, reconstruida desde los headers que inyecta el API Gateway
 * (`x-user-id`, `x-user-role`, `x-user-store`). Fulfillment confía en el gateway: no
 * valida Firebase (CLAUDE.md §11).
 */
export interface CurrentUserData {
  userId: string;
  role?: UserRole;
  storeId?: string;
}

/**
 * Inyecta `CurrentUserData` en el handler. Requiere que `GatewayAuthGuard` haya corrido
 * antes y poblado `request.user`. Con `data` devuelve un campo puntual (ej. `@CurrentUser('userId')`).
 */
export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: CurrentUserData }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
