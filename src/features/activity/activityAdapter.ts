import {
  aggregateGroupByPeriod,
  readRecords,
} from 'react-native-health-connect';

import { localDayKey } from './activityCalculations';
import type { ActivitySession, ActivitySnapshot, DailyActivity } from './types';

const MAX_PAGES = 50;
const PAGE_SIZE = 1000;
const SECONDS_PER_MINUTE = 60;

type DayValue = { day: string; value: number };

const dailySlicer = { period: 'DAYS', length: 1 } as const;

/** Steps per calendar day, bucketed by Health Connect's daily aggregation. */
async function readStepDays(startTime: string, endTime: string): Promise<DayValue[]> {
  const groups = await aggregateGroupByPeriod({
    recordType: 'Steps',
    timeRangeFilter: { operator: 'between', startTime, endTime },
    timeRangeSlicer: dailySlicer,
  });
  return groups.map((group) => ({
    day: localDayKey(new Date(group.startTime)),
    value: group.result.COUNT_TOTAL,
  }));
}

/** Exercise minutes per calendar day (summed across every source app). */
async function readExerciseDays(
  startTime: string,
  endTime: string
): Promise<DayValue[]> {
  const groups = await aggregateGroupByPeriod({
    recordType: 'ExerciseSession',
    timeRangeFilter: { operator: 'between', startTime, endTime },
    timeRangeSlicer: dailySlicer,
  });
  return groups.map((group) => ({
    day: localDayKey(new Date(group.startTime)),
    value:
      group.result.EXERCISE_DURATION_TOTAL.inSeconds / SECONDS_PER_MINUTE,
  }));
}

/** Individual exercise sessions, newest first, capped for storage. */
async function readExerciseSessions(
  startTime: string,
  endTime: string
): Promise<ActivitySession[]> {
  const sessions: ActivitySession[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await readRecords('ExerciseSession', {
      timeRangeFilter: { operator: 'between', startTime, endTime },
      ascendingOrder: false,
      pageSize: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });

    for (const record of response.records) {
      const id = record.metadata?.id;
      const startMs = Date.parse(record.startTime);
      const endMs = Date.parse(record.endTime);
      if (!id || !Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

      sessions.push({
        id,
        title: record.title ?? null,
        exerciseType: record.exerciseType,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        minutes: Math.max(0, (endMs - startMs) / 60_000),
      });
    }

    pageToken = response.pageToken || undefined;
    if (!pageToken) break;
  }

  return sessions;
}

/**
 * Reads daily steps, daily exercise minutes, and recent sessions in one pass.
 * `startTime` should be local midnight so the daily buckets align to calendar
 * days; see `windowStartIso`.
 */
export async function readActivity(
  startTime: string,
  endTime: string
): Promise<ActivitySnapshot> {
  const [stepDays, exerciseDays, sessions] = await Promise.all([
    readStepDays(startTime, endTime),
    readExerciseDays(startTime, endTime),
    readExerciseSessions(startTime, endTime),
  ]);

  const byDay = new Map<string, DailyActivity>();
  const ensure = (day: string): DailyActivity => {
    const existing = byDay.get(day);
    if (existing) return existing;
    const created: DailyActivity = { day, steps: 0, exerciseMinutes: 0 };
    byDay.set(day, created);
    return created;
  };

  for (const entry of stepDays) {
    ensure(entry.day).steps = Math.max(0, Math.round(entry.value));
  }
  for (const entry of exerciseDays) {
    ensure(entry.day).exerciseMinutes = Math.max(0, Math.round(entry.value));
  }

  return {
    days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    sessions,
  };
}
