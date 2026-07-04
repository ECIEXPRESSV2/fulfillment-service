import { ConfigService } from '@nestjs/config';
import { ShortCodeRateLimiter } from './short-code-rate-limiter';

function build(max = 3, windowSec = 60): ShortCodeRateLimiter {
  const config = {
    get: (key: string) =>
      key === 'SHORT_CODE_RATELIMIT_MAX' ? max : windowSec,
  } as unknown as ConfigService;
  return new ShortCodeRateLimiter(config);
}

describe('ShortCodeRateLimiter', () => {
  afterEach(() => jest.useRealTimers());

  it('permite hasta el máximo de intentos y bloquea el siguiente', () => {
    const limiter = build(3);
    expect(limiter.consume('A7K9')).toBe(true);
    expect(limiter.consume('A7K9')).toBe(true);
    expect(limiter.consume('A7K9')).toBe(true);
    expect(limiter.consume('A7K9')).toBe(false); // 4º supera el límite de 3
  });

  it('cuenta cada código por separado', () => {
    const limiter = build(1);
    expect(limiter.consume('AAAA')).toBe(true);
    expect(limiter.consume('AAAA')).toBe(false);
    expect(limiter.consume('BBBB')).toBe(true); // otro código, ventana propia
  });

  it('reinicia la ventana cuando expira el tiempo', () => {
    jest.useFakeTimers();
    const limiter = build(1, 60);
    expect(limiter.consume('AAAA')).toBe(true);
    expect(limiter.consume('AAAA')).toBe(false);
    jest.advanceTimersByTime(61_000); // pasa la ventana de 60s
    expect(limiter.consume('AAAA')).toBe(true);
  });
});
