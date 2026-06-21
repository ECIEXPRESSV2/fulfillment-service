import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body de UC-05: motivo obligatorio de la entrega manual y nota opcional. */
export class ManualDeliveryDto {
  @ApiProperty({
    description: 'Motivo por el que se registra la entrega manualmente (obligatorio, RN-06).',
    example: 'La cámara del vendedor no escaneaba el QR.',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Detalle adicional opcional.',
    example: 'El comprador mostró su cédula y el número de pedido.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
