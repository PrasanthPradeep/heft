import type { WeightEntry } from '@/features/weight/types';

import {
  changeOverDays,
  computeGoalProgress,
  hasEntryOnDay,
  latestEntry,
  monthlyChange,
  nextMilestone,
  reachedMilestones,
  rollingAverage,
  shouldRemindWeighIn,
  sortAscending,
  weeklyChange,
} from '../trendCalculations';

function entry(measuredAt: string, weightKg: number): WeightEntry {
  return {
    id: measuredAt,
    measuredAt,
    weightKg,
    note: null,
    source: 'manual',
    externalId: null,
    owned: true,
    pending: false,
  };
}

const iso = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();

describe('sortAscending / latestEntry', () => {
  it('orders oldest first', () => {
    const sorted = sortAscending([entry(iso(2026, 3, 5), 80), entry(iso(2026, 3, 1), 82)]);
    expect(sorted.map((item) => item.measuredAt)).toEqual([
      iso(2026, 3, 1),
      iso(2026, 3, 5),
    ]);
  });

  it('finds the latest entry and handles empty input', () => {
    expect(latestEntry([])).toBeNull();
    expect(latestEntry([entry(iso(2026, 3, 5), 80), entry(iso(2026, 3, 9), 78)])?.weightKg).toBe(78);
  });
});

describe('rollingAverage', () => {
  it('averages the trailing seven-day window', () => {
    const averages = rollingAverage(
      [entry(iso(2026, 3, 10), 80), entry(iso(2026, 3, 12), 78)],
      7
    );
    expect(averages[0].averageKg).toBe(80);
    expect(averages[1].averageKg).toBe(79);
  });

  it('ignores readings older than the window', () => {
    const averages = rollingAverage(
      [entry(iso(2026, 3, 1), 90), entry(iso(2026, 3, 20), 80)],
      7
    );
    expect(averages[1].averageKg).toBe(80);
  });
});

describe('changeOverDays', () => {
  const now = new Date(2026, 2, 15, 12, 0, 0, 0).getTime();

  it('compares the recent window with the previous one', () => {
    const change = changeOverDays(
      [entry(iso(2026, 3, 5), 80), entry(iso(2026, 3, 12), 78)],
      7,
      now
    );
    expect(change).toBeCloseTo(-2, 6);
  });

  it('returns null when a window has no data', () => {
    expect(changeOverDays([entry(iso(2026, 3, 12), 78)], 7, now)).toBeNull();
    expect(changeOverDays([], 7, now)).toBeNull();
  });

  it('exposes weekly and monthly helpers', () => {
    const entries = [entry(iso(2026, 3, 5), 80), entry(iso(2026, 3, 12), 78)];
    expect(weeklyChange(entries, now)).toBeCloseTo(-2, 6);
    expect(monthlyChange(entries, now)).not.toBeUndefined();
  });
});

describe('computeGoalProgress', () => {
  const entries = [entry(iso(2026, 3, 1), 90), entry(iso(2026, 3, 10), 80)];

  it('computes progress toward a lower goal', () => {
    const goal = computeGoalProgress(entries, 75);
    expect(goal).not.toBeNull();
    expect(goal!.direction).toBe('lose');
    expect(goal!.progress).toBeCloseTo(2 / 3, 6);
    expect(goal!.remainingKg).toBeCloseTo(5, 6);
  });

  it('detects a gain goal', () => {
    const goal = computeGoalProgress(entries, 100);
    expect(goal!.direction).toBe('gain');
  });

  it('clamps progress between 0 and 1', () => {
    const goal = computeGoalProgress(entries, 85);
    expect(goal!.progress).toBe(1);
  });

  it('returns null for missing or invalid goals and empty data', () => {
    expect(computeGoalProgress(entries, null)).toBeNull();
    expect(computeGoalProgress(entries, 0)).toBeNull();
    expect(computeGoalProgress([], 70)).toBeNull();
  });
});

describe('milestones', () => {
  it('lists reached milestones and the next one', () => {
    expect(reachedMilestones(0.6)).toEqual([0.25, 0.5]);
    expect(nextMilestone(0.6)).toBe(0.75);
    expect(reachedMilestones(1)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(nextMilestone(1)).toBeNull();
  });
});

describe('reminders', () => {
  it('detects an entry on the same local day', () => {
    const day = new Date(2026, 2, 15, 20, 0);
    expect(hasEntryOnDay([entry(iso(2026, 3, 15, 7), 80)], day)).toBe(true);
    expect(hasEntryOnDay([entry(iso(2026, 3, 14, 7), 80)], day)).toBe(false);
  });

  it('only reminds after the scheduled time and with nothing logged today', () => {
    const prefs = {
      reminderEnabled: true,
      reminderRepeat: 'daily' as const,
      reminderWeekday: 2,
      reminderHour: 7,
      reminderMinute: 0,
    };
    const after = new Date(2026, 2, 15, 8, 0);
    const before = new Date(2026, 2, 15, 6, 0);
    const todayEntry = entry(iso(2026, 3, 15, 7), 80);

    expect(shouldRemindWeighIn([], prefs, after)).toBe(true);
    expect(shouldRemindWeighIn([todayEntry], prefs, after)).toBe(false);
    expect(shouldRemindWeighIn([], prefs, before)).toBe(false);
    expect(
      shouldRemindWeighIn([], { ...prefs, reminderEnabled: false }, after)
    ).toBe(false);
  });

  it('only shows a weekly reminder on the selected weekday', () => {
    const prefs = {
      reminderEnabled: true,
      reminderRepeat: 'weekly' as const,
      // 2026-03-15 is a Sunday, which is weekday 1.
      reminderWeekday: 1,
      reminderHour: 7,
      reminderMinute: 0,
    };
    const sundayAfter = new Date(2026, 2, 15, 8, 0);
    const mondayAfter = new Date(2026, 2, 16, 8, 0);
    const sundayEntry = entry(iso(2026, 3, 15, 7), 80);

    expect(shouldRemindWeighIn([], prefs, sundayAfter)).toBe(true);
    expect(shouldRemindWeighIn([], prefs, mondayAfter)).toBe(false);
    expect(shouldRemindWeighIn([sundayEntry], prefs, sundayAfter)).toBe(false);
  });
});
