import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryFailureReason } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Body de UC-06: motivo tipificado de la entrega fallida; `OTHER` exige nota (RN-13). */
export class DeliveryFailureDto {
  @ApiProperty({
    description: 'Motivo tipificado del fallo de entrega.',
    enum: DeliveryFailureReason,
    example: DeliveryFailureReason.CUSTOMER_NO_SHOW,
  })
  @IsEnum(DeliveryFailureReason)
  reason!: DeliveryFailureReason;

  @ApiPropertyOptional({
    description: 'Descripción del fallo. Obligatoria cuando el motivo es OTHER.',
    example: 'El comprador llegó pero el pedido estaba incompleto.',
    maxLength: 500,
  })
  // Se valida solo cuando reason === OTHER: ahí la nota es obligatoria. Para otros motivos,
  // la nota es opcional (y el servicio revalida la regla por defensa).
  @ValidateIf((dto: DeliveryFailureDto) => dto.reason === DeliveryFailureReason.OTHER)
  @IsString()
  @IsNotEmpty({ message: 'Cuando el motivo es OTHER, la nota es obligatoria.' })
  @MaxLength(500)
  note?: string;
}
