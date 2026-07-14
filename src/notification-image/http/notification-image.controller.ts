import { Controller, Get, Header, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { NotificationImageService } from '../domain/notification-image.service';

@ApiTags('Notification Images')
@Controller('fulfillment/notification-image')
export class NotificationImageController {
  constructor(private readonly service: NotificationImageService) {}

  @Public()
  @Get('confirmed/:orderId')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  async confirmed(@Param('orderId') orderId: string) {
    const id = orderId.replace(/\.png$/i, '');
    const png = await this.service.generateConfirmedPng(id);
    return new StreamableFile(png, { type: 'image/png' });
  }

  @Public()
  @Get('cancelled/:orderId')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  async cancelled(@Param('orderId') orderId: string) {
    const id = orderId.replace(/\.png$/i, '');
    const png = await this.service.generateCancelledPng(id);
    return new StreamableFile(png, { type: 'image/png' });
  }

  @Public()
  @Get('qr-expired/:orderId')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  async qrExpired(@Param('orderId') orderId: string) {
    const id = orderId.replace(/\.png$/i, '');
    const png = await this.service.generateQrExpiredPng(id);
    return new StreamableFile(png, { type: 'image/png' });
  }

  @Public()
  @Get('payment-processed/:orderId/:amount')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  async paymentProcessed(@Param('orderId') orderId: string, @Param('amount') amount: string) {
    const id = orderId.replace(/\.png$/i, '');
    const png = await this.service.generatePaymentProcessedPng(id, amount);
    return new StreamableFile(png, { type: 'image/png' });
  }

  @Public()
  @Get('refund-issued/:orderId/:amount')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  async refundIssued(@Param('orderId') orderId: string, @Param('amount') amount: string) {
    const id = orderId.replace(/\.png$/i, '');
    const png = await this.service.generateRefundIssuedPng(id, amount);
    return new StreamableFile(png, { type: 'image/png' });
  }
}
