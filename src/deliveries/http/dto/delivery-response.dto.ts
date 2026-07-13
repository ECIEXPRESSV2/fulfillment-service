import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryFailureReason, DeliveryMethod } from '../../../common/enums';
import { DeliveryEntity } from '../../../database/entities/delivery.entity';

/** Respuesta de las operaciones de entrega (confirmar, manual, fallida). */
export class DeliveryResponseDto {
  @ApiProperty({ description: 'Id de la entrega.', example: 'dlv_abc123' })
  id!: string;

  @ApiProperty({ description: 'Id del pedido.', example: 'ord_123' })
  orderId!: string;

  @ApiPropertyOptional({
    description: 'Codigo visible del pedido.',
    example: 'OC-20260713-6632',
  })
  orderNumber!: string | null;

  @ApiProperty({ description: 'Id de la tienda.', example: 'str_9' })
  storeId!: string;

  @ApiProperty({
    description: 'Usuario que registró la entrega.',
    example: 'usr_seller',
  })
  confirmedByUserId!: string;
  @ApiPropertyOptional({
    description: 'Nombre del usuario que registro la entrega.',
    nullable: true,
    example: 'Laura Gomez',
  })
  confirmedByUserName!: string | null;


  @ApiPropertyOptional({
    description: 'Método de entrega. `null` en entregas fallidas.',
    enum: DeliveryMethod,
    nullable: true,
    example: DeliveryMethod.QR,
  })
  method!: DeliveryMethod | null;

  @ApiPropertyOptional({
    description: 'Motivo del fallo. Solo en entregas fallidas.',
    enum: DeliveryFailureReason,
    nullable: true,
    example: null,
  })
  failureReason!: DeliveryFailureReason | null;

  @ApiProperty({
    description: 'Fecha/hora del registro de la entrega (ISO 8601).',
    example: '2026-06-18T17:30:00.000Z',
  })
  deliveredAt!: Date;

  @ApiPropertyOptional({
    description: 'Nota asociada.',
    nullable: true,
    example: null,
  })
  note!: string | null;

  @ApiProperty({
    description:
      'Indica que el pedido YA estaba entregado y esta respuesta devuelve la entrega previa ' +
      '(operación idempotente): no se creó una entrega nueva. El front debe advertir "este ' +
      'pedido ya fue entregado" en vez de mostrar una confirmación nueva.',
    example: false,
  })
  alreadyDelivered!: boolean;

  static from(
    delivery: DeliveryEntity,
    alreadyDelivered = false,
    orderNumber: string | null = null,
    confirmedByUserName: string | null = null,
  ): DeliveryResponseDto {
    return Object.assign(new DeliveryResponseDto(), {
      id: delivery.id,
      orderId: delivery.orderId,
      storeId: delivery.storeId,
      orderNumber,
      confirmedByUserId: delivery.confirmedByUserId,
      confirmedByUserName,
      method: delivery.method,
      failureReason: delivery.failureReason,
      deliveredAt: delivery.deliveredAt,
      note: delivery.note,
      alreadyDelivered,
    });
  }
}
