"""Public Binance archives with checksums; no authenticated exchange endpoints."""
import calendar, csv, hashlib, io, json, pathlib, time, urllib.request, zipfile
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path('reports/research-data')
PERIODS = [
    ('2020-03', 'development', 'high-volatility candidate'),
    ('2022-06', 'development', 'bear candidate'),
    ('2023-07', 'development', 'range candidate'),
    ('2023-09', 'development', 'low-volatility candidate'),
    ('2024-02', 'development', 'bull candidate'),
    ('2024-10', 'validation', 'validation, no parameter selection'),
    ('2025-02', 'final-oos', 'locked final test'),
]
VARIANTS = ['A-current', 'B-atr-1.5', 'C-atr-2', 'D-atr-2.5', 'E-tp-0.006', 'E-tp-0.008',
            'E-tp-0.012', 'F-1h-only', 'G-1h-5m=A', 'H-without-time', 'H-without-invalidation',
            'ablate-primary', 'ablate-rsi', 'ablate-macd', 'ablate-volume', 'ablate-candle',
            'ablate-structure', 'cost-no-fee', 'cost-no-spread', 'cost-no-slippage', 'USDT-cash']

def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=40) as response:
                return response.read()
        except Exception:
            if attempt == 3: raise
            time.sleep(2 ** attempt)

def candle(row):
    t, end = int(row[0]), int(row[6])
    # Binance Spot archives use microseconds starting January 2025.
    if t > 10**14: t //= 1000; end //= 1000
    return dict(symbol='BTCUSDT', timeframe='1m', openTime=t, closeTime=end,
                open=float(row[1]), high=float(row[2]), low=float(row[3]), close=float(row[4]), volume=float(row[5]))

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    plan = dict(version=1, original='2025-01-01/2025-01-08 diagnostic only; already observed', periods=PERIODS,
                variants=VARIANTS, warmupDays=3, capital=500, maxPositions=5, usdtPerTrade=30,
                selection='No selection or tuning. All variants fixed before downloading the final OOS data.')
    plan = json.loads(json.dumps(plan))
    plan_path = pathlib.Path('reports/research-plan.json')
    if plan_path.exists():
        if json.loads(plan_path.read_text()) != plan: raise RuntimeError('Research plan is frozen; do not overwrite')
    else: plan_path.write_text(json.dumps(plan, indent=2))
    plan_hash = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    pathlib.Path('reports/research-plan.sha256').write_text(plan_hash + '\n')
    print('Frozen research plan SHA256:', plan_hash, flush=True)
    manifest = []
    for month, split, label in PERIODS:
        target = ROOT / (month + '.json')
        year, mon = map(int, month.split('-'))
        start = datetime(year, mon, 1, tzinfo=timezone.utc)
        end = (start + timedelta(days=32)).replace(day=1)
        url = f'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-{month}.zip'
        if not target.exists():
            zipped = get(url)
            checksum = get(url + '.CHECKSUM').decode().split()[0]
            if hashlib.sha256(zipped).hexdigest() != checksum: raise RuntimeError('Archive checksum mismatch')
            rows = []
            with zipfile.ZipFile(io.BytesIO(zipped)) as archive:
                for raw in csv.reader(io.TextIOWrapper(archive.open(archive.namelist()[0]), encoding='utf-8')):
                    if raw and raw[0].isdigit(): rows.append(candle(raw))
            warmup = []; cursor = int((start - timedelta(days=3)).timestamp() * 1000)
            cutoff = int(start.timestamp() * 1000)
            while cursor < cutoff:
                batch = json.loads(get(f'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000&startTime={cursor}&endTime={cutoff-1}'))
                if not batch: raise RuntimeError('Missing warmup data')
                warmup.extend(candle(r) for r in batch)
                cursor = int(batch[-1][0]) + 60000
                time.sleep(.2)
            all_bars = sorted(warmup + rows, key=lambda c: c['openTime'])
            if any(b['openTime'] <= all_bars[i-1]['openTime'] for i,b in enumerate(all_bars) if i):
                raise RuntimeError('Duplicate or nonchronological minute')
            target.write_text(json.dumps(all_bars, separators=(',', ':')))
            (ROOT / (month + '.archive.sha256')).write_text(checksum + '\n')
        bars = json.loads(target.read_text())
        gaps = [dict(after=bars[i-1]['closeTime'], before=b['openTime'], missingMinutes=(b['openTime']-bars[i-1]['openTime'])//60000-1) for i,b in enumerate(bars) if i and b['openTime'] != bars[i-1]['openTime']+60000]
        manifest.append(dict(month=month, split=split, candidateRegime=label, start=int(start.timestamp()*1000), end=int(end.timestamp()*1000),
                             rows=len(bars), gaps=gaps, sha256=hashlib.sha256(target.read_bytes()).hexdigest(), url=url))
        pathlib.Path('reports/research-manifest.json').write_text(json.dumps(manifest, indent=2))
        print(f'{month}: {len(bars)} minutes, {split}, checksum verified', flush=True)

if __name__ == '__main__': main()
