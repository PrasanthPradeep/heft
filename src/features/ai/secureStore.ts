import * as SecureStore from 'expo-secure-store';

import { coerceChatGptConnection, type ChatGptConnection } from './types';

const CONNECTION_KEY = 'heft.ai.chatgpt.connection';
const API_KEY_KEY = 'heft.ai.openai.apiKey';
const HOST_ID_KEY = 'heft.ai.chatgpt.hostId';

async function readItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

async function removeItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing stored, or the keystore is unavailable on this platform.
  }
}

/** SecureStore is unavailable on web; the assistant is Android/iOS only. */
export async function isSecureStorageAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
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
