"""Read-only report QA, independent CSV parser and arithmetic reconciliation."""
import csv
import hashlib
import json
import math
from pathlib import Path


def read_csv(name, expected):
    with Path(name).open(encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        assert len(reader.fieldnames) == len(set(reader.fieldnames))
        rows = list(reader)
    assert len(rows) == expected
    assert all(None not in row and all(v is not None for v in row.values()) for row in rows)
    return rows


trades = read_csv('reports/trades-audit.csv', 28)
comparison = read_csv('reports/strategy-comparison.csv', 140)
summary = json.loads(Path('reports/trades-audit-summary.json').read_text())
assert len({r['positionId'] for r in trades}) == 28
assert all(r['exitClassificationMatches'] == 'true' for r in trades)
assert all(r['originalVsCorrectedChanged'] == 'false' for r in trades)
assert all(r['exitReason'] == 'STOP_LOSS' for r in trades)
assert math.isclose(sum(float(r['netPnl']) for r in trades), summary['corrected']['netRealizedPnl'], abs_tol=1e-9)
assert math.isclose(sum(float(r['commissionsQuote']) for r in trades), summary['corrected']['totalCommissions'], abs_tol=1e-9)
assert len({(r['period'], r['variant']) for r in comparison}) == 140
assert len({r['period'] for r in comparison}) == 7
for r in comparison:
    assert math.isclose(float(r['netRealizedPnl']) + float(r['unrealizedPnl']), float(r['netEquityPnl']), abs_tol=1e-8)
    if r['variant'] == 'USDT-cash':
        assert all(float(r[k]) == 0 for k in ['netEquityPnl', 'commissions', 'spreadCost', 'slippageCost', 'roundingCost', 'capitalImmobilized'])
    if r['split'] == 'final-oos' and r['variant'] != 'USDT-cash':
        assert float(r['netEquityPnl']) < 0
plan_hash = hashlib.sha256(Path('reports/research-plan.json').read_bytes()).hexdigest()
assert plan_hash == '3b4521117fcf3eabc82f72eca6715992aa3ed864baa2ec54ff524b6a48b15c7f'
for p in ['docs/simulator-audit.md', 'docs/strategy-diagnostics.md']:
    assert Path(p).stat().st_size > 1000
report = dict(tradeRows=28, comparisonRows=140, periods=7, originalTradesChanged=0,
              classificationsMatch=True, tradePnlAndFeesReconciled=True,
              cashCostsZero=True, finalOosVariantsNegative=19, frozenPlanHash=plan_hash)
Path('reports/csv-verification.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
