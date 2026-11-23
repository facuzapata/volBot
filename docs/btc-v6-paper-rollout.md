# V6.1 PAPER rollout

V6 is an aggressive, independent BTC momentum experiment. It must remain PAPER.
Publishing the release does not activate it or enable account entries.

## Fixed entry model

- EMA9 above EMA21 on completed 5m candles, separated by at least 0.02%.
- Same-minute close at least 0.5 ATR above the prior 45-minute resistance.
- Breakout no farther than 2.5 ATR from resistance.
- Bullish 1m impulse of at least 1 ATR and above the prior minute high.
- Volume at least 1.5 times the prior 20-minute average.
- 5m ATR between 0.02% and 1.2% of price.
- Gross target 0.4%; estimated net target must remain at least 0.1%.

V6 is `TARGET_ONLY`: no stop, time exit or invalidation exit. `usdtPerTrade` and
`maxPositions` come exclusively from the user's account configuration. V6 adds
no daily entry-count limit. Exchange filters, available balance and the generic
account exposure check still apply.

## Deployment

1. Deploy API and worker from the same commit.
2. Run `npm run db:migrate` to register `btc-v6` without activating it.
3. Restart API and worker.
4. Verify `GET /api/strategies` reports revision `2026-11-23.v6.1`,
   `btcV6.exitMode: "TARGET_ONLY"` and `timeExit: false`.
5. Select it explicitly with `PATCH /api/admin/strategies/btc-v6/active`.
6. Keep the account PAPER and enable entries separately.

## October 2026 retrospective result

With 500 USDT, 10 USDT per signal and five parallel positions, the production
V6.1 code generated 82 eligible minutes and closed 33 targets for +0.499734
USDT. One position remained open; marking and liquidating it at the month-end
price changes the result to -0.038822 USDT. This inspected sample does not
qualify the strategy and does not establish future profitability. The purpose
of deployment is prospective PAPER observation, not live trading.
