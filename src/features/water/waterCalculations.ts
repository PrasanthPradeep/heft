import { dayKeyOffset, localDayKey } from '@/features/activity/activityCalculations';

import type { WaterEntry } from './types';

/** A single entry beyond this is far more likely to be a typo than a drink. */
export const MIN_VOLUME_ML = 1;
export const MAX_VOLUME_ML = 10_000;

/** Sizes offered by the quick-add buttons on the dashboard. */
export const GLASS_ML = 250;
export const BOTTLE_ML = 500;

export const DEFAULT_WATER_TARGET_ML = 2000;

/** Sensible daily targets offered in Settings, in millilitres. */
export const WATER_TARGET_PRESETS_ML = [1500, 2000, 2500, 3000] as const;

/**
 * Validates a volume and rounds it to whole millilitres. Throws a message
 * suitable for display when the value is not a usable amount.
 */
export function normalizeVolumeMl(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Amount must be a number.');
  }
  if (value < MIN_VOLUME_ML || value > MAX_VOLUME_ML) {
    throw new Error(
      `A single entry must be between ${MIN_VOLUME_ML} and ${MAX_VOLUME_ML} ml.`
    );
  }
  return Math.round(value);
}

/** Validates an ISO timestamp and rejects entries in the future. */
export function validateLoggedAt(
  iso: string,
  now: number = Date.now()
): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    throw new Error('Enter a valid date and time.');
  }
  if (time > now + 60_000) {
    throw new Error('The time is in the future.');
  }
  return new Date(time).toISOString();
}

/** Compact human-readable volume: `750 ml` below a litre, `1.5 L` above. */
export function formatVolume(ml: number): string {
  if (!Number.isFinite(ml)) return '0 ml';
  if (ml < 1000) return `${Math.round(ml)} ml`;
  const litres = Math.round((ml / 1000) * 100) / 100;
  return `${litres} L`;
}

/**
 * Health Connect rejects zero-length interval records — its native validation
 * reads `startTime must be before endTime` — so a single drink is written as a
 * one-second interval. Only the start is used for totals and day grouping.
 */
export const HYDRATION_INTERVAL_MS = 1_000;

/** Start/end pair for a Health Connect `HydrationRecord`. */
export function hydrationInterval(loggedAt: string): {
  startTime: string;
  endTime: string;
} {
  const startTime = new Date(loggedAt).toISOString();
  return {
    startTime,
    endTime: new Date(
      Date.parse(startTime) + HYDRATION_INTERVAL_MS
    ).toISOString(),
  };
}

/** Entries whose logged time falls on the given local day key. */
export function entriesForDay(entries: WaterEntry[], day: string): WaterEntry[] {
  return entries.filter(
    (entry) => localDayKey(new Date(entry.loggedAt)) === day
  );
}

/** Total millilitres recorded on a local day. */
export function totalForDay(entries: WaterEntry[], day: string): number {
  return entriesForDay(entries, day).reduce(
    (sum, entry) => sum + entry.volumeMl,
    0
  );
}

/** Progress towards a target, clamped to 0…1 for safe use as a bar width. */
export function progressRatio(totalMl: number, targetMl: number): number {
  if (!Number.isFinite(targetMl) || targetMl <= 0) return 0;
  if (!Number.isFinite(totalMl) || totalMl <= 0) return 0;
  return Math.min(1, totalMl / targetMl);
}

export type WaterSummary = {
  todayMl: number;
  /** Mean intake over the last 7 days, counting only days with entries. */
  averageMl7d: number | null;
  daysTracked7d: number;
};

/** Compact summary for the dashboard and the assistant context builder. */
export function summarizeWater(
  entries: WaterEntry[],
  now: Date = new Date()
): WaterSummary {
  const today = localDayKey(now);
  const todayMl = totalForDay(entries, today);

  const keys = new Set<string>();
  for (let offset = 0; offset < 7; offset += 1) {
    keys.add(dayKeyOffset(now, offset));
  }

  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const key = localDayKey(new Date(entry.loggedAt));
    if (!keys.has(key)) continue;
    byDay.set(key, (byDay.get(key) ?? 0) + entry.volumeMl);
  }

  const days = [...byDay.values()];
  return {
    todayMl,
    averageMl7d:
      days.length > 0
        ? days.reduce((sum, value) => sum + value, 0) / days.length
        : null,
    daysTracked7d: days.length,
  };
}
