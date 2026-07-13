import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.config';

config();

export const AppDataSource = new DataSource(buildDataSourceOptions());
