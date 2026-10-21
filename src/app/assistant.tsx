import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
import {
  CHAT_HISTORY_PAGE_SIZE,
  MAX_CHAT_HISTORY_BYTES,
} from '@/features/ai/chatHistory';
import {
  appendChatMessage,
  createDraftChat,
  deleteChat,
  getChat,
  getChatHistoryStats,
  getOrCreateLatestChat,
  listChatMessages,
  listChats,
} from '@/features/ai/chatStore';
import { buildHealthContext } from '@/features/ai/healthContext';
import { buildInstructions } from '@/features/ai/prompts';
import { MarkdownText } from '@/features/ai/MarkdownText';
import {
  describeAiError,
  type ChatHistoryStats,
  type ChatMessage,
  type ChatThread,
} from '@/features/ai/types';
import { usePreferences } from '@/features/settings/preferences';
import {
  formatDateTime,
  formatStorageSize,
} from '@/lib/format';
import type { WeightEntry } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';

export default function AssistantScreen() {
  const { preferences } = usePreferences();
  const repository = getWeightRepository(preferences.storageMode);

  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [historyStats, setHistoryStats] = useState<ChatHistoryStats | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
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
  const activeChatIdRef = useRef<string | null>(null);
  const activeChatIsDraftRef = useRef(false);
  const scrollToEndRef = useRef(true);
  const creatingChatRef = useRef(false);

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

  const loadChat = useCallback(async (id: string, isDraft = false) => {
    const page = await listChatMessages(id, CHAT_HISTORY_PAGE_SIZE);
    activeChatIdRef.current = id;
    activeChatIsDraftRef.current = isDraft;
    setChatId(id);
    setMessages(page.messages);
    setHasOlder(page.hasMore);
    setLoadingOlder(false);
    setStreaming('');
    setError(null);
    setInput('');
    scrollToEndRef.current = true;
  }, []);

  const load = useCallback(async () => {
    if (preferences.aiMethod === 'none') return;

    const [rows, activityDays] = await Promise.all([
      repository.listWeights(),
      loadDailyActivity(),
    ]);
    setEntries(rows);
    setActivity(activityDays.length > 0 ? summarizeActivity(activityDays) : null);

    // Keep the open chat across tab changes, but recover if the database was
    // wiped from Settings while this screen was in the background.
    const currentId = activeChatIdRef.current;
    if (currentId) {
      if (activeChatIsDraftRef.current) return;
      if (await getChat(currentId)) return;
    }

    const latest = await getOrCreateLatestChat();
    await loadChat(latest.chat.id, latest.isDraft);
  }, [loadChat, preferences.aiMethod, repository]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load the assistant.'));
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

  async function openChat(id: string, isDraft = false) {
    Keyboard.dismiss();
    controllerRef.current?.abort();
    controllerRef.current = null;
    setSending(false);
    setStreaming('');
    setShowHistory(false);

    try {
      await loadChat(id, isDraft);
    } catch {
      setError('Could not open that conversation.');
    }
  }

  async function startNewChat() {
    if (creatingChatRef.current) return;

    if (messages.length === 0 && activeChatIdRef.current) {
      setShowHistory(false);
      return;
    }

    creatingChatRef.current = true;
    Keyboard.dismiss();
    controllerRef.current?.abort();
    controllerRef.current = null;
    setSending(false);
    setStreaming('');
    setError(null);

    try {
      const chat = createDraftChat();
      await loadChat(chat.id, true);
      setShowHistory(false);
    } catch {
      setError('Could not start a new chat.');
    } finally {
      creatingChatRef.current = false;
    }
  }

  async function refreshHistory() {
    const [nextChats, nextStats] = await Promise.all([
      listChats(),
      getChatHistoryStats(),
    ]);
    setChats(nextChats);
    setHistoryStats(nextStats);
  }

  async function openHistory() {
    Keyboard.dismiss();
    setShowHistory(true);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      await refreshHistory();
    } catch {
      setHistoryError('Could not load chat history.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function removeChat(chat: ChatThread) {
    try {
      await deleteChat(chat.id);
      const nextChats = await listChats();
      setChats(nextChats);
      setHistoryStats(await getChatHistoryStats());

      if (chat.id === activeChatIdRef.current) {
        if (nextChats.length > 0) {
          await openChat(nextChats[0].id);
        } else {
          await openChat(createDraftChat().id, true);
        }
      }
    } catch {
      Alert.alert('Could not delete chat', 'Please try again.');
    }
  }

  function confirmDeleteChat(chat: ChatThread) {
    Alert.alert(
      'Delete chat?',
      `"${chat.title}" and all of its messages will be permanently removed from this device. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void removeChat(chat);
          },
        },
      ]
    );
  }

  async function loadOlder() {
    const targetChatId = chatId;
    if (!targetChatId || !hasOlder || loadingOlder) return;

    const oldest = messages[0];
    if (!oldest) return;

    setLoadingOlder(true);
    scrollToEndRef.current = false;
    try {
      const page = await listChatMessages(
        targetChatId,
        CHAT_HISTORY_PAGE_SIZE,
        oldest.id
      );
      if (activeChatIdRef.current !== targetChatId) return;
      setMessages((previous) => [...page.messages, ...previous]);
      setHasOlder(page.hasMore);
    } catch {
      if (activeChatIdRef.current === targetChatId) {
        setError('Could not load earlier messages.');
      }
    } finally {
      if (activeChatIdRef.current === targetChatId) {
        setLoadingOlder(false);
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    if (!chatId) {
      setError('The conversation is still loading. Try again.');
      return;
    }
    if (preferences.aiMethod === 'none') {
      setError('Set up the assistant in Settings first.');
      return;
    }
    if (!preferences.aiModel) {
      setError('Choose a model in Settings first.');
      return;
    }

    const targetChatId = chatId;
    setError(null);
    setInput('');
    setSending(true);
    setStreaming('');
    scrollToEndRef.current = true;

    let userMessage: ChatMessage;
    try {
      userMessage = await appendChatMessage(targetChatId, 'user', text);
    } catch {
      if (activeChatIdRef.current === targetChatId) {
        setInput(text);
        setSending(false);
        setError('Could not save this message. Try again.');
      }
      return;
    }

    const conversation = [...messages, userMessage];
    if (activeChatIdRef.current === targetChatId) {
      activeChatIsDraftRef.current = false;
      setMessages(conversation);
    } else {
      // The user switched chats while the message was being written.
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const instructions =
        buildInstructions({
          hasHealthContext: Boolean(healthContext),
          now: new Date(),
        }) +
        (healthContext
          ? `\n\nHealth data (shared with the user's consent):\n${healthContext}`
          : '');

      const turns: ChatTurn[] = conversation
        .filter((message) => message.content.trim().length > 0)
        .map((message) => ({
          role: message.role,
          content:
            message.role === 'user'
              ? `[${formatDateTime(message.createdAt)}] ${message.content}`
              : message.content,
        }));

      const answer = await streamChat({
        method: preferences.aiMethod,
        model: preferences.aiModel,
        instructions,
        messages: turns,
        onDelta: (delta) => {
          if (activeChatIdRef.current === targetChatId) {
            setStreaming((previous) => previous + delta);
          }
        },
        signal: controller.signal,
      });

      if (!answer.trim()) {
        if (activeChatIdRef.current === targetChatId) {
          setError('The assistant returned an empty reply. Try again.');
        }
        return;
      }

      // Only the completed answer is persisted, never individual stream chunks.
      const assistantMessage = await appendChatMessage(
        targetChatId,
        'assistant',
        answer
      );
      if (activeChatIdRef.current === targetChatId) {
        setMessages((previous) => [...previous, assistantMessage]);
      }
    } catch (cause) {
      if (!controller.signal.aborted && activeChatIdRef.current === targetChatId) {
        setError(describeAiError(cause));
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      if (activeChatIdRef.current === targetChatId) {
        setStreaming('');
        setSending(false);
      }
    }
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
          <Text style={styles.toolbarText} numberOfLines={1}>
            {preferences.aiModel ?? 'No model selected'}
          </Text>
          <View style={styles.toolbarActions}>
            <Text
              style={styles.toolbarLink}
              onPress={() => setShowPreview((value) => !value)}>
              {showPreview ? 'Hide preview' : 'Shared data'}
            </Text>
            <Text style={styles.toolbarLink} onPress={() => void openHistory()}>
              History
            </Text>
            <Text style={styles.toolbarLink} onPress={() => void startNewChat()}>
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
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onContentSizeChange={() => {
            if (scrollToEndRef.current) {
              listRef.current?.scrollToEnd({ animated: false });
            }
          }}
          ListHeaderComponent={
            hasOlder ? (
              <Pressable
                accessibilityRole="button"
                disabled={loadingOlder}
                onPress={() => void loadOlder()}
                style={styles.loadOlder}>
                <Text style={styles.loadOlderText}>
                  {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
                </Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <Card>
              <Text style={styles.emptyTitle}>Ask about your progress</Text>
              <Text style={styles.emptyBody}>
                Try asking how your weight has changed this month, for a meal
                plan, or tell me what you ate and I&apos;ll estimate the calories
                and macros and keep a running total for the day.
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

      <Modal
        visible={showHistory}
        transparent
        animationType="slide"
        onRequestClose={() => setShowHistory(false)}>
        <View style={styles.historyBackdrop}>
          <View
            style={[
              styles.historySheet,
              { paddingBottom: insets.bottom + Spacing.three },
            ]}>
            <View style={styles.historyHeader}>
              <View style={styles.flex}>
                <Text style={styles.historyTitle}>Chat history</Text>
                <Text style={styles.historyMeta}>Saved on this device only.</Text>
              </View>
              <Text
                style={styles.toolbarLink}
                onPress={() => setShowHistory(false)}>
                Close
              </Text>
            </View>

            <Text style={styles.historyStorage}>
              {historyStats
                ? `${historyStats.chatCount} of ${historyStats.maxChats} chats · ${historyStats.messageCount} messages`
                : 'Loading saved chats…'}
            </Text>
            <Text style={styles.historyMeta}>
              Stored message text: {formatStorageSize(historyStats?.bytes ?? 0)} of{' '}
              {formatStorageSize(MAX_CHAT_HISTORY_BYTES)}. Only completed message
              text is saved. When a limit is reached, the oldest chats are removed
              first.
            </Text>

            {historyError ? (
              <Text style={styles.historyError}>{historyError}</Text>
            ) : null}

            {historyLoading ? (
              <ActivityIndicator
                color={Colors.brand}
                style={styles.historyLoading}
              />
            ) : (
              <FlatList
                data={chats}
                keyExtractor={(item) => item.id}
                style={styles.historyList}
                contentContainerStyle={styles.historyListContent}
                ListEmptyComponent={
                  <Text style={styles.historyEmpty}>No saved chats yet.</Text>
                }
                renderItem={({ item }) => {
                  const active = item.id === chatId;
                  return (
                    <View
                      style={[styles.chatRow, active && styles.chatRowActive]}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void openChat(item.id)}
                        style={styles.chatMain}>
                        <Text style={styles.chatTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.chatMeta}>
                          {active ? 'Current · ' : ''}
                          {formatDateTime(item.updatedAt)} · {item.messageCount}{' '}
                          {item.messageCount === 1 ? 'message' : 'messages'}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${item.title}`}
                        onPress={() => confirmDeleteChat(item)}
                        style={styles.chatDelete}>
                        <Text style={styles.chatDeleteText}>Delete</Text>
                      </Pressable>
                    </View>
                  );
                }}
              />
            )}

            <Button label="New chat" onPress={() => void startNewChat()} />
          </View>
        </View>
      </Modal>
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
  toolbarText: {
    color: Colors.textSecondary,
    fontWeight: '600',
    flex: 1,
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 0,
  },
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
  loadOlder: { alignItems: 'center', paddingVertical: Spacing.two },
  loadOlderText: { color: Colors.brand, fontWeight: '700' },
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
  historyBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  historySheet: {
    maxHeight: '85%',
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  historyTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  historyMeta: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  historyStorage: { color: Colors.text, fontWeight: '700' },
  historyError: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.two,
    fontSize: 13,
  },
  historyLoading: { paddingVertical: Spacing.five },
  historyList: { maxHeight: 420, flexShrink: 1 },
  historyListContent: { gap: Spacing.two, paddingVertical: Spacing.one },
  historyEmpty: {
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingLeft: Spacing.three,
  },
  chatRowActive: {
    borderColor: Colors.brand,
    backgroundColor: Colors.brandTint,
  },
  chatMain: { flex: 1, gap: Spacing.one, paddingVertical: Spacing.two },
  chatTitle: { color: Colors.text, fontWeight: '700' },
  chatMeta: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  chatDelete: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chatDeleteText: { color: Colors.danger, fontWeight: '700' },
});
