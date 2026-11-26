import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  IsUUID,
  IsObject,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { BtcV3Parameters, DEFAULT_BTC_V3 } from '../strategy/btc-v3.config';
import { validV3Parameters } from '../strategy/btc-v3.strategy';

@ValidatorConstraint({name:'btcV3Parameters',async:false})
export class BtcV3ParametersConstraint implements ValidatorConstraintInterface {
  validate(v:unknown):boolean{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>k in DEFAULT_BTC_V3)&&validV3Parameters({...DEFAULT_BTC_V3,...v as object})}
  defaultMessage():string{return 'btcV3 must contain only valid, versioned BTC-V3 parameters'}
}

export class LoginDto {
  @ApiProperty({ example: 'admin@example.com' }) @IsEmail() email!: string;
  @ApiProperty({ example: 'existing-password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
export class CreateUserDto extends LoginDto {
  // Login must accept legacy bootstrap credentials, while account creation
  // continues to require a strong new password.
  @MinLength(12)
  declare password: string;
  @ApiProperty({ example: 'Trader A' }) @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiPropertyOptional({ enum: ['user', 'admin'], default: 'user' })
  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';
  @ApiPropertyOptional({ example: 500, minimum: 10, maximum: 1000000 })
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(1000000)
  initialCapital?: number;
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxPositions?: number;
  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(100000)
  usdtPerTrade?: number;
}
export class TradingConfigDto {
  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxPositions?: number;
  @ApiPropertyOptional({ example: 30, minimum: 5, maximum: 100000 })
  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(100000)
  usdtPerTrade?: number;
}
export class EntriesDto {
  @ApiProperty({
    example: true,
    description: 'Only controls new entries; existing positions remain supervised.',
  })
  @IsBoolean()
  enabled!: boolean;
}
export class BinanceCredentialsDto {
  @ApiProperty({ description: 'Binance API key. It is encrypted at rest and never returned.' })
  @IsString() @MinLength(16) @MaxLength(200) apiKey!: string;
  @ApiProperty({ description: 'Binance API secret. It is encrypted at rest and never returned.' })
  @IsString() @MinLength(16) @MaxLength(300) secret!: string;
  @ApiProperty({ enum: ['TESTNET', 'LIVE'], description: 'Use TESTNET before a production key.' })
  @IsIn(['TESTNET', 'LIVE']) environment!: 'TESTNET' | 'LIVE';
}
export class TradingModeDto {
  @ApiProperty({ enum: ['PAPER', 'LIVE'], description: 'LIVE submits to the verified Binance connection for this user.' })
  @IsIn(['PAPER', 'LIVE']) mode!: 'PAPER' | 'LIVE';
}
export class ExchangeConnectionDto {
  @ApiProperty({ example: true }) configured!: boolean;
  @ApiPropertyOptional({ enum: ['TESTNET', 'LIVE'] }) environment?: 'TESTNET' | 'LIVE';
  @ApiPropertyOptional({ example: '2026-11-22T00:00:00.000Z' }) verifiedAt?: Date | null;
}
export class RegisterValidationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() reportId!: string;
  @ApiProperty({ minLength: 30 }) @IsString() @MinLength(30) @MaxLength(4000) rationale!: string;
}
export class DecideValidationDto {
  @ApiProperty({ enum: ['APPROVED','REVOKED'] }) @IsIn(['APPROVED','REVOKED']) status!: 'APPROVED'|'REVOKED';
  @ApiProperty({ minLength: 30 }) @IsString() @MinLength(30) @MaxLength(4000) rationale!: string;
  @ApiProperty({ example: false }) @IsBoolean() simulatorReviewed!: boolean;
  @ApiProperty({ example: false }) @IsBoolean() outOfSampleReviewed!: boolean;
  @ApiProperty({ example: false }) @IsBoolean() costsReviewed!: boolean;
  @ApiProperty({ example: false }) @IsBoolean() riskReviewed!: boolean;
}
export class NotificationSettingsDto {
  @ApiProperty({
    example: '123456789',
    description: 'Admin-verified private Telegram chat belonging to this user. No global fallback.',
  })
  @IsString()
  @Matches(/^-?\d{1,20}$/)
  telegramChatId!: string;
}
export class PageDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  offset = 0;
}
export class PublicUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'trader@example.com' }) email!: string;
  @ApiProperty({ example: 'Trader A' }) name!: string;
  @ApiProperty({ enum: ['user', 'admin'] }) role!: string;
  @ApiProperty({ example: true }) active!: boolean;
}
export class TokenDto {
  @ApiProperty({ description: 'Short-lived bearer token', example: '<JWT>' }) accessToken!: string;
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}
export class BalanceDto {
  @ApiProperty({ example: 'PAPER', enum: ['PAPER', 'LIVE'] }) mode!: string;
  @ApiProperty({ example: '500.000000000000' }) availableUSDT!: string;
  @ApiProperty({ example: '30.000000000000' }) reservedUSDT!: string;
  @ApiProperty({ example: '0.000300000000' }) assignedBTC!: string;
  @ApiProperty({ example: '0.00031000', description: 'Total virtual BTC inventory from the ledger, including reservations.' }) totalBTC!: string;
  @ApiProperty({ example: '0.00001000', description: 'Ledger BTC not assigned to a position. Reserved exits are already included in assignedBTC.' }) unassignedBTC!: string;
  @ApiProperty({ example: '0.00000100', description: 'BTC in DUST positions, already included in assignedBTC.' }) dustBTC!: string;
  @ApiProperty({
    example: '0.000300000000',
    description: 'Assigned quantity covered by a pending exit',
  })
  reservedBTC!: string;
  @ApiProperty({ example: 500.1 }) equityUSDT!: number;
  @ApiProperty({ example: false }) entriesEnabled!: boolean;
}
export class AccountConfigResponseDto {
  @ApiProperty({ example: 5 }) maxPositions!: number;
  @ApiProperty({ example: '30.000000000000' }) usdtPerTrade!: string;
  @ApiProperty({ example: false }) entriesEnabled!: boolean;
  @ApiProperty({ enum: ['PAPER', 'LIVE'], example: 'PAPER' }) executionMode!: string;
}
export class RecordDto {
  @ApiProperty({ description: 'Stable, idempotent domain identifier' }) id!: string;
  @ApiPropertyOptional({ example: 'OPEN' }) status?: string;
}
export class PageResponseDto {
  @ApiProperty({
    type: [RecordDto],
    description:
      'Domain records scoped to the authenticated account. See docs/database.md for full fields.',
  })
  items!: object[];
  @ApiProperty() total!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
}
export class StatsDto {
  @ApiProperty({ example: 1.25 }) netRealizedPnl!: number;
  @ApiProperty({ example: -0.1 }) unrealizedPnl!: number;
  @ApiProperty({ example: 501.15 }) equity!: number;
  @ApiProperty({ example: 10 }) closedTrades!: number;
  @ApiProperty({ example: 6, description: 'Closed positions with positive net realized P&L.' }) winningTrades!: number;
  @ApiProperty({ example: 3, description: 'Closed positions with negative net realized P&L.' }) losingTrades!: number;
  @ApiProperty({ example: 1, description: 'Closed positions with zero net realized P&L.' }) breakevenTrades!: number;
  @ApiProperty({ example: 1.2, nullable: true }) profitFactor!: number | null;
  @ApiProperty({ example: 0.125 }) expectancy!: number;
  @ApiProperty({ example: 0.6 }) winRate!: number;
  @ApiProperty({ nullable: true, description: 'Null when an equity curve has not been measured.' })
  maxDrawdown!: number | null;
  @ApiProperty() totalCommissions!: number;
}
export class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: string;
  @ApiProperty({ example: 'PAPER' }) mode!: string;
  @ApiProperty() database!: boolean;
  @ApiProperty() redis!: boolean;
  @ApiProperty() marketFresh!: boolean;
  @ApiProperty() outboxPending!: number;
}
export class CandleDto {
  @ApiProperty({ enum: ['BTCUSDT'] }) @IsIn(['BTCUSDT']) symbol!: 'BTCUSDT';
  @ApiProperty({ enum: ['1m'] }) @IsIn(['1m']) timeframe!: '1m';
  @ApiProperty({ example: 1735689600000 }) @IsInt() @Min(0) openTime!: number;
  @ApiProperty({ example: 1735689659999 }) @IsInt() @Min(0) closeTime!: number;
  @ApiProperty({ example: 95000 }) @IsNumber() @Min(0.01) open!: number;
  @ApiProperty({ example: 95100 }) @IsNumber() @Min(0.01) high!: number;
  @ApiProperty({ example: 94900 }) @IsNumber() @Min(0.01) low!: number;
  @ApiProperty({ example: 95050 }) @IsNumber() @Min(0.01) close!: number;
  @ApiProperty({ example: 10 }) @IsNumber() @Min(0) volume!: number;
}
export class BacktestDto {
  @ApiProperty({ enum: ['legacy-v1', 'btc-v2','btc-v3','btc-v4','btc-v5','btc-v6','trend-reference'] }) @IsIn(['legacy-v1', 'btc-v2','btc-v3','btc-v4','btc-v5','btc-v6','trend-reference']) strategy!:
    | 'legacy-v1'
    | 'btc-v2'|'btc-v3'|'btc-v4'|'btc-v5'|'btc-v6'|'trend-reference';
  @ApiPropertyOptional({type:'object',additionalProperties:true,example:DEFAULT_BTC_V3,description:'Experimental versioned thresholds. Calibration is server-configured and hash verified; clients cannot supply forecasts or approvals.'})
  @IsOptional() @IsObject() @Validate(BtcV3ParametersConstraint) btcV3?:Partial<BtcV3Parameters>;
  @ApiPropertyOptional({example:.005,minimum:.000001,maximum:.1,description:'Maximum estimated net stop loss / marked account equity, revalidated before fill.'})
  @IsOptional() @IsNumber() @Min(.000001) @Max(.1) maxRiskPerTrade?:number;
  @ApiProperty({ example: 500 }) @IsNumber() @Min(10) @Max(1000000) initialCapital!: number;
  @ApiProperty({ example: 5 }) @IsInt() @Min(1) @Max(20) maxPositions!: number;
  @ApiProperty({ example: 30 }) @IsNumber() @Min(5) @Max(100000) usdtPerTrade!: number;
  @ApiPropertyOptional({ example: 0.001 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.01)
  feeRate?: number;
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  slippageBps?: number;
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  spreadBps?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() compare?: boolean;
  @ApiProperty({ type: [CandleDto], maxItems: 50000 })
  @IsArray()
  @ArrayMinSize(50)
  @ArrayMaxSize(50000)
  @ValidateNested({ each: true })
  @Type(() => CandleDto)
  candles!: CandleDto[];
}
export class BacktestResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    description:
      'Reproducible simulation report with configuration, dataset hash, metrics and complete executions.',
    type: 'object',
    additionalProperties: true,
  })
  report!: object;
}
export class StrategyResponseDto {
  @ApiProperty({ enum: ['legacy-v1', 'btc-v2','btc-v3','btc-v4','btc-v5','btc-v6','trend-reference'] }) id!: string;
  @ApiProperty() revision!: string;
  @ApiProperty() description!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ description: 'Last evaluated closed-candle timestamp in UTC milliseconds' }) lastEvaluationAt!: number;
  @ApiProperty() eligible!: boolean;
  @ApiProperty({type:'object',additionalProperties:true}) configuration!:object;
  @ApiProperty() configurationHash!:string;
  @ApiProperty() calibrationReady!:boolean;
  @ApiPropertyOptional({type:'object',additionalProperties:true,description:'Latest closed-candle assessment. For BTC-V2, `reason` lists the failed required conditions and `features.conditions` contains each boolean.'}) lastDecision?:object;
}
export class MarketQueryDto extends PageDto {
  @ApiPropertyOptional({ enum: ['1m', '5m', '1h'], default: '1m' })
  @IsOptional()
  @IsIn(['1m', '5m', '1h'])
  timeframe: '1m' | '5m' | '1h' = '1m';
}
export class MarketCandleDto extends OmitType(CandleDto, ['timeframe'] as const) {
  @ApiProperty({ enum: ['1m', '5m', '1h'] }) timeframe!: string;
}
export class MarketStatusDto extends HealthDto {
  @ApiProperty({ enum: ['BTCUSDT'] }) symbol!: string;
  @ApiProperty({ example: 95000, nullable: true }) latestPrice!: number | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Latest closed candle for 1m, 5m and 1h; null until initialized.',
  })
  intervals!: object;
}
export class PositionDto extends RecordDto {
  @ApiProperty() accountId!: string;
  @ApiProperty() signalId!: string;
  @ApiProperty({ enum: ['legacy-v1', 'btc-v2','btc-v3','btc-v4','btc-v5','btc-v6','trend-reference'] }) strategy!: string;
  @ApiProperty({ enum: ['PAPER', 'LIVE'] }) executionMode!: string;
  @ApiProperty({ description: 'Current remaining BTC, decimal string', example: '0.000300000000' })
  quantity!: string;
  @ApiProperty() averageEntry!: string;
  @ApiProperty() entryQuantity!: string;
  @ApiProperty() entryQuote!: string;
  @ApiProperty() entryFees!: string;
  @ApiProperty() remainingCost!: string;
  @ApiProperty() realizedPnl!: string;
  @ApiProperty() stopLoss!: string;
  @ApiProperty() takeProfit!: string;
  @ApiProperty() highWater!: string;
  @ApiProperty() atr!: string;
  @ApiProperty() openedAt!: number;
  @ApiPropertyOptional() closedAt?: number;
  @ApiPropertyOptional() exitReason?: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) config!: object;
  @ApiPropertyOptional({type:'object',additionalProperties:true,description:'Fill-time geometry, gross risk, net stop loss, round-trip costs and risk cap; stop gaps can exceed the estimate.'}) executionRisk?:object;
}
export class OrderDto extends RecordDto {
  @ApiProperty() positionId!: string;
  @ApiProperty() signalId!: string;
  @ApiProperty({ enum: ['BUY', 'SELL'] }) side!: string;
  @ApiProperty({ enum: ['PAPER', 'LIVE'] }) executionMode!: string;
  @ApiProperty({ enum: ['MARKET', 'LIMIT', 'PROTECTION'] }) type!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() filledQuantity!: string;
  @ApiProperty() reservedQuote!: string;
  @ApiPropertyOptional() limitPrice?: string;
  @ApiPropertyOptional() deferredReason?:string;
  @ApiPropertyOptional({type:'object',additionalProperties:true}) executionRisk?:object;
  @ApiProperty() reason!: string;
  @ApiProperty() createdAt!: number;
  @ApiPropertyOptional() rejection?: string;
}
export class FillDto extends RecordDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() positionId!: string;
  @ApiProperty({ enum: ['BUY', 'SELL'] }) side!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() price!: string;
  @ApiProperty() quote!: string;
  @ApiProperty() commission!: string;
  @ApiProperty({ enum: ['USDT', 'BTC'] }) commissionAsset!: string;
  @ApiProperty() at!: number;
  @ApiPropertyOptional({enum:['OPEN','INTRABAR','CLOSE','DECISION']}) executionPhase?:string;
  @ApiPropertyOptional({nullable:true,description:'Closed timestamp of the prior minute supplying the causal capacity proxy; never current/future candle volume.'}) liquiditySourceCloseTime?:number|null;
  @ApiPropertyOptional({description:'Shared BTC capacity for this symbol/minute, across phases and operational accounts.'}) liquidityCapacity?:number;
}
export class LedgerDto extends RecordDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() positionId!: string;
  @ApiProperty({ enum: ['BTC', 'USDT'] }) asset!: string;
  @ApiProperty() availableDelta!: string;
  @ApiProperty() reservedDelta!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() at!: number;
}
export class PositionsPageDto extends PageResponseDto {
  @ApiProperty({ type: [PositionDto] }) items: PositionDto[] = [];
}
export class OrdersPageDto extends PageResponseDto {
  @ApiProperty({ type: [OrderDto] }) items: OrderDto[] = [];
}
export class FillsPageDto extends PageResponseDto {
  @ApiProperty({ type: [FillDto] }) items: FillDto[] = [];
}
export class LedgerPageDto extends PageResponseDto {
  @ApiProperty({ type: [LedgerDto] }) items: LedgerDto[] = [];
}
export class CandlesPageDto extends PageResponseDto {
  @ApiProperty({ type: [MarketCandleDto] }) items: MarketCandleDto[] = [];
}
export class UsersPageDto extends PageResponseDto {
  @ApiProperty({ type: [PublicUserDto] }) items: PublicUserDto[] = [];
}
