import { DeliveryImageService } from './delivery-image.service';

describe('DeliveryImageService', () => {
  const service = new DeliveryImageService();

  it('genera un PNG válido con la firma correcta', async () => {
    const png = await service.generatePng('ORD-123');
    // Firma PNG: 89 50 4E 47 0D 0A 1A 0A
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.length).toBeGreaterThan(1000);
  });

  it('no falla con ids que traen caracteres especiales de XML', async () => {
    const png = await service.generatePng('<ord&"\'1>');
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
