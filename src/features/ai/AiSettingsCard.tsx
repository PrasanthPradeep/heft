import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Card, Label } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { usePreferences } from '@/features/settings/preferences';

import { listAiModels } from './aiClient';
import {
  disconnectChatGpt,
  getChatGptSessionInfo,
  type ChatGptSessionInfo,
} from './chatgptAuth';
import { ChatGptSignInModal } from './ChatGptSignInModal';
import {
  clearApiKey,
  isSecureStorageAvailable,
  loadApiKey,
  saveApiKey,
} from './secureStore';
import { describeAiError, type AiMethod, type AiModel } from './types';

const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

export function AiSettingsCard() {
  const { preferences, updatePreferences } = usePreferences();
  const method = preferences.aiMethod;

  const [session, setSession] = useState<ChatGptSessionInfo | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [models, setModels] = useState<AiModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshSession = useCallback(async () => {
    const [info, key] = await Promise.all([
      getChatGptSessionInfo(),
      loadApiKey(),
    ]);
    setSession(info);
    setHasApiKey(Boolean(key));
  }, []);

  const loadModels = useCallback(async (target: AiMethod) => {
    if (target === 'none') {
      setModels([]);
      setModelError(null);
      return;
    }

    setLoadingModels(true);
    setModelError(null);
    try {
      setModels(await listAiModels(target));
    } catch (cause) {
      setModels([]);
      setModelError(describeAiError(cause));
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getChatGptSessionInfo(), loadApiKey()])
      .then(([info, key]) => {
        if (!active) return;
        setSession(info);
        setHasApiKey(Boolean(key));
        if (method !== 'none') void loadModels(method);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [method, loadModels]);

  const onConnected = useCallback(async () => {
    setShowSignIn(false);
    await refreshSession();
    await loadModels('chatgpt');
    await updatePreferences({ aiMethod: 'chatgpt' });
  }, [loadModels, refreshSession, updatePreferences]);

  async function saveKey() {
    const key = apiKeyInput.trim();
    if (!key) return;
    setBusy(true);
    try {
      const available = await isSecureStorageAvailable();
      if (!available) {
        Alert.alert(
          'Secure storage unavailable',
          'Heft cannot store secrets on this device.'
        );
        return;
      }
      await saveApiKey(key);
      setApiKeyInput('');
      setHasApiKey(true);
      await updatePreferences({ aiMethod: 'api-key' });
      await loadModels('api-key');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      if (method === 'chatgpt') await disconnectChatGpt();
      if (method === 'api-key') await clearApiKey();
      await updatePreferences({ aiMethod: 'none', aiModel: null });
      await refreshSession();
      await loadModels('none');
    } finally {
      setBusy(false);
    }
  }

  const connected =
    (method === 'chatgpt' && session?.connected) ||
    (method === 'api-key' && hasApiKey);

  const statusText = (() => {
    if (method === 'chatgpt' && session?.connected) {
      const who = session.email ?? session.name ?? 'your ChatGPT account';
      return `Connected to ChatGPT as ${who}.`;
    }
    if (method === 'api-key' && hasApiKey) {
      return 'Connected with an OpenAI API key.';
    }
    if (method === 'chatgpt') return 'ChatGPT sign-in incomplete.';
    if (method === 'api-key') return 'Add an API key to continue.';
    return 'The assistant is off.';
  })();

  return (
    <>
      <Label>Assistant</Label>
      <Card style={styles.card}>
        <Text style={styles.status}>{statusText}</Text>

        {method === 'chatgpt' && session?.connected ? (
          <Text style={styles.meta}>
            {session.planSharing
              ? 'Eligible requests use your ChatGPT plan.'
              : 'Signed in, but ChatGPT plan usage is not enabled for Heft.'}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            label="Continue with ChatGPT"
            variant={method === 'chatgpt' ? 'primary' : 'secondary'}
            onPress={() => setShowSignIn(true)}
            disabled={busy}
          />
          {connected ? (
            <Button
              label={busy ? 'Working…' : 'Disconnect'}
              variant="danger"
              onPress={disconnect}
              disabled={busy}
            />
          ) : null}
        </View>

        <Text style={styles.meta}>
          ChatGPT account sign-in is an unofficial, experimental flow on mobile.
          If it does not work on your device, use an OpenAI API key instead.
        </Text>

        {session?.planSharing ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openURL(CHATGPT_USAGE_URL).catch(() => undefined)}>
            <Text style={styles.link}>Manage usage in ChatGPT settings</Text>
          </Pressable>
        ) : null}

        <View style={styles.divider} />

        <Text style={styles.subhead}>Use an OpenAI API key</Text>
        <TextInput
          value={apiKeyInput}
          onChangeText={setApiKeyInput}
          placeholder="sk-…"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
          editable={!busy}
        />
        <View style={styles.actions}>
          <Button
            label="Save key"
            variant="secondary"
            onPress={saveKey}
            disabled={busy || apiKeyInput.trim().length === 0}
            loading={busy}
          />
        </View>
        <Text style={styles.meta}>
          Stored in the device keystore. Requests are billed to your OpenAI
          account.
        </Text>

        {method !== 'none' ? (
          <>
            <View style={styles.divider} />
            <View style={styles.rowBetween}>
              <Text style={styles.subhead}>Model</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadModels(method)}>
                <Text style={styles.link}>
                  {loadingModels ? 'Loading…' : 'Refresh'}
                </Text>
              </Pressable>
            </View>

            {modelError ? <Text style={styles.error}>{modelError}</Text> : null}

            {models.length === 0 && !loadingModels && !modelError ? (
              <Text style={styles.meta}>No models loaded yet.</Text>
            ) : null}

            <View style={styles.modelList}>
              {models.map((model) => {
                const selected = preferences.aiModel === model.slug;
                return (
                  <Pressable
                    key={model.slug}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => void updatePreferences({ aiModel: model.slug })}
                    style={[styles.modelRow, selected && styles.modelRowSelected]}>
                    <Text style={styles.modelName}>{model.displayName}</Text>
                    {selected ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.divider} />

            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.subhead}>Share health data with the AI</Text>
                <Text style={styles.meta}>
                  When on, your weight history, trends and (if available) activity
                  summary are sent to OpenAI with each message.
                </Text>
              </View>
              <Switch
                value={preferences.aiShareHealth}
                onValueChange={(value) => {
                  if (value) {
                    Alert.alert(
                      'Share health data?',
                      'Heft will send a summary of your weight history and trends to OpenAI when you message the assistant. You can turn this off at any time.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Share',
                          onPress: () =>
                            void updatePreferences({ aiShareHealth: true }),
                        },
                      ]
                    );
                  } else {
                    void updatePreferences({ aiShareHealth: false });
                  }
                }}
              />
            </View>

            <Button
              label="Open assistant"
              variant="secondary"
              onPress={() => router.push('/assistant')}
            />
          </>
        ) : null}

        <Text style={styles.disclaimer}>
          Heft&apos;s assistant is not a medical professional and cannot
          diagnose or treat conditions. For medical advice, consult a clinician.
        </Text>
      </Card>

      {showSignIn ? (
        <ChatGptSignInModal
          onClose={() => setShowSignIn(false)}
          onConnected={() => {
            void onConnected();
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  status: { fontSize: 16, fontWeight: '700', color: Colors.text },
  meta: { color: Colors.textSecondary, lineHeight: 20, fontSize: 13 },
  actions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: Spacing.two,
  },
  subhead: { fontSize: 14, fontWeight: '700', color: Colors.text },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    backgroundColor: Colors.background,
    color: Colors.text,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  flex: { flex: 1 },
  link: { color: Colors.brand, fontWeight: '700' },
  modelList: { gap: Spacing.one },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  modelRowSelected: {
    borderColor: Colors.brand,
    backgroundColor: Colors.brandTint,
  },
  modelName: { color: Colors.text, fontWeight: '600' },
  check: { color: Colors.brand, fontWeight: '800' },
  error: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.two,
    fontSize: 13,
  },
  disclaimer: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: Spacing.one,
  },
});
