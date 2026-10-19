import { useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { Button, Card, Label, Screen, Title } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  dayKeyOffset,
  localDayKey,
} from '@/features/activity/activityCalculations';
import {
  NO_HYDRATION_PERMISSIONS,
  getHydrationPermissionState,
  hasHydrationAccess,
  requestAllHealthPermissions,
  type HydrationPermissionState,
} from '@/features/health-connect/healthConnectPermissions';
import { syncHealthConnect } from '@/features/health-connect/weightSync';
import { usePreferences } from '@/features/settings/preferences';
import type { WaterEntry } from '@/features/water/types';
import {
  averageMl,
  dailyTotals,
  formatVolume,
  progressRatio,
  summarizeWater,
} from '@/features/water/waterCalculations';
import { getWaterRepository } from '@/features/water/waterRepository';
import { formatShortDate, formatTime } from '@/lib/format';

type Period = 'today' | 'week' | 'all';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'all', label: 'All time' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Height of the bar area, in points. Kept in one place so scaling matches. */
const CHART_HEIGHT = 96;

function weekdayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime()) ? day : WEEKDAYS[date.getDay()];
}

function dayTitle(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === dayKeyOffset(new Date(), 1)) return 'Yesterday';
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  const label = formatShortDate(`${day}T12:00:00`);
  return date.getFullYear() === new Date().getFullYear()
    ? label
    : `${label} ${date.getFullYear()}`;
}

type DayGroup = {
  day: string;
  totalMl: number;
  entries: WaterEntry[];
};

/**
 * Water insights. Totals and the log are read through the same
 * `WaterRepository` route as the dashboard and widget: SQLite in local-only
 * mode, Health Connect (with its cache) when that mode is selected. Revoked
 * access is surfaced as a reconnect prompt rather than silently switching
 * sources.
 */
