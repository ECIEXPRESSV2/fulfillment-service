import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { EnvironmentVariables } from '../config/env.config';
import { ExpirationService } from './expiration.service';

const JOB_NAME = 'pickup-code-expiration';

/**
 * Programa el job de expiración con el cron de `EXPIRATION_JOB_CRON`. Se registra de forma
 * dinámica (no con `@Cron`) para leer la expresión desde la config ya validada al arrancar,
 * en vez de depender de `process.env` en tiempo de carga del módulo.
 */
@Injectable()
export class ExpirationScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExpirationScheduler.name);
  private readonly cronExpression: string;
  private readonly timeZone?: string;

  constructor(
    private readonly expirationService: ExpirationService,
    private readonly schedulerRegistry: SchedulerRegistry,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.cronExpression = config.get('EXPIRATION_JOB_CRON', { infer: true });
    this.timeZone = config.get('TZ', { infer: true });
  }

  onApplicationBootstrap(): void {
    const job = CronJob.from({
      cronTime: this.cronExpression,
      onTick: () => void this.run(),
      timeZone: this.timeZone,
    });
    this.schedulerRegistry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Job de expiración programado (${this.cronExpression})`);
  }

  onModuleDestroy(): void {
    try {
      this.schedulerRegistry.getCronJob(JOB_NAME).stop();
    } catch {
      // el job pudo no haberse registrado; nada que detener
    }
  }

  private async run(): Promise<void> {
    try {
      await this.expirationService.expireDueCodes();
    } catch (error) {
      this.logger.error({ err: error }, 'Error ejecutando el job de expiración');
    }
  }
}
