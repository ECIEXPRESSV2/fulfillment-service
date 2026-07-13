import { ApiProperty } from '@nestjs/swagger';
import {
  ValidatedOrder,
  ValidationError,
} from '../../domain/pickup-code.types';

/** Datos del pedido devueltos cuando el código es válido. */
export class ValidatedOrderDto implements ValidatedOrder {
  @ApiProperty({ example: 'ord_123' })
  orderId!: string;

  @ApiProperty({ example: 'usr_456' })
  buyerId!: string;
  @ApiProperty({ example: 'OC-20260713-6632' })
  orderNumber!: string;

  @ApiProperty({ example: 'str_9' })
  storeId!: string;

  @ApiProperty({ example: '2026-06-18T22:00:00.000Z' })
  expiresAt!: Date;
}

/** Respuesta de UC-03: válido (con datos del pedido) o rechazado (con motivo tipificado). */
export class ValidateCodeResponseDto {
  @ApiProperty({
    description:
      'Si el código es válido para entregar. Validar NO cambia el estado del código.',
    example: true,
  })
  valid!: boolean;

  @ApiProperty({
    description:
      'Motivo del rechazo cuando `valid=false`. El front lo traduce a un mensaje.',
    enum: ValidationError,
    required: false,
    nullable: true,
    example: null,
  })
  validationError?: ValidationError;

  @ApiProperty({
    description: 'Datos del pedido cuando `valid=true`.',
    type: ValidatedOrderDto,
    required: false,
    nullable: true,
  })
  order?: ValidatedOrderDto;
}
