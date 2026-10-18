import * as Crypto from 'expo-crypto';

import { getDatabase } from '@/db/database';

import type { ChatMessage, ChatRole } from './types';

type MessageRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    createdAt: row.created_at,
  };
}

/** Most recent messages in chronological order (oldest first). */
export async function listChatMessages(limit = 40): Promise<ChatMessage[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MessageRow>(
    'SELECT id, role, content, created_at FROM ai_messages ORDER BY rowid DESC LIMIT ?',
    limit
  );
  return rows.reverse().map(rowToMessage);
}

export async function appendChatMessage(
  role: ChatRole,
  content: string
): Promise<ChatMessage> {
  const db = await getDatabase();
  const message: ChatMessage = {
    id: Crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
  await db.runAsync(
    'INSERT INTO ai_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)',
    message.id,
    message.role,
    message.content,
    message.createdAt
  );
  return message;
}

export async function clearChatMessages(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM ai_messages');
}
