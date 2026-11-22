"""Download checksum-verified public BTCUSDT 1m archives for V4 research.

This utility uses Binance's public archive only. It never reads environment
variables, credentials, or private exchange endpoints. Each completed month is
validated and saved independently, so a failed later month can be resumed.
"""

import argparse
import csv
import hashlib
import io
import json
import pathlib
import time
import urllib.request
import zipfile
from datetime import datetime, timezone


def fetch(url: str) -> bytes:
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=40) as response:
                return response.read()
        except Exception as error:  # pragma: no cover - depends on public network
            last = error
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise RuntimeError(f'DOWNLOAD_FAILED {url}: {last}')


def next_month(value: datetime) -> datetime:
    return value.replace(year=value.year + 1, month=1) if value.month == 12 else value.replace(month=value.month + 1)


def candle(row: list[str]) -> dict:
    open_time, close_time = int(row[0]), int(row[6])
    # Spot archives switched to microseconds in 2025.
    if open_time > 10 ** 14:
        open_time //= 1000
        close_time //= 1000
    return {
        'symbol': 'BTCUSDT', 'timeframe': '1m',
        'openTime': open_time, 'closeTime': close_time,
        'open': float(row[1]), 'high': float(row[2]), 'low': float(row[3]),
        'close': float(row[4]), 'volume': float(row[5]),
    }


def parse_month(value: str) -> datetime:
    return datetime.strptime(value, '%Y-%m').replace(tzinfo=timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser(description='Checksum-verified public BTCUSDT 1m history')
    parser.add_argument('--start', required=True, help='First month, YYYY-MM (inclusive)')
    parser.add_argument('--end', required=True, help='First month after the range, YYYY-MM (exclusive)')
    parser.add_argument('--output-dir', default='reports/btc-v4/data')
    args = parser.parse_args()
    cursor, end = parse_month(args.start), parse_month(args.end)
    if cursor >= end:
        raise ValueError('END_MUST_BE_AFTER_START')
    output = pathlib.Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    while cursor < end:
        month = cursor.strftime('%Y-%m')
        base = f'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-{month}.zip'
        archive_path = output / f'{month}.zip'
        checksum_path = output / f'{month}.sha256'
        target = output / f'{month}.json'
        zipped = archive_path.read_bytes() if archive_path.exists() else fetch(base)
        checksum = fetch(base + '.CHECKSUM').decode().split()[0]
        if hashlib.sha256(zipped).hexdigest() != checksum:
            raise RuntimeError(f'CHECKSUM_MISMATCH {month}')
        archive_path.write_bytes(zipped)
        checksum_path.write_text(checksum + '\n', encoding='utf-8')
        with zipfile.ZipFile(io.BytesIO(zipped)) as archive:
            rows = [candle(row) for row in csv.reader(io.TextIOWrapper(archive.open(archive.namelist()[0]), encoding='utf-8')) if row and row[0].isdigit()]
        expected = int(cursor.timestamp() * 1000)
        if not rows or any(bar['openTime'] != expected + index * 60000 or bar['closeTime'] != bar['openTime'] + 59999 for index, bar in enumerate(rows)):
            raise RuntimeError(f'INVALID_OR_GAPPED_MONTH {month}')
        target.write_text(json.dumps(rows, separators=(',', ':')), encoding='utf-8')
        print(f'{month}: {len(rows)} candles; checksum verified', flush=True)
        cursor = next_month(cursor)


if __name__ == '__main__':
    main()
