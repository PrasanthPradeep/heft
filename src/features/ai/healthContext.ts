import type { ActivitySummary } from '@/features/activity/activityCalculations';
import {
  changeOverDays,
  computeGoalProgress,
  latestEntry,
  rollingAverage,
  sortAscending,
} from '@/features/analytics/trendCalculations';
import { kgToLb } from '@/features/weight/weightCalculations';
import type { WeightEntry } from '@/features/weight/types';

export type HealthContextInput = {
  entries: WeightEntry[];
  weightUnit: 'kg' | 'lb';
  goalWeightKg: number | null;
  /** Only passed when the user has enabled health-data sharing. */
  activity?: ActivitySummary | null;
  now?: Date;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

const signed = (value: number): string =>
  `${value >= 0 ? '+' : ''}${round1(value)}`;

const localDay = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};

/**
 * Builds the plain-text weight summary that is sent to the model when the user
 * has opted in. Kept in one place (and unit-tested) so what leaves the device is
 * always predictable and reviewable.
 */
export function buildHealthContext(input: HealthContextInput): string {
  const { entries, weightUnit } = input;
  const now = input.now ?? new Date();
  const convert = (kg: number): number =>
    weightUnit === 'lb' ? kgToLb(kg) : kg;

  const lines: string[] = [
    `Weight data shared from the user's Heft log (unit: ${weightUnit}), as of ${localDay(
      now.toISOString()
    )}.`,
  ];

  const ascending = sortAscending(entries);
  if (ascending.length === 0) {
    lines.push('- No weight measurements have been logged yet.');
  } else {
    const latest = latestEntry(entries);
    const first = ascending[0];

    lines.push(`- Measurements logged: ${ascending.length}`);
    if (latest) {
      lines.push(
        `- Latest: ${round1(convert(latest.weightKg))} ${weightUnit} on ${localDay(
          latest.measuredAt
        )}`
      );
      lines.push(
        `- Change since first logged: ${signed(
          convert(latest.weightKg - first.weightKg)
        )} ${weightUnit}`
      );
    }
    lines.push(
      `- Earliest logged: ${round1(convert(first.weightKg))} ${weightUnit} on ${localDay(
        first.measuredAt
      )}`
    );

    const average = rollingAverage(entries, 7);
    if (average.length > 0) {
      lines.push(
        `- 7-day rolling average (latest): ${round1(
          convert(average[average.length - 1].averageKg)
        )} ${weightUnit}`
      );
    }

    const weekly = changeOverDays(entries, 7, now.getTime());
    if (weekly !== null) {
      lines.push(
        `- Change over the last 7 days: ${signed(convert(weekly))} ${weightUnit}`
      );
    }

    const monthly = changeOverDays(entries, 30, now.getTime());
    if (monthly !== null) {
      lines.push(
        `- Change over the last 30 days: ${signed(convert(monthly))} ${weightUnit}`
      );
    }

    const goal = computeGoalProgress(entries, input.goalWeightKg);
    if (goal) {
      lines.push(
        `- Goal weight: ${round1(convert(goal.goalKg))} ${weightUnit} (goal is to ${goal.direction} weight); ${round1(
          convert(goal.remainingKg)
        )} ${weightUnit} remaining; ${Math.round(goal.progress * 100)}% of the way there.`
      );
    }
  }

  if (input.activity) {
    const average =
      input.activity.averageSteps7d === null
        ? 'no average yet'
        : `${Math.round(input.activity.averageSteps7d)} steps/day`;
    lines.push(
      `- Activity (last 7 days): ${input.activity.stepsToday} steps today; ${average}; ${input.activity.exerciseMinutes7d} exercise minutes; active on ${input.activity.activeDays7d}/7 days.`
    );
  }

  return lines.join('\n');
}
