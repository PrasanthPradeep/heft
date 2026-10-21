/** Messages loaded at a time when opening or paging through a chat. */
export const CHAT_HISTORY_PAGE_SIZE = 40;

/**
 * Retention limits for the local transcript. The chat count keeps the history
 * list usable; the byte budget is a safety net for unusually large transcripts.
 * Both limits are enforced by removing the oldest chats first.
 */
export const MAX_CHAT_HISTORY_CHATS = 200;
export const MAX_CHAT_HISTORY_BYTES = 200 * 1024 * 1024;

export const DEFAULT_CHAT_TITLE = 'New chat';

/** Turns the first user message into a short, single-line chat title. */
export function deriveChatTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return DEFAULT_CHAT_TITLE;

  const maxLength = 60;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export type ChatTrimCandidate = {
  id: string;
  bytes: number;
};

/**
 * Chooses old chats to evict until both retention limits are met. The active
 * chat is never removed, so an exceptionally large open conversation can keep
 * the total slightly over the byte budget rather than disappearing mid-session.
 */
export function selectChatsToTrim(
  chats: readonly ChatTrimCandidate[],
  activeChatId: string,
  chatCount: number,
  totalBytes: number,
  maxChats = MAX_CHAT_HISTORY_CHATS,
  maxBytes = MAX_CHAT_HISTORY_BYTES
): string[] {
  let remainingChats = chatCount;
  let remainingBytes = totalBytes;
  const remove: string[] = [];

  for (const chat of chats) {
    if (remainingChats <= maxChats && remainingBytes <= maxBytes) break;
    if (chat.id === activeChatId) continue;

    remove.push(chat.id);
    remainingChats -= 1;
    remainingBytes -= chat.bytes;
  }

  return remove;
}
