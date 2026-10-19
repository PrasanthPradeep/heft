import {
  bmiCategory,
  bmiCategoryLabel,
  bmiScalePosition,
  calculateBmi,
  formatBmi,
  formatHeightCm,
  parseHeightCm,
} from '../bmiCalculations';

describe('calculateBmi', () => {
  it('calculates the sample values without rounding internally', () => {
    const current = calculateBmi(52.1, 172);
    expect(current).toBeCloseTo(17.611, 3);
    expect(formatBmi(current)).toBe('17.6');

    const goal = calculateBmi(60, 172);
    expect(goal).toBeCloseTo(20.281, 3);
    expect(formatBmi(goal)).toBe('20.3');
  });

  it('returns null rather than NaN for unusable inputs', () => {
    expect(calculateBmi(null, 172)).toBeNull();
    expect(calculateBmi(52.1, null)).toBeNull();
    expect(calculateBmi(0, 172)).toBeNull();
    expect(calculateBmi(52.1, 0)).toBeNull();
    expect(calculateBmi(-70, 172)).toBeNull();
    expect(calculateBmi(Number.NaN, 172)).toBeNull();
    expect(calculateBmi(52.1, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('bmiCategory', () => {
  it('places every boundary in the higher category', () => {
    expect(bmiCategory(17)).toBe('underweight');
    expect(bmiCategory(18.499)).toBe('underweight');
    expect(bmiCategory(18.5)).toBe('healthy');
    expect(bmiCategory(24.999)).toBe('healthy');
    expect(bmiCategory(25)).toBe('overweight');
    expect(bmiCategory(29.999)).toBe('overweight');
    expect(bmiCategory(30)).toBe('obesity');
    expect(bmiCategory(42)).toBe('obesity');
  });

  it('returns null for missing values', () => {
    expect(bmiCategory(null)).toBeNull();
    expect(bmiCategory(undefined)).toBeNull();
    expect(bmiCategory(Number.NaN)).toBeNull();
  });

  it('labels each category', () => {
    expect(bmiCategoryLabel('underweight')).toBe('Underweight range');
    expect(bmiCategoryLabel('healthy')).toBe('Healthy range');
    expect(bmiCategoryLabel('overweight')).toBe('Overweight range');
    expect(bmiCategoryLabel('obesity')).toBe('Obesity range');
  });
});

describe('bmiScalePosition', () => {
  it('clamps values outside the scale to the edges', () => {
    expect(bmiScalePosition(12)).toBe(0);
    expect(bmiScalePosition(16)).toBe(0);
    expect(bmiScalePosition(30.1)).toBe(1);
    expect(bmiScalePosition(50)).toBe(1);
    expect(bmiScalePosition(null)).toBeNull();
  });

  it('aligns the category boundaries with the drawn segments', () => {
    expect(bmiScalePosition(18.5)).toBeCloseTo(2.5 / 16, 10);
    expect(bmiScalePosition(25)).toBeCloseTo(9 / 16, 10);
    expect(bmiScalePosition(30)).toBeCloseTo(14 / 16, 10);
  });

  it('increases monotonically across the scale', () => {
    const values = [16, 17, 18.5, 20, 25, 27, 29.9, 30];
    const positions = values.map((value) => bmiScalePosition(value) ?? -1);
    positions.forEach((position, index) => {
      if (index > 0) expect(position).toBeGreaterThan(positions[index - 1]);
    });
  });
});

describe('parseHeightCm', () => {
  it('accepts whole and decimal heights, including a comma separator', () => {
    expect(parseHeightCm('172')).toBe(172);
    expect(parseHeightCm('172.5')).toBe(172.5);
    expect(parseHeightCm(' 172,5 ')).toBe(172.5);
    expect(parseHeightCm('100')).toBe(100);
    expect(parseHeightCm('250')).toBe(250);
  });

  it('rounds to one decimal', () => {
    expect(parseHeightCm('172.56')).toBe(172.6);
  });

  it('rejects empty, non-numeric and implausible heights', () => {
    expect(() => parseHeightCm('')).toThrow('Enter your height.');
    expect(() => parseHeightCm('tall')).toThrow('Enter a valid height.');
    expect(() => parseHeightCm('99')).toThrow('between 100 and 250 cm');
    expect(() => parseHeightCm('251')).toThrow('between 100 and 250 cm');
    expect(() => parseHeightCm('-172')).toThrow('between 100 and 250 cm');
  });
});

describe('formatHeightCm', () => {
  it('drops a redundant decimal and keeps a real one', () => {
    expect(formatHeightCm(172)).toBe('172 cm');
    expect(formatHeightCm(172.5)).toBe('172.5 cm');
    expect(formatHeightCm(172.0)).toBe('172 cm');
  });
});
