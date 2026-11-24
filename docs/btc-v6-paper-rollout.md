# V6.3 PAPER rollout

V6 is an aggressive, independent BTC momentum experiment. It must remain PAPER.
Publishing the release does not activate it or enable account entries.

## Fixed entry model

- EMA9 on completed 5m candles strictly higher than its value one 5m candle
  earlier. EMA9 may remain below EMA21; no minimum EMA separation is required.
- Same-minute close at least 0.2 ATR above the prior 20-minute resistance.
- Breakout no farther than 2.5 ATR from resistance.
- Bullish 1m impulse of at least 0.5 ATR and above the prior minute high.
- Volume at least 1.5 times the prior 20-minute average.
- 5m ATR between 0.02% and 1.2% of price.
- Gross target 0.4%; estimated net target must remain at least 0.1%.

V6 is `TARGET_ONLY`: no stop, time exit or invalidation exit. `usdtPerTrade` and
`maxPositions` come exclusively from the user's account configuration. V6 adds
no daily entry-count limit. Exchange filters, available balance and the generic
account exposure check still apply.

Independent V6 target-only PAPER entries may execute below another position's
entry price, as allowed by reservation. Each entry retains its own inventory and
target. Adding a lower-priced partial fill to the same position remains blocked.
An accepted decision records reservation; execution can still reject an order
after rechecking balance, exposure, target economics and exchange filters.
The rejection code is stored in the order's `rejection` and `executionRisk.reason`
fields and in the ledger entry that releases its reservation.
SELL orders are created when a candle reaches the stored target or a manual
close is requested; a falling price alone does not generate a V6 sell.

## Deployment

1. Deploy API and worker from the same commit.
2. Run `npm run db:migrate` to register `btc-v6` without activating it.
3. Restart API and worker.
4. Verify `GET /api/strategies` reports revision `2026-11-23.v6.3`,
   `btcV6.exitMode: "TARGET_ONLY"` and `timeExit: false`.
5. Select it explicitly with `PATCH /api/admin/strategies/btc-v6/active`.
6. Keep the account PAPER and enable entries separately.

## Entry history

V6.3 replaces the mandatory EMA9/EMA21 crossover and 0.02% separation with a
strictly rising EMA9 between the last two completed 5m candles. A flat or
falling EMA9 still blocks entry. Both EMA values use the same initialization
window; the current 5m candle is excluded. `ema5mFastPrevious` and
`ema5mFastSlope` expose this decision in diagnostics. EMA21 and `trendStrength`
remain diagnostic only; `minTrendStrength` is removed from V6 parameters.
The remaining V6.2 entry and exit rules are retained.

V6.2 shortens resistance from 45 to 20 minutes, reduces the breakout buffer
from 0.5 to 0.2 ATR and the one-minute impulse from 1 to 0.5 ATR. ATR still
comes from completed 5m candles. Trend, relative volume, costs and exits retain
their existing rules. These thresholds are experimental, not a profitability
qualification; the V6.1 retrospective below does not evaluate V6.2.

Replaying the same Binance BTCUSDT candles for November 23, 2026, 15:35–19:35
Argentina time (18:35–22:35 UTC), V6.2 passes the breakout filter on 6 minutes
and the impulse filter on 12, versus zero for both in V6.1. Both revisions
produce zero fully eligible minutes. The 18:00 Argentina candle passes every
V6.2 condition except the 5m trend. This replay uses source defaults and does
not establish deployed worker behavior or profitability.

With the same dataset and source defaults, V6.3 produces one eligible minute:
the November 23 18:00 Argentina candle (21:00 UTC), evaluated at its close.
Its reference close is 61344.76 USDT and its target is 61590.13 USDT. EMA9
rises from 61206.00847 to 61212.60678 while remaining below EMA21 (61279.98557).
The trend condition passes on 90 of the 240 evaluated minutes, versus 10 for
V6.2. This is an entry eligibility replay, not an execution or profit result.

## October 2026 retrospective result (V6.1 only)

With 500 USDT, 10 USDT per signal and five parallel positions, the production
V6.1 code generated 82 eligible minutes and closed 33 targets for +0.499734
USDT. One position remained open; marking and liquidating it at the month-end
price changes the result to -0.038822 USDT. This inspected sample does not
qualify the strategy and does not establish future profitability. The purpose
of deployment is prospective PAPER observation, not live trading.
