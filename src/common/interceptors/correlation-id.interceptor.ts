import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';

/** Header de correlación, propagado en respuestas, logs y eventos del outbox (CLAUDE.md §13). */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Garantiza un `X-Correlation-Id` por request: lo toma del header entrante o genera uno,
 * lo expone en `request.correlationId` y lo refleja en la respuesta.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { correlationId?: string }>();
    const response = http.getResponse<Response>();

    const incoming = request.headers[CORRELATION_ID_HEADER];
    const correlationId =
      (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();

    request.correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    return next.handle();
  }
}
