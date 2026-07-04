import { DeliveryMethod, DeliveryFailureReason } from '../../common/enums';
import { DeliveryEntity } from '../../database/entities/delivery.entity';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { DeliveriesService } from '../domain/deliveries.service';
import { DeliveriesController } from './deliveries.controller';

function buildDelivery(overrides: Partial<DeliveryEntity> = {}): DeliveryEntity {
  return {
    id: 'dlv-1',
    orderId: 'ord-1',
    storeId: 'str-1',
    confirmedByUserId: 'seller-1',
    method: DeliveryMethod.QR,
    failureReason: null,
    deliveredAt: new Date('2026-06-18T17:30:00.000Z'),
    note: null,
    createdAt: new Date(),
    ...overrides,
  } as DeliveryEntity;
}

describe('DeliveriesController', () => {
  function build() {
    const service = {
      confirmByCode: jest.fn(),
      registerManualDelivery: jest.fn(),
      registerDeliveryFailure: jest.fn(),
      getFulfillmentStatus: jest.fn(),
      listStoreDeliveries: jest.fn(),
    } as unknown as jest.Mocked<DeliveriesService>;
    return { controller: new DeliveriesController(service), service };
  }

  it('confirm delega en confirmByCode y mapea la respuesta', async () => {
    const { controller, service } = build();
    service.confirmByCode.mockResolvedValue({ delivery: buildDelivery(), alreadyDelivered: false });
    const res = await controller.confirm({ code: 'A7K9' } as never, 'seller-1', 'corr-1');
    expect(service.confirmByCode).toHaveBeenCalledWith('A7K9', 'seller-1', 'corr-1');
    expect(res.orderId).toBe('ord-1');
    expect(res.alreadyDelivered).toBe(false);
  });

  it('manualDelivery delega en registerManualDelivery', async () => {
    const { controller, service } = build();
    service.registerManualDelivery.mockResolvedValue({
      delivery: buildDelivery({ method: DeliveryMethod.MANUAL, note: 'cámara falló' }),
      alreadyDelivered: true,
    });
    const dto = { reason: 'QR ilegible' } as never;
    const res = await controller.manualDelivery('ord-1', dto, 'seller-1', 'corr-1');
    expect(service.registerManualDelivery).toHaveBeenCalledWith('ord-1', 'seller-1', dto, 'corr-1');
    expect(res.alreadyDelivered).toBe(true);
  });

  it('deliveryFailure delega en registerDeliveryFailure', async () => {
    const { controller, service } = build();
    service.registerDeliveryFailure.mockResolvedValue(
      buildDelivery({ method: null, failureReason: DeliveryFailureReason.CUSTOMER_NO_SHOW }),
    );
    const dto = { reason: DeliveryFailureReason.CUSTOMER_NO_SHOW } as never;
    const res = await controller.deliveryFailure('ord-1', dto, 'seller-1', 'corr-1');
    expect(service.registerDeliveryFailure).toHaveBeenCalledWith('ord-1', 'seller-1', dto, 'corr-1');
    expect(res.orderId).toBe('ord-1');
  });

  it('getStatus delega en getFulfillmentStatus con el usuario', () => {
    const { controller, service } = build();
    const user = { userId: 'u1', role: 'ADMIN' } as CurrentUserData;
    service.getFulfillmentStatus.mockResolvedValue({ orderId: 'ord-1' } as never);
    void controller.getStatus('ord-1', user);
    expect(service.getFulfillmentStatus).toHaveBeenCalledWith('ord-1', user);
  });

  it('listStoreDeliveries mapea data y conserva la paginación', async () => {
    const { controller, service } = build();
    service.listStoreDeliveries.mockResolvedValue({
      data: [buildDelivery(), buildDelivery({ id: 'dlv-2' })],
      total: 2,
      page: 1,
      limit: 10,
    });
    const res = await controller.listStoreDeliveries('str-1', { page: 1, limit: 10 } as never);
    expect(service.listStoreDeliveries).toHaveBeenCalledWith('str-1', { page: 1, limit: 10 });
    expect(res.data).toHaveLength(2);
    expect(res.total).toBe(2);
    expect(res.page).toBe(1);
  });
});
