import { NotFoundException, StreamableFile } from '@nestjs/common';
import { CodesRepository } from '../../codes/infra/codes.repository';
import { QrService } from '../domain/qr.service';
import { QrController } from './qr.controller';

describe('QrController', () => {
  function build() {
    const qrService = {
      generatePng: jest.fn().mockResolvedValue(Buffer.from('89504e47', 'hex')),
    } as unknown as jest.Mocked<QrService>;
    const codesRepo = {
      findByToken: jest.fn(),
    } as unknown as jest.Mocked<CodesRepository>;
    return { controller: new QrController(qrService, codesRepo), qrService, codesRepo };
  }

  it('devuelve el PNG cuando el token existe', async () => {
    const { controller, qrService, codesRepo } = build();
    codesRepo.findByToken.mockResolvedValue({ token: 'tok' } as never);
    const result = await controller.getQrImage('tok.png');
    expect(codesRepo.findByToken).toHaveBeenCalledWith('tok');
    expect(qrService.generatePng).toHaveBeenCalledWith('tok');
    expect(result).toBeInstanceOf(StreamableFile);
  });

  it('lanza 404 cuando no existe un código con ese token', async () => {
    const { controller, codesRepo, qrService } = build();
    codesRepo.findByToken.mockResolvedValue(null);
    await expect(controller.getQrImage('nope.png')).rejects.toBeInstanceOf(NotFoundException);
    expect(qrService.generatePng).not.toHaveBeenCalled();
  });
});
