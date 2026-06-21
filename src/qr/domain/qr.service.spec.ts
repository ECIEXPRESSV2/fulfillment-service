import { QrService } from './qr.service';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('QrService', () => {
  const service = new QrService();

  it('genera un Buffer PNG válido (firma de archivo correcta)', async () => {
    const png = await service.generatePng('mO9c2Xb7Kd-opaque-token');
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('genera imágenes distintas para tokens distintos', async () => {
    const a = await service.generatePng('token-a');
    const b = await service.generatePng('token-b');
    expect(a.equals(b)).toBe(false);
  });
});
