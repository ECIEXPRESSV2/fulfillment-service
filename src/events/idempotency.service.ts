import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { ProcessedEventEntity } from '../database/entities/processed-event.entity';

/** Código PostgreSQL de violación de restricción única. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Idempotencia de consumo (CLAUDE.md §9, §13): deduplica eventos por `idempotencyKey`
 * usando la tabla `processed_events`. Reprocesar un evento nunca produce efectos duplicados.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(ProcessedEventEntity)
    private readonly repo: Repository<ProcessedEventEntity>,
  ) {}

  /** ¿Ya se procesó este evento? */
  async isProcessed(idempotencyKey: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { idempotencyKey } });
    return row !== null;
  }

  /**
   * Marca el evento como procesado dentro de la MISMA tx que aplicó los efectos.
   * Si otro consumidor lo insertó en paralelo (violación única), lo trata como ya procesado.
   */
  async markProcessed(
    manager: EntityManager,
    idempotencyKey: string,
    routingKey: string,
  ): Promise<void> {
    const repo = manager.getRepository(ProcessedEventEntity);
    const entity = repo.create({ idempotencyKey, routingKey });
    await repo.save(entity);
  }

  /** True si el error es una violación de unicidad PostgreSQL (evento ya marcado como procesado). */
  isDuplicateError(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { code: string }).code === PG_UNIQUE_VIOLATION
    );
  }
}
