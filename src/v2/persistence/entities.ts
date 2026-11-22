import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  AccountState,
  Candle,
  ExchangeOrder,
  Fill,
  LedgerEntry,
  MarketSignal,
  OrderIntent,
  Position,
  UserSignalDecision,
  VirtualAccount,
  SimulationConfig,
} from '../domain/model';
import { DomainEvent } from '../events/contracts';

@Entity('v2_users')
export class V2User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) email!: string;
  @Column() name!: string;
  @Column({ select: false }) passwordHash!: string;
  @Column({ default: 'user' }) role!: 'admin' | 'user';
  @Column({ default: true }) active!: boolean;
  @Column({ default: 0 }) tokenVersion!: number;
  @Column({ type: 'varchar', nullable: true }) telegramChatId!: string | null;
  @Column({ type: 'varchar', nullable: true }) whatsappNumber!: string | null;
  @CreateDateColumn() createdAt!: Date;
}
@Entity('v2_refresh_tokens')
@Index(['userId', 'expiresAt'])
export class RefreshTokenRow {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') userId!: string;
  // Opaque refresh tokens are never stored; only a SHA-256 digest is persisted.
  @Column() tokenHash!: string;
  @Column() tokenVersion!: number;
  @Column({ type: 'timestamptz' }) expiresAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column('uuid', { nullable: true }) replacedById!: string | null;
  @CreateDateColumn() createdAt!: Date;
}
@Entity('v2_exchange_credentials')
export class ExchangeCredentialRow {
  @PrimaryColumn('uuid') id!: string;
  @Index({ unique: true }) @Column('uuid') userId!: string;
  @Column() environment!: 'TESTNET' | 'LIVE';
  @Column('text') apiKeyCiphertext!: string;
  @Column('text') secretCiphertext!: string;
  @Column({ type: 'timestamptz', nullable: true }) verifiedAt!: Date | null;
  @CreateDateColumn() createdAt!: Date;
}
@Entity('v2_virtual_accounts')
export class VirtualAccountRow {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { unique: true }) userId!: string;
  @Column('jsonb') data!: VirtualAccount;
}
abstract class OwnedRow<T> {
  @PrimaryColumn() id!: string;
  @Index() @Column('uuid') accountId!: string;
  @Column('jsonb') data!: T;
}
@Entity('v2_positions')
export class PositionRow extends OwnedRow<Position> {}
@Entity('v2_order_intents')
export class OrderIntentRow extends OwnedRow<OrderIntent> {}
@Entity('v2_exchange_orders')
export class ExchangeOrderRow extends OwnedRow<ExchangeOrder> {}
@Entity('v2_fills')
export class FillRow extends OwnedRow<Fill> {}
@Entity('v2_ledger_entries')
export class LedgerEntryRow extends OwnedRow<LedgerEntry> {}
@Entity('v2_user_signal_decisions')
export class UserSignalDecisionRow extends OwnedRow<UserSignalDecision> {}
@Entity('v2_market_signals')
export class MarketSignalRow {
  @PrimaryColumn() id!: string;
  @Column('jsonb') data!: MarketSignal;
}
@Entity('v2_candles')
@Index(['timeframe', 'openTime'], { unique: true })
export class CandleRow {
  @PrimaryColumn() id!: string;
  @Column() timeframe!: string;
  @Column('bigint') openTime!: number;
  @Column('jsonb') data!: Candle;
}
@Entity('v2_strategy_versions')
export class StrategyVersionRow {
  @PrimaryColumn() id!: string;
  @Column() revision!: string;
  @Column('jsonb') state!: { active?: boolean; eligible: boolean; lastCandleTime: number; lastSignalTime: number; configuration?: SimulationConfig; configurationHash?: string; lastDecision?:{decision:string;reason:string;features?:object} };
}
@Entity('v2_outbox')
@Index(['publishedAt', 'createdAt'])
export class OutboxEventRow {
  @PrimaryColumn() id!: string;
  @Column('jsonb') event!: DomainEvent;
  @CreateDateColumn() createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) publishedAt!: Date | null;
}
@Entity('v2_inbox')
export class InboxEventRow {
  @PrimaryColumn() id!: string;
  @CreateDateColumn() processedAt!: Date;
}
@Entity('v2_delivery_attempts')
export class DeliveryAttemptRow {
  @PrimaryColumn() id!: string;
  @Column({ default: 0 }) attempts!: number;
  @Column('timestamptz') nextAttemptAt!: Date;
  @Column({ default: false }) dead!: boolean;
}
@Entity('v2_backtest_runs')
export class BacktestRunRow {
  @PrimaryColumn('uuid') id!: string;
  @Index() @Column('uuid') userId!: string;
  @Column('jsonb') report!: object;
  @CreateDateColumn() createdAt!: Date;
}
@Entity('v2_strategy_validations')
@Index(['strategy', 'revision', 'configHash', 'status'])
export class StrategyValidationRow {
  @PrimaryColumn('uuid') id!: string;
  @Column() strategy!: string;
  @Column() revision!: string;
  @Column() simulatorRevision!: string;
  @Column() configHash!: string;
  @Column('uuid') reportId!: string;
  @Column() evidenceHash!: string;
  @Column() status!: 'PENDING'|'APPROVED'|'REVOKED';
  @Column('uuid') registeredBy!: string;
  @Column({ type: 'uuid', nullable: true }) decidedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) decidedAt!: Date | null;
  @Column('text') rationale!: string;
  @Column('jsonb') review!: Record<string, boolean>;
  @CreateDateColumn() createdAt!: Date;
}
export const V2_ENTITIES = [
  V2User,
  RefreshTokenRow,
  ExchangeCredentialRow,
  VirtualAccountRow,
  PositionRow,
  OrderIntentRow,
  ExchangeOrderRow,
  FillRow,
  LedgerEntryRow,
  UserSignalDecisionRow,
  MarketSignalRow,
  CandleRow,
  StrategyVersionRow,
  OutboxEventRow,
  InboxEventRow,
  DeliveryAttemptRow,
  BacktestRunRow,
  StrategyValidationRow,
];
export type StateArrays = Pick<
  AccountState,
  'positions' | 'orders' | 'fills' | 'ledger' | 'decisions'
>;
