import { formatVolume } from '@/features/water/waterCalculations';

test('formatVolume returns 0 ml for negative values', () => {
  expect(formatVolume(-123)).toBe('0 ml');
});

test('formatVolume returns 0 ml for zero', () => {
  expect(formatVolume(0)).toBe('0 ml');
});
