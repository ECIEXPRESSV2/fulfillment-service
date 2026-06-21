import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Esquema de las variables de entorno (CLAUDE.md §15). Se valida al arrancar:
 * si falta o es inválida alguna variable requerida, el proceso falla rápido.
 */
export class EnvironmentVariables {
  // ── Base de datos ──
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  // ── Bus de eventos ──
  @IsString()
  @IsNotEmpty()
  RABBITMQ_URL!: string;

  @IsString()
  @IsNotEmpty()
  RABBITMQ_EXCHANGE!: string;

  @IsString()
  @IsNotEmpty()
  RABBITMQ_QUEUE!: string;

  // ── App ──
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3005;

  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsString()
  @IsNotEmpty()
  SERVICE_NAME: string = 'fulfillment-service';

  @IsString()
  @IsOptional()
  TZ?: string;

  @IsString()
  @IsNotEmpty()
  PUBLIC_BASE_URL: string = 'http://localhost:3005';

  // ── Reglas del dominio ──
  @IsInt()
  @Min(1)
  PICKUP_CODE_FALLBACK_EXPIRY_HOURS: number = 8;

  @IsInt()
  @Min(1)
  SHORT_CODE_RATELIMIT_MAX: number = 5;

  @IsInt()
  @Min(1)
  SHORT_CODE_RATELIMIT_WINDOW_SEC: number = 60;

  // ── Outbox / reintentos ──
  @IsInt()
  @Min(100)
  OUTBOX_POLL_INTERVAL_MS: number = 5000;

  @IsInt()
  @Min(0)
  OUTBOX_MAX_RETRIES: number = 5;

  @IsString()
  @IsNotEmpty()
  EXPIRATION_JOB_CRON: string = '*/1 * * * *';
}

/**
 * Función de validación que consume `@nestjs/config` (`ConfigModule.forRoot({ validate })`).
 * Convierte los strings de `process.env` a sus tipos y lanza si algo es inválido.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Configuración de entorno inválida: ${details}`);
  }

  return validated;
}
