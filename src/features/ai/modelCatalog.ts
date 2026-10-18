import type { AiModel } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Sign in with ChatGPT model catalog: `{ models: [{ slug, display_name,
 * visibility }] }`. Only entries marked `visibility: "list"` are meant to be
 * shown, and the server's ordering is preserved.
 */
export function parseChatGptModels(body: unknown): AiModel[] {
  const record = asRecord(body);
  const list = record && Array.isArray(record.models) ? record.models : null;
  if (!list) return [];

  const models: AiModel[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    const item = asRecord(entry);
    if (!item || item.visibility !== 'list') continue;

    const slug = typeof item.slug === 'string' ? item.slug.trim() : '';
    if (!slug || slug.length > 200 || seen.has(slug)) continue;

    const displayName =
      typeof item.display_name === 'string' && item.display_name.trim()
        ? item.display_name.trim()
        : slug;

    seen.add(slug);
    models.push({ slug, displayName });
  }

  return models;
}

/** Models that cannot take a text conversation, hidden from the platform list. */
const NON_CHAT_MODEL = /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|sora/i;

/**
 * Platform API model catalog: `{ object: "list", data: [{ id, object }] }`.
 * Non-conversational models are filtered out to keep the picker usable.
 */
export function parsePlatformModels(body: unknown): AiModel[] {
  const record = asRecord(body);
  const list = record && Array.isArray(record.data) ? record.data : null;
  if (!list) return [];

  const models: AiModel[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) continue;

    const slug = typeof item.id === 'string' ? item.id.trim() : '';
    if (!slug || slug.length > 200 || seen.has(slug)) continue;
    if (NON_CHAT_MODEL.test(slug)) continue;

    seen.add(slug);
    models.push({ slug, displayName: slug });
  }

  return models.sort((a, b) => a.slug.localeCompare(b.slug));
}
