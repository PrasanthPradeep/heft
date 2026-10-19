import { Colors } from '@/constants/theme';

import type { BmiCategory } from './bmiCalculations';

export const BMI_CATEGORY_COLORS: Record<BmiCategory, string> = {
  underweight: Colors.warning,
  healthy: Colors.brand,
  overweight: Colors.warning,
  obesity: Colors.danger,
};

export function bmiCategoryColor(category: BmiCategory): string {
  return BMI_CATEGORY_COLORS[category];
}
