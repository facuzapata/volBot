# BTC-V5 intraday PAPER candidate

Revision `2026-11-22.v5.7` uses a 15m trend context by default and retains
V5.6's explicit PAPER `TARGET_ONLY` mode. `trendMinutes: 60` is retained as
a comparison option; `trendMinutes: 15` selects the new default. Automatic exits
occur only at the snapshotted take-profit target: there is no stop-loss,
time expiry, trailing stop or trend-invalidation exit. A manual close remains
available and can realize a loss. Existing positions keep the mode and rules
stored when they opened; this change does not rewrite their protection.

The V5.5 entry and target-selection rules are unchanged apart from the trend
timeframe. They use complete, contiguous candles: 15m EMA20 above EMA50 and
15m close above EMA50 (or hourly context when `trendMinutes` is 60); a recent
5m lower Bollinger band touch followed by a bullish higher close; then a 1m
recovery above EMA9 and the preceding minute's high. Bands use 20 candles and
two standard deviations, excluding the current 5m candle. Entry must remain
below the prior band midpoint and near the 5m confirmation close.

The target is the prior upper band, capped at 1.2% above entry. Entry filters
still require adequate room after fees, spread and slippage relative to the
reference structural geometry. This reference is **not an active stop** in
`TARGET_ONLY`: the emitted signal and position have stop price zero, horizon
zero and explicit mode metadata. `referenceGeometry`, `referenceRewardRisk`
and `referenceStopPrice` describe entry selection only. A projected fill must
still leave at least the minimum net profit at the target after commissions.

Risk controls for `TARGET_ONLY`:

- One V5 position at a time; no automatic averaging down or recovery sizing.
- Configured ticket ceiling (30 USDT in the experiment), and 20% exposure cap.
- The whole ticket can be lost. The protected mode's 0.1% stop-based trade-risk
  budget is **not applicable**. Execution snapshots label this `FULL_NOTIONAL`
  and report the full cost as potential loss; the legacy field named
  `estimatedNetStopLoss` contains that full-ticket estimate in this mode.
- Daily 0.5% and cumulative 2% loss guards block new entries once observed
  equity/loss limits are reached. They do not liquidate an already open
  target-only position and do not bound its subsequent drawdown.
- Six daily entries and the 15-minute post-close cooldown remain. An occupied
  position can block new buys for months even while fresh signals are emitted.
- The special mode requires matching V5 signal, configuration and PAPER venue
  markers. A missing stop on another strategy, a protected position, or an
  inconsistent signal remains invalid. This mode is rejected for LIVE accounts.

The comparison mode `STOP_TARGET` preserves the V5.5 structural/ATR stop,
0.1% projected account risk ceiling, 0.6% maximum stop distance and six-hour
expiry. Trailing and generic invalidation exits remain disabled in both modes.
Fees, spread and slippage are included in both. The no-stop experiment is not
a guarantee of recovery or positive final equity.

Run the frozen replay without tuning parameters to the historical result:

```powershell
npm.cmd run build
node --max-old-space-size=4096 scripts/btc-v5/qualify-intraday.cjs --as-of 2026-11-22 --output reports/btc-v5/qualification-v5.6-target-only.json
```

The compatibility entry point `scripts/btc-v5/qualify.cjs` runs the same check.
`--case retrospective-2025` (or another case label) runs one case for diagnosis;
partial evidence is marked incomplete and can never qualify the whole suite.
Historical V5.1/V5.2 reports are retained separately and do not validate V5.3.
The runner uses seven days of warmup, rejects missing or noncontiguous history,
records dataset/configuration hashes, includes fees, spread and slippage,
executes signals on the next minute, and does not force profitable liquidation
at the last candle. It reports open positions and unrealized P&L separately.

