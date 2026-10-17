import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Card, Screen } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { usePreferences } from '@/features/settings/preferences';
import {
  countPendingMeasurements,
  deleteMeasurement,
  listMeasurements,
} from '@/features/measurements/repository';
import type { Measurement } from '@/features/measurements/types';
import { formatDateTime, formatWeightKg } from '@/lib/format';

export default function HomeScreen() {
  const { profile } = usePreferences();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [rows, pendingCount] = await Promise.all([
      listMeasurements(),
      countPendingMeasurements(),
    ]);
    setMeasurements(rows);
    setPending(pendingCount);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        Alert.alert('Could not load history', 'Please try again.');
      });
    }, [load])
  );

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  function confirmDelete(entry: Measurement) {
    Alert.alert(
      'Delete reading?',
      `${formatWeightKg(entry.weightGrams)} kg from ${formatDateTime(
        entry.measuredAt
      )}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMeasurement(entry.id).then(load).catch(() => {
              Alert.alert('Could not delete', 'Please try again.');
            });
          },
        },
      ]
    );
  }

  const latest = measurements[0] ?? null;

  return (
    <Screen edges={['left', 'right']}>
      <FlatList
        data={measurements}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Latest weight</Text>
              <Text style={styles.summaryValue}>
                {latest ? formatWeightKg(latest.weightGrams) : '--.--'}
                <Text style={styles.summaryUnit}> kg</Text>
              </Text>
              <Text style={styles.summaryMeta}>
                {latest ? formatDateTime(latest.measuredAt) : 'No readings yet'}
              </Text>
            </Card>

            <View style={styles.actions}>
              <Button
                label="Scan scale"
                onPress={() => router.push('/scan')}
                style={styles.flex}
              />
              <Button
                label="Add manually"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/confirm-weight',
                    params: { source: 'manual' },
                  })
                }
                style={styles.flex}
              />
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaText}>Scale: {profile.name}</Text>
              <Text
                style={styles.metaLink}
                onPress={() => router.push('/settings')}>
                Settings
              </Text>
            </View>

            {pending > 0 && (
              <Text style={styles.pendingText}>
                {pending} reading{pending === 1 ? '' : 's'} waiting to sync
              </Text>
            )}

            <Text style={styles.sectionTitle}>History</Text>
          </View>
        }
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyTitle}>No measurements yet</Text>
            <Text style={styles.emptyText}>
              {
                "Scan your scale's display or add a reading manually to get started."
              }
            </Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Card style={styles.entry}>
            <View style={styles.entryMain}>
              <Text style={styles.entryWeight}>
                {formatWeightKg(item.weightGrams)} kg
              </Text>
              <Text style={styles.entryDate}>
                {formatDateTime(item.measuredAt)}
              </Text>
              {item.note ? (
                <Text style={styles.entryNote}>{item.note}</Text>
              ) : null}
              <View style={styles.badges}>
                <Text style={styles.badge}>{item.source.toUpperCase()}</Text>
                <Text style={styles.badge}>
                  {item.syncStatus === 'synced' ? 'SYNCED' : 'LOCAL'}
                </Text>
              </View>
            </View>
            <Text
              style={styles.deleteLink}
              onPress={() => confirmDelete(item)}>
              Delete
            </Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
  header: {
    gap: Spacing.three,
    marginBottom: Spacing.two,
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
  flex: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  metaLink: {
    color: Colors.brand,
    fontWeight: '700',
  },
  pendingText: {
    color: Colors.warning,
    backgroundColor: Colors.warningTint,
    padding: Spacing.two,
    borderRadius: Radius.sm,
    fontSize: 13,
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
  entryMain: {
    flex: 1,
    gap: Spacing.one,
  },
  entryWeight: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  entryDate: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  entryNote: {
    color: Colors.textMuted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  badges: {
    flexDirection: 'row',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
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
  deleteLink: {
    color: Colors.danger,
    fontWeight: '600',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.one,
  },
  emptyText: {
    color: Colors.textSecondary,
    lineHeight: 21,
  },
});
