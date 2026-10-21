/**
 * How the assistant is allowed to reach a model.
 *  - `chatgpt`: the user signed in with their ChatGPT account (Sign in with
 *    ChatGPT), and eligible requests use their ChatGPT plan.
 *  - `api-key`: the user pasted an OpenAI platform API key (a reliable
 *    fallback, billed to that key).
 *  - `none`: the assistant is off.
 */
export type AiMethod = 'none' | 'chatgpt' | 'api-key';

export type AiModel = {
  /** Value passed as `model` to the Responses API. */
  slug: string;
  /** Human-friendly name shown in the picker. */
  displayName: string;
};

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

/** A locally saved conversation shown in the assistant history list. */
export type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

/** One page of a transcript, ordered oldest to newest. */
export type ChatMessagePage = {
  messages: ChatMessage[];
  hasMore: boolean;
};

/** Current local transcript usage, shown in the history sheet. */
export type ChatHistoryStats = {
  chatCount: number;
  messageCount: number;
  bytes: number;
  maxChats: number;
  maxBytes: number;
};

/**
 * Persisted ChatGPT OAuth connection. Stored in the OS keystore, never in the
 * plain SQLite preferences blob.
 */
export type ChatGptConnection = {
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
  scopes: string[];
  subject: string | null;
  email: string | null;
  name: string | null;
  savedAt: string;
};

/** Scope that grants use of the user's ChatGPT plan for eligible requests. */
export const CHATGPT_SHARING_SCOPE = 'chatgpt.tokens.use.direct';

export function connectionHasPlanSharing(
  connection: ChatGptConnection | null
): boolean {
  return Boolean(
    connection && connection.scopes.includes(CHATGPT_SHARING_SCOPE)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Defensively rebuilds a stored connection. Corrupt data returns null so the
 * caller treats the account as signed out rather than crashing.
 */
export function coerceChatGptConnection(
  input: unknown
): ChatGptConnection | null {
  const raw = asRecord(input);
  if (!raw) return null;

  const clientId = asString(raw.clientId);
  const accessToken = asString(raw.accessToken);
  const expiresAt = raw.expiresAt;
  if (
    !clientId ||
    !accessToken ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }

  return {
    clientId,
    accessToken,
    refreshToken: asString(raw.refreshToken),
    expiresAt,
    scopes: Array.isArray(raw.scopes)
      ? raw.scopes.filter((scope): scope is string => typeof scope === 'string')
      : [],
    subject: asString(raw.subject),
    email: asString(raw.email),
    name: asString(raw.name),
    savedAt: asString(raw.savedAt) ?? new Date().toISOString(),
  };
}

export class AiAuthError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'AiAuthError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function isAiAuthError(error: unknown): error is AiAuthError {
  return error instanceof AiAuthError;
}

/** Safe, user-facing message for any thrown value. */
export function describeAiError(error: unknown): string {
  if (isAiAuthError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong talking to the assistant.';
}