The retrospective checks cover 2024, 2025, 2026 through the exclusive as-of date,
and a 2026 stress case with 0.15% fees, 4 bps spread and 6 bps slippage. Every
case must have positive equity change, profit factor >= 1.2, at least one
closed trade per two calendar days, drawdown <= 3% and no projected execution
risk violations. Reduced exposure alone does not qualify a losing strategy.
All these historical periods have previously been inspected, so they are not
untouched out-of-sample evidence. Passing only permits consideration for
prospective PAPER observation; failure remains `NOT_QUALIFIED`.

## Recorded replay: 2026-11-22

V5.3 is **NOT_QUALIFIED**. More entry opportunities did not produce positive
net expectancy. This revision must remain a research candidate. No strategy
activation, validation approval, environment change or deployment was performed.

Each case starts independently with 500 USDT and a 30 USDT ticket ceiling.
The cumulative capital loss guard blocked further entries near a 10 USDT loss.
The two-percent budget is measured from starting equity; peak-to-trough
drawdown can exceed two percent, and gaps can exceed the modeled budget.

| Period | Closed trades | Net USDT | Profit factor | Max drawdown |
|---|---:|---:|---:|---:|
| retrospective-2024 | 124 | -9.8988 | 0.264 | 2.015% |
| retrospective-2025 | 106 | -9.9083 | 0.157 | 2.022% |
| retrospective-2026-ytd | 130 | -9.8949 | 0.294 | 1.990% |
| cost-stress-2026-ytd | 0 | 0.0000 | undefined | 0.000% |

The stress case rejected all entries because costs made the capped target
uneconomic. There were no accepted execution projections above their risk
budget and no simultaneous V5 positions in any case. Frequency is reported
over the full calendar period, including time blocked by the capital guard.

Full local evidence: `reports/btc-v5/qualification-v5.3.json` (ignored by Git).
It includes monthly attribution, exit reasons, configuration and dataset hashes,
and hashes of the relevant source files. The cases were run independently
against the same compiled revision and combined without parameter changes.

Report SHA-256: `6294ecef0e16f3a32500c874744bb332850abeb4ae1a314ed5d49e866d1e69e9`.

Validation: build, typecheck and lint passed; V2 tests: 132 passed,
14 skipped (18 passing suites, four skipped). These verify software behavior
and risk controls; they do not establish trading profitability.

## Independent accounting check: V5.3 2026 Q1

A replay from January 1 to April 1 reproduced all 130 trades and the
full-year-to-date net loss, since the capital guard prevented later entries.
Quote cash flows from fills, USDT ledger changes, final cash balance and
closed-position P&L agree within 1e-8 USDT. This checks P&L accounting; it
does not prove that every market or execution assumption is realistic.

The executed trades lost 2.2156128 USDT before commissions, retaining
spread and slippage, and 9.89492799 USDT after 7.67931519 USDT in commissions.
Adding back commissions to the same trades is an arithmetic attribution,
not a replay with zero fees. There were 72 stop exits, 16 target exits and
42 time exits; 31 time exits lost money and 11 won. The current entry/exit
hypothesis lacks positive observed expectancy even before commissions.

Local evidence: `reports/btc-v5/audit-v5.3-2026-q1.json`.
Audit report SHA-256: `ef499d345ab787d3275a50bdb40a2a2b49a1b76fd7574fc16d947284e2cdd747`.

Reproduce after building the same revision:

```powershell
node scripts/btc-v5/analyze-period.cjs --start 2026-01-01 --end 2026-04-01 --output reports/btc-v5/audit-v5.3-2026-q1.json
```

## V5.4 publication and recovery accounting

V5 previously published only when eligibility changed from false to true.
A position closing or a cooldown expiring did not reset that market-wide
eligibility state. V5.4 publishes each new eligible closed-minute signal in
both the worker and the historical engine. Recovered historical candles and
duplicate/out-of-order candles still cannot create duplicate worker signals.
V4 and the other versions retain their prior publication cadence.

