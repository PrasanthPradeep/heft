import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';
import { PreferencesProvider } from '@/features/settings/preferences';

export default function RootLayout() {
  return (
    <PreferencesProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: Colors.background },
        }}>
        <Stack.Screen name="index" options={{ title: 'Heft' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan scale' }} />
        <Stack.Screen
          name="confirm-weight"
          options={{ title: 'Confirm weight' }}
        />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </PreferencesProvider>
  );
}
