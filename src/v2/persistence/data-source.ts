import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { databaseUrl } from '../config';
import { V2_ENTITIES } from './entities';
import { InitialV21795172400000 } from './migrations/1795172400000-InitialV2';
import { StrategyApprovals1795180000000 } from './migrations/1795180000000-StrategyApprovals';
import { BtcV31795185000000 } from './migrations/1795185000000-BtcV3';
import { RefreshTokens1795190000000 } from './migrations/1795190000000-RefreshTokens';
import { ArchiveProspectivePaper1795210000000 } from './migrations/1795210000000-ArchiveProspectivePaper';
import { ExchangeCredentials1795220000000 } from './migrations/1795220000000-ExchangeCredentials';
import { BtcV41795240000000 } from './migrations/1795240000000-BtcV4';
import { BtcV45MinuteEntry1795250000000 } from './migrations/1795250000000-BtcV45MinuteEntry';
import { BtcV51795260000000 } from './migrations/1795260000000-BtcV5';
config({ path: '.env.v2', quiet: true } as Parameters<typeof config>[0]);
export default new DataSource({
  type: 'postgres',
  url: databaseUrl(),
  entities: V2_ENTITIES,
  migrations: [InitialV21795172400000, StrategyApprovals1795180000000,BtcV31795185000000,RefreshTokens1795190000000,ArchiveProspectivePaper1795210000000,ExchangeCredentials1795220000000,BtcV41795240000000,BtcV45MinuteEntry1795250000000,BtcV51795260000000],
  synchronize: false,
  migrationsRun: false,
  logging: false,
});
