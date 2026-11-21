"""Only the frozen candidate's public monthly archive; no credentials or private APIs."""
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import zipfile

root = Path('reports/btc-v3')
if not (root/'candidate-freeze.json').exists():
    raise RuntimeError('Freeze candidate before downloading untouched data')
if (root/'oos-started.json').exists():
    raise RuntimeError('Final evaluation already started; do not reuse it for tuning')
spec = importlib.util.spec_from_file_location('public_archive_helpers', 'scripts/download-research.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
out = root/'oos-data'
out.mkdir(exist_ok=True)
target = out/'2025-03.json'
if target.exists():
    raise RuntimeError('Candidate data already downloaded; inspect provenance rather than overwrite')
url = 'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2025-03.zip'
archive = helpers.get(url)
checksum = helpers.get(url+'.CHECKSUM').decode().split()[0]
if hashlib.sha256(archive).hexdigest() != checksum:
    raise RuntimeError('Public archive SHA256 mismatch')
with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
    reader = csv.reader(io.TextIOWrapper(zipped.open(zipped.namelist()[0]), encoding='utf8'))
    rows = [helpers.candle(row) for row in reader if row and row[0].isdigit()]
start, end = 1740787200000, 1743465600000
prior_file = Path('reports/research-data/2025-02.json')
warmup = [c for c in json.loads(prior_file.read_text()) if start-3*86400000 <= c['openTime'] < start]
assert len(warmup) == 4320
bars = warmup + rows
assert all(c['openTime'] == bars[0]['openTime'] + i*60000 for i,c in enumerate(bars))
target.write_text(json.dumps(bars,separators=(',',':')))
(out/'BTCUSDT-1m-2025-03.zip').write_bytes(archive)
manifest = dict(period='2025-03',split='new-final-oos',start=start,end=end,input=str(target),archiveURL=url,archiveSHA256=checksum,datasetFileSHA256=hashlib.sha256(target.read_bytes()).hexdigest(),warmupSource=str(prior_file),warmupSourceSHA256=hashlib.sha256(prior_file.read_bytes()).hexdigest(),warmupRows=len(warmup),tradingRows=len(rows))
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({k:manifest[k] for k in ['period','archiveSHA256','tradingRows','warmupRows']}))
