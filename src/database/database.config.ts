import { DataSourceOptions } from 'typeorm';
import { SnakeCaseNamingStrategy } from './naming.strategy';
import {
  PickupCodeEntity,
  DeliveryEntity,
  OrderProjectionEntity,
  StoreStaffProjectionEntity,
  OutboxEventEntity,
  ProcessedEventEntity,
  AuditLogEntity,
} from './entities';

export function buildDataSourceOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env variable is required');

  return {
    type: 'postgres',
    url,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    namingStrategy: new SnakeCaseNamingStrategy(),
    entities: [
      PickupCodeEntity,
      DeliveryEntity,
      OrderProjectionEntity,
      StoreStaffProjectionEntity,
      OutboxEventEntity,
      ProcessedEventEntity,
      AuditLogEntity,
    ],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
  };
}
