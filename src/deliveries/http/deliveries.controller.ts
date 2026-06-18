import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CorrelationId } from '../../common/decorators/correlation-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StoreAccessGuard } from '../../common/guards/store-access.guard';
import { DeliveriesService } from '../domain/deliveries.service';
import { ConfirmCodeDto } from './dto/confirm-code.dto';
import { DeliveryFailureDto } from './dto/delivery-failure.dto';
import { DeliveryResponseDto } from './dto/delivery-response.dto';
import { ManualDeliveryDto } from './dto/manual-delivery.dto';

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
}
