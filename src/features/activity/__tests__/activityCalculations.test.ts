import {
  averageSteps,
  dayKeyOffset,
  localDayKey,
  stepsForDay,
  summarizeActivity,
  totalExerciseMinutes,
  totalSteps,
  windowStartIso,
} from '../activityCalculations';
import type { DailyActivity } from '../types';

const NOW = new Date(2026, 9, 18, 12, 0, 0); // 18 Oct 2026, local noon

function day(offset: number, steps: number, exerciseMinutes = 0): DailyActivity {
  return { day: dayKeyOffset(NOW, offset), steps, exerciseMinutes };
}

describe('localDayKey', () => {
  it('formats a local calendar day without timezone drift', () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('dayKeyOffset', () => {
  it('walks backwards across month boundaries', () => {
    expect(dayKeyOffset(new Date(2026, 10, 2), 3)).toBe('2026-10-30');
  });
});

describe('stepsForDay', () => {
  it('returns 0 when the day has no entry', () => {
    expect(stepsForDay([day(0, 5000)], '2000-01-01')).toBe(0);
  });
});

describe('totalSteps', () => {
  it('sums only days inside the window', () => {
    const days = [day(0, 1000), day(3, 2000), day(10, 9999)];
    expect(totalSteps(days, 7, NOW)).toBe(3000);
  });
});

describe('averageSteps', () => {
  it('averages days that have data', () => {
    const days = [day(0, 1000), day(1, 3000)];
    expect(averageSteps(days, 7, NOW)).toBe(2000);
  });

  it('returns null with no data', () => {
    expect(averageSteps([], 7, NOW)).toBeNull();
  });
});

describe('totalExerciseMinutes', () => {
  it('sums exercise minutes in the window', () => {
    const days = [day(0, 0, 30), day(2, 0, 45), day(9, 0, 100)];
    expect(totalExerciseMinutes(days, 7, NOW)).toBe(75);
  });
});

describe('summarizeActivity', () => {
  it('summarizes today and the last week', () => {
    const days = [day(0, 4000, 20), day(1, 6000, 40), day(5, 2000)];
    const summary = summarizeActivity(days, NOW);
    expect(summary.stepsToday).toBe(4000);
    expect(summary.exerciseMinutes7d).toBe(60);
    expect(summary.activeDays7d).toBe(3);
    expect(summary.averageSteps7d).toBe(4000);
  });
});

describe('windowStartIso', () => {
  it('aligns to local midnight of the first day in the window', () => {
    const start = new Date(windowStartIso(NOW, 30));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(localDayKey(start)).toBe(dayKeyOffset(NOW, 29));
  });
});