The account risk policy still enforces one V5 position, fixed risk ceilings,
cooldowns, the daily entry limit and cumulative loss guard. Emitting an
opportunity does not bypass an account rejection or force an order.
No target, horizon, ticket or risk multiplier was widened after observing
a loss, and no previous loss is treated as evidence of a future win.

Account statistics and backtest metrics now expose `v5Recovery`: closed
filled V5 trades, realized net USDT, unrecovered loss below the realized P&L
peak, the configured ticket times the default minimum net profit fraction,
and their sum as `recoveryGoalUSDT`. Open or rejected orders and unrealized
gains do not count toward recovery. Positive closes reduce the actual
deficit; another negative close increases it. The goal is accounting only:
it does not change the next order, target price or acceptance criteria.

Historical V5.3 results above remain evidence for that revision only.
Its referenced source snapshots were preserved locally under
`reports/btc-v5/snapshots/v5.3/` before the V5.4 changes. The qualification
runner derives the default output filename from the compiled revision,
so a new replay does not overwrite V5.3 evidence.

### Recorded V5.4 2026 replay

The fixed V5.4 case from 2026-01-01 through 2026-11-21 closed 130 trades,
lost 9.894928 USDT net and had profit factor 0.294443. It remains
**NOT_QUALIFIED**. Closed-trade count and net P&L are unchanged from V5.3
in this historical case: retrying fresh eligible minutes did not create
a profitable entry/exit edge. Risk guards still blocked further entries.

The code correction establishes publication continuity and honest recovery
accounting; it does not establish that the next trade can recover a loss.
No order size or target was changed to pursue the outstanding deficit.

The recovery accounting reports 9.894928 USDT
unrecovered and a 9.954928 USDT accounting goal
(including the configured 0.06 USDT minimum cycle profit). This is not
a projected payout. The live metrics field remains informational.

Evidence: `reports/btc-v5/qualification-v5.4-2026.json`. Only the 2026 case
was rerun for V5.4; the four-case suite is incomplete and this negative case
already disqualifies it. V5.3 reports are retained unchanged.

Report SHA-256: `fcc69ccca03cef4b9fc31955ea3ec8909ef344c1fa5556980ff39055ae05ffab`.

Validation: build, typecheck and lint passed; 138 V2 tests passed and
14 were skipped. Six new cases exercise worker publication idempotency,
legacy cadence, reentry after a losing close, and recovery accounting.

## V5.5 fixed 2025 replay plan

Before running 2025, the new hypothesis, configuration, account limits,
configuration hash and source hashes were recorded locally in
`reports/btc-v5/plan-v5.5-2025.json`. Baseline costs remain fee 0.1% per side,
spread 2 bps and slippage 3 bps. The account starts with 500 USDT, at most one
position and a 30 USDT ticket ceiling. The run covers all of 2025 with seven
days of warmup; capital, guards and indicators are not reset at month or
quarter boundaries. Open inventory and unrealized P&L must be reported.

These standard range parameters were fixed before this replay rather than
searched over its results. 2025 has already been inspected by earlier V5
research, so this remains retrospective evaluation, not untouched holdout
validation. V5.4 source snapshots were preserved under
`reports/btc-v5/snapshots/v5.4/` before implementing V5.5. Prior reports remain
unchanged and do not qualify the new revision.

```powershell
npm.cmd run build
node --max-old-space-size=2048 scripts/btc-v5/qualify-intraday.cjs --case retrospective-2025 --output reports/btc-v5/qualification-v5.5-2025.json
```

### Recorded V5.5 full-year 2025 result

The frozen hypothesis was replayed once without changing its parameters after
seeing this result. The fixed plan's configuration hash and source hashes
match the evaluated revision. All twelve months have closed trades; the
cumulative capital guard did not terminate this run early.

| Metric | Result |
|---|---:|
| Initial capital | 500 USDT |
| Ticket ceiling | 30 USDT |
| Closed trades | 55 |
| Net realized P&L | -2.539375 USDT |
| Unrealized P&L | 0.000000 USDT |
| Final equity | 497.460625 USDT |
| Open positions | 0 |
| Profit factor | 0.576394 |
| Win rate | 32.7273% |
| Maximum drawdown | 0.6209% |
| Average holding time | 149.31 minutes |
| Commissions | 3.241030 USDT |
| Accepted execution risk violations | 0 |

