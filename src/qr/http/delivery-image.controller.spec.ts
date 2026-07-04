import { StreamableFile } from '@nestjs/common';
import { DeliveryImageService } from '../domain/delivery-image.service';
import { DeliveryImageController } from './delivery-image.controller';

describe('DeliveryImageController', () => {
  function build() {
    const deliveryImage = {
      generatePng: jest.fn().mockResolvedValue(Buffer.from('89504e47', 'hex')),
    } as unknown as jest.Mocked<DeliveryImageService>;
    return { controller: new DeliveryImageController(deliveryImage), deliveryImage };
  }

  it('quita la extensión .png y devuelve el PNG como StreamableFile', async () => {
    const { controller, deliveryImage } = build();
    const result = await controller.getDeliveryImage('ORD-9.png');
    expect(deliveryImage.generatePng).toHaveBeenCalledWith('ORD-9');
    expect(result).toBeInstanceOf(StreamableFile);
  });

  it('acepta el id sin extensión', async () => {
    const { controller, deliveryImage } = build();
    await controller.getDeliveryImage('ORD-9');
    expect(deliveryImage.generatePng).toHaveBeenCalledWith('ORD-9');
  });
});
