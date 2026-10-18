import type { ActivitySummary } from '@/features/activity/activityCalculations';
import type { WeightEntry } from '@/features/weight/types';

import { buildHealthContext } from '../healthContext';

function entry(measuredAt: string, weightKg: number): WeightEntry {
  return {
    id: measuredAt,
    weightKg,
    measuredAt,
    note: null,
    source: 'manual',
    externalId: null,
    owned: true,
    pending: false,
  };
}

const NOW = new Date('2026-10-18T12:00:00.000Z');

const ENTRIES = [
  entry('2026-09-20T08:00:00.000Z', 85),
  entry('2026-10-01T08:00:00.000Z', 84),
  entry('2026-10-11T08:00:00.000Z', 83),
  entry('2026-10-17T08:00:00.000Z', 82),
];

describe('buildHealthContext', () => {
  it('reports an empty log honestly', () => {
    const context = buildHealthContext({
      entries: [],
      weightUnit: 'kg',
      goalWeightKg: null,
      now: NOW,
    });
    expect(context).toContain('No weight measurements');
    expect(context).toContain('unit: kg');
  });

  it('summarises count, latest and change in kilograms', () => {
    const context = buildHealthContext({
      entries: ENTRIES,
      weightUnit: 'kg',
      goalWeightKg: 78,
      now: NOW,
    });
    expect(context).toContain('Measurements logged: 4');
    expect(context).toContain('Latest: 82 kg');
    expect(context).toContain('Change since first logged: -3 kg');
    expect(context).toContain('Goal weight: 78 kg');
    expect(context).toContain('4 kg remaining');
  });

  it('converts everything when the unit is pounds', () => {
    const context = buildHealthContext({
      entries: ENTRIES,
      weightUnit: 'lb',
      goalWeightKg: null,
      now: NOW,
    });
    expect(context).toContain('unit: lb');
    // 82 kg -> 180.8 lb
    expect(context).toContain('180.8 lb');
    expect(context).not.toContain('kg on');
  });

  it('includes activity only when provided', () => {
    const activity: ActivitySummary = {
      stepsToday: 4200,
      averageSteps7d: 8123.4,
      exerciseMinutes7d: 150,
      activeDays7d: 5,
    };
    const withActivity = buildHealthContext({
      entries: ENTRIES,
      weightUnit: 'kg',
      goalWeightKg: null,
      activity,
      now: NOW,
    });
    expect(withActivity).toContain('8123 steps/day');
    expect(withActivity).toContain('150 exercise minutes');

    const withoutActivity = buildHealthContext({
      entries: ENTRIES,
      weightUnit: 'kg',
      goalWeightKg: null,
      now: NOW,
    });
    expect(withoutActivity).not.toContain('Activity (last 7 days)');
  });
});
