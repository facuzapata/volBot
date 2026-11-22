# BTC-V4 qualification

BTC-V4 is not promoted on the basis of one profitable period. The qualification
runner evaluates its fixed revision; it does not search for parameters or
modify the strategy after seeing results.

Download public, checksum-verified BTCUSDT one-minute archives. No API key or
private Binance endpoint is used:

```powershell
python scripts/btc-v4/download-history.py --start 2025-01 --end 2026-01
python scripts/btc-v4/download-history.py --start 2026-01 --end 2026-12
npm.cmd run build
node scripts/btc-v4/qualify.cjs --as-of 2026-11-22 --output reports/btc-v4/qualification.json
```

The runner applies simulator fees, spread, and slippage to 2024, 2025, and
2026 YTD. Every period must have positive net P&L, profit factor of at least
1.2, a minimum number of closed trades, and drawdown no higher than 5%.

`NOT_QUALIFIED` means the strategy is not a LIVE candidate. A positive result
only advances it to a controlled PAPER observation; it is not a return
guarantee.
