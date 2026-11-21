"""Verify that every normalized minute is exactly derived from its checksum-verified archive."""
import csv, hashlib, importlib.util, io, json, pathlib, zipfile
ROOT = pathlib.Path('reports/net-optimization')
spec = importlib.util.spec_from_file_location('archives', 'scripts/download-research.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
seen = set()
for stage in ('development', 'validation'):
    for m in json.loads((ROOT / (stage+'-manifest.json')).read_text()):
        if m['month'] in seen: continue
        seen.add(m['month'])
        target = pathlib.Path(m['path'])
        raw = target.with_suffix('.zip').read_bytes()
        assert hashlib.sha256(raw).hexdigest() == m['archiveSha256']
        assert hashlib.sha256(target.read_bytes()).hexdigest() == m['jsonSha256']
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            expected = [helper.candle(r) for r in csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding='utf-8')) if r and r[0].isdigit()]
        assert expected == json.loads(target.read_text()), m['month']+' differs from public archive'
print(f'Verified {len(seen)} public archives and all normalized minute values')
