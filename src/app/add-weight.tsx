import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { Button, Card, Screen } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { usePreferences } from '@/features/settings/preferences';
import { WeightEntryForm } from '@/features/weight/WeightEntryForm';
import type { WeightEntry, WeightEntryInput } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';

export default function AddWeightScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { preferences } = usePreferences();
  const repository = getWeightRepository(preferences.storageMode);

  const [initial, setInitial] = useState<WeightEntry | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;

    repository
      .listWeights()
      .then((entries) => {
        if (!active) return;
        const match = entries.find((entry) => entry.id === id) ?? null;
        if (!match) setLoadError('This measurement no longer exists.');
        setInitial(match);
      })
      .catch(() => {
        if (active) setLoadError('Could not load this measurement.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, repository]);

  async function handleSubmit(input: WeightEntryInput) {
    if (id && initial) {
      await repository.updateWeight(id, input);
      router.back();
      return;
    }

    const entry = await repository.addWeight(input);

    if (entry.pending) {
      Alert.alert(
        'Saved on this device',
        'Health Connect was unreachable, so this reading is waiting to sync.'
      );
    }
    router.replace('/');
  }

  async function handleDelete() {
    if (!id) return;
    await repository.deleteWeight(id);
    router.back();
  }

  if (loading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: id ? 'Edit weight' : 'Add weight' }} />
        <ActivityIndicator style={styles.loader} />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen edges={['left', 'right']}>
        <Stack.Screen options={{ title: 'Edit weight' }} />
        <ScrollView contentContainerStyle={styles.content}>
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{loadError}</Text>
          </Card>
          <Button label="Go back" onPress={() => router.back()} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: id ? 'Edit weight' : 'Add weight' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <WeightEntryForm
          key={initial?.id ?? 'new'}
          initial={initial}
          submitLabel={id ? 'Save changes' : 'Save measurement'}
          onSubmit={handleSubmit}
          onDelete={id ? handleDelete : undefined}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
  },
  loader: { marginTop: Spacing.six },
  errorCard: { marginBottom: Spacing.three },
  errorText: { color: Colors.danger },
});
