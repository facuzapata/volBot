import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const sslConfig = process.env.DB_SSL === 'false' ? false : (isProduction ? {
  rejectUnauthorized: false
} : false);

export const typeOrmConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || process.env.DATABASE_HOST,
  port: parseInt(process.env.DB_PORT || process.env.DATABASE_PORT || '5432'),
  username: process.env.DB_USERNAME || process.env.DATABASE_USERNAME,
  password: process.env.DB_PASSWORD || process.env.DATABASE_PASSWORD,
  database: process.env.DB_NAME || process.env.DATABASE_NAME,
  autoLoadEntities: true,
  synchronize: false, // Never mutate a persistent V1 schema during startup.
  ssl: sslConfig,
};
