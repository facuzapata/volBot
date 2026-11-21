"""Independent CSV/time/arithmetic checks using Python's standard library only."""
import csv
import json
import math
from pathlib import Path


def read(name, expected):
    with Path(name).open(encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        assert len(reader.fieldnames) == len(set(reader.fieldnames))
    assert len(rows) == expected, (name, len(rows))
    assert all(None not in r and all(v is not None for v in r.values()) for r in rows)
    return rows


entries = read('reports/entry-signal-analysis.csv', 805)
controls = read('reports/signal-control-comparison.csv', 1080)
stops = read('reports/stop-loss-analysis.csv', 638)
summary = json.loads(Path('reports/strategy-research-summary.json').read_text())
assert len({(r['period'], r['signalId']) for r in entries}) == 805
assert len({(r['period'], r['positionId']) for r in stops}) == 638
original = [r for r in stops if r['period'] == '2025-01-original']
assert len(original) == 28
assert math.isclose(sum(float(r['netPnl']) for r in original), -3.1064573288, abs_tol=1e-9)
assert sum(r['stopAboveNextOpen'] == 'true' for r in original) == 6
assert sum(r['within5m'] == 'true' for r in original) == 9
for r in entries:
    signal = int(r['signalTime'])
    assert int(r['entryTime']) == signal + 1
    for field, step in [('close5m', 300000), ('close1h', 3600000)]:
        assert int(r[field]) == (signal + 1) // step * step - 1
    for h in [5, 15, 30, 60, 120, 240]:
        if r[f'complete{h}m'] == 'true':
            assert r[f'return{h}mPct'] != ''
            assert float(r[f'mfe{h}mPct']) >= -1e-9
            assert float(r[f'mae{h}mPct']) >= -1e-9
        else:
            assert r.get(f'return{h}mPct', '') == ''
for r in controls:
    if r['selection'] == 'case-weighted-matched' and r['n'] != '0':
        assert math.isclose(float(r['matchedBtcMeanNetPct']) - float(r['meanNetPct']), float(r['deltaNetPct']), abs_tol=1e-9)
    if r['n'] != '0':
        assert float(r['netCI95LowPct']) <= float(r['netCI95HighPct'])
for r in stops:
    for h in [1, 2, 4, 8, 24]:
        if r[f'completeAfter{h}h'] == 'true':
            assert float(r[f'postStopMfe{h}hPct']) >= 0
            assert float(r[f'postStopMae{h}hPct']) >= 0
        if r[f'completeAfter{h}h'] != 'true':
            assert r[f'tpAfter{h}h'] in ['', 'true']
windows = json.loads(Path('reports/signal-research-v1/2025-01-original/original-28-windows.json').read_text())
assert len(windows) == 28
lengths = []
for w in windows:
    bars = w['marketWindow']
    lengths.append(len(bars))
    assert len(bars) == 241
    assert bars[0]['relativeMinute'] == -120 and bars[-1]['relativeMinute'] == 120
    assert all(bars[i]['openTime'] == bars[0]['openTime'] + i*60000 for i in range(len(bars)))
    assert w['signalTime'] + 1 == w['entryTime']
for feature in summary['featureBuckets']:
    if feature['period'] == 'pooled-expanded-exploratory':
        same = [f for f in summary['featureBuckets'] if f['period'] == feature['period'] and f['feature'] == feature['feature']]
        assert sum(f['n'] for f in same) == 777, feature['feature']
qa = dict(entryRows=805, controlRows=1080, stopRows=638, originalWindows=28,
          barsPerOriginalWindow=241, originalNetUnchanged=True,
          temporalAlignment=True, pairedComparisonReconciled=True,
          fixedFeatureBucketsCoverAll777Cases=True)
Path('reports/signal-research-v1/csv-verification.json').write_text(json.dumps(qa, indent=2))
print(json.dumps(qa))
