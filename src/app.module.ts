import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.config';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { LoggingMiddleware } from './common/logger/logging.middleware';
import { GatewayAuthGuard } from './common/guards/gateway-auth.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AuditModule } from './audit/audit.module';
import { CodesModule } from './codes/codes.module';
import { DatabaseModule } from './database/database.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { ConsumerModule } from './events/consumer.module';
import { EventsModule } from './events/events.module';
import { ExpirationModule } from './expiration/expiration.module';
import { OutboxModule } from './outbox/outbox.module';
import { QrModule } from './qr/qr.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    AuditModule,
    OutboxModule,
    EventsModule,
    CodesModule,
    DeliveriesModule,
    QrModule,
    ExpirationModule,
    ConsumerModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Rellena el userId (header x-user-id) en el contexto de logging para que cada
    // log enviado a Application Insights incluya customDimensions.userId.
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
