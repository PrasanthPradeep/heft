import type { WeightEntry } from '@/features/weight/types';

import {
  csvToEntries,
  detectFormat,
  entriesToCsv,
  entriesToJson,
  jsonToEntries,
  parseCsv,
} from '../exportService';

function entry(
  measuredAt: string,
  weightKg: number,
  note: string | null = null
): WeightEntry {
  return {
    id: measuredAt,
    measuredAt,
    weightKg,
    note,
    source: 'manual',
    externalId: null,
    owned: true,
    pending: false,
  };
}

describe('entriesToCsv', () => {
  it('writes a header and one row per entry', () => {
    const csv = entriesToCsv([
      entry('2026-03-01T08:00:00.000Z', 80, 'morning'),
      entry('2026-03-02T08:00:00.000Z', 79.5),
    ]);
    expect(csv.split('\n')).toEqual([
      'measuredAt,weightKg,note,source',
      '2026-03-01T08:00:00.000Z,80,morning,manual',
      '2026-03-02T08:00:00.000Z,79.5,,manual',
    ]);
  });

  it('quotes fields containing commas or quotes', () => {
    const csv = entriesToCsv([entry('2026-03-01T08:00:00.000Z', 80, 'a,b "c"')]);
    expect(csv).toContain('"a,b ""c"""');
  });
});

describe('parseCsv', () => {
  it('handles quoted fields and embedded newlines', () => {
    const rows = parseCsv('a,b\n"x,y","line1\nline2"');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,y', 'line1\nline2'],
    ]);
  });
});

describe('csvToEntries', () => {
  it('round-trips exported data', () => {
    const original = [
      entry('2026-03-01T08:00:00.000Z', 80, 'morning, before breakfast'),
      entry('2026-03-02T08:00:00.000Z', 79.5),
    ];
    const parsed = csvToEntries(entriesToCsv(original));
    expect(parsed).toEqual([
      {
        measuredAt: '2026-03-01T08:00:00.000Z',
        weightKg: 80,
        note: 'morning, before breakfast',
      },
      { measuredAt: '2026-03-02T08:00:00.000Z', weightKg: 79.5, note: null },
    ]);
  });

  it('accepts headerless rows using the default column order', () => {
    const parsed = csvToEntries('2026-03-01T08:00:00.000Z,80,note');
    expect(parsed).toEqual([
      { measuredAt: '2026-03-01T08:00:00.000Z', weightKg: 80, note: 'note' },
    ]);
  });

  it('skips rows with invalid weight or timestamp', () => {
    const parsed = csvToEntries(
      [
        'measuredAt,weightKg,note',
        'nonsense,80,x',
        '2026-03-01T08:00:00.000Z,notanumber,x',
        '2026-03-01T08:00:00.000Z,80,ok',
      ].join('\n')
    );
    expect(parsed).toEqual([
      { measuredAt: '2026-03-01T08:00:00.000Z', weightKg: 80, note: 'ok' },
    ]);
  });
});

describe('jsonToEntries', () => {
  it('reads an array of entries', () => {
    const json = entriesToJson([entry('2026-03-01T08:00:00.000Z', 80, 'x')]);
    expect(jsonToEntries(json)).toEqual([
      { measuredAt: '2026-03-01T08:00:00.000Z', weightKg: 80, note: 'x' },
    ]);
  });

  it('reads an { entries: [...] } wrapper', () => {
    const parsed = jsonToEntries(
      JSON.stringify({ entries: [{ measuredAt: '2026-03-01T08:00:00.000Z', weightKg: 80 }] })
    );
    expect(parsed).toHaveLength(1);
  });

  it('throws on invalid JSON or shape', () => {
    expect(() => jsonToEntries('not json')).toThrow(/valid json/i);
    expect(() => jsonToEntries('{"nope":1}')).toThrow(/array/i);
  });
});

describe('detectFormat', () => {
  it('detects JSON by its opening bracket', () => {
    expect(detectFormat('[{"weightKg":80}]')).toBe('json');
    expect(detectFormat('{"entries":[]}')).toBe('json');
    expect(detectFormat('measuredAt,weightKg')).toBe('csv');
  });
});
