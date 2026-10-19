import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

import {
  bmiCategoryLabel,
  formatBmi,
  type BmiCategory,
} from './bmiCalculations';
import { bmiCategoryColor } from './bmiColors';

type Props = {
  label: string;
  bmi: number;
  category: BmiCategory;
  /** Goal values use the brand green; current uses the body text colour. */
  accent?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function BmiValueCard({
  label,
  bmi,
  category,
  accent = false,
  style,
}: Props) {
  const categoryColor = bmiCategoryColor(category);
  const categoryLabel = bmiCategoryLabel(category);

  return (
    <View
      style={[styles.card, style]}
      accessible
      accessibilityLabel={`${label} ${formatBmi(bmi)}, ${categoryLabel}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, accent && styles.accent]}>
        {formatBmi(bmi)}
      </Text>
      <View style={styles.categoryRow}>
        <View style={[styles.dot, { backgroundColor: categoryColor }]} />
        <Text style={[styles.category, { color: categoryColor }]}>
          {categoryLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 0,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  value: {
    color: Colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  accent: {
    color: Colors.brand,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.half,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  category: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
});
