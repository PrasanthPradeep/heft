import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Button, Card, Description, Screen, Title } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { usePreferences } from '@/features/settings/preferences';
import type { StorageMode } from '@/features/settings/types';
import {
  getHealthConnectStatus,
  requestAllHealthPermissions,
  type HealthConnectStatus,
} from '@/features/health-connect/healthConnectPermissions';

export default function OnboardingScreen() {
  const { updatePreferences } = usePreferences();
  const [status, setStatus] = useState<HealthConnectStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealthConnectStatus()
      .then(setStatus)
      .catch(() => setStatus('unavailable'));
  }, []);

  async function finish(mode: StorageMode) {
    await updatePreferences({ storageMode: mode, onboardingCompleted: true });
    router.replace('/');
  }

  async function chooseHealthConnect() {
    setError(null);
    setBusy(true);
    try {
      const current = status ?? (await getHealthConnectStatus());
      setStatus(current);

      if (current !== 'available') {
        setError(
          current === 'unsupported-platform'
            ? 'Health Connect is only available on Android.'
            : 'Health Connect is not available on this device. You can use local storage instead.'
        );
        return;
      }

      const permissions = await requestAllHealthPermissions();
      if (!permissions.weight.canRead && !permissions.weight.canWrite) {
        setError(
          'Health Connect permission was not granted. You can try again, or keep your history on this device only.'
        );
        return;
      }

      await finish('health-connect');
    } finally {
      setBusy(false);
    }
  }

  async function chooseLocal() {
    setError(null);
    setBusy(true);
    try {
      await finish('local');
    } finally {
      setBusy(false);
    }
  }

  const healthConnectAvailable = status === 'available';
  const statusLoading = status === null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Title>Welcome to Heft</Title>
        <Description>
          Heft tracks your body weight. Choose where your measurements live — you
          can change this later in Settings.
        </Description>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Use Health Connect</Text>
          <Text style={styles.cardBody}>
            Connect once to read your weight, height, steps, workouts, water, and
            full weight history, and to save the weight and water you add. You can
            allow or deny each data type in the Health Connect sheet. Heft keeps
            only settings and a small cache on this device.
          </Text>
          <Button
            label={busy ? 'Please wait…' : 'Connect Health Connect'}
            onPress={chooseHealthConnect}
            disabled={busy || statusLoading || !healthConnectAvailable}
            loading={busy && healthConnectAvailable}
          />
          {!statusLoading && !healthConnectAvailable ? (
            <Text style={styles.statusNote}>
              {status === 'unsupported-platform'
                ? 'Not available on this platform.'
                : status === 'update-required'
                  ? 'The Health Connect app needs an update on this device.'
                  : 'Health Connect is unavailable on this device.'}
            </Text>
          ) : null}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Use local storage only</Text>
          <Text style={styles.cardBody}>
            Keep your complete weight history on this device in a local database.
            No Health Connect permission and no account required.
          </Text>
          <Button
            label="Use local storage only"
            variant="secondary"
            onPress={chooseLocal}
            disabled={busy}
          />
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.privacy}>
          Heft works fully offline. Nothing is uploaded to a server, and there is
          no sign-in.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  card: { gap: Spacing.two, padding: Spacing.four },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  cardBody: { color: Colors.textSecondary, lineHeight: 21 },
  statusNote: { color: Colors.textMuted, fontSize: 13 },
  error: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.three,
  },
  privacy: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: Spacing.two,
  },
});
