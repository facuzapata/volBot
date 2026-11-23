import 'reflect-metadata';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import * as bcrypt from 'bcrypt';
import { BacktestingEngine } from './backtesting/backtesting.engine';
import { Candle, StrategyId } from './domain/model';
import { newAccount } from './execution/paper-execution.adapter';
import { PublicMarketClient } from './market/public-market.client';
import { V2User, VirtualAccountRow } from './persistence/entities';

config({ path: '.env.v2', quiet: true } as Parameters<typeof config>[0]);
async function main(): Promise<void> {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  const arg = (name: string, fallback = '') => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : fallback;
  };
  if (command === 'backtest') {
    const input = JSON.parse(await readFile(arg('input'), 'utf8')) as Candle[];
    const options = {
      strategy: arg('strategy', 'btc-v2') as StrategyId,
      initialCapital: Number(arg('capital', '500')),
      maxPositions: Number(arg('max-positions', '5')),
      usdtPerTrade: Number(arg('usdt', '30')),
      config: {
        feeRate: Number(arg('fee', '0.001')),
        spreadBps: Number(arg('spread', '2')),
        slippageBps: Number(arg('slippage', '3')),
      },
    };
    if (
      !['legacy-v1', 'btc-v2','btc-v3','btc-v4','btc-v5','btc-v6','trend-reference'].includes(options.strategy) ||
      options.initialCapital < 10 ||
      options.usdtPerTrade < 5 ||
      options.maxPositions < 1 ||
      options.maxPositions > 20
    )
      throw new Error('INVALID_BACKTEST_OPTIONS');
    const engine = new BacktestingEngine();
    const report = args.includes('--compare')
      ? engine.compare(input, options)
      : engine.run(input, options);
    await writeFile(arg('output', 'backtest-report.json'), JSON.stringify(report, null, 2));
    process.stdout.write('Backtest report written; no orders sent.\n');
    return;
  }
  if (command === 'download') {
    const start = Date.parse(arg('start'));
    const end = Date.parse(arg('end'));
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end - start > 366 * 86400000
    )
      throw new Error('INVALID_DATE_RANGE_MAX_366_DAYS');
    const client = new PublicMarketClient();
    const candles: Candle[] = [];
    let cursor = Math.ceil(start / 60000) * 60000;
    let batches = 0;
    while (cursor < end) {
      const batch = await client.candles('1m', cursor, 1000, end - 1);
      if (!batch.length) break;
      candles.push(...batch.filter((c) => c.closeTime < end));
      cursor = batch[batch.length - 1].openTime + 60000;
      batches++;
      if (batches % 25 === 0 || cursor >= end)
        process.stdout.write(`Downloaded ${candles.length} candles through ${new Date(Math.min(cursor, end) - 1).toISOString()}.\n`);
      await new Promise((r) => setTimeout(r, 250));
    }
    await writeFile(arg('output', 'btcusdt-1m.json'), JSON.stringify(candles));
    process.stdout.write(`Downloaded ${candles.length} public BTCUSDT candles.\n`);
    return;
  }
  const db = (await import('./persistence/data-source')).default;
  await db.initialize();
  try {
    if (command === 'migrate') {
      await db.runMigrations({ transaction: 'all' });
      process.stdout.write('V2 additive migrations applied.\n');
    } else if (command === 'seed') {
      const email = process.env.V2_ADMIN_EMAIL?.trim().toLowerCase();
      const password = process.env.V2_ADMIN_PASSWORD;
      if (!email?.includes('@') || !password || password.length < 12)
        throw new Error('Set V2_ADMIN_EMAIL and V2_ADMIN_PASSWORD (12+ characters)');
      if (await db.getRepository(V2User).existsBy({ email })) {
        process.stdout.write('Admin already exists; unchanged.\n');
        return;
      }
      await db.transaction(async (tx) => {
        const user = await tx.save(V2User, {
          email,
          name: 'Simulation administrator',
          passwordHash: await bcrypt.hash(password, 12),
          role: 'admin',
          active: true,
          tokenVersion: 0,
        });
        const state = newAccount(
          randomUUID(),
          user.id,
          Number(process.env.V2_INITIAL_CAPITAL || 500),
        );
        await tx.insert(VirtualAccountRow, {
          id: state.account.id,
          userId: user.id,
          data: state.account,
        });
      });
      process.stdout.write('Admin and paused 500-USDT-default simulation account created.\n');
    } else throw new Error('Commands: migrate, seed, download, backtest');
  } finally {
    await db.destroy();
  }
}
void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  process.stderr.write(
    `V2 command failed: ${detail}. Check documented arguments, network access, and dedicated database availability.\n`,
  );
  process.exitCode = 1;
});
