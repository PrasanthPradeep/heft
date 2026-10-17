import { kgToLb } from '@/features/weight/weightCalculations';
import type { WeightUnit } from '@/features/settings/types';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Formats kilograms in the user's unit without trailing-zero noise. */
export function formatWeight(kg: number, unit: WeightUnit = 'kg'): string {
  const value = unit === 'lb' ? kgToLb(kg) : kg;
  // At most two decimals, then drop trailing zeros.
  return parseFloat(value.toFixed(2)).toString();
}

export function weightUnitLabel(unit: WeightUnit): string {
  return unit;
}

/** Deterministic local date/time formatting that avoids relying on Intl. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

/** Short local date, e.g. `5 Mar`. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Signed change, e.g. `+1.2` / `-0.4`. */
export function formatSigned(value: number, digits = 1): string {
  const rounded = parseFloat(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}
