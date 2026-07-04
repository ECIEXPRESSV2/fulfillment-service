import { Module } from '@nestjs/common';
import { CodesModule } from '../codes/codes.module';
import { DeliveryImageService } from './domain/delivery-image.service';
import { QrController } from './http/qr.controller';
import { DeliveryImageController } from './http/delivery-image.controller';

/**
 * Imágenes públicas: el PNG del QR (`/fulfillment/qr/:file`, verifica el token contra
 * `CodesModule`) y la imagen genérica de entrega (`/fulfillment/delivery/:orderId`). `QrService`
 * lo aporta `CodesModule` (evita el ciclo, ya que Codes también renderiza el QR para subirlo al blob).
 */
@Module({
  imports: [CodesModule],
  controllers: [QrController, DeliveryImageController],
  providers: [DeliveryImageService],
})
export class QrModule {}
