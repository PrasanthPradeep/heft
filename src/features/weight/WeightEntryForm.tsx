import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Description, Label } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDateTime, formatWeight } from '@/lib/format';
import { usePreferences } from '@/features/settings/preferences';
import type { WeightEntry, WeightEntryInput } from '@/features/weight/types';
import {
  parseWeightInput,
  validateMeasuredAt,
} from '@/features/weight/weightCalculations';

type WeightEntryFormProps = {
  initial?: WeightEntry | null;
  submitLabel?: string;
  onSubmit: (input: WeightEntryInput) => Promise<void>;
  onDelete?: () => Promise<void>;
};

function initialDateFrom(initial?: WeightEntry | null): Date {
  if (!initial) return new Date();
  const parsed = new Date(initial.measuredAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function WeightEntryForm({
  initial = null,
  submitLabel = 'Save measurement',
  onSubmit,
  onDelete,
}: WeightEntryFormProps) {
  const { preferences } = usePreferences();
  // Capture the unit once so editing an existing value is never reinterpreted
  // if the global preference changes while this screen is open.
  const [unit] = useState(preferences.weightUnit);

  const [weight, setWeight] = useState(
    initial ? formatWeight(initial.weightKg, unit) : ''
  );
  const [measuredAt, setMeasuredAt] = useState(initialDateFrom(initial));
  const [note, setNote] = useState(initial?.note ?? '');
  const [showPicker, setShowPicker] = useState<null | 'date' | 'time'>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = initial !== null;

  function onPickerChange(event: DateTimePickerEvent, value?: Date) {
    const currentMode = showPicker;
    setShowPicker(Platform.OS === 'ios' ? currentMode : null);
    if (event.type === 'dismissed' || !value) return;

    setMeasuredAt((previous) => {
      const next = new Date(previous);
      if (currentMode === 'date') {
        next.setFullYear(value.getFullYear(), value.getMonth(), value.getDate());
      } else {
        next.setHours(value.getHours(), value.getMinutes(), 0, 0);
      }
      return next;
    });
  }

  async function submit() {
    setError(null);

    let weightKg: number;
    let measuredAtIso: string;
    try {
      weightKg = parseWeightInput(weight, unit);
      measuredAtIso = validateMeasuredAt(measuredAt.toISOString());
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : 'Check the reading and try again.'
      );
      return;
    }

    setSaving(true);
    try {
      await onSubmit({ weightKg, measuredAt: measuredAtIso, note });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!onDelete) return;
    Alert.alert('Delete measurement?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setError(null);
          setSaving(true);
          onDelete()
            .catch((deleteError: unknown) => {
              setError(
                deleteError instanceof Error
                  ? deleteError.message
                  : 'Could not delete this measurement.'
              );
            })
            .finally(() => setSaving(false));
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Label>Weight ({unit})</Label>
      <View style={styles.weightRow}>
        <TextInput
          value={weight}
          onChangeText={(text) => setWeight(text.replace(/[^0-9.,]/g, ''))}
          keyboardType="decimal-pad"
          accessibilityLabel={`Weight in ${unit}`}
          placeholder={unit === 'lb' ? '180' : '80'}
          style={styles.weightInput}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>

      <Label>Measurement time</Label>
      <View style={styles.timeRow}>
        <Pressable
          style={styles.timeButton}
          onPress={() => setShowPicker('date')}>
          <Text style={styles.timeButtonText}>
            {formatDateTime(measuredAt.toISOString()).split(',')[0]}
          </Text>
        </Pressable>
        <Pressable
          style={styles.timeButton}
          onPress={() => setShowPicker('time')}>
          <Text style={styles.timeButtonText}>
            {formatDateTime(measuredAt.toISOString()).split(', ')[1]}
          </Text>
        </Pressable>
      </View>

      {showPicker && (
        <DateTimePicker
          value={measuredAt}
          mode={showPicker}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onPickerChange}
        />
      )}
      {showPicker && Platform.OS === 'ios' && (
        <Pressable
          style={styles.doneButton}
          onPress={() => setShowPicker(null)}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      )}

      <Label>Note (optional)</Label>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Morning, before breakfast"
        style={styles.note}
        multiline
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={saving ? 'Saving…' : submitLabel}
        onPress={submit}
        loading={saving}
        disabled={saving || weight.trim().length === 0}
      />

      {isEditing && onDelete ? (
        <Button
          label="Delete measurement"
          variant="danger"
          onPress={confirmDelete}
          disabled={saving}
        />
      ) : null}

      {!isEditing ? (
        <Description>
          New readings are saved to {preferences.storageMode === 'health-connect'
            ? 'Health Connect'
            : 'this device'}
          .
        </Description>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.brand,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.surface,
  },
  weightInput: {
    flex: 1,
    fontSize: 38,
    color: Colors.text,
    paddingVertical: Spacing.two,
  },
  unit: { fontSize: 18, color: Colors.textMuted },
  timeRow: { flexDirection: 'row', gap: Spacing.two },
  timeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.three,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  timeButtonText: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  doneButton: {
    alignSelf: 'flex-end',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  doneText: { color: Colors.brand, fontWeight: '700', fontSize: 16 },
  note: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.three,
    textAlignVertical: 'top',
    backgroundColor: Colors.surface,
  },
  error: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.two,
  },
});
