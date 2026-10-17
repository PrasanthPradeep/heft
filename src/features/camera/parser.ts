export type OcrBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export type WeightCandidate = {
  weightKg: number;
  rawText: string;
  /** Bounding box of the source text token, when OCR provides geometry. */
  box?: OcrBox;
};

export type ScaleProfile = {
  id: string;
  name: string;
  minKg: number;
  maxKg: number;
  graduationKg: number;
};

type OcrElementLike = { text?: string; boundingBox?: OcrBox };
type OcrLineLike = {
  text?: string;
  boundingBox?: OcrBox;
  elements?: OcrElementLike[];
};
type OcrBlockLike = {
  text?: string;
  boundingBox?: OcrBox;
  lines?: OcrLineLike[];
};

/**
 * Structural subset of `expo-mlkit-ocr`'s result. Declared locally so the
 * parser stays dependency-free and testable without a device.
 */
export type RecognitionLike = {
  text?: string;
  blocks?: OcrBlockLike[];
};

type Token = { text: string; box?: OcrBox };

/**
 * A reading is treated as part of the LCD cluster while its glyphs are at
 * least this fraction of the tallest numeric glyph on screen. Body weight is
 * almost always the largest number on a scale's display, but small unrelated
 * numbers (temperature, model sticker) are rejected by this ratio.
 */
export const DOMINANT_SIZE_RATIO = 0.6;

/** Matches a nearby `kg`/`lb` unit, which confirms the LCD readout. */
const UNIT_PATTERN = /(?:kg|kgs|kilo|kilogram|lbs?|pound)/i;

/**
 * OCR commonly confuses a handful of glyphs on seven-segment LCDs.
 * Normalize those before looking for numbers.
 */
export function normalizeDigits(rawText: string): string {
  return rawText
    .replace(/,/g, '.')
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1');
}

/**
 * Many bathroom scales briefly show an all-eights self-test pattern
 * (for example `88:88` or `8888`) when powered on. Every eight passes the
 * numeric range check, so a naive parser would treat it as a weight.
 * We reject it here.
 */
export function looksLikeSegmentSelfTest(rawText: string): boolean {
  const digits = rawText.replace(/\D/g, '');
  if (digits.length < 4) return false;
  if (!/^8+$/.test(digits)) return false;
  // Keep a genuine decimal reading such as "88.88" or "88,88".
  return !/[.,]/.test(rawText);
}

export function isAlignedToGraduation(
  value: number,
  graduationKg: number
): boolean {
  if (graduationKg <= 0) return true;
  const steps = value / graduationKg;
  return Math.abs(steps - Math.round(steps)) <= 0.001;
}

function boxHeight(candidate: WeightCandidate): number {
  return candidate.box?.height ?? 0;
}

