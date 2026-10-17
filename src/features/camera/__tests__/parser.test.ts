import {
  looksLikeSegmentSelfTest,
  mergeRecognitions,
  parseWeightCandidates,
  parseWeightCandidatesFromRecognition,
  shiftRecognition,
  type RecognitionLike,
  type ScaleProfile,
} from '../parser';
import { getScaleProfile } from '../profiles';

const flora = getScaleProfile('ant-flora');
const precision: ScaleProfile = getScaleProfile('precision-0-01');
const basic: ScaleProfile = getScaleProfile('basic-1');

describe('looksLikeSegmentSelfTest', () => {
  it('detects all-eights startup patterns', () => {
    expect(looksLikeSegmentSelfTest('88:88')).toBe(true);
    expect(looksLikeSegmentSelfTest('8888')).toBe(true);
  });

  it('does not flag genuine decimal readings', () => {
    expect(looksLikeSegmentSelfTest('88.88')).toBe(false);
    expect(looksLikeSegmentSelfTest('54.25')).toBe(false);
  });
});

describe('parseWeightCandidates', () => {
  it('reads a decimal reading with a unit suffix', () => {
    expect(parseWeightCandidates('54.25 kg', flora)).toEqual([
      { weightKg: 54.25, rawText: '54.25' },
    ]);
  });

  it('normalizes comma decimal separators', () => {
    expect(parseWeightCandidates('54,25', flora)).toEqual([
      { weightKg: 54.25, rawText: '54.25' },
    ]);
  });

  it('accepts the profile maximum', () => {
    expect(parseWeightCandidates('180.00', flora)).toEqual([
      { weightKg: 180, rawText: '180.00' },
    ]);
  });

  it('normalizes commonly confused glyphs', () => {
    expect(parseWeightCandidates('54.2O', flora)).toEqual([
      { weightKg: 54.2, rawText: '54.20' },
    ]);
  });

  it('rejects values below and above the profile range', () => {
    expect(parseWeightCandidates('4.90', flora)).toEqual([]);
    expect(parseWeightCandidates('215.00', flora)).toEqual([]);
  });

  it('rejects readings that do not align with the graduation', () => {
    // 0.05 kg graduation: 54.23 is not a valid step.
    expect(parseWeightCandidates('54.23', flora)).toEqual([]);
    // 54.2 (54.20) is a valid 0.05 step...
    expect(parseWeightCandidates('54.2', flora)).toEqual([
      { weightKg: 54.2, rawText: '54.2' },
    ]);
    // ...and remains valid on a 0.1 kg scale.
    expect(parseWeightCandidates('54.2', getScaleProfile('standard-0-1'))).toEqual([
      { weightKg: 54.2, rawText: '54.2' },
    ]);
  });

  it('returns every distinct candidate but de-duplicates repeats', () => {
    expect(parseWeightCandidates('54.25 54.30 54.25', flora)).toEqual([
      { weightKg: 54.25, rawText: '54.25' },
      { weightKg: 54.3, rawText: '54.30' },
    ]);
  });

  it('drops the all-eights self-test display', () => {
    expect(parseWeightCandidates('88:88', flora)).toEqual([]);
  });

  it('handles integer-only scales without inventing decimals', () => {
    expect(parseWeightCandidates('88', basic)).toEqual([
      { weightKg: 88, rawText: '88' },
    ]);
    expect(parseWeightCandidates('88.5', basic)).toEqual([]);
  });

  it('supports finer graduation profiles', () => {
    expect(parseWeightCandidates('54.20', precision)).toEqual([
      { weightKg: 54.2, rawText: '54.20' },
    ]);
  });

  it('returns nothing for empty or non-numeric text', () => {
    expect(parseWeightCandidates('', flora)).toEqual([]);
    expect(parseWeightCandidates('Err', flora)).toEqual([]);
  });
});

