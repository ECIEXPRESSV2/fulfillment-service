import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '../interceptors/correlation-id.interceptor';

/** Forma estable de los errores de la API: código técnico (inglés) + mensaje al usuario (español). */
interface ErrorBody {
  code: string;
  message: string;
  correlationId?: string;
  details?: unknown;
}

/**
 * Filtro global de excepciones. Normaliza toda respuesta de error a `{ code, message }`,
 * adjunta el `correlationId` y nunca filtra stack traces al cliente (CLAUDE.md §1, §13).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();
    // Los guards se ejecutan antes que el interceptor de correlación; en un rechazo de
    // auth `request.correlationId` puede no estar seteado, así que se cae al header entrante.
    const incoming = request.headers[CORRELATION_ID_HEADER];
    const correlationId =
      request.correlationId ?? (Array.isArray(incoming) ? incoming[0] : incoming);

    const { status, body } = this.normalize(exception);
    body.correlationId = correlationId;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { correlationId, err: exception },
        'Error no controlado procesando la petición',
      );
    }

    response.setHeader(CORRELATION_ID_HEADER, correlationId ?? '');
    response.status(status).json(body);
  }

  private normalize(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;
        // Errores ya tipificados por el dominio: { code, message }.
        if (typeof obj.code === 'string' && typeof obj.message === 'string') {
          return {
            status,
            body: { code: obj.code, message: obj.message, details: obj.details },
          };
        }
        // Errores del ValidationPipe: { message: string[] , error, statusCode }.
        const rawMessage = obj.message;
        return {
          status,
          body: {
            code: typeof obj.error === 'string' ? this.toCode(obj.error) : 'BAD_REQUEST',
            message: Array.isArray(rawMessage)
              ? 'Revisa los datos enviados: hay campos inválidos.'
              : String(rawMessage ?? exception.message),
            details: Array.isArray(rawMessage) ? rawMessage : undefined,
          },
        };
      }

      return { status, body: { code: this.toCode(exception.name), message: String(res) } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error inesperado. Inténtalo de nuevo en unos minutos.',
      },
    };
  }

  private toCode(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/\s+/g, '_')
      .toUpperCase();
  }
}
