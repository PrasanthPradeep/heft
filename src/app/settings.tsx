import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Card, Description, Label, Screen, Title } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { clearAllData } from '@/db/database';
import { formatDateTime } from '@/lib/format';
import { AiSettingsCard } from '@/features/ai/AiSettingsCard';
import { loadDailyActivity } from '@/features/activity/activityRepository';
import { summarizeActivity } from '@/features/activity/activityCalculations';
import {
  detectFormat,
  entriesToCsv,
  entriesToJson,
  parseImport,
} from '@/features/export/exportService';
import { syncHealthConnect } from '@/features/health-connect/weightSync';
import {
  getActivityPermissionState,
  getHealthConnectStatus,
  hasActivityAccess,
  openHealthConnectSettings,
  requestActivityPermissions,
  requestWeightPermissions,
  type ActivityPermissionState,
} from '@/features/health-connect/healthConnectPermissions';
import {
  loadLastSyncedAt,
} from '@/features/settings/preferenceStore';
import { usePreferences } from '@/features/settings/preferences';
import type { WeightUnit } from '@/features/settings/types';
import type { WeightEntry } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';

const UNITS: WeightUnit[] = ['kg', 'lb'];

const REPOSITORY_URL = 'https://github.com/PrasanthPradeep/heft';

export default function SettingsScreen() {
  const { preferences, updatePreferences } = usePreferences();
  const repository = getWeightRepository(preferences.storageMode);
  const isHealthConnect = preferences.storageMode === 'health-connect';
  const appVersion = Constants.expoConfig?.version;

  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState('');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [activityAccess, setActivityAccess] = useState<ActivityPermissionState>({
    canReadSteps: false,
    canReadExercise: false,
  });
  const [activitySteps7d, setActivitySteps7d] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [rows, syncedAt, access, activityDays] = await Promise.all([
      repository.listWeights(),
      loadLastSyncedAt(),
      getActivityPermissionState(),
      loadDailyActivity(),
    ]);
    setEntries(rows);
    setLastSyncedAt(syncedAt);
    setActivityAccess(access);
    setActivitySteps7d(summarizeActivity(activityDays).averageSteps7d);
  }, [repository]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        // Non-fatal; the screen still renders.
      });
    }, [load])
  );

  const pendingCount = entries.filter((entry) => entry.pending).length;

  async function enableHealthConnect() {
    setBusy(true);
    try {
      const status = await getHealthConnectStatus();
      if (status !== 'available') {
        Alert.alert(
          'Health Connect unavailable',
          status === 'update-required'
            ? 'The Health Connect app needs an update before Heft can use it.'
            : 'Health Connect is not available on this device.'
        );
        return;
      }

      const permissions = await requestWeightPermissions();
      if (!permissions.canRead && !permissions.canWrite) {
        Alert.alert(
          'Permission needed',
          'Heft needs permission to read and write weight in Health Connect.'
        );
        return;
      }

      await updatePreferences({ storageMode: 'health-connect' });
      await syncHealthConnect();
      await load();
      Alert.alert(
        'Health Connect enabled',
        'Heft will read and write your weight in Health Connect.'
      );
    } finally {
      setBusy(false);
    }
  }

  function enableLocal() {
    Alert.alert(
      'Use local storage only?',
      'Heft will stop syncing with Health Connect and keep your history on this device. Nothing in Health Connect is deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            await updatePreferences({ storageMode: 'local' });
            await load();
          },
        },
      ]
    );
  }

  async function runSync() {
    setBusy(true);
    try {
      const result = await syncHealthConnect();
      await load();
      if (result.status === 'skipped') {
        Alert.alert('Nothing to sync', 'Health Connect is not ready right now.');
      } else if (result.failed > 0) {
        Alert.alert(
          'Partly synced',
          `${result.written} uploaded, ${result.failed} still waiting.`
        );
      } else {
        const activity =
          result.activityDays > 0
            ? `, ${result.activityDays} activity day${result.activityDays === 1 ? '' : 's'}`
            : '';
        Alert.alert(
          'Synced',
          `${result.written} uploaded, ${result.imported} read${activity}.`
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function connectActivity() {
    setBusy(true);
    try {
      const access = await requestActivityPermissions();
      setActivityAccess(access);
      if (!hasActivityAccess(access)) {
        Alert.alert(
          'No activity data',
          'Heft needs read access to steps and exercise to show Google Fit data. You can grant it in Health Connect.'
        );
        return;
      }
      await syncHealthConnect();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function exportData(format: 'csv' | 'json') {
    if (entries.length === 0) {
      Alert.alert('Nothing to export', 'Add a measurement first.');
      return;
    }

    const payload =
      format === 'csv' ? entriesToCsv(entries) : entriesToJson(entries);
    await Share.share({
      title: `Heft weight export (${format.toUpperCase()})`,
      message: payload,
    });
  }

  async function importData() {
    if (importText.trim().length === 0) {
      Alert.alert('Nothing to import', 'Paste CSV or JSON first.');
      return;
    }

    let parsed;
    try {
      parsed = parseImport(importText, detectFormat(importText));
    } catch (error) {
      Alert.alert(
        'Could not read that',
        error instanceof Error ? error.message : 'Check the format and try again.'
      );
      return;
    }

    if (parsed.length === 0) {
      Alert.alert('No readings found', 'The pasted data had no valid entries.');
      return;
    }

    // Skip readings that already exist at the same time with the same value.
    const existing = new Set(
      entries.map((entry) => `${entry.measuredAt}|${entry.weightKg}`)
    );

    let added = 0;
    setBusy(true);
    try {
      for (const item of parsed) {
        const key = `${item.measuredAt}|${item.weightKg}`;
        if (existing.has(key)) continue;
        await repository.addWeight(item);
        existing.add(key);
        added += 1;
      }
      await load();
      setImportText('');
      Alert.alert('Imported', `${added} readings added.`);
    } catch (error) {
      Alert.alert(
        'Import failed',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmClear() {
    Alert.alert(
      'Delete all measurements?',
      isHealthConnect
        ? 'This removes the readings Heft wrote to Health Connect and clears the local cache. Readings saved by other apps are not affected. This cannot be undone.'
        : 'This removes every reading from Heft. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isHealthConnect) {
                await repository.deleteAllWeights();
              } else {
                await clearAllData();
              }
              await load();
            } catch {
              Alert.alert(
                'Could not delete',
                'Health Connect was unreachable, so nothing was removed. Try again.'
              );
            }
          },
        },
      ]
    );
  }

  function onTimeChange(event: DateTimePickerEvent, value?: Date) {
    setShowTimePicker(Platform.OS === 'ios');
    if (event.type === 'dismissed' || !value) return;
    updatePreferences({
      reminderHour: value.getHours(),
      reminderMinute: value.getMinutes(),
    }).catch(() => {});
  }

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Settings</Title>

        <Label>Storage</Label>
        <Card style={styles.stack}>
          <Text style={styles.cardTitle}>
            {isHealthConnect ? 'Health Connect' : 'Local storage only'}
          </Text>
          <Text style={styles.cardText}>
            {isHealthConnect
              ? 'Health Connect is your weight history. Heft keeps only settings and a small cache on this device.'
              : 'Your complete weight history lives on this device in a local database.'}
          </Text>

          {isHealthConnect ? (
            <>
              <Button
                label="Open Health Connect"
                variant="secondary"
                onPress={openHealthConnectSettings}
              />
              <Button
                label="Switch to local storage only"
                variant="secondary"
                onPress={enableLocal}
                disabled={busy}
              />
            </>
          ) : (
            <Button
              label={busy ? 'Please wait…' : 'Switch to Health Connect'}
              onPress={enableHealthConnect}
              loading={busy}
              disabled={busy}
            />
          )}
        </Card>

        {isHealthConnect ? (
          <>
            <Label>Sync</Label>
            <Card style={styles.stack}>
              <Text style={styles.cardText}>
                {pendingCount > 0
                  ? `${pendingCount} measurement${pendingCount === 1 ? '' : 's'} waiting to sync.`
                  : 'Everything is synced.'}
              </Text>
              <Text style={styles.cardText}>
                {lastSyncedAt
                  ? `Last synced ${formatDateTime(lastSyncedAt)}`
                  : 'Not synced yet.'}
              </Text>
              <Button
                label={busy ? 'Syncing…' : 'Sync now'}
                onPress={runSync}
                loading={busy}
                disabled={busy}
              />
            </Card>

            <Label>Activity</Label>
            <Card style={styles.stack}>
              <Text style={styles.cardText}>
                {hasActivityAccess(activityAccess)
                  ? activitySteps7d !== null
                    ? `Averaging ${Math.round(activitySteps7d).toLocaleString()} steps a day over the last week.`
                    : 'Reading steps and workouts from Health Connect.'
                  : 'Read steps and workouts that Google Fit and other fitness apps sync to Health Connect.'}
              </Text>
              {hasActivityAccess(activityAccess) ? (
                <Button
                  label="Refresh activity"
                  variant="secondary"
                  onPress={runSync}
                  disabled={busy}
                />
              ) : (
                <Button
                  label={busy ? 'Please wait…' : 'Connect activity data'}
                  onPress={connectActivity}
                  loading={busy}
                  disabled={busy}
                />
              )}
            </Card>
          </>
        ) : null}

        <Label>Units</Label>
        <View style={styles.unitRow}>
          {UNITS.map((unit) => {
            const selected = preferences.weightUnit === unit;
            return (
              <Pressable
                key={unit}
                onPress={() => updatePreferences({ weightUnit: unit })}
                style={[styles.unit, selected && styles.unitSelected]}>
                <Text
                  style={[
                    styles.unitText,
                    selected && styles.unitTextSelected,
                  ]}>
                  {unit === 'kg' ? 'Kilograms' : 'Pounds'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Label>Weigh-in reminder</Label>
        <Card style={styles.stack}>
          <View style={styles.switchRow}>
            <Text style={styles.cardText}>Remind me to weigh in</Text>
            <Switch
              value={preferences.reminderEnabled}
              onValueChange={(value) =>
                updatePreferences({ reminderEnabled: value })
              }
            />
          </View>
          {preferences.reminderEnabled ? (
            <Pressable
              style={styles.timeButton}
              onPress={() => setShowTimePicker(true)}>
              <Text style={styles.timeText}>
                {String(preferences.reminderHour).padStart(2, '0')}:
                {String(preferences.reminderMinute).padStart(2, '0')}
              </Text>
            </Pressable>
          ) : null}
          <Description>
            Heft reminds you inside the app when you have not logged a reading
            that day. No notification permission is requested.
          </Description>
        </Card>

        {showTimePicker ? (
          <DateTimePicker
            value={new Date(2020, 0, 1, preferences.reminderHour, preferences.reminderMinute)}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onTimeChange}
          />
        ) : null}

        <AiSettingsCard />

        <Label>Export</Label>
        <Card style={styles.stack}>
          <Description>
            Exports are shared as text (CSV or JSON) through the system share
            sheet. Everything stays on your device.
          </Description>
          <Button
            label="Export as CSV"
            variant="secondary"
            onPress={() => exportData('csv')}
          />
          <Button
            label="Export as JSON"
            variant="secondary"
            onPress={() => exportData('json')}
          />
        </Card>

        <Label>Import</Label>
        <Card style={styles.stack}>
          {isHealthConnect ? (
            <Text style={styles.cardText}>
              Import is only available in local storage mode, so Health Connect
              records are never duplicated.
            </Text>
          ) : (
            <>
              <Description>
                Paste exported CSV or JSON below. Readings already at the same
                time and value are skipped.
              </Description>
              <TextInput
                value={importText}
                onChangeText={setImportText}
                placeholder="measuredAt,weightKg,note,source…"
                multiline
                style={styles.importInput}
              />
              <Button
                label={busy ? 'Importing…' : 'Import readings'}
                onPress={importData}
                loading={busy}
                disabled={busy}
              />
            </>
          )}
        </Card>

        <Label>Data & privacy</Label>
        <Card style={styles.stack}>
          <Text style={styles.cardText}>
            Heft has no account and no server. In local mode nothing leaves this
            device. In Health Connect mode, data is read from and written to the
            Android Health Connect app under your control.
          </Text>
          <Button
            label="Delete all measurements"
            variant="danger"
            onPress={confirmClear}
          />
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {appVersion ? `Heft ${appVersion}` : 'Heft'}
          </Text>
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() =>
              Linking.openURL(REPOSITORY_URL).catch(() => undefined)
            }>
            <Text style={styles.footerLink}>
              github.com/PrasanthPradeep/heft
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
  stack: { gap: Spacing.two },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  cardText: { color: Colors.textSecondary, lineHeight: 21, flexShrink: 1 },
  unitRow: { flexDirection: 'row', gap: Spacing.two },
  unit: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  unitSelected: {
    borderColor: Colors.brand,
    backgroundColor: Colors.brandTint,
  },
  unitText: { fontWeight: '600', color: Colors.text },
  unitTextSelected: { color: Colors.brand },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  timeButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.three,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  timeText: { fontSize: 20, fontWeight: '700', color: Colors.text },
  importInput: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.three,
    textAlignVertical: 'top',
    backgroundColor: Colors.surface,
  },
  footer: {
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.four,
  },
  footerText: { color: Colors.textSecondary, fontSize: 13 },
  footerLink: {
    color: Colors.brand,
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: Spacing.one,
  },
});
