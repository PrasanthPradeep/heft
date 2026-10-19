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
  NO_HYDRATION_PERMISSIONS,
  getActivityPermissionState,
  getHealthConnectStatus,
  getHydrationPermissionState,
  hasActivityAccess,
  hasHydrationAccess,
  openHealthConnectSettings,
  requestActivityPermissions,
  requestHydrationPermissions,
  requestWeightPermissions,
  type ActivityPermissionState,
  type HydrationPermissionState,
} from '@/features/health-connect/healthConnectPermissions';
import {
  getReminderPermission,
  requestReminderPermission,
  type ReminderPermission,
} from '@/features/reminders/notifications';
import {
  WATER_INTERVALS,
  WEEKDAYS,
  clockTime,
  describeWaterWindow,
  pickReminderSettings,
} from '@/features/reminders/schedule';
import {
  loadLastSyncedAt,
} from '@/features/settings/preferenceStore';
import { usePreferences } from '@/features/settings/preferences';
import type {
  AppPreferences,
  ReminderRepeat,
  WeightUnit,
} from '@/features/settings/types';
import type { WeightEntry } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';
import {
  WATER_TARGET_PRESETS_ML,
  formatVolume,
} from '@/features/water/waterCalculations';
import { getWaterRepository } from '@/features/water/waterRepository';
import { refreshHydrationWidget } from '@/features/widget/HeftWidget';

const UNITS: WeightUnit[] = ['kg', 'lb'];
const REPEATS: ReminderRepeat[] = ['daily', 'weekly'];

/** Which clock the open time picker is editing. */
type PickerTarget = 'weighIn' | 'waterStart' | 'waterEnd';

const REPOSITORY_URL = 'https://github.com/PrasanthPradeep/heft';

