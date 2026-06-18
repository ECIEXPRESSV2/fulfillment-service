import { ApiProperty } from '@nestjs/swagger';
import { PickupCodeStatus } from '@prisma/client';
import { PickupCodeView } from '../../domain/codes.service';

/** Respuesta de UC-02: el código de retiro del pedido para el comprador. */
export class PickupCodeResponseDto {
  @ApiProperty({ description: 'Id del pedido.', example: 'ord_123' })
  orderId!: string;

  @ApiProperty({
    description: 'Token opaco que va dentro del QR (la app lo renderiza del lado cliente).',
    example: 'mO9c2Xb7...base64url',
  })
  token!: string;

  @ApiProperty({
    description: 'Código corto legible para tecleo manual.',
    example: 'A7K9-P2MX',
  })
  shortCode!: string;

  @ApiProperty({
    description: 'URL pública del PNG del QR (la usa Notification en correo/WhatsApp).',
    example: 'http://localhost:3005/fulfillment/qr/mO9c2Xb7.png',
  })
  qrCode!: string;

  @ApiProperty({
    description: 'Estado actual del código.',
    enum: PickupCodeStatus,
    example: PickupCodeStatus.ACTIVE,
  })
  status!: PickupCodeStatus;

  @ApiProperty({
    description: 'Fecha/hora de vencimiento del código (ISO 8601).',
    example: '2026-06-18T22:00:00.000Z',
  })
  expiresAt!: Date;

  @ApiProperty({
    description: 'Fecha/hora en que se usó el código, si ya se usó.',
    example: null,
    nullable: true,
  })
  usedAt!: Date | null;

  static from(view: PickupCodeView): PickupCodeResponseDto {
    return Object.assign(new PickupCodeResponseDto(), view);
  }
}