describe('parseWeightCandidatesFromRecognition', () => {
  function element(text: string, x: number, y: number, height: number, width = height) {
    return { text, boundingBox: { x, y, width, height } };
  }
  function line(
    text: string,
    boundingBox: { x: number; y: number; width: number; height: number },
    elements: ReturnType<typeof element>[]
  ) {
    return { text, boundingBox, elements };
  }

  it('prefers the large LCD digits over smaller surrounding text', () => {
    const result: RecognitionLike = {
      text: '24.5\n55.2 kg',
      blocks: [
        {
          text: '24.5',
          boundingBox: { x: 10, y: 10, width: 60, height: 20 },
          lines: [
            line('24.5', { x: 10, y: 10, width: 60, height: 20 }, [
              element('24.5', 10, 10, 20, 60),
            ]),
          ],
        },
        {
          text: '55.2 kg',
          boundingBox: { x: 100, y: 200, width: 220, height: 80 },
          lines: [
            line('55.2 kg', { x: 100, y: 200, width: 220, height: 80 }, [
              element('55.2', 100, 200, 80, 160),
              element('kg', 270, 230, 20, 40),
            ]),
          ],
        },
      ],
    };

    const candidates = parseWeightCandidatesFromRecognition(result, flora);
    expect(candidates.map((c) => c.weightKg)).toEqual([55.2]);
    expect(candidates[0].box).toEqual({ x: 100, y: 200, width: 160, height: 80 });
  });

  it('rejoins numeric fragments split around a decimal point', () => {
    const result: RecognitionLike = {
      text: '55 . 2',
      blocks: [
        {
          text: '55 . 2',
          boundingBox: { x: 50, y: 50, width: 140, height: 90 },
          lines: [
            line('55 . 2', { x: 50, y: 50, width: 140, height: 90 }, [
              element('55', 50, 50, 90, 60),
              element('.', 114, 50, 90, 12),
              element('2', 130, 50, 90, 40),
            ]),
          ],
        },
      ],
    };

    expect(
      parseWeightCandidatesFromRecognition(result, flora).map((c) => c.weightKg)
    ).toEqual([55.2]);
  });

  it('ignores small unrelated numbers such as a temperature', () => {
    const result: RecognitionLike = {
      text: '24.5 C\n55.20',
      blocks: [
        {
          text: '24.5 C',
          boundingBox: { x: 10, y: 10, width: 120, height: 24 },
          lines: [
            line('24.5 C', { x: 10, y: 10, width: 120, height: 24 }, [
              element('24.5', 10, 10, 24, 70),
              element('C', 90, 10, 24, 30),
            ]),
          ],
        },
        {
          text: '55.20',
          boundingBox: { x: 40, y: 300, width: 240, height: 110 },
          lines: [
            line('55.20', { x: 40, y: 300, width: 240, height: 110 }, [
              element('55.20', 40, 300, 110, 240),
            ]),
          ],
        },
      ],
    };

    expect(
      parseWeightCandidatesFromRecognition(result, flora).map((c) => c.weightKg)
    ).toEqual([55.2]);
  });

  it('falls back to plain text parsing when no blocks are returned', () => {
    expect(
      parseWeightCandidatesFromRecognition({ text: '54.25 kg' }, flora)
    ).toEqual([{ weightKg: 54.25, rawText: '54.25' }]);
  });

  it('reads numbers from lines that carry no elements', () => {
    const result: RecognitionLike = {
      text: '55.2',
      blocks: [
        {
          text: '55.2',
          boundingBox: { x: 0, y: 0, width: 200, height: 90 },
          lines: [
            { text: '55.2', boundingBox: { x: 0, y: 0, width: 200, height: 90 } },
          ],
        },
      ],
    };

    expect(
      parseWeightCandidatesFromRecognition(result, flora).map((c) => c.weightKg)
    ).toEqual([55.2]);
  });

  it('prefers a slightly smaller number that carries a kg unit', () => {
    const result: RecognitionLike = {
      text: '24.5\n55.2 kg',
      blocks: [
        {
          text: '24.5',
          boundingBox: { x: 180, y: 40, width: 120, height: 100 },
          lines: [
            {
              text: '24.5',
              boundingBox: { x: 180, y: 40, width: 120, height: 100 },
            },
          ],
        },
        {
          text: '55.2 kg',
          boundingBox: { x: 200, y: 300, width: 200, height: 60 },
          lines: [
            {
              text: '55.2 kg',
              boundingBox: { x: 200, y: 300, width: 200, height: 60 },
            },
          ],
        },
      ],
    };

    const candidates = parseWeightCandidatesFromRecognition(result, flora, {
      width: 400,
      height: 600,
    });
    expect(candidates[0].weightKg).toBe(55.2);
  });

  it('recovers the LCD decimal from real ML Kit output (55.2 read as 552)', () => {
    const result: RecognitionLike = {
      text: '552\nkg\nHedLTHZSense',
      blocks: [
        {
          text: '552',
          boundingBox: { x: 1149, y: 1118, width: 476, height: 354 },
          lines: [
            {
              text: '552',
              boundingBox: { x: 1149, y: 1118, width: 476, height: 354 },
            },
            {
              text: 'kg',
              boundingBox: { x: 1453, y: 1398, width: 76, height: 65 },
            },
            {
              text: 'HedLTHZSense',
              boundingBox: { x: 1076, y: 2437, width: 590, height: 129 },
            },
          ],
        },
      ],
    };

    expect(
      parseWeightCandidatesFromRecognition(result, flora).map((c) => c.weightKg)
    ).toEqual([55.2]);
  });

  it('never returns empty when the raw text holds a usable reading', () => {
    const result: RecognitionLike = {
      text: 'MODEL X200 82.4 kg',
      blocks: [
        {
          text: 'MODEL X200',
          boundingBox: { x: 0, y: 0, width: 300, height: 40 },
          lines: [
            {
              text: 'MODEL X200',
              boundingBox: { x: 0, y: 0, width: 300, height: 40 },
            },
          ],
        },
      ],
    };

    expect(
      parseWeightCandidatesFromRecognition(result, flora).map((c) => c.weightKg)
    ).toEqual([82.4]);
  });
});

