# BTC-V5 qualification

V5 is a separate PAPER research candidate. It does not modify V4 and is not
allowed to increase the ticket after a loss. Its specific hypothesis is that
a 4h trend plus a 1h higher-low and a 15m retest can reject some failed
continuations that V4 admitted. A stop loss triggers a quality gate on the
next V5 setup; two consecutive stops require a wait for the next 4h close.

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
