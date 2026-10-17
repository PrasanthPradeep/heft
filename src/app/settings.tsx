import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Card, Description, Label, Screen, Title } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { countPendingMeasurements } from '@/features/measurements/repository';
import { usePreferences } from '@/features/settings/preferences';
import { syncPendingMeasurements } from '@/features/sync/sync';
import { useAuth } from '@/features/sync/useAuth';
import { isSupabaseConfigured, requireSupabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const { profile, profileId, profiles, setProfileId } = usePreferences();
  const { session, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  const configured = isSupabaseConfigured();

  useFocusEffect(
    useCallback(() => {
      countPendingMeasurements().then(setPending).catch(() => {});
    }, [])
  );

  async function runSync() {
    setBusy(true);
    try {
      const summary = await syncPendingMeasurements();
      if (summary.skipped) {
        Alert.alert(
          'Sync unavailable',
          summary.reason === 'unauthenticated'
            ? 'Sign in to sync your readings.'
            : 'Supabase is not configured in this build.'
        );
      } else {
        Alert.alert(
          'Sync complete',
          `${summary.pushed} pushed, ${summary.failed} failed.`
        );
        setPending(await countPendingMeasurements());
      }
    } finally {
      setBusy(false);
    }
  }

  async function signIn(mode: 'signIn' | 'signUp') {
    if (!email || !password) {
      Alert.alert('Missing details', 'Enter an email and password.');
      return;
    }
    setBusy(true);
    try {
      const client = requireSupabase();
      const { error } =
        mode === 'signIn'
          ? await client.auth.signInWithPassword({ email, password })
          : await client.auth.signUp({ email, password });
      if (error) {
        Alert.alert('Authentication failed', error.message);
      } else {
        setEmail('');
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.container}>
        <Title>Settings</Title>

        <Label>Scale profile</Label>
        <Description>
          Each scale has its own display resolution. Pick the profile that
          matches your scale so readings validate correctly.
        </Description>
        <View style={styles.profileList}>
          {profiles.map((item) => {
            const selected = item.id === profileId;
            return (
              <Pressable
                key={item.id}
                onPress={() => setProfileId(item.id)}
                style={[styles.profile, selected && styles.profileSelected]}>
                <Text
                  style={[
                    styles.profileText,
                    selected && styles.profileTextSelected,
                  ]}>
                  {item.name}
                </Text>
                <Text style={styles.profileMeta}>
                  {item.minKg}–{item.maxKg} kg · step {item.graduationKg} kg
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.currentProfile}>
          Active: {profile.name}
        </Text>

        <Label>Cloud sync</Label>
        {!configured ? (
          <Card>
            <Text style={styles.cardTitle}>Backend not configured</Text>
            <Text style={styles.cardText}>
              Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to a
              .env file and rebuild to enable sync. Local storage works without
              it.
            </Text>
          </Card>
        ) : !ready ? (
          <Text style={styles.cardText}>Checking session…</Text>
        ) : session ? (
          <Card style={styles.stack}>
            <Text style={styles.cardTitle}>Signed in</Text>
            <Text style={styles.cardText}>{session.user.email}</Text>
            <Text style={styles.cardText}>
              {pending} reading{pending === 1 ? '' : 's'} waiting to sync
            </Text>
            <Button
              label={busy ? 'Syncing…' : 'Sync now'}
              onPress={runSync}
              loading={busy}
              disabled={busy}
            />
            <Button
              label="Sign out"
              variant="secondary"
              onPress={() => requireSupabase().auth.signOut()}
            />
          </Card>
        ) : (
          <Card style={styles.stack}>
            <Text style={styles.cardTitle}>Sign in to sync</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              style={styles.input}
            />
            <Button
              label={busy ? 'Please wait…' : 'Sign in'}
              onPress={() => signIn('signIn')}
              loading={busy}
              disabled={busy}
            />
            <Button
              label="Create account"
              variant="secondary"
              onPress={() => signIn('signUp')}
              disabled={busy}
            />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.six },
  profileList: { gap: Spacing.two, marginTop: Spacing.two },
  profile: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    backgroundColor: Colors.surface,
    gap: 2,
  },
  profileSelected: {
    borderColor: Colors.brand,
    backgroundColor: Colors.brandTint,
  },
  profileText: { fontSize: 16, fontWeight: '600', color: Colors.text },
  profileTextSelected: { color: Colors.brand },
  profileMeta: { color: Colors.textSecondary, fontSize: 13 },
  currentProfile: {
    color: Colors.textMuted,
    fontSize: 13,
    marginBottom: Spacing.two,
  },
  stack: { gap: Spacing.two },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  cardText: { color: Colors.textSecondary, lineHeight: 21 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.three,
    backgroundColor: Colors.surface,
  },
});
