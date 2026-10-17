import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Screen } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDateTime, formatWeight } from '@/lib/format';
import { usePreferences } from '@/features/settings/preferences';
import type { WeightEntry } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';

export default function HistoryScreen() {
  const { preferences } = usePreferences();
  const unit = preferences.weightUnit;
  const repository = getWeightRepository(preferences.storageMode);

  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await repository.listWeights();
    setEntries(rows);
    setError(null);
  }, [repository]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load your history.'));
    }, [load])
  );

  return (
    <Screen edges={['left', 'right']}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.count}>
              {entries.length} measurement{entries.length === 1 ? '' : 's'}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyText}>
              Add a reading and it will appear in this list.
            </Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Card style={styles.entry}>
            <View style={styles.entryMain}>
              <Text style={styles.entryWeight}>
                {formatWeight(item.weightKg, unit)} {unit}
              </Text>
              <Text style={styles.entryDate}>
                {formatDateTime(item.measuredAt)}
              </Text>
              {item.note ? (
                <Text style={styles.entryNote}>{item.note}</Text>
              ) : null}
              <View style={styles.badges}>
                <Text style={styles.badge}>
                  {item.pending
                    ? 'NOT SYNCED'
                    : item.owned
                      ? 'HEFT'
                      : 'HEALTH CONNECT'}
                </Text>
              </View>
            </View>

            {item.owned ? (
              <Button
                label="Edit"
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/add-weight', params: { id: item.id } })
                }
                style={styles.editButton}
              />
            ) : (
              <Text style={styles.readOnly}>Read-only</Text>
            )}
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
  header: { gap: Spacing.two, marginBottom: Spacing.two },
  count: { color: Colors.textSecondary, fontSize: 14 },
  entry: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  entryMain: { flex: 1, gap: Spacing.one },
  entryWeight: { fontSize: 20, fontWeight: '700', color: Colors.text },
  entryDate: { color: Colors.textSecondary, fontSize: 14 },
  entryNote: { color: Colors.textMuted, fontSize: 14, fontStyle: 'italic' },
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
  editButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  readOnly: {
    color: Colors.textMuted,
    fontSize: 13,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  error: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.two,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.one,
  },
  emptyText: { color: Colors.textSecondary, lineHeight: 21 },
});
