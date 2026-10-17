import {
  kgToLb,
  lbToKg,
  normalizeNote,
  normalizeWeightKg,
  parseWeightInput,
  validateMeasuredAt,
} from '../weightCalculations';

describe('normalizeWeightKg', () => {
  it('accepts values within range', () => {
    expect(normalizeWeightKg(72.5)).toBe(72.5);
  });

  it('rounds to gram precision', () => {
    expect(normalizeWeightKg(72.123456)).toBe(72.123);
  });

  it('rejects non-finite values', () => {
    expect(() => normalizeWeightKg(Number.NaN)).toThrow(/number/i);
    expect(() => normalizeWeightKg(Number.POSITIVE_INFINITY)).toThrow(/number/i);
  });

  it('rejects values outside the supported range', () => {
    expect(() => normalizeWeightKg(0.5)).toThrow(/between/i);
    expect(() => normalizeWeightKg(501)).toThrow(/between/i);
  });
});

describe('parseWeightInput', () => {
  it('parses kilograms', () => {
    expect(parseWeightInput('72.5', 'kg')).toBe(72.5);
  });

  it('accepts a comma decimal separator', () => {
    expect(parseWeightInput('72,5', 'kg')).toBe(72.5);
  });

  it('converts pounds to kilograms', () => {
    expect(parseWeightInput('220', 'lb')).toBeCloseTo(99.79, 2);
  });

  it('rejects empty or non-numeric input', () => {
    expect(() => parseWeightInput('', 'kg')).toThrow(/enter a weight/i);
    expect(() => parseWeightInput('abc', 'kg')).toThrow(/valid number/i);
  });
});

describe('validateMeasuredAt', () => {
  const now = Date.parse('2026-03-01T12:00:00.000Z');

  it('accepts a past timestamp and normalises it', () => {
    expect(validateMeasuredAt('2026-03-01T11:00:00.000Z', now)).toBe(
      '2026-03-01T11:00:00.000Z'
    );
  });

  it('rejects a clearly future timestamp', () => {
    expect(() => validateMeasuredAt('2026-03-01T13:00:00.000Z', now)).toThrow(
      /future/i
    );
  });

  it('tolerates small clock skew', () => {
    expect(() =>
      validateMeasuredAt('2026-03-01T12:00:30.000Z', now)
    ).not.toThrow();
  });

  it('rejects an unparseable timestamp', () => {
    expect(() => validateMeasuredAt('not-a-date', now)).toThrow(/valid date/i);
  });
});

describe('unit conversion', () => {
  it('round-trips between kilograms and pounds', () => {
    expect(lbToKg(kgToLb(70))).toBeCloseTo(70, 6);
  });
});

describe('normalizeNote', () => {
  it('trims and converts blank input to null', () => {
    expect(normalizeNote('  morning  ')).toBe('morning');
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote(undefined)).toBeNull();
  });
});
