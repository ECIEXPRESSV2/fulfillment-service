import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './database.config';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDataSourceOptions(),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