function boxesOverlap(a?: OcrBox, b?: OcrBox): boolean {
  // Without geometry we cannot prove separation, so assume overlap.
  if (!a || !b) return true;
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** True when two boxes sit close together (same visual row/field). */
function isNear(a?: OcrBox, b?: OcrBox): boolean {
  if (!a || !b) return false;
  const reference = Math.max(a.height, b.height, 1);
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return (
    Math.abs(ay - by) <= reference * 1.2 &&
    Math.abs(ax - bx) <= Math.max(a.width, b.width) * 0.75 + reference
  );
}

function unionBox(a?: OcrBox, b?: OcrBox): OcrBox | undefined {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Pulls every distinct number out of a single text token. */
function extractNumbers(text: string): { value: number; rawText: string }[] {
  if (looksLikeSegmentSelfTest(text)) {
    return [];
  }

  const normalized = normalizeDigits(text);

  // Recognize decimal values and integer displays.
  // Do not silently insert a decimal point into an integer.
  const matches = normalized.match(/\d+(?:\.\d+)?/g) ?? [];
  const seen = new Set<number>();
  const results: { value: number; rawText: string }[] = [];

  for (const match of matches) {
    const value = Number(match);
    if (!Number.isFinite(value) || seen.has(value)) continue;
    seen.add(value);
    results.push({ value, rawText: match });
  }

  return results;
}

function inRange(value: number, profile: ScaleProfile): boolean {
  return value >= profile.minKg && value <= profile.maxKg;
}

/** Every possible decimal placement for an integer digit string. */
function decimalPlacements(digits: string): string[] {
  const placements: string[] = [];
  for (let i = 1; i < digits.length; i += 1) {
    placements.push(`${digits.slice(0, i)}.${digits.slice(i)}`);
  }
  return placements;
}

/**
 * Readings for a single OCR token.
 *
 * Seven-segment decimal points are frequently not recognised: a scale showing
 * `55.2` comes back as `552`. When `allowInference` is set (the token belongs
 * to the weight field, i.e. it sits next to a `kg`/`lb` unit) and the plain
 * integer does not fit the profile, we recover the decimal placements that fit
 * the range and align with the profile's graduation.
 */
function readingsForToken(
  text: string,
  profile: ScaleProfile,
  allowInference: boolean
): { value: number; rawText: string }[] {
  const readings: { value: number; rawText: string }[] = [];

  for (const number of extractNumbers(text)) {
    if (number.rawText.includes('.')) {
      if (inRange(number.value, profile)) readings.push(number);
      continue;
    }

    if (inRange(number.value, profile)) {
      readings.push(number);
      continue;
    }

    if (!allowInference) continue;

    for (const placement of decimalPlacements(number.rawText)) {
      const value = Number(placement);
      if (
        inRange(value, profile) &&
        isAlignedToGraduation(value, profile.graduationKg)
      ) {
        readings.push({ value, rawText: placement });
      }
    }
  }

  return readings;
}

/**
 * Text-only entry point (used as a fallback when OCR returns no geometry).
 * Applies the strict graduation filter so unchecked text cannot sneak through.
 */
export function parseWeightCandidates(
  rawText: string,
  profile: ScaleProfile
): WeightCandidate[] {
  return readingsForToken(rawText, profile, false)
    .filter((number) =>
      isAlignedToGraduation(number.value, profile.graduationKg)
    )
    .map((number) => ({ weightKg: number.value, rawText: number.rawText }));
}

function isNumericFragment(text: string): boolean {
  const normalized = normalizeDigits(text).replace(/\s/g, '');
  return normalized.length > 0 && /^[0-9.]+$/.test(normalized);
}

function areAdjacent(a: OcrElementLike, b: OcrElementLike): boolean {
  const ba = a.boundingBox;
  const bb = b.boundingBox;
  if (!ba || !bb) return false;

  const gap = bb.x - (ba.x + ba.width);
  const reference = Math.max(ba.height, bb.height, 1);
  if (gap > reference * 0.6) return false;

  const verticalOverlap =
    Math.min(ba.y + ba.height, bb.y + bb.height) - Math.max(ba.y, bb.y);
  return verticalOverlap > Math.min(ba.height, bb.height) * 0.3;
}

/**
 * Rejoins numeric fragments that OCR split around a decimal point
 * (for example "55" + "." + "2" -> "55.2") when they sit next to each other
 * on the same row.
 */
function mergeNumericFragments(elements: OcrElementLike[]): OcrElementLike[] {
  const sorted = elements
    .filter((element) => (element.text ?? '').length > 0)
    .sort((a, b) => (a.boundingBox?.x ?? 0) - (b.boundingBox?.x ?? 0));

  const merged: OcrElementLike[] = [];

  for (const element of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      isNumericFragment(previous.text ?? '') &&
      isNumericFragment(element.text ?? '') &&
      areAdjacent(previous, element)
    ) {
      merged[merged.length - 1] = {
        text: `${previous.text ?? ''}${element.text ?? ''}`,
        boundingBox: unionBox(previous.boundingBox, element.boundingBox),
      };
    } else {
      merged.push({ ...element });
    }
  }

  return merged;
}

/**
 * Flattens an OCR result into text tokens. Both merged glyph elements (precise
 * per-token boxes) and whole lines (robust text when glyphs were split oddly)
 * are emitted, so a reading survives either representation.
 */
function gatherTokens(result: RecognitionLike): Token[] {
  const tokens: Token[] = [];

  for (const block of result.blocks ?? []) {
    const lines = block.lines ?? [];

    if (lines.length > 0) {
      for (const line of lines) {
        for (const element of mergeNumericFragments(line.elements ?? [])) {
          if ((element.text ?? '').length > 0) {
            tokens.push({
              text: element.text as string,
              box: element.boundingBox ?? line.boundingBox,
            });
          }
        }
        if ((line.text ?? '').length > 0) {
          tokens.push({ text: line.text as string, box: line.boundingBox });
        }
      }
    } else if ((block.text ?? '').length > 0) {
      tokens.push({ text: block.text as string, box: block.boundingBox });
    }
  }

  if (tokens.length === 0 && (result.text ?? '').length > 0) {
    tokens.push({ text: result.text as string });
  }

  return tokens;
}

function dedupeByValue(candidates: WeightCandidate[]): WeightCandidate[] {
  const byValue = new Map<number, WeightCandidate>();
  for (const candidate of candidates) {
    const previous = byValue.get(candidate.weightKg);
    if (!previous || boxHeight(candidate) > boxHeight(previous)) {
      byValue.set(candidate.weightKg, candidate);
    }
  }
  return [...byValue.values()];
}

/**
 * Drops a reading that is a literal substring of a more specific reading in
 * the same region (for example "55" when "55.2" was also found), which happens
 * when OCR splits a decimal across elements.
 */
function removeSubsumed(candidates: WeightCandidate[]): WeightCandidate[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate &&
          other.rawText.length > candidate.rawText.length &&
          other.rawText.includes(candidate.rawText) &&
          boxesOverlap(other.box, candidate.box)
      )
  );
}