export default function SettingsScreen() {
  const { preferences, updatePreferences } = usePreferences();
  const repository = getWeightRepository(preferences.storageMode);
  const waterRepository = getWaterRepository(preferences.storageMode);
  const isHealthConnect = preferences.storageMode === 'health-connect';
  const appVersion = Constants.expoConfig?.version;

  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState('');
  const [activePicker, setActivePicker] = useState<PickerTarget | null>(null);
  const [reminderPermission, setReminderPermission] =
    useState<ReminderPermission>('undetermined');
  const [activityAccess, setActivityAccess] = useState<ActivityPermissionState>({
    canReadSteps: false,
    canReadExercise: false,
  });
  const [activitySteps7d, setActivitySteps7d] = useState<number | null>(null);
  const [hydrationAccess, setHydrationAccess] =
    useState<HydrationPermissionState>(NO_HYDRATION_PERMISSIONS);

  const load = useCallback(async () => {
    const [rows, syncedAt, access, activityDays, permission, hydration] =
      await Promise.all([
        repository.listWeights(),
        loadLastSyncedAt(),
        getActivityPermissionState(),
        loadDailyActivity(),
        // Re-read on every focus, since it can change in system settings while
        // Heft sits in the background.
        getReminderPermission(),
        getHydrationPermissionState(),
      ]);
    setEntries(rows);
    setLastSyncedAt(syncedAt);
    setActivityAccess(access);
    setActivitySteps7d(summarizeActivity(activityDays).averageSteps7d);
    setReminderPermission(permission);
    setHydrationAccess(hydration);
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
      } else if (result.failed > 0 || result.waterFailed > 0) {
        Alert.alert(
          'Partly synced',
          `${result.written + result.waterWritten} saved, ${
            result.failed + result.waterFailed
          } still waiting.`
        );
      } else {
        const bits: string[] = [];
        if (result.written > 0) bits.push(`${result.written} weight uploaded`);
        if (result.waterWritten > 0) {
          bits.push(`${result.waterWritten} water uploaded`);
        }
        if (result.imported > 0) bits.push(`${result.imported} weight read`);
        if (result.waterImported > 0) {
          bits.push(`${result.waterImported} water read`);
        }
        if (result.activityDays > 0) {
          bits.push(
            `${result.activityDays} activity day${
              result.activityDays === 1 ? '' : 's'
            }`
          );
        }
        Alert.alert(
          'Synced',
          bits.length > 0 ? bits.join(' · ') : 'Everything is up to date.'
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

  async function connectHydration() {
    setBusy(true);
    try {
      const access = await requestHydrationPermissions();
      setHydrationAccess(access);
      if (!hasHydrationAccess(access)) {
        Alert.alert(
          'No water access',
          'Heft needs access to hydration in Health Connect to sync water. You can grant it in Health Connect.'
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
      'Delete all data?',
      isHealthConnect
        ? 'This removes the weight and water entries Heft wrote to Health Connect and clears the local cache. Records saved by other apps are not affected. This cannot be undone.'
        : 'This removes every weight and water entry from Heft. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isHealthConnect) {
                await repository.deleteAllWeights();
                await waterRepository.deleteAllWater();
              } else {
                await clearAllData();
              }
              await load();
              refreshHydrationWidget();
            } catch {
              Alert.alert(
                'Could not delete',
                'Health Connect was unreachable, so not everything could be removed. Try again.'
              );
            }
          },
        },
      ]
    );
  }

  const pickerTimes: Record<PickerTarget, Date> = {
    weighIn: new Date(
      2020,
      0,
      1,
      preferences.reminderHour,
      preferences.reminderMinute
    ),
    waterStart: new Date(2020, 0, 1, preferences.waterStartHour, 0),
    waterEnd: new Date(2020, 0, 1, preferences.waterEndHour, 0),
  };

  function onTimeChange(event: DateTimePickerEvent, value?: Date) {
    // iOS keeps a spinner open while it is being scrolled; Android closes it as
    // soon as the user confirms or dismisses.
    const target = activePicker;
    setActivePicker(Platform.OS === 'ios' ? target : null);
    if (event.type === 'dismissed' || !value || !target) return;

    if (target === 'weighIn') {
      updatePreferences({
        reminderHour: value.getHours(),
        reminderMinute: value.getMinutes(),
      }).catch(() => {});
    } else if (target === 'waterStart') {
      updatePreferences({ waterStartHour: value.getHours() }).catch(() => {});
    } else {
      updatePreferences({ waterEndHour: value.getHours() }).catch(() => {});
    }
  }

  /**
   * The permission request lives here and nowhere else. On launch Heft stays
   * silent; the dialog only appears because the user just switched a reminder
   * on. A refusal is not treated as a failure either — the switch stays where
   * they put it, the card says what is blocked, and the dashboard banner keeps
   * reminding them in the meantime.
   */
  async function enableReminder(patch: Partial<AppPreferences>) {
    const permission = await requestReminderPermission();
    setReminderPermission(permission);
    await updatePreferences(patch);

    if (permission === 'denied') {
      Alert.alert(
        'Notifications are off',
        'Android is blocking Heft from posting notifications. Until you allow them, reminders appear on the dashboard instead.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ]
      );
    }
  }

  function toggleWeighIn(enabled: boolean) {
    if (!enabled) {
      updatePreferences({ reminderEnabled: false }).catch(() => {});
      return;
    }
    enableReminder({ reminderEnabled: true }).catch(() => {});
  }

  function toggleWater(enabled: boolean) {
    if (!enabled) {
      updatePreferences({ waterReminderEnabled: false }).catch(() => {});
      return;
    }
    enableReminder({ waterReminderEnabled: true }).catch(() => {});
  }

  const remindersOn =
    preferences.reminderEnabled || preferences.waterReminderEnabled;

  const reminderNotice = !remindersOn ? null : reminderPermission ===
    'unavailable' ? (
    <Card style={styles.stack}>
      <Text style={styles.warningText}>
        This build cannot post notifications, so these reminders will not
        appear. Installing the latest Heft APK turns them on.
      </Text>
    </Card>
  ) : reminderPermission === 'denied' ? (
    <Card style={styles.stack}>
      <Text style={styles.warningText}>
        Android is blocking Heft notifications. The dashboard banner still works
        — allow notifications to get the timed reminders as well.
      </Text>
      <Button
        label="Open notification settings"
        variant="secondary"
        onPress={() => Linking.openSettings()}
      />
    </Card>
  ) : null;

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

            <Label>Water in Health Connect</Label>
            <Card style={styles.stack}>
              <Text style={styles.cardText}>
                {hasHydrationAccess(hydrationAccess)
                  ? hydrationAccess.canWrite
                    ? 'Water logged in Heft is written to Health Connect, and water logged by other apps is read back.'
                    : 'Reading water from Health Connect. Writing is not allowed, so new entries stay on this device.'
                  : 'Connect hydration to sync water with Health Connect. Until then, water stays on this device.'}
              </Text>
              {hasHydrationAccess(hydrationAccess) ? (
                <Button
                  label="Refresh water"
                  variant="secondary"
                  onPress={runSync}
                  disabled={busy}
                />
              ) : (
                <Button
                  label={busy ? 'Please wait…' : 'Connect water data'}
                  onPress={connectHydration}
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
              onValueChange={toggleWeighIn}
            />
          </View>

          {preferences.reminderEnabled ? (
            <>
              <View style={styles.unitRow}>
                {REPEATS.map((repeat) => {
                  const selected = preferences.reminderRepeat === repeat;
                  return (
                    <Pressable
                      key={repeat}
                      onPress={() =>
                        updatePreferences({ reminderRepeat: repeat })
                      }
                      style={[styles.unit, selected && styles.unitSelected]}>
                      <Text
                        style={[
                          styles.unitText,
                          selected && styles.unitTextSelected,
                        ]}>
                        {repeat === 'daily' ? 'Every day' : 'Once a week'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {preferences.reminderRepeat === 'weekly' ? (
                <View style={styles.weekRow}>
                  {WEEKDAYS.map((day) => {
                    const selected = preferences.reminderWeekday === day.value;
                    return (
                      <Pressable
                        key={day.value}
                        accessibilityLabel={day.long}
                        onPress={() =>
                          updatePreferences({ reminderWeekday: day.value })
                        }
                        style={[styles.dayChip, selected && styles.unitSelected]}>
                        <Text
                          style={[
                            styles.dayChipText,
                            selected && styles.unitTextSelected,
                          ]}>
                          {day.short}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <Pressable
                style={styles.timeButton}
                onPress={() => setActivePicker('weighIn')}>
                <Text style={styles.timeText}>
                  {clockTime(
                    preferences.reminderHour,
                    preferences.reminderMinute
                  )}
                </Text>
              </Pressable>
            </>
          ) : null}

          <Description>
            Heft posts a notification at this time, and the dashboard banner
            still reminds you if you have not logged a reading that day.
          </Description>
        </Card>

        <Label>Water reminder</Label>
        <Card style={styles.stack}>
          <View style={styles.switchRow}>
            <Text style={styles.cardText}>Remind me to drink water</Text>
            <Switch
              value={preferences.waterReminderEnabled}
              onValueChange={toggleWater}
            />
          </View>

          {preferences.waterReminderEnabled ? (
            <>
              <View style={styles.switchRow}>
                <Text style={styles.cardText}>First at</Text>
                <Pressable
                  style={styles.timeButton}
                  onPress={() => setActivePicker('waterStart')}>
                  <Text style={styles.timeText}>
                    {clockTime(preferences.waterStartHour)}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.cardText}>Last at</Text>
                <Pressable
                  style={styles.timeButton}
                  onPress={() => setActivePicker('waterEnd')}>
                  <Text style={styles.timeText}>
                    {clockTime(preferences.waterEndHour)}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.unitRow}>
                {WATER_INTERVALS.map((hours) => {
                  const selected = preferences.waterIntervalHours === hours;
                  return (
                    <Pressable
                      key={hours}
                      onPress={() =>
                        updatePreferences({ waterIntervalHours: hours })
                      }
                      style={[styles.unit, selected && styles.unitSelected]}>
                      <Text
                        style={[
                          styles.unitText,
                          selected && styles.unitTextSelected,
                        ]}>
                        {hours}h
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.cardText}>
                {describeWaterWindow(pickReminderSettings(preferences))}
              </Text>
            </>
          ) : null}

          <Description>
            Silent notifications spaced across the day. They are scheduled on
            this device and nothing about them leaves the phone.
          </Description>
        </Card>

        <Label>Water goal</Label>
        <View style={styles.unitRow}>
          {WATER_TARGET_PRESETS_ML.map((ml) => {
            const selected = preferences.waterTargetMl === ml;
            return (
              <Pressable
                key={ml}
                onPress={() => updatePreferences({ waterTargetMl: ml })}
                style={[
                  styles.unit,
                  styles.goalChip,
                  selected && styles.unitSelected,
                ]}>
                <Text
                  style={[
                    styles.unitText,
                    selected && styles.unitTextSelected,
                  ]}>
                  {formatVolume(ml)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {reminderNotice}

        {activePicker ? (
          <DateTimePicker
            value={pickerTimes[activePicker]}
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
            Heft has no account and no server of ours. In local mode your
            measurements and water entries stay on this device; in Health
            Connect mode they are read from and written to the Android Health
            Connect app under your control. The only network request Heft makes
            is the update check, which carries nothing you entered.
          </Text>
          <Button
            label="Delete all data"
            variant="danger"
            onPress={confirmClear}
          />
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {appVersion ? `Heft ${appVersion}` : 'Heft'}
          </Text>
          <Text style={styles.footerText}>·</Text>
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() =>
              Linking.openURL(REPOSITORY_URL).catch(() => undefined)
            }>
            <Text style={styles.footerLink}>GitHub</Text>
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
  // Four goal chips share one row, so they need less inner padding than the
  // two-chip unit row to keep "2.5 L" on one line.
  goalChip: { paddingHorizontal: Spacing.two },
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
  weekRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  dayChip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
  },
  dayChipText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  warningText: { color: Colors.warning, lineHeight: 21 },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