The same executed trades produced +0.701655 USDT before commissions while
retaining spread and slippage, and -2.539375 USDT after commissions. This is
arithmetic attribution of actual simulated fills, not a new zero-fee replay.
There were 34 stop exits, 11 target exits and 10 time exits. No losing open
inventory was hidden at year-end.

The result remains **NOT_QUALIFIED**: negative net equity change, profit factor
below 1.2 and fewer than the predeclared 183 annual closed trades. Only the
2025 case was run; the four-case suite remains incomplete. The implementation
and its tests pass, but the new trading hypothesis still fails profitability
and frequency requirements. It was not activated or deployed.

Local plan: `reports/btc-v5/plan-v5.5-2025.json`.
Local result: `reports/btc-v5/qualification-v5.5-2025.json`.

Plan SHA-256: `7e8e6253b69ee1321f1ba895b15ae93efffe2bdb35a0351c09a1b7d4be2ef404`.

Result SHA-256: `0ea521c93d39b53ae22e96261b5e538e224843941afe5536e2eabf1526c3d39c`.

Validation: build, typecheck and lint passed; V2 tests: 143 passed, 14 skipped.

## V5.6 no-stop 2025 comparison plan

Before replay, modes, account settings, configuration hashes and source hashes
were fixed in `reports/btc-v5/plan-v5.6-2025.json`. `TARGET_ONLY` is compared
with `STOP_TARGET` on the same full 2025 history, seven-day warmup, 500 USDT
initial capital, 30 USDT ticket ceiling, one position and default costs.
No parameter or target search is performed. These data were previously
observed, so results are retrospective rather than untouched holdout evidence.
V5.5 snapshots were retained under `reports/btc-v5/snapshots/v5.5/`.

The runner reports closed P&L, marked unrealized P&L, available and occupied
capital, open-position ages and targets, and estimated liquidatable equity
after final exit fees, impact and quantity/notional filters. It does not
actually force a year-end sale. Quote cash flows are independently reconciled
against cash balances, and marked equity against the position inventory.
Qualification requires positive estimated net liquidation value, sufficient
trades and other predeclared gates; closed winning trades alone cannot pass.
Undefined profit factor with only winners remains explicitly undefined.

```powershell
npm.cmd run build
node --max-old-space-size=2048 scripts/btc-v5/qualify-intraday.cjs --case retrospective-2025 --exit-mode TARGET_ONLY --output reports/btc-v5/qualification-v5.6-2025-target-only.json
node --max-old-space-size=2048 scripts/btc-v5/qualify-intraday.cjs --case retrospective-2025 --exit-mode STOP_TARGET --output reports/btc-v5/qualification-v5.6-2025-stop-target.json
```

### Recorded V5.6 full-year 2025 comparison

Both modes match the frozen plan and source hashes. Quote cash-flow and
marked-inventory reconciliations passed, with no accepted execution risk
projection above the applicable budget. The protected control exactly
reproduced V5.5's 55 closed trades and -2.539375 USDT net result.

| Metric | STOP_TARGET | TARGET_ONLY |
|---|---:|---:|
| Closed trades | 55 | 32 |
| Open positions | 0 | 1 |
| Realized net USDT | -2.539375 | 8.311936 |
| Marked unrealized USDT | 0 | -6.887560 |
| Marked total net USDT | -2.539375 | 1.424376 |
| Net after estimated final liquidation USDT | -2.539375 | 1.392481 |
| Marked final equity USDT | 497.460625 | 501.424376 |
| Estimated liquidatable equity USDT | 497.460625 | 501.392481 |
| Occupied cost USDT | 0 | 29.676097 |
| Maximum marked drawdown | 0.620900% | 1.708818% |
| Actual simulated commissions USDT | 3.241030 | 1.928434 |

