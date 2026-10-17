import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Card, Screen } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDateTime, formatWeight } from '@/lib/format';
import { syncHealthConnect } from '@/features/health-connect/weightSync';
import { usePreferences } from '@/features/settings/preferences';
import { shouldRemindWeighIn } from '@/features/analytics/trendCalculations';
import type { WeightEntry } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';

const RECENT_LIMIT = 5;

export default function HomeScreen() {
  const { preferences } = usePreferences();
  const isHealthConnect = preferences.storageMode === 'health-connect';
  const unit = preferences.weightUnit;

  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repository = getWeightRepository(preferences.storageMode);

  const load = useCallback(async () => {
    const rows = await repository.listWeights();
    setEntries(rows);
    setError(null);
  }, [repository]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        setError('Could not load your measurements.');
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
      setError('Could not refresh your measurements.');
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
      } else if (result.failed > 0) {
        Alert.alert(
          'Partly synced',
          `${result.written} saved, ${result.failed} still waiting. Heft will retry later.`
        );
      } else {
        Alert.alert(
          'Synced',
          `${result.written} uploaded, ${result.imported} read from Health Connect.`
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  const latest = entries[0] ?? null;
  const pendingCount = entries.filter((entry) => entry.pending).length;
  const showReminder = shouldRemindWeighIn(entries, preferences);
  const recent = entries.slice(0, RECENT_LIMIT);

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Latest weight</Text>
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
        </Card>

        <View style={styles.actions}>
          <Button
            label="Add weight"
            onPress={() => router.push('/add-weight')}
            style={styles.flex}
          />
          <Button
            label="History"
            variant="secondary"
            onPress={() => router.push('/history')}
            style={styles.flex}
          />
        </View>

        <View style={styles.links}>
          <Text style={styles.link} onPress={() => router.push('/insights')}>
            Insights
          </Text>
          <Text style={styles.link} onPress={() => router.push('/settings')}>
            Settings
          </Text>
        </View>

        {showReminder ? (
          <Text style={styles.reminder}>
            You have not logged a weight today. Add one when you get a moment.
          </Text>
        ) : null}

        {isHealthConnect ? (
          <Card style={styles.syncCard}>
            <Text style={styles.syncTitle}>
              {pendingCount > 0
                ? `${pendingCount} measurement${pendingCount === 1 ? '' : 's'} waiting to sync`
                : 'Health Connect is your weight history'}
            </Text>
            <Text style={styles.syncBody}>
              {pendingCount > 0
                ? 'Heft could not reach Health Connect. Retry when you are online or the permission is restored.'
                : 'New readings are written to Health Connect. Pull down or tap Sync now to refresh.'}
            </Text>
            <Button
              label={syncing ? 'Syncing…' : 'Sync now'}
              variant={pendingCount > 0 ? 'primary' : 'secondary'}
              onPress={syncNow}
              loading={syncing}
              disabled={syncing}
            />
          </Card>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.sectionTitle}>Recent</Text>

        {recent.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>No measurements yet</Text>
            <Text style={styles.emptyText}>
              Add your first reading to start tracking your weight.
            </Text>
          </Card>
        ) : (
          recent.map((entry) => (
            <Card key={entry.id} style={styles.entry}>
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
          ))
        )}

        {entries.length > RECENT_LIMIT ? (
          <Button
            label="View all readings"
            variant="secondary"
            onPress={() => router.push('/history')}
          />
        ) : null}
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
  summaryLabel: {
    color: Colors.accent,
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
  summaryUnit: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.accent,
  },
  summaryMeta: {
    color: Colors.accent,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  flex: { flex: 1 },
  links: {
    flexDirection: 'row',
    gap: Spacing.four,
    paddingVertical: Spacing.one,
  },
  link: {
    color: Colors.brand,
    fontWeight: '700',
    fontSize: 15,
  },
  reminder: {
    color: Colors.warning,
    backgroundColor: Colors.warningTint,
    padding: Spacing.three,
    borderRadius: Radius.sm,
    fontSize: 13,
  },
  syncCard: { gap: Spacing.two },
  syncTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  syncBody: { color: Colors.textSecondary, lineHeight: 21 },
  error: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.three,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.two,
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
