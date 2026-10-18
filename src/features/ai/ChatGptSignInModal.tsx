import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { WebViewNavigation } from 'react-native-webview';

import { Button } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';

import {
  beginChatGptSignIn,
  completeChatGptSignIn,
  type ChatGptSignInAttempt,
} from './chatgptAuth';
import { describeAiError, type ChatGptConnection } from './types';

/**
 * Hosts OpenAI's sign-in page and intercepts the loopback callback URL that the
 * OAuth flow redirects to. The loopback URL is never loaded, so no local HTTP
 * server is needed (React Native has none).
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

/**
 * `react-native-webview` is a native module. It is loaded lazily so a binary
 * without it shows a clear message instead of crashing Settings on import.
 */
type WebViewModule = typeof import('react-native-webview');

let webViewCache: WebViewModule | null | undefined;

function loadWebView(): WebViewModule | null {
  if (webViewCache !== undefined) return webViewCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    webViewCache = require('react-native-webview') as WebViewModule;
  } catch {
    webViewCache = null;
  }
  return webViewCache;
}

type Props = {
  onClose: () => void;
  onConnected: (connection: ChatGptConnection) => void;
};

export function ChatGptSignInModal({ onClose, onConnected }: Props) {
  const webView = loadWebView();
  const [attempt, setAttempt] = useState<ChatGptSignInAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(() => loadWebView() !== null);
  const [finishing, setFinishing] = useState(false);
  const [intercepted, setIntercepted] = useState(false);

  useEffect(() => {
    // No point starting OAuth if the in-app browser is unavailable.
    if (!loadWebView()) return;

    let cancelled = false;

    beginChatGptSignIn()
      .then((next) => {
        if (!cancelled) setAttempt(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(describeAiError(cause));
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(
    async (callbackUrl: string) => {
      if (!attempt || intercepted) return;
      setIntercepted(true);
      setFinishing(true);
      try {
        const connection = await completeChatGptSignIn(attempt, callbackUrl);
        onConnected(connection);
      } catch (cause) {
        setError(describeAiError(cause));
      } finally {
        setFinishing(false);
      }
    },
    [attempt, intercepted, onConnected]
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation): boolean => {
      if (attempt && request.url.startsWith(attempt.redirectUri)) {
        void finish(request.url);
        return false;
      }
      return true;
    },
    [attempt, finish]
  );

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      transparent={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Sign in with ChatGPT</Text>
          <Button label="Close" variant="secondary" onPress={onClose} />
        </View>

        {!webView ? (
          <View style={styles.center}>
            <Text style={styles.error}>
              Sign in with ChatGPT is unavailable in this build.
            </Text>
            <Text style={styles.hint}>
              This build is missing the in-app browser module. Rebuild the app
              (npx expo run:android), or use an OpenAI API key instead from
              Settings.
            </Text>
            <Button label="Close" variant="secondary" onPress={onClose} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
            <Text style={styles.hint}>
              This flow is unofficial in the ChatGPT app; if it fails, you can
              use an OpenAI API key instead from Settings.
            </Text>
            <Button label="Try again" onPress={onClose} />
          </View>
        ) : preparing || !attempt ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.brand} />
            <Text style={styles.hint}>Preparing secure sign-in…</Text>
          </View>
        ) : (
          <View style={styles.webviewWrap}>
            <webView.WebView
              source={{ uri: attempt.authorizationUrl }}
              userAgent={BROWSER_USER_AGENT}
              originWhitelist={['*']}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
              onError={() =>
                setError(
                  'The sign-in page could not load. Check your connection and try again.'
                )
              }
              startInLoadingState
              renderLoading={() => (
                <View style={styles.center}>
                  <ActivityIndicator color={Colors.brand} />
                </View>
              )}
            />
            {finishing ? (
              <View style={styles.overlay}>
                <ActivityIndicator color={Colors.brand} />
                <Text style={styles.hint}>Finishing sign-in…</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text, flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  webviewWrap: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: 'rgba(247,250,248,0.92)',
  },
  error: {
    color: Colors.danger,
    backgroundColor: Colors.dangerTint,
    borderRadius: Radius.sm,
    padding: Spacing.three,
    textAlign: 'center',
  },
  hint: { color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
});
