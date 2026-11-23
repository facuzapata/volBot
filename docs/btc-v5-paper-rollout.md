# V5.9 PAPER rollout

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
   revision `2026-11-23.v5.9`,
   `configuration.btcV5.entryModel: "CONFIRMED_JUMP"`,
   `configuration.btcV5.exitMode: "TARGET_ONLY"`,
   `configuration.btcV5.targetFraction: 0.008`,
   `configuration.btcV5.maxTicketUsdt: 10` and `configuration.timeExit: false`.
5. An administrator can select V5 with `PATCH /api/admin/strategies/btc-v5/active`
   (no request body). This changes the shared strategy for future signals.
   Refresh the listing; after a new closed-minute evaluation by the updated
   worker, `lastEvaluationAt` should advance above zero. A stale V5 snapshot
   does not count as a new-version evaluation.
6. Keep the account in PAPER. Enabling new entries uses
   `PATCH /api/me/entries` with `{"enabled":true}`. Selection alone does not
   enable a paused account or submit an exchange order.

The frontend should use the returned configuration and position snapshots.
V5.9 detects the first 1m cross above the prior two hours of completed 5m
resistance, requires an exceptional impulse and volume, and buys only after the
following 1m candle confirms continuation. Target-only positions have zero stop,
no automatic time or trend exit, and a snapshotted 0.8% take-profit target.
Older positions retain their original mode and target.
The public candle endpoint still accepts only 1m/5m/1h; 15m is aggregated
internally. A valid market signal can still be rejected by account limits.

Up to five confirmed-jump V5 positions are allowed when the account limit also
permits them. Each entry is capped internally at 10 USDT and aggregate V5
exposure remains capped at 20% of equity. A position can lose the entire ticket
and may remain open indefinitely. Daily/cumulative loss entry guards do not
liquidate it. Account performance must include both realized and unrealized P&L;
closed winning trades alone are insufficient.

The fixed V5.9 replay used 500 USDT and the production 10 USDT internal ticket
cap. It closed 11 trades in 2024 (+0.591263 USDT), 6 in 2025 (+0.321232 USDT)
and 10 through 22 November 2026 (+0.534958 USDT), with no open position at each
cut. The 2026 higher-cost case closed the same 10 trades for +0.400533 USDT.
The sample is too small for the existing qualification gates and was inspected
retrospectively, so these figures are not a forecast or evidence of guaranteed
profit. This revision must remain PAPER until prospective observations exist.

Publication validation: build and lint pass. The repository suite passes 202
tests with 15 skipped when the separate unfinished historical-range experiment
is excluded. V5-specific coverage passes 55 tests, including the confirmed-jump
entry, target-only execution and the internal 10 USDT ticket cap.
