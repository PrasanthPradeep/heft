import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Description, Label, Screen, Title } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { WeightCandidate } from '@/features/camera/parser';
import {
  saveMeasurement,
  validateWeightKg,
} from '@/features/measurements/repository';
import type { MeasurementSource } from '@/features/measurements/types';
import { usePreferences } from '@/features/settings/preferences';
import { formatDateTime } from '@/lib/format';

function parseCandidates(raw: string | undefined): WeightCandidate[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function ConfirmWeightScreen() {
  const params = useLocalSearchParams<{
    source?: string;
    imageUri?: string;
    rawText?: string;
    ocrDebug?: string;
    candidates?: string;
    measuredAt?: string;
  }>();
  const { profile } = usePreferences();

  const source: MeasurementSource =
    params.source === 'manual' ? 'manual' : 'ocr';
  const candidates = useMemo(
    () => parseCandidates(params.candidates),
    [params.candidates]
  );

  const initialDate = useMemo(() => {
    const parsed = params.measuredAt ? new Date(params.measuredAt) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [params.measuredAt]);

  const [weight, setWeight] = useState(
    candidates[0] ? String(candidates[0].weightKg) : ''
  );
  const [note, setNote] = useState('');
  const [measuredAt, setMeasuredAt] = useState(initialDate);
  const [showPicker, setShowPicker] = useState<null | 'date' | 'time'>(null);
  const [saving, setSaving] = useState(false);

  const isManual = source === 'manual';

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

  async function confirm() {
    const value = Number(weight.replace(',', '.'));

    try {
      validateWeightKg(value, profile);
    } catch (error) {
      Alert.alert(
        'Check the reading',
        error instanceof Error ? error.message : 'Enter a valid weight in kg.'
      );
      return;
    }

    if (measuredAt.getTime() > Date.now() + 60_000) {
      Alert.alert('Check the time', 'The measurement time is in the future.');
      return;
    }

    setSaving(true);

    try {
      await saveMeasurement({
        weightKg: value,
        measuredAt: measuredAt.toISOString(),
        source,
        profile,
        ocrRawText: params.rawText ?? '',
        note: note.trim(),
      });

      Alert.alert('Saved', 'Your weight reading has been recorded.', [
        { text: 'OK', onPress: () => router.replace('/') },
      ]);
    } catch {
      Alert.alert(
        "Couldn't save",
        'Your reading could not be saved. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Title>{isManual ? 'Add weight' : 'Confirm weight'}</Title>
        <Description>
          {isManual
            ? 'Enter the reading from your scale.'
            : "Check the number against your scale's LCD before saving."}
        </Description>

        {params.imageUri ? (
          <Image
            source={{ uri: params.imageUri }}
            style={styles.preview}
            contentFit="cover"
            transition={150}
          />
        ) : null}

        <Label>Detected reading (kg)</Label>
        <View style={styles.weightRow}>
          <TextInput
            value={weight}
            onChangeText={(text) => setWeight(text.replace(/[^0-9.,]/g, ''))}
            keyboardType="decimal-pad"
            accessibilityLabel="Weight in kilograms"
            style={styles.weightInput}
            placeholder={profile.graduationKg < 1 ? '54.25' : '88'}
          />
          <Text style={styles.unit}>kg</Text>
        </View>

        {candidates.length > 1 && (
          <>
            <Label>Other detected candidates</Label>
            <View style={styles.candidateRow}>
              {candidates.map((candidate, index) => (
                <Pressable
                  key={`${candidate.weightKg}-${index}`}
                  style={styles.candidate}
                  onPress={() => setWeight(String(candidate.weightKg))}>
                  <Text style={styles.candidateText}>
                    {candidate.weightKg.toFixed(2)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

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

        {!isManual && (
          <>
            <Label>OCR text (for troubleshooting)</Label>
            <Text style={styles.rawText}>
              {(__DEV__ && params.ocrDebug) ||
                params.rawText ||
                'No text returned'}
            </Text>
          </>
        )}

        <Label>Note (optional)</Label>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Morning, before breakfast"
          style={styles.note}
          multiline
        />

        <Button
          label={saving ? 'Saving…' : 'Confirm and save'}
          onPress={confirm}
          loading={saving}
          disabled={saving || weight.trim().length === 0}
        />

        <Pressable
          style={styles.cancelButton}
          onPress={() => router.back()}>
          <Text style={styles.cancelText}>
            {isManual ? 'Cancel' : 'Retake photo'}
          </Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.six },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: Radius.lg,
    backgroundColor: Colors.brandTint,
  },
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
  candidateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  candidate: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.two,
    backgroundColor: Colors.surface,
  },
  candidateText: { color: Colors.brand, fontWeight: '600' },
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
  rawText: {
    backgroundColor: Colors.brandTint,
    borderRadius: Radius.sm,
    padding: Spacing.three,
    color: Colors.textSecondary,
  },
  note: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.three,
    textAlignVertical: 'top',
    backgroundColor: Colors.surface,
  },
  cancelButton: { alignItems: 'center', padding: Spacing.three },
  cancelText: { color: Colors.brand, fontWeight: '600' },
});
