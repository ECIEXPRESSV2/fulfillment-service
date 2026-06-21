import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.config';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Rate-limit del código corto legible (RN-11): limita los intentos de validación por código
 * en una ventana de tiempo para frenar la adivinación por fuerza bruta.
 *
 * Implementación **in-memory** (suficiente para el MVP de una sola instancia). Si el servicio
 * escala horizontalmente habría que mover el contador a un store compartido (ej. Redis).
 * Ver §20 del CLAUDE.md.
 */
@Injectable()
export class ShortCodeRateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.max = config.get('SHORT_CODE_RATELIMIT_MAX', { infer: true });
    this.windowMs = config.get('SHORT_CODE_RATELIMIT_WINDOW_SEC', { infer: true }) * 1000;
  }

  /** Registra un intento. Devuelve `true` si se permite, `false` si superó el límite. */
  consume(key: string): boolean {
    const now = Date.now();
    const current = this.windows.get(key);

    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (current.count >= this.max) {
      return false;
    }

    current.count += 1;
    return true;
  }
}
