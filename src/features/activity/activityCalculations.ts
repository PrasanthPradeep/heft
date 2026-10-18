import type { DailyActivity } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day key (`YYYY-MM-DD`) for a date, avoiding UTC drift. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Day key `offset` days before `from` (0 = today). */
export function dayKeyOffset(from: Date, offset: number): string {
  const date = new Date(from);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return localDayKey(date);
}

/** Start of the local day `days` back, as an ISO instant (for range queries). */
export function windowStartIso(now: Date, days: number): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.toISOString();
}

export function stepsForDay(days: DailyActivity[], day: string): number {
  return days.find((entry) => entry.day === day)?.steps ?? 0;
}

/** Total steps across the last `windowDays` calendar days (inclusive of today). */
export function totalSteps(
  days: DailyActivity[],
  windowDays: number,
  now: Date = new Date()
): number {
  const keys = new Set<string>();
  for (let offset = 0; offset < windowDays; offset += 1) {
    keys.add(dayKeyOffset(now, offset));
  }
  return days
    .filter((entry) => keys.has(entry.day))
    .reduce((sum, entry) => sum + entry.steps, 0);
}

/**
 * Mean daily steps over the last `windowDays`, counting only days that actually
 * have data. Returns null when there is nothing to average.
 */
export function averageSteps(
  days: DailyActivity[],
  windowDays: number,
  now: Date = new Date()
): number | null {
  const keys = new Set<string>();
  for (let offset = 0; offset < windowDays; offset += 1) {
    keys.add(dayKeyOffset(now, offset));
  }
  const present = days.filter((entry) => keys.has(entry.day));
  if (present.length === 0) return null;
  return present.reduce((sum, entry) => sum + entry.steps, 0) / present.length;
}

/** Total exercise minutes across the last `windowDays` calendar days. */
export function totalExerciseMinutes(
  days: DailyActivity[],
  windowDays: number,
  now: Date = new Date()
): number {
  const keys = new Set<string>();
  for (let offset = 0; offset < windowDays; offset += 1) {
    keys.add(dayKeyOffset(now, offset));
  }
  return days
    .filter((entry) => keys.has(entry.day))
    .reduce((sum, entry) => sum + entry.exerciseMinutes, 0);
}

export type ActivitySummary = {
  stepsToday: number;
  averageSteps7d: number | null;
  exerciseMinutes7d: number;
  activeDays7d: number;
};

/** Compact summary used by the Insights screen and the AI context builder. */
export function summarizeActivity(
  days: DailyActivity[],
  now: Date = new Date()
): ActivitySummary {
  const today = localDayKey(now);
  const keys = new Set<string>();
  for (let offset = 0; offset < 7; offset += 1) {
    keys.add(dayKeyOffset(now, offset));
  }
  const week = days.filter((entry) => keys.has(entry.day));
  const activeDays7d = week.filter(
    (entry) => entry.steps > 0 || entry.exerciseMinutes > 0
  ).length;

  return {
    stepsToday: stepsForDay(days, today),
    averageSteps7d: averageSteps(days, 7, now),
    exerciseMinutes7d: totalExerciseMinutes(days, 7, now),
    activeDays7d,
  };
}

export const DAY_IN_MS = DAY_MS;
