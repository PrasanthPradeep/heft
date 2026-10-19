import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { Button, Card, Label } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { WeightUnit } from '@/features/settings/types';
import { formatWeight } from '@/lib/format';

import {
  bmiCategory,
  calculateBmi,
  formatHeightCm,
  parseHeightCm,
} from './bmiCalculations';
import { BmiRangeBar } from './BmiRangeBar';
import { BmiValueCard } from './BmiValueCard';

type Props = {
  currentWeightKg: number | null;
  goalWeightKg: number | null;
  /** Manually entered height. Takes precedence over the Health Connect value. */
  heightCm: number | null;
  /** Latest height read from Health Connect, when the user allowed it. */
  healthConnectHeightCm?: number | null;
  /** True when Health Connect is the active storage mode. */
  healthConnectAvailable?: boolean;
  weightUnit: WeightUnit;
  onSaveHeight: (heightCm: number) => Promise<void>;
  /** Opens the Health Connect permission flow and re-reads the height. */
  onUseHealthConnectHeight?: () => void;
};

/**
 * Current and goal BMI against the adult categories.
 *
 * Height comes from the manual preference when it exists, otherwise from the
 * latest Health Connect height record. Weight always comes from the existing
 * repository, so both storage modes work without a new data source.
 */
export function BmiProgressCard({
  currentWeightKg,
  goalWeightKg,
  heightCm,
  healthConnectHeightCm = null,
  healthConnectAvailable = false,
  weightUnit,
  onSaveHeight,
  onUseHealthConnectHeight,
}: Props) {
  const { width, fontScale } = useWindowDimensions();
  const effectiveHeightCm = heightCm ?? healthConnectHeightCm;
  const usingHealthConnectHeight =
    heightCm === null && healthConnectHeightCm !== null;

  const [heightInput, setHeightInput] = useState(
    effectiveHeightCm === null ? '' : String(effectiveHeightCm)
  );
  const [editingHeight, setEditingHeight] = useState(false);

  // Android reports a 1.3 font scale as 1.2999999, so allow a small tolerance.
  const stackCards = fontScale >= 1.29 || width < 340;
  const currentBmi = calculateBmi(currentWeightKg, effectiveHeightCm);
  const goalBmi = calculateBmi(goalWeightKg, effectiveHeightCm);
  const currentCategory = bmiCategory(currentBmi);
  const goalCategory = bmiCategory(goalBmi);
  const showingHeightPrompt = effectiveHeightCm === null || editingHeight;

  const bmiDifference =
    currentBmi !== null && goalBmi !== null
      ? Math.abs(currentBmi - goalBmi)
      : null;
  const goalLabel =
    goalWeightKg === null
      ? null
      : `${formatWeight(goalWeightKg, weightUnit)} ${weightUnit}`;

  function startEditingHeight() {
    setHeightInput(effectiveHeightCm === null ? '' : String(effectiveHeightCm));
    setEditingHeight(true);
  }

  function cancelEditingHeight() {
    setHeightInput(effectiveHeightCm === null ? '' : String(effectiveHeightCm));
    setEditingHeight(false);
  }

  async function saveHeight() {
    try {
      const value = parseHeightCm(heightInput);
      await onSaveHeight(value);
      setEditingHeight(false);
    } catch (error) {
      Alert.alert(
        'Check the height',
        error instanceof Error ? error.message : 'Enter a valid height.'
      );
    }
  }

  return (
    <Card style={styles.card}>
      <Label>BMI progress</Label>

      {showingHeightPrompt ? (
        <View style={styles.heightPrompt}>
          <Text style={styles.hint}>
            {effectiveHeightCm === null
              ? 'Add your height to see your BMI and how it compares with your goal.'
              : 'Update your height to recalculate both BMI values.'}
          </Text>

          <View style={styles.heightRow}>
            <TextInput
              value={heightInput}
              onChangeText={(text) =>
                setHeightInput(text.replace(/[^0-9.,]/g, ''))
              }
              keyboardType="decimal-pad"
              maxLength={5}
              accessibilityLabel="Height in centimetres"
              style={styles.heightInput}
            />
            <Text style={styles.heightUnit}>cm</Text>
            <Button
              label="Save"
              variant="secondary"
              onPress={saveHeight}
              style={styles.heightButton}
            />
          </View>

          <View style={styles.heightMeta}>
            <Text style={styles.hintSmall}>
              {healthConnectAvailable
                ? 'Saved to Health Connect when you update it.'
                : 'Stored on this device.'}
            </Text>
            {effectiveHeightCm !== null ? (
              <Pressable
                onPress={cancelEditingHeight}
                hitSlop={8}
                accessibilityRole="button">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>

          {healthConnectAvailable &&
          effectiveHeightCm === null &&
          onUseHealthConnectHeight ? (
            <Pressable
              onPress={onUseHealthConnectHeight}
              hitSlop={8}
              accessibilityRole="button">
              <Text style={styles.healthConnectLink}>
                Use height from Health Connect
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : currentBmi === null || currentCategory === null ? (
        <Text style={styles.hint}>Log a weight to see your BMI.</Text>
      ) : (
        <>
          <View style={[styles.values, stackCards && styles.valuesStacked]}>
            <BmiValueCard
              label="Current BMI"
              bmi={currentBmi}
              category={currentCategory}
              style={stackCards ? undefined : styles.flexCard}
            />
            {goalBmi !== null && goalCategory !== null ? (
              <BmiValueCard
                label="Goal BMI"
                bmi={goalBmi}
                category={goalCategory}
                accent
                style={stackCards ? undefined : styles.flexCard}
              />
            ) : null}
          </View>

          <BmiRangeBar currentBmi={currentBmi} goalBmi={goalBmi} />

          {bmiDifference !== null && goalLabel !== null ? (
            <View style={styles.callout}>
              <Text style={styles.calloutTitle}>
                {bmiDifference < 0.05
                  ? 'You are at your goal BMI'
                  : `${bmiDifference.toFixed(1)} BMI points to goal`}
              </Text>
              <Text style={styles.calloutBody}>
                BMI at your target weight of {goalLabel}.
              </Text>
            </View>
          ) : null}
        </>
      )}

      {effectiveHeightCm !== null && !showingHeightPrompt ? (
        <Pressable
          onPress={startEditingHeight}
          accessibilityRole="button"
          accessibilityLabel={`Height ${formatHeightCm(
            effectiveHeightCm
          )}, edit`}
          hitSlop={8}
          style={styles.heightFooter}>
          <Text style={styles.heightFooterText}>
            Height {formatHeightCm(effectiveHeightCm)}
            {usingHealthConnectHeight ? ' · Health Connect' : ''}
          </Text>
          <Text style={styles.editHeight}>Edit</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
  },
  values: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  valuesStacked: {
    flexDirection: 'column',
  },
  flexCard: {
    flex: 1,
    flexBasis: 0,
  },
  hint: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  hintSmall: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  heightPrompt: {
    gap: Spacing.two,
  },
  heightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  heightInput: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: 0,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    color: Colors.text,
    fontSize: 18,
    textAlignVertical: 'center',
  },
  heightUnit: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  heightButton: {
    paddingHorizontal: Spacing.three,
  },
  heightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancel: {
    color: Colors.brand,
    fontSize: 13,
    fontWeight: '700',
  },
  healthConnectLink: {
    color: Colors.brand,
    fontSize: 13,
    fontWeight: '700',
  },
  callout: {
    backgroundColor: Colors.brandTint,
    borderRadius: Radius.md,
    padding: Spacing.three,
    gap: 2,
  },
  calloutTitle: {
    color: Colors.brandDark,
    fontSize: 14,
    fontWeight: '700',
  },
  calloutBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  heightFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.two,
  },
  heightFooterText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  editHeight: {
    color: Colors.brand,
    fontSize: 12,
    fontWeight: '700',
  },
});
