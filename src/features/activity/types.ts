/**
 * Activity data read from Health Connect. Google Fit (and other fitness apps)
 * write their data into Health Connect, so this is how Heft surfaces "Google Fit"
 * activity without depending on the deprecated Google Fit APIs.
 */

/** One calendar day of aggregated activity, keyed by local date (`YYYY-MM-DD`). */
export type DailyActivity = {
  /** Local calendar day, e.g. `2026-10-18`. */
  day: string;
  steps: number;
  exerciseMinutes: number;
};

/** A single exercise session, used for recency and richer AI context. */
export type ActivitySession = {
  id: string;
  title: string | null;
  exerciseType: number;
  startTime: string;
  endTime: string;
  minutes: number;
};

export type ActivitySnapshot = {
  days: DailyActivity[];
  sessions: ActivitySession[];
};

export function emptySnapshot(): ActivitySnapshot {
  return { days: [], sessions: [] };
}
