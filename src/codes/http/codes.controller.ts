import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CodesService } from '../domain/codes.service';
import { PickupCodeResponseDto } from './dto/pickup-code-response.dto';
import { ValidateCodeDto } from './dto/validate-code.dto';
import { ValidateCodeResponseDto } from './dto/validate-code-response.dto';

@ApiTags('Códigos de retiro')
@ApiSecurity('x-user-id')
@ApiHeader({
  name: 'x-user-id',
  description: 'Id del usuario autenticado, inyectado por el API Gateway.',
  required: true,
})
@Controller('fulfillment')
export class CodesController {
  constructor(private readonly codesService: CodesService) {}

  @Get('orders/:orderId/code')
  @ApiOperation({
    summary: 'Consultar el código de retiro de un pedido (UC-02)',
    description:
      'Devuelve el código de retiro del pedido para mostrarlo al recoger. Solo el comprador ' +
      'dueño del pedido puede consultarlo (RN-09).',
  })
  @ApiParam({ name: 'orderId', description: 'Id del pedido.', example: 'ord_123' })
  @ApiOkResponse({ description: 'Código de retiro del pedido.', type: PickupCodeResponseDto })
  @ApiUnauthorizedResponse({ description: 'Falta el header de sesión del gateway.' })
  @ApiForbiddenResponse({ description: 'El pedido no pertenece a quien consulta.' })
  @ApiNotFoundResponse({ description: 'El pedido aún no tiene código de retiro.' })
  async getCode(
    @Param('orderId') orderId: string,
    @CurrentUser('userId') buyerUserId: string,
  ): Promise<PickupCodeResponseDto> {
    const view = await this.codesService.getCodeForBuyer(orderId, buyerUserId);
    return PickupCodeResponseDto.from(view);
  }

  @Post('codes/validate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Validar un código de retiro (UC-03)',
    description:
      'Comprueba si un código (escaneado o tecleado) es válido **sin confirmar la entrega** ' +
      '(operación de solo lectura, RN-03). Lo usa el vendedor. Verifica existencia, vigencia, ' +
      'que no esté usado/invalidado y que el pedido sea de una tienda donde el vendedor está ' +
      'autorizado; si no, responde `valid:false` con `WRONG_STORE`. El código corto tiene ' +
      'rate-limit (RN-11).',
  })
  @ApiOkResponse({
    description: 'Resultado de la validación (válido o rechazado con motivo).',
    type: ValidateCodeResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El body no cumple el formato esperado.' })
  @ApiUnauthorizedResponse({ description: 'Falta el header de sesión del gateway.' })
  @ApiTooManyRequestsResponse({ description: 'Demasiados intentos con el mismo código corto.' })
  validate(
    @Body() dto: ValidateCodeDto,
    @CurrentUser('userId') sellerUserId: string,
  ): Promise<ValidateCodeResponseDto> {
    return this.codesService.validateCode(dto.code, sellerUserId);
  }
}
