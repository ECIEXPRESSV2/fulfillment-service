import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body de UC-04: el código (token o código corto) cuya entrega se confirma. */
export class ConfirmCodeDto {
  @ApiProperty({
    description: 'Token del QR o código corto legible (formato XXXX-XXXX).',
    example: 'A7K9-P2MX',
    maxLength: 128,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  code!: string;
}
