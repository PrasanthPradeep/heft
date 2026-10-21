import * as Crypto from 'expo-crypto';

import { getDatabase } from '@/db/database';

import {
  CHAT_HISTORY_PAGE_SIZE,
  DEFAULT_CHAT_TITLE,
  MAX_CHAT_HISTORY_BYTES,
  MAX_CHAT_HISTORY_CHATS,
  deriveChatTitle,
  selectChatsToTrim,
} from './chatHistory';
import type {
  ChatHistoryStats,
  ChatMessage,
  ChatMessagePage,
  ChatRole,
  ChatThread,
} from './types';

type MessageRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

type ChatRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

type ChatSizeRow = {
  id: string;
  bytes: number;
};

type HistoryTotals = {
  chatCount: number;
  bytes: number;
};

const VISIBLE_CHAT = `
  EXISTS (SELECT 1 FROM ai_messages visible WHERE visible.chat_id = c.id)
`;

/** A chat saved in the database, or an in-memory draft with no messages yet. */
export type LatestChat = {
  chat: ChatThread;
  isDraft: boolean;
};

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    createdAt: row.created_at,
  };
}

function rowToChat(row: ChatRow): ChatThread {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  };
}

const CHAT_SELECT = `
  SELECT
    c.id,
    c.title,
    c.created_at,
    c.updated_at,
    (SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id = c.id) AS message_count
  FROM ai_chats c
`;

/** Saved conversations, most recently active first. Empty chats are hidden. */
export async function listChats(
  limit = MAX_CHAT_HISTORY_CHATS
): Promise<ChatThread[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ChatRow>(
    `${CHAT_SELECT}
     WHERE ${VISIBLE_CHAT}
     ORDER BY c.updated_at DESC, c.created_at DESC
     LIMIT ?`,
    Math.max(1, Math.floor(limit))
  );
  return rows.map(rowToChat);
}

export async function getChat(id: string): Promise<ChatThread | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ChatRow>(
    `${CHAT_SELECT}
     WHERE c.id = ? AND ${VISIBLE_CHAT}`,
    id
  );
  return row ? rowToChat(row) : null;
}

/**
 * Builds a chat that exists only on screen. Nothing is written to the database
 * until the first message is sent, so empty chats never reach history.
 */
