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

/** Formats grams as a kilogram string without trailing-zero noise. */
export function formatWeightKg(grams: number): string {
  const kg = grams / 1000;
  // At most two decimals (0.05 kg graduation), then drop trailing zeros.
  return parseFloat(kg.toFixed(2)).toString();
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
