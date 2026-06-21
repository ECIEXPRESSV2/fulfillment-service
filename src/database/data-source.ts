import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.config';

export const AppDataSource = new DataSource(buildDataSourceOptions());
