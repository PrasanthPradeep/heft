export type BmiCategory =
  | 'underweight'
  | 'healthy'
  | 'overweight'
  | 'obesity';

export const BMI_SCALE_MIN = 16;
export const BMI_SCALE_MAX = 30;

export const MIN_HEIGHT_CM = 100;
export const MAX_HEIGHT_CM = 250;

/**
 * Visual segments for the adult BMI scale.
 *
 * `weight` is the share of the drawn bar, not a BMI span. The first three
 * segments are proportional to their real spans; the open-ended obesity range
 * gets a fixed cap at the right so "30+" is visible. A BMI of exactly 30 sits
 * at the start of that cap; anything above 30 clamps to the right edge, as the
 * exact figure is always shown in the value cards.
 */
export type BmiScaleSegment = {
  category: BmiCategory;
  min: number;
  max: number | null;
  weight: number;
};

export const BMI_SCALE_SEGMENTS: readonly BmiScaleSegment[] = [
  { category: 'underweight', min: 16, max: 18.5, weight: 2.5 },
  { category: 'healthy', min: 18.5, max: 25, weight: 6.5 },
  { category: 'overweight', min: 25, max: 30, weight: 5 },
  { category: 'obesity', min: 30, max: null, weight: 2 },
] as const;

const SCALE_WEIGHT = BMI_SCALE_SEGMENTS.reduce(
  (total, segment) => total + segment.weight,
  0
);

const CATEGORY_LABELS: Record<BmiCategory, string> = {
  underweight: 'Underweight range',
  healthy: 'Healthy range',
  overweight: 'Overweight range',
  obesity: 'Obesity range',
};

/** Standard adult BMI formula. Returns null for unusable inputs, never NaN. */
export function calculateBmi(
  weightKg: number | null | undefined,
  heightCm: number | null | undefined
): number | null {
  if (typeof weightKg !== 'number' || typeof heightCm !== 'number') {
    return null;
  }
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm)) {
    return null;
  }
  if (weightKg <= 0 || heightCm <= 0) {
    return null;
  }

  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return Number.isFinite(bmi) ? bmi : null;
}

/** Adult screening categories. Boundaries belong to the higher category. */
export function bmiCategory(
  bmi: number | null | undefined
): BmiCategory | null {
  if (typeof bmi !== 'number' || !Number.isFinite(bmi)) {
    return null;
  }
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'healthy';
  if (bmi < 30) return 'overweight';
  return 'obesity';
}

export function bmiCategoryLabel(category: BmiCategory): string {
  return CATEGORY_LABELS[category];
}

/**
 * Maps a BMI to 0..1 across the drawn scale.
 *
 * Below 16 and above 30 clamp to the edges. Exactly 30 sits at the start of
 * the open-ended cap so the obesity boundary stays visible.
 */
export function bmiScalePosition(
  bmi: number | null | undefined
): number | null {
  if (typeof bmi !== 'number' || !Number.isFinite(bmi)) {
    return null;
  }
  if (bmi <= BMI_SCALE_MIN) return 0;
  if (bmi > BMI_SCALE_MAX) return 1;

  let cumulative = 0;
  for (const segment of BMI_SCALE_SEGMENTS) {
    if (segment.max === null) break;
    if (bmi <= segment.max) {
      const span = segment.max - segment.min;
      const within = span > 0 ? (bmi - segment.min) / span : 0;
      return (cumulative + within * segment.weight) / SCALE_WEIGHT;
    }
    cumulative += segment.weight;
  }

  return 1;
}

/** One decimal keeps neighbouring categories from looking identical. */
export function formatBmi(bmi: number | null): string {
  if (bmi === null || !Number.isFinite(bmi)) return '--';
  return bmi.toFixed(1);
}

export function formatHeightCm(heightCm: number): string {
  return `${parseFloat(heightCm.toFixed(1))} cm`;
}

/** Parses and validates a manually entered height in centimetres. */
export function parseHeightCm(text: string): number {
  const normalized = text.trim().replace(',', '.');
  if (normalized.length === 0) {
    throw new Error('Enter your height.');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new Error('Enter a valid height.');
  }
  if (value < MIN_HEIGHT_CM || value > MAX_HEIGHT_CM) {
    throw new Error(
      `Enter a height between ${MIN_HEIGHT_CM} and ${MAX_HEIGHT_CM} cm.`
    );
  }

  return Math.round(value * 10) / 10;
}
