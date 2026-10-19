import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

import {
  BMI_SCALE_SEGMENTS,
  bmiCategory,
  bmiCategoryLabel,
  bmiScalePosition,
  formatBmi,
} from './bmiCalculations';
import { bmiCategoryColor } from './bmiColors';

type Props = {
  currentBmi: number;
  goalBmi: number | null;
};

const SCALE_LABELS = ['16', '18.5', '25', '30+'] as const;

export function BmiRangeBar({ currentBmi, goalBmi }: Props) {
  const currentCategory = bmiCategory(currentBmi);
  const goalCategory = goalBmi === null ? null : bmiCategory(goalBmi);
  const currentPosition = bmiScalePosition(currentBmi);
  const goalPosition = goalBmi === null ? null : bmiScalePosition(goalBmi);

  if (currentCategory === null || currentPosition === null) {
    return null;
  }

  const scaleLabel = [
    'Adult BMI categories from 16 to 30 plus.',
    `Current BMI ${formatBmi(currentBmi)}, ${bmiCategoryLabel(
      currentCategory
    )}.`,
    goalBmi !== null && goalCategory !== null
      ? `Goal BMI ${formatBmi(goalBmi)}, ${bmiCategoryLabel(goalCategory)}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Adult BMI categories</Text>

      <View
        style={styles.trackOuter}
        accessible
        accessibilityLabel={scaleLabel}>
        <View style={styles.trackArea}>
          <View style={styles.track}>
            {BMI_SCALE_SEGMENTS.map((segment) => (
              <View
                key={segment.category}
                style={{
                  flex: segment.weight,
                  backgroundColor: bmiCategoryColor(segment.category),
                }}
              />
            ))}
          </View>

          <View
            style={[
              styles.currentMarker,
              { left: `${currentPosition * 100}%` },
            ]}
          />

          {goalPosition !== null ? (
            <View
              style={[styles.goalMarker, { left: `${goalPosition * 100}%` }]}>
              <View style={styles.goalMarkerInner} />
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.labels}>
        {BMI_SCALE_SEGMENTS.map((segment, index) => (
          <View key={segment.category} style={{ flex: segment.weight }}>
            <Text
              style={[
                styles.scaleLabel,
                index === BMI_SCALE_SEGMENTS.length - 1 && styles.scaleLabelEnd,
              ]}>
              {SCALE_LABELS[index]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  heading: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  trackOuter: {
    height: 28,
    paddingHorizontal: 6,
  },
  trackArea: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  track: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  currentMarker: {
    position: 'absolute',
    top: 4,
    width: 4,
    height: 20,
    marginLeft: -2,
    borderRadius: 2,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(24, 51, 38, 0.45)',
  },
  goalMarker: {
    position: 'absolute',
    top: 7,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(24, 51, 38, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalMarkerInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 3,
    borderColor: Colors.surface,
  },
  labels: {
    flexDirection: 'row',
    paddingHorizontal: 6,
  },
  scaleLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  scaleLabelEnd: {
    textAlign: 'right',
  },
});