export default function WaterScreen() {
  const { preferences } = usePreferences();
  const { fontScale, width } = useWindowDimensions();
  const repository = getWaterRepository(preferences.storageMode);
  const isHealthConnect = preferences.storageMode === 'health-connect';
  const stackStats = width < 340 || fontScale >= 1.29;

  const [entries, setEntries] = useState<WaterEntry[]>([]);
  const [access, setAccess] = useState<HydrationPermissionState>(
    NO_HYDRATION_PERMISSIONS
  );
  const [period, setPeriod] = useState<Period>('today');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [rows, hydration] = await Promise.all([
      repository.listWater(),
      isHealthConnect
        ? getHydrationPermissionState()
        : Promise.resolve(NO_HYDRATION_PERMISSIONS),
    ]);
    setEntries(rows);
    setAccess(hydration);
  }, [isHealthConnect, repository]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        // Non-fatal; the screen renders whatever is available.
      });
    }, [load])
  );

  const today = localDayKey(new Date());
  const goalMl = preferences.waterTargetMl;
  const summary = useMemo(() => summarizeWater(entries), [entries]);
  const week = useMemo(() => dailyTotals(entries, 7), [entries]);
  const monthAverage = useMemo(
    () => averageMl(dailyTotals(entries, 30)),
    [entries]
  );
  const allTimeMl = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.volumeMl, 0),
    [entries]
  );
  const pendingCount = entries.filter((entry) => entry.pending).length;
  const hydrated = hasHydrationAccess(access);
  const ratio = progressRatio(summary.todayMl, goalMl);
  const remaining = Math.max(0, goalMl - summary.todayMl);
  // A little headroom above the goal keeps the goal marker visible.
  const chartMax = Math.max(
    goalMl * 1.15,
    ...week.map((day) => day.totalMl),
    1
  );

  const groups = useMemo<DayGroup[]>(() => {
    const byDay = new Map<string, WaterEntry[]>();
    for (const entry of entries) {
      const key = localDayKey(new Date(entry.loggedAt));
      const list = byDay.get(key);
      if (list) {
        list.push(entry);
      } else {
        byDay.set(key, [entry]);
      }
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([day, list]) => ({
        day,
        totalMl: list.reduce((sum, entry) => sum + entry.volumeMl, 0),
        entries: [...list].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt)),
      }));
  }, [entries]);

  const visibleGroups = useMemo(() => {
    if (period === 'all') return groups;
    const keys = new Set(
      dailyTotals(entries, period === 'today' ? 1 : 7).map((day) => day.day)
    );
    return groups.filter((group) => keys.has(group.day));
  }, [entries, groups, period]);

  async function reconnect() {
    setBusy(true);
    try {
      const next = await requestAllHealthPermissions();
      setAccess(next.hydration);
      if (!hasHydrationAccess(next.hydration)) {
        Alert.alert(
          'No water access',
          'Heft needs access to hydration in Health Connect. You can grant it in Health Connect settings.'
        );
        return;
      }
      await syncHealthConnect();
      await load();
    } catch {
      Alert.alert(
        'Could not reconnect',
        'Health Connect did not respond. Your water is still saved on this device.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const result = await syncHealthConnect();
      await load();
      if (result.status === 'skipped') {
        Alert.alert('Nothing to sync', 'Health Connect is not ready right now.');
      } else if (result.waterFailed > 0) {
        Alert.alert(
          'Still waiting',
          `${result.waterFailed} water ${
            result.waterFailed === 1 ? 'entry' : 'entries'
          } could not be saved yet. Heft will retry.`
        );
      }
    } catch {
      Alert.alert(
        'Could not sync',
        'Health Connect did not respond. Waiting entries are safe on this device.'
      );
    } finally {
      setBusy(false);
    }
  }

  const emptyMessage =
    period === 'today'
      ? 'No water logged yet today.'
      : period === 'week'
        ? 'No water logged in the last 7 days.'
        : 'No water logged yet.';

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Water</Title>

        <Label>Today</Label>
        <Card style={styles.card}>
          <View style={styles.todayHeader}>
            <View style={styles.todayText}>
              <Text style={styles.todayValue}>
                {formatVolume(summary.todayMl)}
              </Text>
              <Text style={styles.todayGoal}>of {formatVolume(goalMl)} goal</Text>
            </View>
            <Text style={styles.todayPercent}>
              {Math.round(ratio * 100)}%
            </Text>
          </View>

          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Water progress today"
            accessibilityValue={{
              min: 0,
              max: goalMl,
              now: Math.min(summary.todayMl, goalMl),
            }}
            style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(ratio * 100)}%` },
              ]}
            />
          </View>

          <Text style={styles.todayHint}>
            {remaining <= 0
              ? 'Daily goal reached. Nice work.'
              : `${formatVolume(remaining)} to go today.`}
          </Text>
          <Text style={styles.source}>
            {isHealthConnect
              ? hydrated
                ? 'Today is read from Health Connect. The total resets at midnight.'
                : 'Health Connect water access is off. The total still resets at midnight.'
              : 'Saved on this device only. The total resets at midnight.'}
          </Text>
        </Card>

        {isHealthConnect && !hydrated ? (
          <Card style={[styles.card, styles.warningCard]}>
            <Text style={styles.warningTitle}>
              Health Connect access is off
            </Text>
            <Text style={styles.warningBody}>
              Your existing water stays visible. Reconnect to read new entries
              and upload anything waiting.
            </Text>
            <Button
              label={busy ? 'Please wait…' : 'Reconnect Health Connect'}
              onPress={reconnect}
              loading={busy}
              disabled={busy}
            />
          </Card>
        ) : null}

        {pendingCount > 0 ? (
          <Card style={[styles.card, styles.warningCard]}>
            <Text style={styles.warningTitle}>
              {pendingCount} {pendingCount === 1 ? 'entry is' : 'entries are'}{' '}
              waiting to sync
            </Text>
            <Text style={styles.warningBody}>
              They are saved on this device and will upload when Health Connect
              is reachable.
            </Text>
            {hydrated ? (
              <Button
                label={busy ? 'Syncing…' : 'Sync now'}
                variant="secondary"
                onPress={syncNow}
                loading={busy}
                disabled={busy}
              />
            ) : null}
          </Card>
        ) : null}

        <View style={[styles.statRow, stackStats && styles.statRowStacked]}>
          <Card style={[styles.statCard, stackStats && styles.statCardStacked]}>
            <Text style={styles.statLabel}>7-day average</Text>
            <Text style={styles.statValue}>
              {summary.averageMl7d === null
                ? '--'
                : formatVolume(summary.averageMl7d)}
            </Text>
            <Text style={styles.statMeta}>
              {summary.daysTracked7d}{' '}
              {summary.daysTracked7d === 1 ? 'day' : 'days'} logged
            </Text>
          </Card>
          <Card style={[styles.statCard, stackStats && styles.statCardStacked]}>
            <Text style={styles.statLabel}>30-day average</Text>
            <Text style={styles.statValue}>
              {monthAverage === null ? '--' : formatVolume(monthAverage)}
            </Text>
            <Text style={styles.statMeta}>
              All-time {formatVolume(allTimeMl)}
            </Text>
          </Card>
        </View>

        <Label>Last 7 days</Label>
        <Card style={styles.card}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Daily intake</Text>
            <Text style={styles.chartGoal}>Goal {formatVolume(goalMl)}</Text>
          </View>

          <View style={styles.chart}>
            {week.map((day) => {
              const barHeight = Math.max(
                2,
                Math.round((day.totalMl / chartMax) * CHART_HEIGHT)
              );
              const isToday = day.day === today;
              return (
                <View
                  key={day.day}
                  accessible
                  accessibilityLabel={`${weekdayLabel(day.day)}: ${formatVolume(
                    day.totalMl
                  )}`}
                  style={styles.chartColumn}>
                  <Text style={styles.chartValue} maxFontSizeMultiplier={1.3}>
                    {day.totalMl > 0 ? formatVolume(day.totalMl) : ''}
                  </Text>
                  <View style={styles.chartTrack}>
                    <View
                      style={[
                        styles.chartBar,
                        isToday && styles.chartBarToday,
                        { height: barHeight },
                      ]}
                    />
                    <View
                      style={[
                        styles.goalTick,
                        {
                          bottom: `${Math.min(
                            97,
                            (goalMl / chartMax) * 100
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[styles.chartDay, isToday && styles.chartDayToday]}
                    maxFontSizeMultiplier={1.3}>
                    {weekdayLabel(day.day)}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.chartNote}>
            {summary.averageMl7d === null
              ? 'No water logged in the last 7 days yet.'
              : `The faint line marks your ${formatVolume(goalMl)} goal.`}
          </Text>
        </Card>

        <Label>Log</Label>
        <Card style={styles.card}>
          <View style={styles.periodRow}>
            {PERIODS.map((option) => {
              const selected = period === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setPeriod(option.key)}
                  style={[
                    styles.periodChip,
                    selected && styles.periodChipSelected,
                  ]}>
                  <Text
                    style={[
                      styles.periodText,
                      selected && styles.periodTextSelected,
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {visibleGroups.length === 0 ? (
            <Text style={styles.empty}>{emptyMessage}</Text>
          ) : (
            visibleGroups.map((group) => (
              <View key={group.day} style={styles.dayGroup}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayTitle}>
                    {dayTitle(group.day, today)}
                  </Text>
                  <Text style={styles.dayTotal}>
                    {formatVolume(group.totalMl)}
                  </Text>
                </View>

                {group.entries.map((entry) => (
                  <View key={entry.id} style={styles.entryRow}>
                    <View style={styles.entryMain}>
                      <Text style={styles.entryTime}>
                        {formatTime(entry.loggedAt)}
                      </Text>
                      {entry.pending ? (
                        <Text style={styles.pendingBadge}>
                          Waiting to sync
                        </Text>
                      ) : null}
                      {entry.source === 'health-connect' && !entry.owned ? (
                        <Text style={styles.sourceBadge}>Health Connect</Text>
                      ) : null}
                    </View>
                    <Text style={styles.entryAmount}>
                      {formatVolume(entry.volumeMl)}
                    </Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </Card>
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
  card: { gap: Spacing.two },
  todayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  todayText: { flexShrink: 1 },
  todayValue: {
    color: Colors.brand,
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 46,
  },
  todayGoal: { color: Colors.textSecondary, fontSize: 14 },
  todayPercent: {
    color: Colors.brandDark,
    fontSize: 20,
    fontWeight: '800',
  },
  track: {
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.brandTint,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.brand,
  },
  todayHint: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  source: { color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  warningCard: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warningTint,
  },
  warningTitle: {
    color: Colors.warning,
    fontSize: 15,
    fontWeight: '700',
  },
  warningBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  statRow: { flexDirection: 'row', gap: Spacing.two },
  statRowStacked: { flexDirection: 'column' },
  statCard: { flex: 1, flexBasis: 0, gap: 2 },
  statCardStacked: { flexBasis: 'auto' },
  statLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
  statValue: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  statMeta: { color: Colors.textMuted, fontSize: 11, lineHeight: 15 },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  chartTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  chartGoal: { color: Colors.textMuted, fontSize: 12 },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  chartColumn: { flex: 1, alignItems: 'center', gap: 2 },
  chartValue: {
    color: Colors.textMuted,
    fontSize: 9,
    lineHeight: 12,
    height: 12,
  },
  chartTrack: {
    width: '100%',
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
    borderRadius: Radius.sm,
    backgroundColor: Colors.brandTint,
    overflow: 'hidden',
  },
  chartBar: {
    width: '100%',
    borderTopLeftRadius: Radius.sm,
    borderTopRightRadius: Radius.sm,
    backgroundColor: Colors.brand,
  },
  chartBarToday: { backgroundColor: Colors.brandDark },
  goalTick: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.textMuted,
    opacity: 0.5,
  },
  chartDay: { color: Colors.textMuted, fontSize: 10, lineHeight: 14 },
  chartDayToday: { color: Colors.brandDark, fontWeight: '700' },
  chartNote: {
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  periodRow: { flexDirection: 'row', gap: Spacing.one },
  periodChip: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    backgroundColor: Colors.surface,
  },
  periodChipSelected: {
    borderColor: Colors.brand,
    backgroundColor: Colors.brandTint,
  },
  periodText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  periodTextSelected: { color: Colors.brand, fontWeight: '700' },
  empty: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    paddingVertical: Spacing.two,
  },
  dayGroup: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  dayTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  dayTotal: { color: Colors.brandDark, fontSize: 14, fontWeight: '700' },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  entryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  entryTime: { color: Colors.textSecondary, fontSize: 13 },
  entryAmount: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  pendingBadge: {
    color: Colors.warning,
    backgroundColor: Colors.warningTint,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  sourceBadge: {
    color: Colors.brandDark,
    backgroundColor: Colors.brandTint,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    fontSize: 10,
    fontWeight: '700',
  },
});
