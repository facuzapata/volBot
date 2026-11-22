# V5.7 PAPER rollout

Publish the API and worker from the same `dev` commit. This release does not
select V5 or enable account entries; those remain explicit operator actions.

1. Build the release (`npm run build`) and deploy both API and worker.
2. Run the existing additive migrations in that environment (`npm run db:migrate`).
   The V5 registration migration must have created the `btc-v5` strategy row.
   Do not rewrite an already applied migration to change its historical revision.
3. Restart the worker. Market startup loads enough closed 5m history for the
   15m EMA20/50, including repair of older 100-bar seeds. API and worker readiness
   may remain degraded while market backfill or other dependencies are unavailable.
4. Query `GET /api/strategies` with a Bearer token. The V5 entry should expose
   revision `2026-11-22.v5.7`, `configuration.btcV5.trendMinutes: 15`,
   `configuration.btcV5.exitMode: "TARGET_ONLY"` and `configuration.timeExit: false`.
5. An administrator can select V5 with `PATCH /api/admin/strategies/btc-v5/active`
   (no request body). This changes the shared strategy for future signals.
   Refresh the listing; after a new closed-minute evaluation by the updated
   worker, `lastEvaluationAt` should advance above zero. A stale V5 snapshot
   does not count as a new-version evaluation.
6. Keep the account in PAPER. Enabling new entries uses
   `PATCH /api/me/entries` with `{"enabled":true}`. Selection alone does not
   enable a paused account or submit an exchange order.

The frontend should use the returned configuration and position snapshots.
V5.7 evaluates a 15m trend, a 5m oversold recovery and a 1m entry. Target-only
positions have zero stop, no automatic time or trend exit, and a snapshotted
take-profit target. Older positions retain their original mode and target.
The public candle endpoint still accepts only 1m/5m/1h; 15m is aggregated
internally. A valid market signal can still be rejected by account limits.

One V5 position is allowed at a time. An open position blocks another buy,
can lose the entire ticket, and may remain open indefinitely. Daily/cumulative
loss entry guards do not liquidate it. Account performance must include both
realized and unrealized P&L; closed winning trades alone are insufficient.

The 2025 retrospective comparison used 500 USDT and a 30 USDT ticket ceiling.
The 15m variant closed 13 trades and retained one position for about 20 days
at year-end; estimated net liquidation value was +1.927555 USDT. The 1h
control closed 32 trades, retained a position for about 64 days and finished
at +1.392481 USDT on the same basis. Neither meets the existing qualification
gates. These figures are not a forecast of PAPER or future market performance.
See [the qualification record](btc-v5-qualification.md) for assumptions,
limitations, source/configuration hashes and repeatable replay commands.
