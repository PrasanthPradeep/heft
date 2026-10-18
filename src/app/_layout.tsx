import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';

import { Colors } from '@/constants/theme';
import { syncHealthConnect } from '@/features/health-connect/weightSync';
import {
  PreferencesProvider,
  usePreferences,
} from '@/features/settings/preferences';

/** Sends first-time users to onboarding, and finished users away from it. */
function useOnboardingRedirect(ready: boolean, completed: boolean) {
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    const inOnboarding = segments[0] === 'onboarding';

    if (!completed && !inOnboarding) {
      router.replace('/onboarding');
    } else if (completed && inOnboarding) {
      router.replace('/');
    }
  }, [ready, completed, segments]);
}

/**
 * Runs the Health Connect sync once per app launch when that mode is active.
 * Synchronisation failures are non-fatal; the UI reads whatever is cached.
 */
function useLaunchSync(ready: boolean, storageMode: string) {
  const hasSynced = useRef(false);

  useEffect(() => {
    if (!ready || hasSynced.current) return;
    if (storageMode !== 'health-connect') return;
    hasSynced.current = true;
    syncHealthConnect().catch(() => {
      // Ignore: a manual Sync now action is always available in Settings.
    });
  }, [ready, storageMode]);
}

function AppNavigator() {
  const { ready, preferences } = usePreferences();
  useOnboardingRedirect(ready, preferences.onboardingCompleted);
  useLaunchSync(ready, preferences.storageMode);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: Colors.background },
      }}>
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="index" options={{ title: 'Heft' }} />
      <Stack.Screen name="add-weight" options={{ title: 'Add weight' }} />
      <Stack.Screen name="history" options={{ title: 'History' }} />
      <Stack.Screen name="insights" options={{ title: 'Insights' }} />
      <Stack.Screen name="assistant" options={{ title: 'Assistant' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <PreferencesProvider>
      <StatusBar style="dark" />
      <AppNavigator />
    </PreferencesProvider>
  );
}