All 32 target-only closed trades were take-profit exits. However, the
remaining position opened at 2025-10-28T19:44:00.000Z and had been held for
64.18 days at year-end. Its 0.00026 BTC cost
29.676097 USDT and was worth 22.788537 USDT at the
last observed price, with -6.887560 USDT unrealized loss.
Its target remained 115346.96 USDT/BTC. The position blocked further
buys under the unchanged one-position rule. Closed-trade win rate alone
cannot describe this experiment's economic outcome.

The target-only marked total was +1.424376 USDT,
and +1.392481 USDT after estimating the
cost of liquidating remaining tradable inventory at year-end. No such
sale was actually forced in the replay. This is a positive retrospective
2025 result, not evidence of continuous wins or guaranteed recovery.

The experiment remains NOT_QUALIFIED under the unchanged gates: only 32
annual closed trades versus the predeclared 183, and undefined closed-trade
profit factor because there were no closed losing trades. The broader
four-case suite was not run for V5.6. It was not activated or deployed.

Validation: build, typecheck and lint passed; 154 V2 tests passed and 14 were
skipped (20 passing suites). Eleven target-only tests cover holding through
losses and expiry, target sales and commissions, reentry, exposure limits,
invalid modes, manual exits and preservation of protected-position stops.

Local summary: `reports/btc-v5/comparison-v5.6-2025.json`.

TARGET_ONLY evidence: `reports/btc-v5/qualification-v5.6-2025-target-only.json`.

SHA-256: `3c1a68b249432d02209d0852c08683dbf033a09470c30177649b7fab46545fb3`.

STOP_TARGET evidence: `reports/btc-v5/qualification-v5.6-2025-stop-target.json`.

SHA-256: `76e631389805f3203acd84dcdabc4906cfcc3744fa81e67c8f2dba86ce0f5333`.

Plan SHA-256: `1770a905949b50859d9c03daf3eaa6a40ba78667fbcec172295b8be20d19b311`.

## V5.7 fifteen-minute trend comparison

Only the trend timeframe changes from V5.6. The same EMA20/EMA50 condition is
computed from closed 15m bars by default, while the 5m setup indicators still
use their prior 100-bar window and the entry is still checked on each closed
minute. Fees, targets, no-stop/no-expiry exits, ticket/exposure ceilings,
cooldowns and the one-position limit are unchanged. A faster timeframe is
not guaranteed to be a superset of hourly signals or to close more trades.

Fifteen-minute trend closes are built from exactly three contiguous,
UTC-aligned closed 5m candles. Partial first/last groups are ignored. V5
requires at least 51 complete trend closes; 100 source 5m candles are
insufficient. The backtester retains 320 source 5m bars for V5, the worker
loads up to 320, and market startup seeds 320. An existing database with
fewer than 320 5m rows is supplemented with recent recovered history.
Other strategies still calculate their indicators from the same windows.

The worker requires aligned 1m/5m snapshots in the 15m variant and does not
wait for an hourly close. The 1h comparison retains its hourly dependency.
Diagnostics expose `features.trendTimeframe`, `trendEmaFast`, `trendEmaSlow`
and `conditions.trend15m`; hourly EMA diagnostic fields are only supplied
for hourly mode. The API strategy description now describes the configurable
context instead of the obsolete V5.2 4h/15m-breakout rules. The public market
candle endpoint still supports only 1m/5m/1h; 15m is an internal aggregate.

Before replay the configurations and source hashes were fixed in
`reports/btc-v5/plan-v5.7-2025.json`. Both variants use the same full 2025
history, seven-day warmup, 500 USDT initial capital, 30 USDT ticket ceiling,
one position and default costs. `eligibleSignalMinutes` is measured separately
from actual buys and closes, so an occupied position cannot be mistaken for
missing signal evaluation. All historical periods have been observed before;
this is retrospective research, not fresh validation. V5.6 sources were
preserved under `reports/btc-v5/snapshots/v5.6/` before changes.

