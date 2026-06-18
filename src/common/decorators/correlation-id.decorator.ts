import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Inyecta el correlation id efectivo del request (el del header entrante o el generado),
 * para propagarlo en el payload de los eventos del outbox (CLAUDE.md §13).
 */
export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ correlationId?: string; id?: string }>();
    return request.correlationId ?? request.id;
  },
);
