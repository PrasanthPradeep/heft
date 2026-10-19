import type { WaterEntry } from '../types';
import {
  BOTTLE_ML,
  DEFAULT_WATER_TARGET_ML,
  GLASS_ML,
  HYDRATION_INTERVAL_MS,
  MAX_VOLUME_ML,
  averageMl,
  dailyTotals,
  entriesForDay,
  formatVolume,
  hydrationInterval,
  normalizeVolumeMl,
  progressRatio,
  summarizeWater,
  totalForDay,
  validateLoggedAt,
} from '../waterCalculations';

/** Local noon, so day bucketing is not affected by the machine's time zone. */
const NOW = new Date(2026, 2, 10, 12, 0, 0);

function at(daysAgo: number, hour = 9): Date {
  const date = new Date(NOW);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function entry(volumeMl: number, loggedAt: Date): WaterEntry {
  return {
    id: `${loggedAt.getTime()}-${volumeMl}`,
    volumeMl,
    loggedAt: loggedAt.toISOString(),
    source: 'manual',
    externalId: null,
    owned: true,
    pending: false,
  };
}

describe('normalizeVolumeMl', () => {
  it('rounds to whole millilitres', () => {
    expect(normalizeVolumeMl(249.6)).toBe(250);
    expect(normalizeVolumeMl(GLASS_ML)).toBe(250);
    expect(normalizeVolumeMl(BOTTLE_ML)).toBe(500);
  });

  it('rejects impossible amounts', () => {
    expect(() => normalizeVolumeMl(0)).toThrow();
    expect(() => normalizeVolumeMl(-250)).toThrow();
    expect(() => normalizeVolumeMl(MAX_VOLUME_ML + 1)).toThrow();
    expect(() => normalizeVolumeMl(Number.NaN)).toThrow();
    expect(() => normalizeVolumeMl(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('validateLoggedAt', () => {
  it('accepts a valid timestamp and normalises it', () => {
    const iso = '2026-03-10T08:00:00.000Z';
    expect(validateLoggedAt(iso)).toBe(new Date(iso).toISOString());
  });

  it('rejects junk and times in the future', () => {
    expect(() => validateLoggedAt('not a date')).toThrow();
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect(() => validateLoggedAt(future)).toThrow();
  });

  it('allows a small clock-skew buffer', () => {
    const slightlyAhead = new Date(Date.now() + 30 * 1000).toISOString();
    expect(() => validateLoggedAt(slightlyAhead)).not.toThrow();
  });
});

describe('formatVolume', () => {  it('uses millilitres below a litre and litres above', () => {
    expect(formatVolume(0)).toBe('0 ml');
    expect(formatVolume(250)).toBe('250 ml');
    expect(formatVolume(999)).toBe('999 ml');
    expect(formatVolume(1000)).toBe('1 L');
    expect(formatVolume(1500)).toBe('1.5 L');
    expect(formatVolume(2250)).toBe('2.25 L');
    expect(formatVolume(DEFAULT_WATER_TARGET_ML)).toBe('2 L');
  });

  it('survives a non-finite value without printing NaN', () => {
    expect(formatVolume(Number.NaN)).toBe('0 ml');
  });
});

describe('hydrationInterval', () => {
  it('produces the strictly positive interval Health Connect requires', () => {
    const { startTime, endTime } = hydrationInterval(
      '2026-03-10T08:00:00.000Z'
    );

    expect(startTime).toBe('2026-03-10T08:00:00.000Z');
    // Zero-length intervals are rejected natively, so this must stay positive.
    expect(Date.parse(endTime)).toBeGreaterThan(Date.parse(startTime));
    expect(Date.parse(endTime) - Date.parse(startTime)).toBe(
      HYDRATION_INTERVAL_MS
    );
  });
});

describe('daily totals', () => {
  const entries = [
    entry(250, at(0, 8)),
    entry(500, at(0, 11)),
    entry(1000, at(1, 9)),
  ];

  it('groups entries by local day', () => {
    const day = entriesForDay(entries, '2026-03-10');
    expect(day).toHaveLength(2);
    expect(day.map((item) => item.volumeMl)).toEqual([250, 500]);
  });

  it('sums a day and returns zero for a day without entries', () => {
    expect(totalForDay(entries, '2026-03-10')).toBe(750);
    expect(totalForDay(entries, '2026-03-09')).toBe(1000);
    expect(totalForDay(entries, '2026-03-01')).toBe(0);
  });
});

describe('progressRatio', () => {
  it('clamps to the 0–1 range', () => {
    expect(progressRatio(0, 2000)).toBe(0);
    expect(progressRatio(1000, 2000)).toBe(0.5);
    expect(progressRatio(5000, 2000)).toBe(1);
  });

  it('returns zero rather than dividing by a broken target', () => {
    expect(progressRatio(500, 0)).toBe(0);
    expect(progressRatio(500, -1)).toBe(0);
    expect(progressRatio(Number.NaN, 2000)).toBe(0);
  });
});

describe('daily totals window', () => {
  const entries = [
    entry(250, at(0, 8)),
    entry(500, at(0, 11)),
    entry(1500, at(1)),
    entry(750, at(3)),
  ];

  it('returns oldest-first totals and zero-filled missing days', () => {
    const totals = dailyTotals(entries, 4, NOW);
    expect(totals.map((day) => day.day)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    expect(totals.map((day) => day.totalMl)).toEqual([750, 0, 1500, 750]);
  });

  it('averages only the days that have entries', () => {
    expect(averageMl(dailyTotals(entries, 7, NOW))).toBe(1000);
    expect(averageMl(dailyTotals([], 7, NOW))).toBeNull();
    expect(averageMl(dailyTotals([entry(2000, at(9))], 7, NOW))).toBeNull();
  });
});

describe('summarizeWater', () => {
  it('reports today and averages the last seven days of data', () => {
    const entries = [
      entry(250, at(0, 8)),
      entry(500, at(0, 11)),
      entry(1500, at(1)),
      entry(750, at(3)),
      entry(3000, at(8)),
    ];

    const summary = summarizeWater(entries, NOW);
    expect(summary.todayMl).toBe(750);
    expect(summary.daysTracked7d).toBe(3);
    expect(summary.averageMl7d).toBe(1000);
  });

  it('returns null for an empty log', () => {
    expect(summarizeWater([], NOW)).toEqual({
      todayMl: 0,
      averageMl7d: null,
      daysTracked7d: 0,
    });
  });

  it('ignores entries older than the seven-day window', () => {
    const summary = summarizeWater([entry(2000, at(9))], NOW);
    expect(summary.todayMl).toBe(0);
    expect(summary.averageMl7d).toBeNull();
    expect(summary.daysTracked7d).toBe(0);
  });
});
