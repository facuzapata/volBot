"""Checksum-verified public spot archives. Final data requires a frozen finalist."""
import csv, hashlib, importlib.util, io, json, pathlib, sys, zipfile
from datetime import datetime, timezone

ROOT = pathlib.Path('reports/net-optimization')
spec = importlib.util.spec_from_file_location('archives', 'scripts/download-research.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

def main():
    stage = sys.argv[1]
    if stage not in ('development', 'validation', 'final'): raise RuntimeError('Unknown stage')
    plan = json.loads((ROOT / 'freeze.json').read_text())['plan']
    if stage == 'final' and not (ROOT / 'finalist.json').exists(): raise RuntimeError('Finalist must be frozen before downloading final data')
    period = plan[stage]
    cursor = datetime.fromisoformat(period['warmupStart']).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(period['endExclusive']).replace(tzinfo=timezone.utc)
    out = ROOT / 'data'
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    while cursor < end:
        month = cursor.strftime('%Y-%m')
        url = f'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-{month}.zip'
        target = out / (month + '.json')
        archive = out / (month + '.zip')
        checksum_file = out / (month + '.sha256')
        if not target.exists():
            zipped = archive.read_bytes() if archive.exists() else helper.get(url)
            checksum = helper.get(url + '.CHECKSUM').decode().split()[0]
            if hashlib.sha256(zipped).hexdigest() != checksum: raise RuntimeError('Archive checksum mismatch')
            archive.write_bytes(zipped)
            checksum_file.write_text(checksum)
            with zipfile.ZipFile(io.BytesIO(zipped)) as z:
                bars = [helper.candle(r) for r in csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding='utf-8')) if r and r[0].isdigit()]
            target.write_text(json.dumps(bars, separators=(',', ':')))
        bars = json.loads(target.read_text())
        archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
        if archive_hash != checksum_file.read_text().strip(): raise RuntimeError('Cached archive changed')
        expected = int(cursor.timestamp()*1000)
        nxt = cursor.replace(year=cursor.year+1, month=1) if cursor.month == 12 else cursor.replace(month=cursor.month+1)
        if len(bars) != int((nxt-cursor).total_seconds()/60): raise RuntimeError('Missing minute')
        if any(b['openTime'] != expected+i*60000 or b['closeTime'] != b['openTime']+59999 for i,b in enumerate(bars)): raise RuntimeError('Non-contiguous minute data')
        manifest.append(dict(month=month, rows=len(bars), path=str(target), archiveSha256=archive_hash, jsonSha256=hashlib.sha256(target.read_bytes()).hexdigest(), url=url))
        print(f'{stage}: {month}, {len(bars)} minutes, checksum verified', flush=True)
        cursor = nxt
    (ROOT / (stage+'-manifest.json')).write_text(json.dumps(manifest, indent=2))

if __name__ == '__main__': main()
