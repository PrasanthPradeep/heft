import type { WeightEntry } from '@/features/weight/types';
import {
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  normalizeNote,
} from '@/features/weight/weightCalculations';

export type ExportFormat = 'csv' | 'json';

/** A validated entry produced from imported text. */
export type ImportedWeight = {
  weightKg: number;
  measuredAt: string;
  note: string | null;
};

const CSV_HEADER = 'measuredAt,weightKg,note,source';

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function entriesToCsv(entries: WeightEntry[]): string {
  const rows = entries.map((entry) =>
    [
      entry.measuredAt,
      String(entry.weightKg),
      entry.note ?? '',
      entry.source,
    ]
      .map(escapeCsv)
      .join(',')
  );
  return [CSV_HEADER, ...rows].join('\n');
}

export function entriesToJson(entries: WeightEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => ({
      measuredAt: entry.measuredAt,
      weightKg: entry.weightKg,
      note: entry.note,
      source: entry.source,
    })),
    null,
    2
  );
}

/** RFC 4180-ish CSV tokenizer that supports quoted fields and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(
    (candidate) =>
      candidate.length > 1 ||
      (candidate.length === 1 && candidate[0].trim().length > 0)
  );
}

function toImportedWeight(
  weightRaw: string,
  measuredAtRaw: string,
  noteRaw: string
): ImportedWeight | null {
  const weightKg = Number(weightRaw.trim().replace(',', '.'));
  if (
    !Number.isFinite(weightKg) ||
    weightKg < MIN_WEIGHT_KG ||
    weightKg > MAX_WEIGHT_KG
  ) {
    return null;
  }

  const time = Date.parse(measuredAtRaw.trim());
  if (!Number.isFinite(time)) {
    return null;
  }

  return {
    weightKg,
    measuredAt: new Date(time).toISOString(),
    note: normalizeNote(noteRaw),
  };
}

function headerIndex(header: string[], name: string): number {
  return header.findIndex(
    (cell) => cell.trim().toLowerCase() === name.toLowerCase()
  );
}

export function csvToEntries(csv: string): ImportedWeight[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const header = rows[0];
  const measuredIndex = headerIndex(header, 'measuredAt');
  const weightIndex = headerIndex(header, 'weightKg');
  const noteIndex = headerIndex(header, 'note');

  const hasHeader = measuredIndex >= 0 && weightIndex >= 0;
  const body = hasHeader ? rows.slice(1) : rows;

  const weightColumn = hasHeader ? weightIndex : 1;
  const measuredColumn = hasHeader ? measuredIndex : 0;
  const noteColumn = hasHeader ? noteIndex : 2;

  const entries: ImportedWeight[] = [];
  for (const row of body) {
    const measuredAtRaw = row[measuredColumn];
    const weightRaw = row[weightColumn];
    if (measuredAtRaw === undefined || weightRaw === undefined) continue;

    const noteRaw = noteColumn >= 0 ? row[noteColumn] ?? '' : '';
    const parsed = toImportedWeight(weightRaw, measuredAtRaw, noteRaw);
    if (parsed) entries.push(parsed);
  }

  return entries;
}

export function jsonToEntries(json: string): ImportedWeight[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That is not valid JSON.');
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : null;

  if (!list) {
    throw new Error('Expected a JSON array of weight entries.');
  }

  const entries: ImportedWeight[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const parsedEntry = toImportedWeight(
      String(record.weightKg ?? ''),
      String(record.measuredAt ?? ''),
      typeof record.note === 'string' ? record.note : ''
    );
    if (parsedEntry) entries.push(parsedEntry);
  }

  return entries;
}

export function parseImport(text: string, format: ExportFormat): ImportedWeight[] {
  return format === 'csv' ? csvToEntries(text) : jsonToEntries(text);
}

/** Detects the format of pasted import text. */
export function detectFormat(text: string): ExportFormat {
  const trimmed = text.trimStart();
  return trimmed.startsWith('[') || trimmed.startsWith('{') ? 'json' : 'csv';
}