```powershell
npm.cmd run build
node --max-old-space-size=2048 scripts/btc-v5/qualify-intraday.cjs --case retrospective-2025 --exit-mode TARGET_ONLY --trend-minutes 15 --output reports/btc-v5/qualification-v5.7-2025-15m.json
node --max-old-space-size=2048 scripts/btc-v5/qualify-intraday.cjs --case retrospective-2025 --exit-mode TARGET_ONLY --trend-minutes 60 --output reports/btc-v5/qualification-v5.7-2025-60m.json
```

### Recorded V5.7 full-year 2025 trend comparison

Both variants match their frozen configuration and source hashes and use the
same dataset hash. Quote cash-flow and marked-equity accounting reconcile.
There are no accepted execution-risk violations. The hourly control exactly
reproduces V5.6's 32 closed trades and +1.424376 USDT marked total result.

| Metric | 15m trend | 1h trend |
|---|---:|---:|
| Eligible closed-minute signals | 27 | 95 |
| Buy attempts | 27 | 95 |
| Closed trades | 13 | 32 |
| Open positions | 1 | 1 |
| Realized net USDT | 3.339923 | 8.311936 |
| Marked unrealized USDT | -1.373113 | -6.887560 |
| Marked total net USDT | 1.966811 | 1.424376 |
| Net after estimated liquidation USDT | 1.927555 | 1.392481 |
| Marked equity USDT | 501.966811 | 501.424376 |
| Occupied cost USDT | 29.420543 | 29.676097 |
| Mean closed-trade hold, minutes | 1695.538445 | 5260.031233 |
| Maximum marked drawdown | 0.745189% | 1.708818% |

Both retained one open position.

- 15m: opened 2025-12-12T01:15:00.000Z, held 19.95 days at year-end; remaining cost 29.420543 USDT, marked loss -1.373113 USDT.
- 60m: opened 2025-10-28T19:44:00.000Z, held 64.18 days at year-end; remaining cost 29.676097 USDT, marked loss -6.887560 USDT.

The 15m variant was **not more permissive in observed signal frequency**.
A shorter trend can turn bearish during a short pullback while the hourly
trend remains bullish; its eligible minutes are not a superset of the hourly
ones. The fixed 2025 experiment produced a slightly higher net final value
and a smaller marked drawdown, with fewer closed trades. No parameters were
changed after seeing that result, and no extra entry filters were relaxed
to force a higher count. No year-end liquidation was actually executed.

Neither qualifies under the unchanged annual trade-count and profit-factor
gates; only the 2025 case was run. This remains retrospective evidence with
previously inspected data and no guarantee of recovery. The new default
`trendMinutes: 15` and comparison option `60` are implemented locally; no
strategy activation or deployment was performed. Existing open positions
retain their original snapshotted exit mode and target.

Validation: build, typecheck and lint passed; 163 V2 tests passed and 14
were skipped (21 passing suites). New cases verify complete UTC aggregation,
partial/gapped inputs, minimum trend warmup, cache invalidation at a full
15m close, hourly-versus-15m behavior, real worker history/publication with
missing hourly data, and recovered-history repair for older 100-bar seeds.

Local summary: `reports/btc-v5/comparison-v5.7-2025.json`.

15m report: `reports/btc-v5/qualification-v5.7-2025-15m.json`.

SHA-256: `0f744144915fa38da674143ef30e1dad8f902b2258f74c77d60c9c85a361eb2f`.

60m report: `reports/btc-v5/qualification-v5.7-2025-60m.json`.

SHA-256: `c0a051dab9fee51b7e224b4bd964c8f2f7da05aa2f394404f6746e9e85124159`.

Plan SHA-256: `ab2e10548b8eec21ddf266fb42ec249836dea6629b1ef7427c40104ea5305840`.
