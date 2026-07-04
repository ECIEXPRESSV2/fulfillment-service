import { CodesService, PickupCodeView } from '../domain/codes.service';
import { PickupCodeStatus } from '../../common/enums';
import { CodesController } from './codes.controller';

function buildView(): PickupCodeView {
  return {
    orderId: 'ord-1',
    token: 'tok',
    shortCode: 'A7K9-P2MX',
    qrCode: 'http://host/fulfillment/qr/tok.png',
    status: PickupCodeStatus.ACTIVE,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    usedAt: null,
  };
}

describe('CodesController', () => {
  function build() {
    const codesService = {
      getCodeForBuyer: jest.fn(),
      validateCode: jest.fn(),
    } as unknown as jest.Mocked<CodesService>;
    return { controller: new CodesController(codesService), codesService };
  }

  it('getCode delega en el servicio y mapea la vista al DTO', async () => {
    const { controller, codesService } = build();
    codesService.getCodeForBuyer.mockResolvedValue(buildView());
    const dto = await controller.getCode('ord-1', 'buyer-1');
    expect(codesService.getCodeForBuyer).toHaveBeenCalledWith('ord-1', 'buyer-1');
    expect(dto.orderId).toBe('ord-1');
    expect(dto.shortCode).toBe('A7K9-P2MX');
  });

  it('validate delega en el servicio con el código y el vendedor', async () => {
    const { controller, codesService } = build();
    codesService.validateCode.mockResolvedValue({ valid: true } as never);
    await controller.validate({ code: 'A7K9-P2MX' } as never, 'seller-1');
    expect(codesService.validateCode).toHaveBeenCalledWith('A7K9-P2MX', 'seller-1');
  });
});
