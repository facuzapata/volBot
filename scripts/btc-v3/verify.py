import csv
import json
import math
from pathlib import Path

root = Path('reports/btc-v3')
with (root/'comparison.csv').open(encoding='utf8', newline='') as f:
    reader = csv.DictReader(f)
    rows = list(reader)
    assert len(reader.fieldnames) == len(set(reader.fieldnames))
assert len(rows) == 45
assert len({(r['period'], r['variant']) for r in rows}) == 45
assert all(None not in r and all(v is not None for v in r.values()) for r in rows)
for r in rows:
    assert int(r['closedTrades']) == int(r['wins']) + int(r['losses']) + int(r['flat'])
    assert math.isclose(float(r['netRealizedPnl']) + float(r['unrealizedPnl']), float(r['netEquityPnl']), abs_tol=1e-8)
    if r['variant'] == 'v3-corrected-simulator':
        assert int(r['closedTrades']) == 0 and r['profitFactor'] == ''
with (root/'trade-risk-audit.csv').open(encoding='utf8', newline='') as f:
    risks = list(csv.DictReader(f))
for r in risks:
    if r['accepted'] == 'true':
        assert float(r['stopPrice']) < float(r['referencePrice'])
        assert float(r['stopPrice']) < float(r['executedPrice'])
        assert float(r['estimatedNetStopLoss']) <= float(r['riskLimitQuote']) + 1e-8
final = [r for r in rows if r['split'] == 'new-final-oos']
assert len(final) == 5
assert all(float(r['netEquityPnl']) < 0 for r in final if r['variant'] not in ['v3-corrected-simulator','USDT-cash'])
manifest = json.loads((root/'oos-data/manifest.json').read_text())
assert manifest['tradingRows'] == 44640 and manifest['warmupRows'] == 4320
print(json.dumps(dict(comparisonRows=45,finalRows=5,riskAssessments=len(risks),acceptedStopGeometryValid=True,csvArithmeticReconciled=True)))
