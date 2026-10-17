import type { WeightUnit } from '@/features/settings/types';

export const MIN_WEIGHT_KG = 1;
export const MAX_WEIGHT_KG = 500;
export const KG_PER_LB = 0.45359237;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/**
 * Validates a kilogram value and rounds it to gram precision. Throws a message
 * suitable for display when the value is not a usable weight.
 */
export function normalizeWeightKg(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Weight must be a number.');
  }
  if (value < MIN_WEIGHT_KG || value > MAX_WEIGHT_KG) {
    throw new Error(
      `Weight must be between ${MIN_WEIGHT_KG} and ${MAX_WEIGHT_KG} kg.`
    );
  }
  return Math.round(value * 1000) / 1000;
}

/**
 * Parses user text in the given display unit and returns kilograms. Accepts a
 * comma as the decimal separator (common on non-US keyboards).
 */
export function parseWeightInput(text: string, unit: WeightUnit): number {
  const normalized = text.trim().replace(',', '.');
  if (normalized.length === 0) {
    throw new Error('Enter a weight.');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new Error('Enter a valid number.');
  }

  return normalizeWeightKg(unit === 'lb' ? lbToKg(value) : value);
}

/** Validates an ISO timestamp and rejects measurements in the future. */
export function validateMeasuredAt(
  iso: string,
  now: number = Date.now()
): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    throw new Error('Enter a valid date and time.');
  }
  if (time > now + 60_000) {
    throw new Error('The measurement time is in the future.');
  }
  return new Date(time).toISOString();
}

/** Trims a note and converts empty input to null. */
export function normalizeNote(note: string | null | undefined): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed;
}