function scoreCandidate(
  candidate: WeightCandidate,
  maxHeight: number,
  profile: ScaleProfile,
  unitValues: Set<number>,
  imageSize?: ImageSize
): number {
  let score = 0;

  if (maxHeight > 0) {
    score += (boxHeight(candidate) / maxHeight) * 100;
  }

  // A nearby "kg"/"lb" unit is the strongest confirmation it is the weight.
  if (unitValues.has(candidate.weightKg)) score += 45;

  if (isAlignedToGraduation(candidate.weightKg, profile.graduationKg)) {
    score += 20;
  }

  // Real scale readings carry a decimal point.
  if (candidate.rawText.includes('.')) score += 10;

  // The LCD sits near the centre of the frame.
  if (candidate.box && imageSize && imageSize.width > 0) {
    const centerX = (candidate.box.x + candidate.box.width / 2) / imageSize.width;
    score += Math.max(0, 1 - Math.abs(centerX - 0.5) * 2) * 12;
  }

  return score;
}

/**
 * Geometry-aware entry point. Flattens the OCR result into text tokens, reads
 * numbers from each token together with its bounding box, keeps the
 * largest-font cluster (the LCD), and ranks the survivors by glyph size,
 * proximity to a `kg` unit, decimal presence, graduation fit, and how centred
 * they are in the frame.
 */
