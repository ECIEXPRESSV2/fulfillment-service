import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { DeliveryImageService } from '../domain/delivery-image.service';

/**
 * Imagen genérica de "pedido entregado" (`GET /fulfillment/delivery/:orderId.png`). Pública y
 * fuera de `/api/v1` para que WhatsApp (Meta) la descargue directamente por URL. No expone datos
 * sensibles: solo la marca, el check y el ID del pedido impreso (para reclamos). La usa
 * Notification como imagen del mensaje de entrega. Express 5 no soporta sufijos en params, así que
 * se captura `:orderId` y se le quita la extensión `.png`.
 */
@ApiTags('QR')
@Controller('fulfillment/delivery')
export class DeliveryImageController {
  constructor(private readonly deliveryImage: DeliveryImageService) {}

  @Public()
  @Get(':orderId')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  @ApiOperation({
    summary: 'Imagen PNG genérica de pedido entregado',
    description:
      'Devuelve un PNG de comprobante de entrega con el ID del pedido impreso. Público. La ruta ' +
      'termina en `.png` (ej. `/fulfillment/delivery/<orderId>.png`).',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Id del pedido seguido de `.png`.',
    example: '3f5b....png',
  })
  @ApiProduces('image/png')
  @ApiOkResponse({ description: 'Imagen PNG de entrega.' })
  async getDeliveryImage(@Param('orderId') orderId: string): Promise<StreamableFile> {
    const id = orderId.replace(/\.png$/i, '');
    const png = await this.deliveryImage.generatePng(id);
    return new StreamableFile(png, { type: 'image/png' });
  }
}
