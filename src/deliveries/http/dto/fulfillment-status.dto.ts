import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryFailureReason, DeliveryMethod, PickupCodeStatus } from '@prisma/client';

class CodeStatusDto {
  @ApiProperty({ enum: PickupCodeStatus, example: PickupCodeStatus.USED })
  status!: PickupCodeStatus;

  @ApiProperty({ example: '2026-06-18T22:00:00.000Z' })
  expiresAt!: Date;

  @ApiPropertyOptional({ nullable: true, example: '2026-06-18T17:30:00.000Z' })
  usedAt!: Date | null;
}

class DeliverySummaryDto {
  @ApiProperty({ enum: DeliveryMethod, example: DeliveryMethod.QR })
  method!: DeliveryMethod;

  @ApiProperty({ example: '2026-06-18T17:30:00.000Z' })
  deliveredAt!: Date;

  @ApiProperty({ example: 'usr_seller' })
  confirmedByUserId!: string;
}

class FailureSummaryDto {
  @ApiProperty({ enum: DeliveryFailureReason, example: DeliveryFailureReason.CUSTOMER_NO_SHOW })
  reason!: DeliveryFailureReason;

  @ApiProperty({ example: '2026-06-18T17:30:00.000Z' })
  occurredAt!: Date;

  @ApiPropertyOptional({ nullable: true, example: null })
  note!: string | null;
}

/** Respuesta de UC-09: estado del proceso de retiro de un pedido (no el estado del pedido). */
export class FulfillmentStatusDto {
  @ApiProperty({ description: 'Id del pedido.', example: 'ord_123' })
  orderId!: string;

  @ApiPropertyOptional({
    description: 'Estado del código de retiro, si existe.',
    type: CodeStatusDto,
    nullable: true,
  })
  code!: CodeStatusDto | null;

  @ApiPropertyOptional({
    description: 'Entrega exitosa, si ya se entregó.',
    type: DeliverySummaryDto,
    nullable: true,
  })
  delivery!: DeliverySummaryDto | null;

  @ApiPropertyOptional({
    description: 'Último fallo de entrega registrado, si lo hay.',
    type: FailureSummaryDto,
    nullable: true,
  })
  failure!: FailureSummaryDto | null;
}
