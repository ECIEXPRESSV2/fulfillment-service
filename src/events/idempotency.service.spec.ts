import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { ProcessedEventEntity } from '../database/entities/processed-event.entity';
import { IdempotencyService } from './idempotency.service';

function build() {
  const repo = {
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<ProcessedEventEntity>>;
  const service = new IdempotencyService(repo);
  return { service, repo };
}

describe('IdempotencyService', () => {
  describe('isProcessed', () => {
    it('devuelve true cuando existe la fila', async () => {
      const { service, repo } = build();
      repo.findOne.mockResolvedValue({ idempotencyKey: 'k1' } as ProcessedEventEntity);
      expect(await service.isProcessed('k1')).toBe(true);
    });

    it('devuelve false cuando no existe', async () => {
      const { service, repo } = build();
      repo.findOne.mockResolvedValue(null);
      expect(await service.isProcessed('k1')).toBe(false);
    });
  });

  describe('markProcessed', () => {
    it('crea y guarda la fila en el manager transaccional', async () => {
      const { service } = build();
      const innerRepo = {
        create: jest.fn().mockReturnValue({ idempotencyKey: 'k1', routingKey: 'r1' }),
        save: jest.fn().mockResolvedValue(undefined),
      };
      const manager = { getRepository: jest.fn().mockReturnValue(innerRepo) } as unknown as EntityManager;

      await service.markProcessed(manager, 'k1', 'r1');

      expect(innerRepo.create).toHaveBeenCalledWith({ idempotencyKey: 'k1', routingKey: 'r1' });
      expect(innerRepo.save).toHaveBeenCalled();
    });
  });

  describe('isDuplicateError', () => {
    it('reconoce la violación de unicidad de Postgres (23505)', () => {
      const { service } = build();
      const err = Object.assign(new QueryFailedError('q', [], new Error('x')), { code: '23505' });
      expect(service.isDuplicateError(err)).toBe(true);
    });

    it('no marca como duplicado otros errores', () => {
      const { service } = build();
      expect(service.isDuplicateError(new Error('boom'))).toBe(false);
      const other = Object.assign(new QueryFailedError('q', [], new Error('x')), { code: '42P01' });
      expect(service.isDuplicateError(other)).toBe(false);
    });
  });
});
