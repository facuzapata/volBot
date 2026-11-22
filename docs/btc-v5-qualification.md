# BTC-V5 qualification

V5 is a separate PAPER research candidate. It does not modify V4 and is not
allowed to increase the ticket after a loss. Revision V5.2 requires a 4h
trend, a 1h higher-low, and a 15m retest with above-baseline volume before a
one-minute recovery entry. It was chosen after the V5.1 audit showed that
most stopped entries continued lower; it is not a wider-stop recovery rule.
Two consecutive stops require a wait for the next 4h close.

The qualifying runner replays the frozen revision with simulated fees, spread
and slippage. It must not be used to select parameters after observing these
three periods:

```powershell
npm.cmd run build
node scripts/btc-v5/qualify.cjs --as-of 2026-11-22 --output reports/btc-v5/qualification.json
```

Every period needs positive net P&L, profit factor at least 1.2, enough closed
trades, and no more than 5% maximum drawdown. A failure yields
`NOT_QUALIFIED`; a pass advances only to controlled PAPER observation, never
to a promise of future return or automatic LIVE activation.

To investigate a failed period without changing V5 parameters, attribute its
closed trades and decision rejections by exit reason and month:

```powershell
npm.cmd run build
node scripts/btc-v5/analyze-period.cjs --start 2025-01-01 --end 2026-01-01 --output reports/btc-v5/audit-2025.json
```
