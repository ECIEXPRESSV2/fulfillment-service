import { Module } from '@nestjs/common';
import { CodesModule } from '../codes/codes.module';
import { NotificationImageService } from '../notification-image/domain/notification-image.service';
import { NotificationImageController } from '../notification-image/http/notification-image.controller';
import { DeliveryImageService } from './domain/delivery-image.service';
import { QrController } from './http/qr.controller';
import { DeliveryImageController } from './http/delivery-image.controller';

@Module({
  imports: [CodesModule],
  controllers: [QrController, DeliveryImageController, NotificationImageController],
  providers: [DeliveryImageService, NotificationImageService],
})
export class QrModule {}
