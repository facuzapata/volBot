import { Candle } from '../domain/model';

export type TrendClose = Pick<Candle, 'openTime' | 'closeTime' | 'close'>;

/** Only full UTC-aligned groups of three closed 5m bars establish a 15m close. */
export function fifteenMinuteCloses(bars: readonly Candle[]): TrendClose[] {
  const step = 300000,
    bucketSize = 900000;
  const groups = new Map<number, Candle[]>();
  for (const bar of bars) {
    const bucket = Math.floor(bar.openTime / bucketSize) * bucketSize;
    const group = groups.get(bucket) ?? [];
    group.push(bar);
    groups.set(bucket, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([openTime, group]) => {
      const ordered = [...group].sort((a, b) => a.openTime - b.openTime);
      if (
        ordered.length !== 3 ||
        ordered.some(
          (bar, i) =>
            bar.openTime !== openTime + i * step || bar.closeTime !== bar.openTime + step - 1,
        )
      )
        return [];
      return [{ openTime, closeTime: openTime + bucketSize - 1, close: ordered[2].close }];
    });
}
