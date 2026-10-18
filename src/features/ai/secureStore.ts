import { coerceChatGptConnection, type ChatGptConnection } from './types';

/**
 * `expo-secure-store` is a native module. It is loaded lazily (and tolerantly)
 * so that a binary which predates the dependency — or the web target — degrades
 * to "secure storage unavailable" instead of throwing while the module graph is
 * being evaluated. A top-level `import` here would otherwise crash every screen
 * that imports the assistant, including Settings.
 */
type SecureStoreApi = typeof import('expo-secure-store');

const CONNECTION_KEY = 'heft.ai.chatgpt.connection';
const API_KEY_KEY = 'heft.ai.openai.apiKey';
const HOST_ID_KEY = 'heft.ai.chatgpt.hostId';

let resolved: SecureStoreApi | null | undefined;

function secureStore(): SecureStoreApi | null {
  if (resolved !== undefined) return resolved;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolved = require('expo-secure-store') as SecureStoreApi;
  } catch {
    resolved = null;
  }
  return resolved;
}

async function readItem(key: string): Promise<string | null> {
  const store = secureStore();
  if (!store) return null;
  try {
    return await store.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  const store = secureStore();
  if (!store) {
    throw new Error(
      'Secure storage is not available in this build of Heft. Rebuild the app.'
    );
  }
  await store.setItemAsync(key, value);
}

async function removeItem(key: string): Promise<void> {
  const store = secureStore();
  if (!store) return;
  try {
    await store.deleteItemAsync(key);
  } catch {
    // Nothing stored, or the keystore is unavailable on this platform.
  }
}

/** False when the native keystore module is missing (e.g. an old dev build). */
export async function isSecureStorageAvailable(): Promise<boolean> {
  const store = secureStore();
  if (!store) return false;
  try {
    return await store.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function loadChatGptConnection(): Promise<ChatGptConnection | null> {
  const raw = await readItem(CONNECTION_KEY);
  if (!raw) return null;
  try {
    return coerceChatGptConnection(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveChatGptConnection(
  connection: ChatGptConnection
): Promise<void> {
  await writeItem(CONNECTION_KEY, JSON.stringify(connection));
}

export async function clearChatGptConnection(): Promise<void> {
  await removeItem(CONNECTION_KEY);
}

export async function loadApiKey(): Promise<string | null> {
  const key = await readItem(API_KEY_KEY);
  return key && key.trim() ? key.trim() : null;
}

export async function saveApiKey(key: string): Promise<void> {
  await writeItem(API_KEY_KEY, key.trim());
}

export async function clearApiKey(): Promise<void> {
  await removeItem(API_KEY_KEY);
}

export async function loadHostId(): Promise<string | null> {
  return readItem(HOST_ID_KEY);
}

export async function saveHostId(id: string): Promise<void> {
  await writeItem(HOST_ID_KEY, id);
}
