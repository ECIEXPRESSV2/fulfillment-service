import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrderProjectionService } from '../../events/projections/order-projection.service';
import { StoreStaffProjectionService } from '../../events/projections/store-staff-projection.service';
import { CurrentUserData } from '../decorators/current-user.decorator';

/**
 * Verifica que el solicitante sea owner o staff activo de la tienda del recurso (RN-04),
 * consultando la proyección local `store_staff` (sin llamadas síncronas a Identity).
 *
 * Aplica a endpoints con `:storeId` o `:orderId` en la ruta (entrega manual, entrega
 * fallida, historial por tienda, estado por pedido). Los endpoints por código
 * (validar/confirmar) NO usan este guard: resuelven el código y devuelven `WRONG_STORE`
 * como resultado de validación dentro del servicio (UC-03).
 */
@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(
    private readonly orderProjection: OrderProjectionService,
    private readonly storeStaff: StoreStaffProjectionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserData; params: Record<string, string> }>();

    const user = request.user;
    if (!user?.userId) {
      throw new UnauthorizedException({
        code: 'GATEWAY_AUTH_REQUIRED',
        message: 'No pudimos identificar tu sesión. Inicia sesión e inténtalo de nuevo.',
      });
    }

    // Los administradores pueden operar sobre cualquier tienda (UC-05, UC-10).
    if (user.role === 'ADMIN') {
      return true;
    }

    const storeId = await this.resolveStoreId(request);
    const authorized = await this.storeStaff.isAuthorized(storeId, user.userId);
    if (!authorized) {
      throw new ForbiddenException({
        code: 'STORE_ACCESS_DENIED',
        message: 'No tienes acceso a esta tienda.',
      });
    }

    return true;
  }

  /** Toma `:storeId` directo, o lo deriva de `:orderId` vía la proyección del pedido. */
  private async resolveStoreId(request: Request & { params: Record<string, string> }): Promise<string> {
    const directStoreId = request.params.storeId;
    if (directStoreId) {
      return directStoreId;
    }

    const orderId = request.params.orderId;
    if (!orderId) {
      throw new ForbiddenException({
        code: 'STORE_ACCESS_DENIED',
        message: 'No tienes acceso a esta tienda.',
      });
    }

    const projection = await this.orderProjection.getByOrderId(orderId);
    if (!projection) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No encontramos información de retiro para este pedido.',
      });
    }
    return projection.storeId;
  }
}
