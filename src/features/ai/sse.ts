/**
 * Minimal Server-Sent Events parser for the Responses API stream.
 *
 * It accumulates text chunks and yields one parsed JSON payload per SSE event
 * (`data:` lines terminated by a blank line). The `event:` line is ignored
 * because Responses API payloads already carry a `type` field.
 */
export type SseParser = {
  /** Feeds a chunk and returns every complete event parsed from it. */
  push(chunk: string): unknown[];
};

function parseDataLines(block: string): unknown | undefined {
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (normalized.startsWith('data:')) {
      dataLines.push(normalized.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return undefined;

  const payload = dataLines.join('\n');
  if (payload === '[DONE]' || payload === '') return undefined;

  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

export function createSseParser(): SseParser {
  let buffer = '';

  return {
    push(chunk: string): unknown[] {
      buffer += chunk.replace(/\r\n/g, '\n');

      const events: unknown[] = [];
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const parsed = parseDataLines(block);
        if (parsed !== undefined) events.push(parsed);

        boundary = buffer.indexOf('\n\n');
      }

      return events;
    },
  };
}