describe('shiftRecognition / mergeRecognitions', () => {
  const recognition: RecognitionLike = {
    text: '55.2',
    blocks: [
      {
        text: '55.2',
        boundingBox: { x: 10, y: 20, width: 30, height: 40 },
        lines: [
          {
            text: '55.2',
            boundingBox: { x: 10, y: 20, width: 30, height: 40 },
            elements: [
              { text: '55.2', boundingBox: { x: 10, y: 20, width: 30, height: 40 } },
            ],
          },
        ],
      },
    ],
  };

  it('maps boxes from a region back into full-image coordinates', () => {
    const shifted = shiftRecognition(recognition, 100, 200, 2);
    const block = shifted.blocks![0];
    expect(block.boundingBox).toEqual({ x: 120, y: 240, width: 60, height: 80 });
    expect(block.lines![0].elements![0].boundingBox).toEqual(block.boundingBox);
  });

  it('merges text and blocks from several passes', () => {
    const other = shiftRecognition(recognition, 500, 600, 1);
    const merged = mergeRecognitions([recognition, other]);
    expect(merged.text).toBe('55.2\n55.2');
    expect(merged.blocks).toHaveLength(2);
  });

  it('keeps the same reading comparable across two regions', () => {
    // A band pass magnifies the LCD: it maps back with a larger box height.
    const band = shiftRecognition(recognition, 0, 400, 2);
    const full = shiftRecognition(recognition, 0, 0, 1);
    const candidates = parseWeightCandidatesFromRecognition(
      mergeRecognitions([full, band]),
      flora,
      { width: 1000, height: 2000 }
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].weightKg).toBe(55.2);
    // The tallest observation of the same value wins.
    expect(candidates[0].box).toEqual({ x: 20, y: 440, width: 60, height: 80 });
  });
});