export function createDraftChat(title = DEFAULT_CHAT_TITLE): ChatThread {
  const now = new Date().toISOString();
  return {
    id: Crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}

/** Returns the latest saved chat, or a fresh in-memory draft. */
export async function getOrCreateLatestChat(): Promise<LatestChat> {
  const chats = await listChats(1);
  if (chats.length > 0) {
    await trimChatHistory(chats[0].id).catch(() => undefined);
    return { chat: chats[0], isDraft: false };
  }
  return { chat: createDraftChat(), isDraft: true };
}

/**
 * Loads one page of a transcript in chronological order. Pass the oldest
 * message's id as `beforeId` to fetch the page immediately before it.
 */
export async function listChatMessages(
  chatId: string,
  limit = CHAT_HISTORY_PAGE_SIZE,
  beforeId?: string
): Promise<ChatMessagePage> {
  const db = await getDatabase();
  const pageSize = Math.max(1, Math.floor(limit));
  const rows = beforeId
    ? await db.getAllAsync<MessageRow>(
        `SELECT id, role, content, created_at
         FROM ai_messages
         WHERE chat_id = ?
           AND rowid < (SELECT rowid FROM ai_messages WHERE id = ?)
         ORDER BY rowid DESC
         LIMIT ?`,
        chatId,
        beforeId,
        pageSize + 1
      )
    : await db.getAllAsync<MessageRow>(
        `SELECT id, role, content, created_at
         FROM ai_messages
         WHERE chat_id = ?
         ORDER BY rowid DESC
         LIMIT ?`,
        chatId,
        pageSize + 1
      );

  return {
    messages: rows
      .slice(0, pageSize)
      .reverse()
      .map(rowToMessage),
    hasMore: rows.length > pageSize,
  };
}

/**
 * Appends a completed message. Streaming deltas are never persisted: only the
 * final user text or final assistant answer reaches the database.
 */
export async function appendChatMessage(
  chatId: string,
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

  await db.withExclusiveTransactionAsync(async (txn) => {
    const chat = await txn.getFirstAsync<{ title: string }>(
      'SELECT title FROM ai_chats WHERE id = ?',
      chatId
    );

    if (!chat) {
      // A draft becomes real on its first user message. An assistant-only
      // transcript would be a ghost chat, so refuse that case.
      if (role !== 'user') throw new Error('Chat not found.');

      await txn.runAsync(
        `INSERT INTO ai_chats
           (id, title, created_at, updated_at, bytes)
         VALUES (?, ?, ?, ?, 0)`,
        chatId,
        deriveChatTitle(content),
        message.createdAt,
        message.createdAt
      );
    }

    await txn.runAsync(
      `INSERT INTO ai_messages (id, chat_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      message.id,
      chatId,
      message.role,
      message.content,
      message.createdAt
    );

    // Keeping a per-chat byte count makes retention checks cheap: they never
    // have to reread every message body.
    await txn.runAsync(
      `UPDATE ai_chats
       SET updated_at = ?,
           bytes = bytes + LENGTH(CAST(? AS BLOB))
       WHERE id = ?`,
      message.createdAt,
      message.content,
      chatId
    );

    if (role === 'user' && chat?.title === DEFAULT_CHAT_TITLE) {
      await txn.runAsync(
        'UPDATE ai_chats SET title = ? WHERE id = ?',
        deriveChatTitle(content),
        chatId
      );
    }
  });

  await trimChatHistory(chatId).catch(() => undefined);
  return message;
}

/** Permanently removes a conversation and all of its messages. */
export async function deleteChat(chatId: string): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM ai_messages WHERE chat_id = ?', chatId);
    await txn.runAsync('DELETE FROM ai_chats WHERE id = ?', chatId);
  });
}

/** Removes every saved conversation, used by the global "Delete all data". */
export async function clearAllChats(): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync('DELETE FROM ai_messages; DELETE FROM ai_chats;');
  });
}

export async function getChatHistoryStats(): Promise<ChatHistoryStats> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    chat_count: number;
    message_count: number;
    bytes: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM ai_chats c WHERE ${VISIBLE_CHAT}) AS chat_count,
       (SELECT COUNT(*) FROM ai_messages) AS message_count,
       (SELECT COALESCE(SUM(c.bytes), 0) FROM ai_chats c WHERE ${VISIBLE_CHAT}) AS bytes`
  );

  return {
    chatCount: row?.chat_count ?? 0,
    messageCount: row?.message_count ?? 0,
    bytes: row?.bytes ?? 0,
    maxChats: MAX_CHAT_HISTORY_CHATS,
    maxBytes: MAX_CHAT_HISTORY_BYTES,
  };
}

async function getHistoryTotals(): Promise<HistoryTotals> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ chat_count: number; bytes: number }>(
    `SELECT
       (SELECT COUNT(*) FROM ai_chats c WHERE ${VISIBLE_CHAT}) AS chat_count,
       (SELECT COALESCE(SUM(c.bytes), 0) FROM ai_chats c WHERE ${VISIBLE_CHAT}) AS bytes`
  );
  return {
    chatCount: row?.chat_count ?? 0,
    bytes: row?.bytes ?? 0,
  };
}

/** Evicts the oldest chats until the count and byte limits are satisfied. */
async function trimChatHistory(activeChatId: string): Promise<void> {
  const totals = await getHistoryTotals();
  if (
    totals.chatCount <= MAX_CHAT_HISTORY_CHATS &&
    totals.bytes <= MAX_CHAT_HISTORY_BYTES
  ) {
    return;
  }

  const db = await getDatabase();
  const candidates = await db.getAllAsync<ChatSizeRow>(
    `SELECT c.id, c.bytes
     FROM ai_chats c
     WHERE ${VISIBLE_CHAT}
     ORDER BY c.updated_at ASC, c.created_at ASC`
  );
  const toRemove = selectChatsToTrim(
    candidates,
    activeChatId,
    totals.chatCount,
    totals.bytes
  );

  for (const id of toRemove) {
    await deleteChat(id);
  }
}
