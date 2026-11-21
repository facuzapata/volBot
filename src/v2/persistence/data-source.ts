import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { databaseUrl } from '../config';
import { V2_ENTITIES } from './entities';
import { InitialV21795172400000 } from './migrations/1795172400000-InitialV2';
import { StrategyApprovals1795180000000 } from './migrations/1795180000000-StrategyApprovals';
import { BtcV31795185000000 } from './migrations/1795185000000-BtcV3';
config({ path: '.env.v2', quiet: true } as Parameters<typeof config>[0]);
export default new DataSource({
  type: 'postgres',
  url: databaseUrl(),
  entities: V2_ENTITIES,
  migrations: [InitialV21795172400000, StrategyApprovals1795180000000,BtcV31795185000000],
  synchronize: false,
  migrationsRun: false,
  logging: false,
});
