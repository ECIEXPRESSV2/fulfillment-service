import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import {
  CorrelationIdInterceptor,
  CORRELATION_ID_HEADER,
} from './correlation-id.interceptor';

function context(headers: Record<string, unknown>) {
  const request: any = { headers };
  const response: any = { setHeader: jest.fn() };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  const next = { handle: jest.fn().mockReturnValue(of('ok')) } as unknown as CallHandler;
  return { ctx, request, response, next };
}

describe('CorrelationIdInterceptor', () => {
  const interceptor = new CorrelationIdInterceptor();

  it('reutiliza el correlation id entrante y lo refleja en la respuesta', () => {
    const { ctx, request, response, next } = context({ [CORRELATION_ID_HEADER]: 'abc-123' });
    interceptor.intercept(ctx, next);
    expect(request.correlationId).toBe('abc-123');
    expect(response.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'abc-123');
    expect(next.handle).toHaveBeenCalled();
  });

  it('genera uno cuando no viene en el header', () => {
    const { ctx, request, response } = context({});
    const { next } = context({});
    interceptor.intercept(ctx, next);
    expect(request.correlationId).toEqual(expect.any(String));
    expect(request.correlationId.length).toBeGreaterThan(0);
    expect(response.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, request.correlationId);
  });

  it('toma el primer valor si el header llega como arreglo', () => {
    const { ctx, request, next } = context({ [CORRELATION_ID_HEADER]: ['first', 'second'] });
    interceptor.intercept(ctx, next);
    expect(request.correlationId).toBe('first');
  });
});
