import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Código de Prisma para violación de restricción única (clave ya insertada). */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Idempotencia de consumo (CLAUDE.md §9, §13): deduplica eventos por `idempotencyKey`
 * usando la tabla `processed_events`. Reprocesar un evento nunca produce efectos duplicados.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** ¿Ya se procesó este evento? */
  async isProcessed(idempotencyKey: string): Promise<boolean> {
    const row = await this.prisma.processedEvent.findUnique({
      where: { idempotencyKey },
    });
    return row !== null;
  }

  /**
   * Marca el evento como procesado dentro de la MISMA tx que aplicó los efectos.
   * Si otro consumidor lo insertó en paralelo (violación única), lo trata como ya procesado:
   * la tx hará rollback y el efecto duplicado se evita.
   */
  async markProcessed(
    tx: Prisma.TransactionClient,
    idempotencyKey: string,
    routingKey: string,
  ): Promise<void> {
    await tx.processedEvent.create({
      data: { idempotencyKey, routingKey },
    });
  }

  /** True si el error es una violación de unicidad (evento ya marcado como procesado). */
  isDuplicateError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    );
  }
}
