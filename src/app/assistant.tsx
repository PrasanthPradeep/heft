import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Screen, Title } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { loadDailyActivity } from '@/features/activity/activityRepository';
import { summarizeActivity } from '@/features/activity/activityCalculations';
import type { ActivitySummary } from '@/features/activity/activityCalculations';
import { streamChat, type ChatTurn } from '@/features/ai/aiClient';
import { appendChatMessage, clearChatMessages, listChatMessages } from '@/features/ai/chatStore';
import { buildHealthContext } from '@/features/ai/healthContext';
import { buildInstructions } from '@/features/ai/prompts';
import { MarkdownText } from '@/features/ai/MarkdownText';
import { describeAiError, type ChatMessage } from '@/features/ai/types';
import { usePreferences } from '@/features/settings/preferences';
import type { WeightEntry } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';

export default function AssistantScreen() {
  const { preferences } = usePreferences();
  const repository = getWeightRepository(preferences.storageMode);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const controllerRef = useRef<AbortController | null>(null);

  /**
   * Android runs edge-to-edge, so the system ignores `adjustResize` and never
   * shrinks the window for the keyboard. `KeyboardAvoidingView` is a no-op
   * there, so the bottom-anchored composer is lifted manually by the reported
   * IME height. iOS still uses `KeyboardAvoidingView`.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const clamp = (height: number) =>
      Number.isFinite(height) && height > 0
        ? Math.min(height, Dimensions.get('window').height * 0.6)
        : 0;

    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(clamp(event.endCoordinates.height));
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  // Keep the newest message visible when the keyboard resizes the list.
  useEffect(() => {
    if (keyboardHeight > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [keyboardHeight]);

  const load = useCallback(async () => {
    const [history, rows, activityDays] = await Promise.all([
      listChatMessages(),
      repository.listWeights(),
      loadDailyActivity(),
    ]);
    setMessages(history);
    setEntries(rows);
    setActivity(activityDays.length > 0 ? summarizeActivity(activityDays) : null);
  }, [repository]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load the conversation.'));
      return () => {
        controllerRef.current?.abort();
      };
    }, [load])
  );

  const shareHealth = preferences.aiShareHealth;
  const healthContext = shareHealth
    ? buildHealthContext({
        entries,
        weightUnit: preferences.weightUnit,
        goalWeightKg: preferences.goalWeightKg,
        activity,
      })
    : null;

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    if (preferences.aiMethod === 'none') {
      setError('Set up the assistant in Settings first.');
      return;
    }
    if (!preferences.aiModel) {
      setError('Choose a model in Settings first.');
      return;
    }

    setError(null);
    setInput('');
    setSending(true);
    setStreaming('');

    const userMessage = await appendChatMessage('user', text);
    const conversation = [...messages, userMessage];
    setMessages(conversation);

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const instructions =
        buildInstructions({ hasHealthContext: Boolean(healthContext) }) +
        (healthContext
          ? `\n\nHealth data (shared with the user's consent):\n${healthContext}`
          : '');

      const turns: ChatTurn[] = conversation
        .filter((message) => message.content.trim().length > 0)
        .map((message) => ({ role: message.role, content: message.content }));

      const answer = await streamChat({
        method: preferences.aiMethod,
        model: preferences.aiModel,
        instructions,
        messages: turns,
        onDelta: (delta) => setStreaming((previous) => previous + delta),
        signal: controller.signal,
      });

      if (!answer.trim()) {
        setError('The assistant returned an empty reply. Try again.');
        return;
      }

      const assistantMessage = await appendChatMessage('assistant', answer);
      setMessages((previous) => [...previous, assistantMessage]);
    } catch (cause) {
      setError(describeAiError(cause));
    } finally {
      setStreaming('');
      setSending(false);
      controllerRef.current = null;
    }
  }

  async function newChat() {
    controllerRef.current?.abort();
    await clearChatMessages();
    setMessages([]);
    setStreaming('');
    setError(null);
  }

  if (preferences.aiMethod === 'none') {
    return (
      <Screen edges={['left', 'right']}>
        <View style={styles.content}>
          <Title>Assistant</Title>
          <Card style={styles.setupCard}>
            <Text style={styles.setupTitle}>The assistant is off</Text>
            <Text style={styles.setupBody}>
              Connect your ChatGPT account or an OpenAI API key in Settings, then
              come back to analyse your weight data and plan next steps.
            </Text>
            <Button label="Go to Settings" onPress={() => router.push('/settings')} />
          </Card>
        </View>
      </Screen>
    );
  }

  const streamingMessage: ChatMessage | null = streaming
    ? { id: 'streaming', role: 'assistant', content: streaming, createdAt: '' }
    : null;
  const data = streamingMessage ? [...messages, streamingMessage] : messages;

  // Lift the composer above the keyboard (Android) or the gesture bar.
  const composerPadding = Platform.OS === 'android'
    ? Spacing.three + Math.max(keyboardHeight, insets.bottom)
    : Spacing.three;

  return (
    <Screen edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.toolbar}>
          <Text style={styles.toolbarText}>
            {preferences.aiModel ?? 'No model selected'}
          </Text>
          <View style={styles.toolbarActions}>
            <Text
              style={styles.toolbarLink}
              onPress={() => setShowPreview((value) => !value)}>
              {showPreview ? 'Hide shared data' : 'Preview shared data'}
            </Text>
            <Text style={styles.toolbarLink} onPress={newChat}>
              New chat
            </Text>
          </View>
        </View>

        {showPreview ? (
          <Card style={styles.previewCard}>
            <Text style={styles.previewTitle}>
              {healthContext
                ? 'This summary is sent with each message'
                : 'Health data sharing is off'}
            </Text>
            <Text style={styles.previewBody}>
              {healthContext ??
                'Turn on "Share health data with the AI" in Settings to include your weight history and trends.'}
            </Text>
          </Card>
        ) : null}

        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          contentContainerStyle={styles.list}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <Card>
              <Text style={styles.emptyTitle}>Ask about your progress</Text>
              <Text style={styles.emptyBody}>
                Try asking how your weight has changed this month, or for help
                planning a realistic goal for the next six weeks.
              </Text>
            </Card>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === 'user' ? styles.userBubble : styles.aiBubble,
              ]}>
              {item.role === 'user' ? (
                <Text style={styles.userText}>{item.content}</Text>
              ) : (
                <MarkdownText source={item.content} style={styles.aiText} />
              )}
            </View>
          )}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={[styles.composer, { paddingBottom: composerPadding }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message the assistant…"
            style={styles.input}
            multiline
            editable={!sending}
          />
          {sending ? (
            <Button
              label="Stop"
              variant="secondary"
              onPress={() => controllerRef.current?.abort()}
            />
          ) : (
            <Button
              label="Send"
              onPress={send}
              disabled={input.trim().length === 0}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  setupCard: { gap: Spacing.two },
  setupTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  setupBody: { color: Colors.textSecondary, lineHeight: 21 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  toolbarText: { color: Colors.textSecondary, fontWeight: '600', flexShrink: 1 },
  toolbarActions: { flexDirection: 'row', gap: Spacing.three },
  toolbarLink: { color: Colors.brand, fontWeight: '700' },
  previewCard: { marginHorizontal: Spacing.three, gap: Spacing.one },
  previewTitle: { fontWeight: '700', color: Colors.text },
  previewBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  list: { padding: Spacing.three, gap: Spacing.two },
  bubble: {
    maxWidth: '92%',
    borderRadius: Radius.lg,
    padding: Spacing.three,
  },
  userBubble: { alignSelf: 'flex-end', backgroundColor: Colors.brand },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  userText: { color: Colors.surface, lineHeight: 21 },
  aiText: { color: Colors.text, lineHeight: 21 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.one,
  },
  emptyBody: { color: Colors.textSecondary, lineHeight: 21 },
  error: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.two,
    marginHorizontal: Spacing.three,
    fontSize: 13,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    color: Colors.text,
  },
});
