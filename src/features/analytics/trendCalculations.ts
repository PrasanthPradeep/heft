import type { WeightEntry } from '@/features/weight/types';
import type { AppPreferences } from '@/features/settings/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function sortAscending(entries: WeightEntry[]): WeightEntry[] {
  return [...entries].sort(
    (a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt)
  );
}

export function latestEntry(entries: WeightEntry[]): WeightEntry | null {
  return entries.reduce<WeightEntry | null>((latest, entry) => {
    if (!latest) return entry;
    return Date.parse(entry.measuredAt) > Date.parse(latest.measuredAt)
      ? entry
      : latest;
  }, null);
}

export type AveragePoint = { measuredAt: string; averageKg: number };

/**
 * Trailing rolling average: for each entry, the mean of every entry within
 * `windowDays` ending at that entry (inclusive).
 */
export function rollingAverage(
  entries: WeightEntry[],
  windowDays = 7
): AveragePoint[] {
  const ascending = sortAscending(entries);
  const windowMs = windowDays * DAY_MS;

  return ascending.map((entry) => {
    const end = Date.parse(entry.measuredAt);
    const start = end - windowMs;
    const inWindow = ascending.filter((other) => {
      const time = Date.parse(other.measuredAt);
      return time > start && time <= end;
    });
    const averageKg =
      inWindow.reduce((sum, item) => sum + item.weightKg, 0) / inWindow.length;
    return { measuredAt: entry.measuredAt, averageKg };
  });
}

/**
 * Mean of the last `days` window minus the mean of the `days` before it.
 * Returns null when either window has no data, so the UI can hide the figure
 * rather than show a misleading zero.
 */
export function changeOverDays(
  entries: WeightEntry[],
  days = 7,
  now: number = Date.now()
): number | null {
  const ascending = sortAscending(entries);
  if (ascending.length === 0) return null;

  const windowMs = days * DAY_MS;
  const recentStart = now - windowMs;
  const previousStart = now - 2 * windowMs;

  const recent = ascending.filter((entry) => {
    const time = Date.parse(entry.measuredAt);
    return time > recentStart && time <= now;
  });
  const previous = ascending.filter((entry) => {
    const time = Date.parse(entry.measuredAt);
    return time > previousStart && time <= recentStart;
  });

  if (recent.length === 0 || previous.length === 0) return null;

  const mean = (list: WeightEntry[]) =>
    list.reduce((sum, entry) => sum + entry.weightKg, 0) / list.length;

  return mean(recent) - mean(previous);
}

export function weeklyChange(
  entries: WeightEntry[],
  now: number = Date.now()
): number | null {
  return changeOverDays(entries, 7, now);
}

export function monthlyChange(
  entries: WeightEntry[],
  now: number = Date.now()
): number | null {
  return changeOverDays(entries, 30, now);
}

export type GoalProgress = {
  startKg: number;
  currentKg: number;
  goalKg: number;
  /** Clamped 0..1. */
  progress: number;
  remainingKg: number;
  direction: 'lose' | 'gain' | 'maintain';
};

export function computeGoalProgress(
  entries: WeightEntry[],
  goalKg: number | null | undefined
): GoalProgress | null {
  if (typeof goalKg !== 'number' || !Number.isFinite(goalKg) || goalKg <= 0) {
    return null;
  }

  const ascending = sortAscending(entries);
  if (ascending.length === 0) return null;

  const startKg = ascending[0].weightKg;
  const currentKg = ascending[ascending.length - 1].weightKg;
  const total = startKg - goalKg;

  let direction: GoalProgress['direction'] = 'maintain';
  if (total > 0.01) direction = 'lose';
  else if (total < -0.01) direction = 'gain';

  const raw = Math.abs(total) < 0.01 ? 1 : (startKg - currentKg) / total;

  return {
    startKg,
    currentKg,
    goalKg,
    progress: Math.max(0, Math.min(1, raw)),
    remainingKg: Math.abs(currentKg - goalKg),
    direction,
  };
}

export const GOAL_MILESTONES = [0.25, 0.5, 0.75, 1] as const;

export function reachedMilestones(progress: number): number[] {
  return GOAL_MILESTONES.filter((milestone) => progress >= milestone);
}

export function nextMilestone(progress: number): number | null {
  return GOAL_MILESTONES.find((milestone) => progress < milestone) ?? null;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function hasEntryOnDay(entries: WeightEntry[], day: Date): boolean {
  return entries.some((entry) => {
    const time = new Date(entry.measuredAt);
    return !Number.isNaN(time.getTime()) && isSameLocalDay(time, day);
  });
}

/**
 * Whether an in-app weigh-in reminder should be shown: reminders are enabled,
 * the scheduled time has passed, and nothing has been recorded today.
 */
export function shouldRemindWeighIn(
  entries: WeightEntry[],
  preferences: Pick<
    AppPreferences,
    'reminderEnabled' | 'reminderHour' | 'reminderMinute'
  >,
  now: Date = new Date()
): boolean {
  if (!preferences.reminderEnabled) return false;

  const scheduled = new Date(now);
  scheduled.setHours(preferences.reminderHour, preferences.reminderMinute, 0, 0);
  if (now.getTime() < scheduled.getTime()) return false;

  return !hasEntryOnDay(entries, now);
}
