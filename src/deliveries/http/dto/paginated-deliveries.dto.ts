import { ApiProperty } from '@nestjs/swagger';
import { DeliveryResponseDto } from './delivery-response.dto';

/** Respuesta paginada del historial de entregas (UC-10), formato `{ data, page, limit, total }`. */
export class PaginatedDeliveriesDto {
  @ApiProperty({ type: [DeliveryResponseDto], description: 'Entregas de la página.' })
  data!: DeliveryResponseDto[];

  @ApiProperty({ description: 'Página actual.', example: 1 })
  page!: number;

  @ApiProperty({ description: 'Tamaño de página.', example: 20 })
  limit!: number;

  @ApiProperty({ description: 'Total de entregas que cumplen el filtro.', example: 137 })
  total!: number;
}