export function parseWeightCandidatesFromRecognition(
  result: RecognitionLike,
  profile: ScaleProfile,
  imageSize?: ImageSize
): WeightCandidate[] {
  const tokens = gatherTokens(result);
  const unitBoxes = tokens
    .filter((token) => UNIT_PATTERN.test(token.text))
    .map((token) => token.box)
    .filter((box): box is OcrBox => box !== undefined);

  const unitValues = new Set<number>();
  const collected: WeightCandidate[] = [];

  for (const token of tokens) {
    const tokenHasUnit = UNIT_PATTERN.test(token.text);
    const nearUnit = unitBoxes.some((box) => isNear(box, token.box));
    const isWeightField = tokenHasUnit || nearUnit;

    for (const reading of readingsForToken(token.text, profile, isWeightField)) {
      if (tokenHasUnit || nearUnit) unitValues.add(reading.value);
      collected.push({
        weightKg: reading.value,
        rawText: reading.rawText,
        ...(token.box ? { box: token.box } : {}),
      });
    }
  }

  const candidates = removeSubsumed(dedupeByValue(collected));

  // Never come back empty when the raw text contains a usable number.
  if (candidates.length === 0) {
    return parseWeightCandidates(result.text ?? '', profile);
  }

  const maxHeight = Math.max(...candidates.map(boxHeight));
  const dominant =
    maxHeight > 0
      ? candidates.filter(
          (candidate) => boxHeight(candidate) >= maxHeight * DOMINANT_SIZE_RATIO
        )
      : candidates;

  const pool = dominant.length > 0 ? dominant : candidates;

  return pool
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, maxHeight, profile, unitValues, imageSize),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        boxHeight(b.candidate) - boxHeight(a.candidate) ||
        b.candidate.weightKg - a.candidate.weightKg ||
        (a.candidate.box?.x ?? 0) - (b.candidate.box?.x ?? 0)
    )
    .map((entry) => entry.candidate);
}

/**
 * Maps a recognition result captured on a cropped/resized region back into
 * full-image coordinates, so boxes from several passes stay comparable.
 */
export function shiftRecognition(
  result: RecognitionLike,
  originX: number,
  originY: number,
  scale = 1
): RecognitionLike {
  const shift = (box?: OcrBox): OcrBox | undefined =>
    box
      ? {
          x: box.x * scale + originX,
          y: box.y * scale + originY,
          width: box.width * scale,
          height: box.height * scale,
        }
      : undefined;

  return {
    text: result.text,
    blocks: (result.blocks ?? []).map((block) => ({
      text: block.text,
      boundingBox: shift(block.boundingBox),
      lines: (block.lines ?? []).map((line) => ({
        text: line.text,
        boundingBox: shift(line.boundingBox),
        elements: (line.elements ?? []).map((element) => ({
          text: element.text,
          boundingBox: shift(element.boundingBox),
        })),
      })),
    })),
  };
}

/** Concatenates several recognition results into one text + block list. */
export function mergeRecognitions(results: RecognitionLike[]): RecognitionLike {
  return {
    text: results
      .map((result) => result.text ?? '')
      .filter((segment) => segment.length > 0)
      .join('\n'),
    blocks: results.flatMap((result) => result.blocks ?? []),
  };
}

/**
 * Readable dump of the OCR result for the on-device troubleshooting panel.
 * Shows each line/element's text and geometry so a bad capture can be
 * diagnosed without a debugger.
 */
export function summarizeRecognition(result: RecognitionLike): string {
  const rows: string[] = [];
  const round = (value: number) => Math.round(value);

  for (const block of result.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const box = line.boundingBox;
      rows.push(
        `line "${line.text ?? ''}"${
          box ? ` @${round(box.x)},${round(box.y)} ${round(box.width)}x${round(box.height)}` : ''
        }`
      );
      for (const element of line.elements ?? []) {
        const elementBox = element.boundingBox;
        rows.push(
          `  el "${element.text ?? ''}"${
            elementBox
              ? ` @${round(elementBox.x)},${round(elementBox.y)} ${round(elementBox.width)}x${round(elementBox.height)}`
              : ''
          }`
        );
      }
    }
    if ((block.lines ?? []).length === 0 && (block.text ?? '').length > 0) {
      rows.push(`block "${block.text}"`);
    }
  }

  if (rows.length === 0) {
    return result.text ?? '';
  }

  return rows.join('\n');
}
