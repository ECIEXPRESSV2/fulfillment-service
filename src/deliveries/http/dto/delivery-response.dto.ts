import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryFailureReason, DeliveryMethod } from '../../../common/enums';
import { DeliveryEntity } from '../../../database/entities/delivery.entity';

/** Respuesta de las operaciones de entrega (confirmar, manual, fallida). */
export class DeliveryResponseDto {
  @ApiProperty({ description: 'Id de la entrega.', example: 'dlv_abc123' })
  id!: string;

  @ApiProperty({ description: 'Id del pedido.', example: 'ord_123' })
  orderId!: string;

  @ApiProperty({ description: 'Id de la tienda.', example: 'str_9' })
  storeId!: string;

  @ApiProperty({ description: 'Usuario que registró la entrega.', example: 'usr_seller' })
  confirmedByUserId!: string;

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

  @ApiPropertyOptional({ description: 'Nota asociada.', nullable: true, example: null })
  note!: string | null;

  static from(delivery: DeliveryEntity): DeliveryResponseDto {
    return Object.assign(new DeliveryResponseDto(), {
      id: delivery.id,
      orderId: delivery.orderId,
      storeId: delivery.storeId,
      confirmedByUserId: delivery.confirmedByUserId,
      method: delivery.method,
      failureReason: delivery.failureReason,
      deliveredAt: delivery.deliveredAt,
      note: delivery.note,
    });
  }
}
