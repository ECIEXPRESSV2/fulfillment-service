import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function host(headers: Record<string, unknown> = {}, correlationId?: string) {
  const json = jest.fn();
  const response: any = { setHeader: jest.fn(), status: jest.fn().mockReturnValue({ json }) };
  const request: any = { headers, correlationId };
  const argsHost = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { argsHost, response, json };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('respeta errores de dominio ya tipificados { code, message }', () => {
    const { argsHost, response, json } = host({}, 'corr-1');
    filter.catch(
      new ConflictException({ code: 'CODE_EXPIRED', message: 'El código venció.' }),
      argsHost,
    );
    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CODE_EXPIRED', message: 'El código venció.', correlationId: 'corr-1' }),
    );
  });

  it('resume los errores de validación (message array) y guarda detalles', () => {
    const { argsHost, json } = host();
    filter.catch(new BadRequestException(['campo x inválido', 'campo y inválido']), argsHost);
    const body = json.mock.calls[0][0];
    expect(body.message).toMatch(/campos inválidos/i);
    expect(body.details).toEqual(['campo x inválido', 'campo y inválido']);
  });

  it('cae al correlationId del header cuando no está en el request', () => {
    const { argsHost, response } = host({ 'x-correlation-id': 'from-header' });
    filter.catch(new ConflictException({ code: 'X', message: 'y' }), argsHost);
    expect(response.setHeader).toHaveBeenCalledWith('x-correlation-id', 'from-header');
  });

  it('normaliza HttpException con respuesta string', () => {
    const { argsHost, json } = host();
    filter.catch(new HttpException('Algo pasó', HttpStatus.I_AM_A_TEAPOT), argsHost);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Algo pasó');
  });

  it('convierte cualquier error no-HTTP en 500 genérico sin filtrar detalles', () => {
    const { argsHost, response, json } = host();
    filter.catch(new Error('boom interno'), argsHost);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('boom interno');
  });
});
