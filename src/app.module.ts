import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.config';
import { CORRELATION_ID_HEADER } from './common/interceptors/correlation-id.interceptor';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { GatewayAuthGuard } from './common/guards/gateway-auth.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Genera/propaga el correlation id desde el header; queda en `req.id` y en todos los logs.
        genReqId: (req, res) => {
          const incoming = req.headers[CORRELATION_ID_HEADER];
          const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
          res.setHeader(CORRELATION_ID_HEADER, id);
          return id;
        },
        customProps: (req) => ({ correlationId: (req as { id?: string }).id }),
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        // No loguear PII más allá de ids (CLAUDE.md §13).
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    PrismaModule,
    OutboxModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    Reflector,
    { provide: APP_GUARD, useClass: GatewayAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationIdInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
