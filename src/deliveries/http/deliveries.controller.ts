import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CorrelationId } from '../../common/decorators/correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { StoreAccessGuard } from '../../common/guards/store-access.guard';
import { DeliveriesService } from '../domain/deliveries.service';
import { ConfirmCodeDto } from './dto/confirm-code.dto';
import { DeliveryFailureDto } from './dto/delivery-failure.dto';
import { DeliveryListQueryDto } from './dto/delivery-list-query.dto';
import { DeliveryResponseDto } from './dto/delivery-response.dto';
import { FulfillmentStatusDto } from './dto/fulfillment-status.dto';
import { ManualDeliveryDto } from './dto/manual-delivery.dto';
import { PaginatedDeliveriesDto } from './dto/paginated-deliveries.dto';

@ApiTags('Entregas')
@ApiSecurity('x-user-id')
@ApiHeader({
  name: 'x-user-id',
  description: 'Id del usuario autenticado, inyectado por el API Gateway.',
  required: true,
})
@Controller('fulfillment')
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Post('codes/confirm')
  @ApiOperation({
    summary: 'Confirmar la entrega por QR (UC-04)',
    description:
      'El vendedor confirma la entrega tras validar el código. Revalida todas las condiciones ' +
      '(no confía en una validación previa, RN-10), marca el código como usado, registra la ' +
      'entrega y publica `delivery.confirmed`. Es idempotente: confirmar dos veces el mismo ' +
      'código no crea una segunda entrega.',
  })
  @ApiCreatedResponse({ description: 'Entrega confirmada.', type: DeliveryResponseDto })
  @ApiBadRequestResponse({ description: 'El body no cumple el formato esperado.' })
  @ApiUnauthorizedResponse({ description: 'Falta el header de sesión del gateway.' })
  @ApiForbiddenResponse({ description: 'El código no pertenece a la tienda del vendedor.' })
  @ApiNotFoundResponse({ description: 'No existe un código con ese valor.' })
  @ApiConflictResponse({ description: 'El código está vencido, anulado o ya fue usado.' })
  async confirm(
    @Body() dto: ConfirmCodeDto,
    @CurrentUser('userId') sellerUserId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveriesService.confirmByCode(dto.code, sellerUserId, correlationId);
    return DeliveryResponseDto.from(delivery);
  }

  @Post('orders/:orderId/manual-delivery')
  @UseGuards(StoreAccessGuard)
  @ApiOperation({
    summary: 'Registrar una entrega manual (UC-05)',
    description:
      'Registra la entrega manualmente cuando falla el flujo del QR. Solo usuarios con acceso ' +
      'a la tienda del pedido (owner/staff activo o ADMIN). `reason` es obligatorio. Marca el ' +
      'código como usado si existe y publica `delivery.confirmed` con `method: MANUAL`.',
  })
  @ApiParam({ name: 'orderId', description: 'Id del pedido.', example: 'ord_123' })
  @ApiCreatedResponse({ description: 'Entrega manual registrada.', type: DeliveryResponseDto })
  @ApiBadRequestResponse({ description: 'Falta el motivo u otro campo inválido.' })
  @ApiUnauthorizedResponse({ description: 'Falta el header de sesión del gateway.' })
  @ApiForbiddenResponse({ description: 'El usuario no tiene acceso a la tienda del pedido.' })
  @ApiNotFoundResponse({ description: 'El pedido no existe para Fulfillment.' })
  async manualDelivery(
    @Param('orderId') orderId: string,
    @Body() dto: ManualDeliveryDto,
    @CurrentUser('userId') sellerUserId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveriesService.registerManualDelivery(
      orderId,
      sellerUserId,
      dto,
      correlationId,
    );
    return DeliveryResponseDto.from(delivery);
  }

  @Post('orders/:orderId/delivery-failure')
  @UseGuards(StoreAccessGuard)
  @ApiOperation({
    summary: 'Registrar una entrega fallida (UC-06)',
    description:
      'Registra que un pedido no se pudo entregar, con un motivo tipificado. Solo usuarios con ' +
      'acceso a la tienda del pedido. Si el motivo es `OTHER`, la nota es obligatoria. Publica ' +
      '`delivery.failed`. No marca el código como usado.',
  })
  @ApiParam({ name: 'orderId', description: 'Id del pedido.', example: 'ord_123' })
  @ApiCreatedResponse({ description: 'Entrega fallida registrada.', type: DeliveryResponseDto })
  @ApiBadRequestResponse({ description: 'Motivo inválido o falta la nota cuando es OTHER.' })
  @ApiUnauthorizedResponse({ description: 'Falta el header de sesión del gateway.' })
  @ApiForbiddenResponse({ description: 'El usuario no tiene acceso a la tienda del pedido.' })
  @ApiNotFoundResponse({ description: 'El pedido no existe para Fulfillment.' })
  async deliveryFailure(
    @Param('orderId') orderId: string,
    @Body() dto: DeliveryFailureDto,
    @CurrentUser('userId') sellerUserId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveriesService.registerDeliveryFailure(
      orderId,
      sellerUserId,
      dto,
      correlationId,
    );
    return DeliveryResponseDto.from(delivery);
  }

  @Get('orders/:orderId')
  @ApiTags('Estado de fulfillment')
  @ApiOperation({
    summary: 'Estado de fulfillment de un pedido (UC-09)',
    description:
      'Devuelve el estado del proceso de retiro (no el estado del pedido): estado del código, ' +
      'si fue usado, método de entrega, y el último fallo registrado. Lo puede ver el comprador ' +
      'dueño, el owner/staff de la tienda o un ADMIN.',
  })
  @ApiParam({ name: 'orderId', description: 'Id del pedido.', example: 'ord_123' })
  @ApiOkResponse({ description: 'Estado de fulfillment del pedido.', type: FulfillmentStatusDto })
  @ApiUnauthorizedResponse({ description: 'Falta el header de sesión del gateway.' })
  @ApiForbiddenResponse({ description: 'El usuario no puede ver el estado de este pedido.' })
  @ApiNotFoundResponse({ description: 'El pedido no existe para Fulfillment.' })
  getStatus(
    @Param('orderId') orderId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<FulfillmentStatusDto> {
    return this.deliveriesService.getFulfillmentStatus(orderId, user);
  }

  @Get('stores/:storeId/deliveries')
  @UseGuards(StoreAccessGuard)
  @ApiOperation({
    summary: 'Historial de entregas por tienda (UC-10)',
    description:
      'Lista paginada de las entregas de una tienda, con filtros (`method`, `from`, `to`, ' +
      'vendedor) y orden por fecha. Restringido a usuarios con acceso a la tienda (owner/staff ' +
      'o ADMIN).',
  })
  @ApiParam({ name: 'storeId', description: 'Id de la tienda.', example: 'str_9' })
  @ApiOkResponse({ description: 'Historial paginado de entregas.', type: PaginatedDeliveriesDto })
  @ApiUnauthorizedResponse({ description: 'Falta el header de sesión del gateway.' })
  @ApiForbiddenResponse({ description: 'El usuario no tiene acceso a la tienda.' })
  async listStoreDeliveries(
    @Param('storeId') storeId: string,
    @Query() query: DeliveryListQueryDto,
  ): Promise<PaginatedDeliveriesDto> {
    const result = await this.deliveriesService.listStoreDeliveries(storeId, query);
    return {
      data: result.data.map((d) => DeliveryResponseDto.from(d)),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }
}
