import { ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** Filtros, paginación y orden del historial de entregas por tienda (UC-10). */
export class DeliveryListQueryDto {
  @ApiPropertyOptional({ description: 'Página (1-based).', minimum: 1, default: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Tamaño de página.',
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Filtra por método de entrega. Omitirlo incluye también las fallidas.',
    enum: DeliveryMethod,
  })
  @IsOptional()
  @IsEnum(DeliveryMethod)
  method?: DeliveryMethod;

  @ApiPropertyOptional({
    description: 'Desde (ISO 8601), filtra por deliveredAt.',
    example: '2026-06-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Hasta (ISO 8601), filtra por deliveredAt.',
    example: '2026-06-30T23:59:59.000Z',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description: 'Filtra por el vendedor que registró la entrega.',
    example: 'usr_seller',
  })
  @IsOptional()
  @IsString()
  confirmedByUserId?: string;

  @ApiPropertyOptional({
    description: 'Dirección de orden por deliveredAt.',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order: 'ASC' | 'DESC' = 'DESC';
}
