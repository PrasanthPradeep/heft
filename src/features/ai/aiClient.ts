import { fetch as expoFetch } from 'expo/fetch';

import { asRecord, getChatGptAccessToken } from './chatgptAuth';
import { parseChatGptModels, parsePlatformModels } from './modelCatalog';
import { loadApiKey } from './secureStore';
import { createSseParser } from './sse';
import {
  AiAuthError,
  type AiMethod,
  type AiModel,
  type ChatRole,
} from './types';

const API_BASE = 'https://api.openai.com/v1';

export type ChatTurn = { role: ChatRole; content: string };

export type StreamChatOptions = {
  method: AiMethod;
  model: string;
  instructions: string;
  messages: ChatTurn[];
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
};

function errorMessage(data: unknown): string | null {
  const record = asRecord(data);
  if (!record) return null;

  const nested = asRecord(record.error);
  if (nested && typeof nested.message === 'string' && nested.message) {
    return nested.message;
  }
  if (typeof record.error === 'string' && record.error) return record.error;
  if (typeof record.message === 'string' && record.message) return record.message;
  return null;
}

function toAiError(body: unknown, status: number): AiAuthError {
  const message = errorMessage(body);
  if (status === 401 || status === 403) {
    return new AiAuthError(
      'unauthorized',
      message ??
        'OpenAI rejected the request. Reconnect the assistant in Settings.'
    );
  }
  if (status === 429) {
    return new AiAuthError(
      'rate_limited',
      message ?? 'OpenAI is rate limiting requests. Try again shortly.',
      true
    );
  }
  return new AiAuthError(
    'request_failed',
    message ?? `The assistant request failed (HTTP ${status}).`,
    status >= 500
  );
}

async function resolveBearer(method: AiMethod): Promise<string> {
  if (method === 'chatgpt') return getChatGptAccessToken();
  if (method === 'api-key') {
    const key = await loadApiKey();
    if (!key) {
      throw new AiAuthError(
        'not_configured',
        'Add your OpenAI API key in Settings.'
      );
    }
    return key;
  }
  throw new AiAuthError(
    'not_configured',
    'Turn on the assistant in Settings first.'
  );
}

/** Loads the account's model catalog for the chosen connection method. */
export async function listAiModels(method: AiMethod): Promise<AiModel[]> {
  const token = await resolveBearer(method);

  let response: Awaited<ReturnType<typeof expoFetch>>;
  try {
    response = await expoFetch(`${API_BASE}/models`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  } catch {
    throw new AiAuthError(
      'network_error',
      'Could not reach OpenAI. Check your connection and try again.',
      true
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) throw toAiError(body, response.status);

  const models =
    method === 'chatgpt' ? parseChatGptModels(body) : parsePlatformModels(body);
  if (models.length === 0) {
    throw new AiAuthError(
      'no_models',
      'No compatible models were returned for this account.'
    );
  }
  return models;
}

/**
 * Streams a chat completion from the Responses API. Returns the full text;
 * partial text is preserved if the stream is interrupted mid-answer.
 */
export async function streamChat(
  options: StreamChatOptions
): Promise<string> {
  if (!options.model.trim()) {
    throw new AiAuthError('not_configured', 'Choose a model in Settings first.');
  }
  const token = await resolveBearer(options.method);

  let response: Awaited<ReturnType<typeof expoFetch>>;
  try {
    response = await expoFetch(`${API_BASE}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: options.model,
        input: options.messages,
        instructions: options.instructions,
        store: false,
        stream: true,
      }),
      signal: options.signal,
    });
  } catch {
    if (options.signal?.aborted) {
      throw new AiAuthError('cancelled', 'The request was cancelled.');
    }
    throw new AiAuthError(
      'network_error',
      'Could not reach OpenAI. Check your connection and try again.',
      true
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw toAiError(body, response.status);
  }

  const stream = response.body;
  if (!stream) {
    throw new AiAuthError(
      'stream_unavailable',
      'This device could not open a response stream. Try again.',
      true
    );
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let text = '';
  let completed = false;

  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        const record = asRecord(event);
        if (!record) continue;

        if (
          record.type === 'response.output_text.delta' &&
          typeof record.delta === 'string'
        ) {
          text += record.delta;
          options.onDelta?.(record.delta);
        } else if (record.type === 'response.completed') {
          completed = true;
          break;
        } else if (
          record.type === 'response.failed' ||
          record.type === 'error'
        ) {
          throw toAiError(record.response ?? record, 200);
        } else if (record.type === 'response.incomplete') {
          throw new AiAuthError(
            'response_incomplete',
            'The assistant stopped before finishing. Try again.',
            true
          );
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Stream already closed.
    }
  }

  if (!completed && !text) {
    throw new AiAuthError(
      'stream_interrupted',
      'The response ended before completing. Try again.',
      true
    );
  }
  return text;
}
