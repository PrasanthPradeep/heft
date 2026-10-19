import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Card, Screen } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDateTime, formatWeight } from '@/lib/format';
import { localDayKey } from '@/features/activity/activityCalculations';
import { syncHealthConnect } from '@/features/health-connect/weightSync';
import {
  getHydrationPermissionState,
  hasHydrationAccess,
  NO_HYDRATION_PERMISSIONS,
  type HydrationPermissionState,
} from '@/features/health-connect/healthConnectPermissions';
import { usePreferences } from '@/features/settings/preferences';
import { shouldRemindWeighIn } from '@/features/analytics/trendCalculations';
import {
  BOTTLE_ML,
  GLASS_ML,
  entriesForDay,
  formatVolume,
  progressRatio,
  summarizeWater,
} from '@/features/water/waterCalculations';
import { getWaterRepository } from '@/features/water/waterRepository';
import type { WaterEntry } from '@/features/water/types';
import type { WeightEntry } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';
import { refreshHydrationWidget } from '@/features/widget/HeftWidget';

const RECENT_LIMIT = 5;

export default function HomeScreen() {
  const { preferences } = usePreferences();
  const isHealthConnect = preferences.storageMode === 'health-connect';
  const unit = preferences.weightUnit;

  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [water, setWater] = useState<WaterEntry[]>([]);
  const [hydrationAccess, setHydrationAccess] =
    useState<HydrationPermissionState>(NO_HYDRATION_PERMISSIONS);
  const [waterBusy, setWaterBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [recentTop, setRecentTop] = useState(0);
  const [recentHeaderHeight, setRecentHeaderHeight] = useState(0);
  const [recentRowHeight, setRecentRowHeight] = useState(0);

  const repository = getWeightRepository(preferences.storageMode);
  const waterRepository = getWaterRepository(preferences.storageMode);

  const load = useCallback(async () => {
    const [rows, waterRows, access] = await Promise.all([
      repository.listWeights(),
      waterRepository.listWater(),
      isHealthConnect
        ? getHydrationPermissionState()
        : Promise.resolve(NO_HYDRATION_PERMISSIONS),
    ]);
    setEntries(rows);
    setWater(waterRows);
    setHydrationAccess(access);
    setError(null);
  }, [repository, waterRepository, isHealthConnect]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        setError('Could not load your data.');
      });
    }, [load])
  );

  async function refresh() {
    setRefreshing(true);
    try {
      if (isHealthConnect) {
        await syncHealthConnect().catch(() => {
          // Surfaced through the pending count / Settings.
        });
      }
      await load();
    } catch {
      setError('Could not refresh your data.');
    } finally {
      setRefreshing(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await syncHealthConnect();
      await load();

      if (result.status === 'skipped') {
        const messages: Record<string, string> = {
          unavailable: 'Health Connect is not available right now.',
          'update-required': 'The Health Connect app needs an update.',
          'no-permissions': 'Health Connect access was not granted.',
          'local-mode': 'You are using local storage.',
        };
        Alert.alert(
          'Nothing to sync',
          (result.reason && messages[result.reason]) ??
            'Health Connect is not ready right now.'
        );
      } else if (result.failed > 0 || result.waterFailed > 0) {
        Alert.alert(
          'Partly synced',
          `${result.written + result.waterWritten} saved, ${
            result.failed + result.waterFailed
          } still waiting. Heft will retry later.`
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
        Alert.alert(
          'Synced',
          bits.length > 0 ? bits.join(' · ') : 'Everything is up to date.'
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  async function addWater(volumeMl: number) {
    setWaterBusy(true);
    try {
      await waterRepository.addWater({ volumeMl });
      await load();
      refreshHydrationWidget();
    } catch (error) {
      Alert.alert(
        'Could not save',
        error instanceof Error ? error.message : 'Try again.'
      );
    } finally {
      setWaterBusy(false);
    }
  }

  async function undoWater(id: string) {
    setWaterBusy(true);
    try {
      await waterRepository.deleteWater(id);
      await load();
      refreshHydrationWidget();
    } catch (error) {
      Alert.alert(
        'Could not remove',
        error instanceof Error ? error.message : 'Try again.'
      );
    } finally {
      setWaterBusy(false);
    }
  }

  const latest = entries[0] ?? null;
  const pendingCount = entries.filter((entry) => entry.pending).length;
  const showReminder = shouldRemindWeighIn(entries, preferences);
  const roomForRecent = Math.max(0, viewportHeight - recentTop - recentHeaderHeight);
  const visibleRecentCount =
    recentRowHeight > 0
      ? Math.min(
          RECENT_LIMIT,
          Math.floor(roomForRecent / (recentRowHeight + Spacing.two))
        )
      : 1;
  const recent = entries.slice(0, visibleRecentCount);

  const today = localDayKey(new Date());
  const waterSummary = summarizeWater(water);
  const todayWater = entriesForDay(water, today);
  // Entries arrive newest-first, so the first owned one today is the last thing
  // the user added and the only sensible target for Undo.
  const lastWaterToday = todayWater.find((entry) => entry.owned);
  const pendingWater = water.filter((entry) => entry.pending).length;

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View insights"
          testID="latest-weight-card"
          onPress={() => router.push('/insights')}
          style={({ pressed }) => [pressed && styles.summaryPressed]}>
          <Card style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <Text style={styles.summaryLabel}>Latest weight</Text>
              {isHealthConnect ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sync with Health Connect"
                  onPress={(event) => {
                    event.stopPropagation();
                    syncNow();
                  }}
                  disabled={syncing}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.summarySync,
                    pressed && styles.summarySyncPressed,
                  ]}>
                  <Text style={styles.summarySyncText}>
                    {syncing ? 'Syncing…' : '↻ Sync'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.summaryValue}>
              {latest ? formatWeight(latest.weightKg, unit) : '--.--'}
              <Text style={styles.summaryUnit}> {unit}</Text>
            </Text>
            <Text style={styles.summaryMeta}>
              {latest
                ? `${formatDateTime(latest.measuredAt)} · ${
                    latest.source === 'health-connect' ? 'Health Connect' : 'Heft'
                  }`
                : 'No measurements yet'}
            </Text>
            {pendingCount > 0 ? (
              <Text style={styles.summaryPending}>
                {pendingCount} measurement{pendingCount === 1 ? '' : 's'}{' '}
                waiting to sync
              </Text>
            ) : null}
            <View style={styles.summaryHint}>
              <Text style={styles.summaryHintText}>View insights</Text>
              <Text style={styles.summaryChevron}>›</Text>
            </View>
          </Card>
        </Pressable>

        <View style={styles.actions}>
          <Button
            label="Add weight"
            onPress={() => router.push('/add-weight')}
            style={styles.flex}
          />
          <Button
            label="Assistant"
            variant="secondary"
            onPress={() => router.push('/assistant')}
            style={styles.flex}
          />
        </View>

        {showReminder ? (
          <Text style={styles.reminder}>
            You have not logged a weight today. Add one when you get a moment.
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Water, ${formatVolume(
            waterSummary.todayMl
          )} today. Open water insights.`}
          accessibilityHint="Shows today's log, history, and trends"
          onPress={() => router.push('/water')}
          style={({ pressed }) => [pressed && styles.waterPressed]}>
          <Card style={styles.waterCard}>
            <View style={styles.waterHeader}>
              <View style={styles.waterHeading}>
                <Text style={styles.waterTitle}>Water</Text>
                <Text style={styles.waterMeta}>
                  Today · Goal {formatVolume(preferences.waterTargetMl)}
                </Text>
              </View>
              <Text style={styles.waterValue}>
                {formatVolume(waterSummary.todayMl)}
              </Text>
            </View>

            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Water progress today"
              accessibilityValue={{
                min: 0,
                max: preferences.waterTargetMl,
                now: Math.min(waterSummary.todayMl, preferences.waterTargetMl),
              }}
              style={styles.waterTrack}>
              <View
                style={[
                  styles.waterFill,
                  {
                    width: `${Math.round(
                      progressRatio(
                        waterSummary.todayMl,
                        preferences.waterTargetMl
                      ) * 100
                    )}%`,
                  },
                ]}
              />
            </View>

            <View style={styles.waterActions}>
              <Button
                label={`+${GLASS_ML} ml`}
                variant="secondary"
                onPress={() => addWater(GLASS_ML)}
                disabled={waterBusy}
                style={styles.flex}
              />
              <Button
                label={`+${BOTTLE_ML} ml`}
                variant="secondary"
                onPress={() => addWater(BOTTLE_ML)}
                disabled={waterBusy}
                style={styles.flex}
              />
            </View>

            <View style={styles.waterFooter}>
              <Text style={styles.waterHint}>
                {waterSummary.averageMl7d !== null
                  ? `7-day average ${formatVolume(waterSummary.averageMl7d)}`
                  : 'No water logged yet'}
              </Text>
              {lastWaterToday ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove the last water entry"
                  hitSlop={8}
                  onPress={() => undoWater(lastWaterToday.id)}>
                  <Text style={styles.waterUndo}>Undo</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.waterInsightsRow}>
              <Text style={styles.waterInsightsText}>Water insights</Text>
              <Text style={styles.waterInsightsChevron}>›</Text>
            </View>

            {isHealthConnect && !hydrationAccess.canWrite ? (
              <Text style={styles.waterHint}>
                {hasHydrationAccess(hydrationAccess)
                  ? 'Health Connect write access is off, so new entries stay on this device.'
                  : 'Water stays on this device until you connect it in Settings.'}
              </Text>
            ) : null}

            {isHealthConnect && hydrationAccess.canWrite && pendingWater > 0 ? (
              <Text style={styles.waterHint}>
                {pendingWater} water {pendingWater === 1 ? 'entry' : 'entries'}{' '}
                waiting to sync.
              </Text>
            ) : null}
          </Card>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View
          style={styles.sectionHeader}
          onLayout={(event) => {
            setRecentTop(event.nativeEvent.layout.y);
            setRecentHeaderHeight(event.nativeEvent.layout.height);
          }}>
          <Text style={styles.sectionTitle}>Recent</Text>
          <Text
            style={styles.sectionLink}
            accessibilityRole="button"
            onPress={() => router.push('/history')}>
            History ›
          </Text>
        </View>

        {recent.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>No measurements yet</Text>
            <Text style={styles.emptyText}>
              Add your first reading to start tracking your weight.
            </Text>
          </Card>
        ) : (
          recent.map((entry, index) => (
            <View
              key={entry.id}
              onLayout={
                index === 0
                  ? (event) =>
                      setRecentRowHeight(event.nativeEvent.layout.height)
                  : undefined
              }>
              <Card style={styles.entry}>
                <View style={styles.entryMain}>
                  <Text style={styles.entryWeight}>
                    {formatWeight(entry.weightKg, unit)} {unit}
                  </Text>
                  <Text style={styles.entryDate}>
                    {formatDateTime(entry.measuredAt)}
                  </Text>
                </View>
                <View style={styles.badges}>
                  <Text style={styles.badge}>
                    {entry.pending
                      ? 'NOT SYNCED'
                      : entry.owned
                        ? 'HEFT'
                        : 'HEALTH CONNECT'}
                  </Text>
                </View>
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
  summaryCard: {
    backgroundColor: Colors.brand,
    borderColor: Colors.brand,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  summarySync: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  summarySyncPressed: { opacity: 0.65 },
  summarySyncText: {
    color: Colors.surface,
    fontSize: 12,
    fontWeight: '700',
  },
  summaryPending: {
    color: Colors.accentOnBrand,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryLabel: {
    color: Colors.accentOnBrand,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: Colors.surface,
    fontSize: 44,
    fontWeight: '800',
  },
  // The 20px unit can keep the richer mint: bold text at >=18.66px is "large"
  // under WCAG, where 3:1 is the bar and mint gives 3.37. Everything smaller on
  // this card uses accentOnBrand, which clears the 4.5:1 bar for small text.
  summaryUnit: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.accent,
  },
  summaryMeta: {
    color: Colors.accentOnBrand,
    fontSize: 14,
  },
  summaryPressed: {
    opacity: 0.85,
  },
  summaryHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  summaryHintText: {
    color: Colors.accentOnBrand,
    fontWeight: '700',
    fontSize: 14,
  },
  summaryChevron: {
    color: Colors.accentOnBrand,
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  flex: { flex: 1 },
  waterCard: { gap: Spacing.two },
  waterPressed: { opacity: 0.85 },
  waterHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  waterHeading: { gap: 2 },
  waterTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  waterMeta: { color: Colors.textSecondary, fontSize: 14 },
  waterValue: { fontSize: 28, fontWeight: '800', color: Colors.brand },
  waterTrack: {
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.brandTint,
    overflow: 'hidden',
  },
  waterFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.brand,
  },
  waterActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  waterFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  waterHint: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  waterUndo: { color: Colors.brand, fontWeight: '700', fontSize: 13 },
  waterInsightsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.two,
  },
  waterInsightsText: { color: Colors.brand, fontSize: 13, fontWeight: '700' },
  waterInsightsChevron: { color: Colors.brand, fontSize: 16, fontWeight: '700' },
  reminder: {
    color: Colors.warning,
    backgroundColor: Colors.warningTint,
    padding: Spacing.three,
    borderRadius: Radius.sm,
    fontSize: 13,
  },
  error: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.three,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  sectionLink: {
    color: Colors.brand,
    fontWeight: '700',
    fontSize: 15,
  },
  entry: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  entryMain: { flex: 1, gap: Spacing.one },
  entryWeight: { fontSize: 20, fontWeight: '700', color: Colors.text },
  entryDate: { color: Colors.textSecondary, fontSize: 14 },
  badges: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.one },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.brand,
    backgroundColor: Colors.brandTint,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.one,
  },
  emptyText: { color: Colors.textSecondary, lineHeight: 21 },
});
