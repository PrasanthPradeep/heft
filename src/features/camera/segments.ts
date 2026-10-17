import type { OcrBox } from './parser';
import type { Component } from './pixels';
import { inkRatio, type BinaryImage } from './pixels';

export const ZONE_FILL_THRESHOLD = 0.45;
export const CELL_MERGE_GAP_RATIO = 0.35;
export const MIN_CELL_HEIGHT_RATIO = 0.25;
export const MAX_CELL_HEIGHT_RATIO = 1.4;
export const MIN_CELL_ASPECT = 0.25;
export const MAX_CELL_ASPECT = 1.4;
export const MAX_CELL_UNION_ASPECT = 0.85;
export const WIDE_CELL_RATIO = 0.45;
export const NARROW_CELL_RATIO = 0.85;
export const DIGIT_ASPECT_RATIO = 0.5;
export const DECIMAL_MAX_HEIGHT_RATIO = 0.4;
export const DECIMAL_TOP_MARGIN = 0.2;
export const DECIMAL_MAX_AREA_RATIO = 0.25;
export const MIN_COMPONENT_AREA = 16;
export const MIN_COMPONENT_HEIGHT = 6;
export const MAX_HAMMING_DISTANCE = 2;
export const MIN_LIT_SEGMENTS = 2;

export const SEGMENT_ZONES: ReadonlyArray<{
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}> = [
  { x0: 0, y0: 0.0, x1: 1, y1: 0.15 },
  { x0: 0.72, y0: 0.0, x1: 1, y1: 0.5 },
  { x0: 0.72, y0: 0.5, x1: 1, y1: 1.0 },
  { x0: 0, y0: 0.85, x1: 1, y1: 1.0 },
  { x0: 0, y0: 0.5, x1: 0.28, y1: 1.0 },
  { x0: 0, y0: 0.0, x1: 0.28, y1: 0.5 },
  { x0: 0, y0: 0.42, x1: 1, y1: 0.58 },
];

const DIGIT_TABLE: Readonly<Record<number, number>> = {
  0b1111110: 0,
  0b0110000: 1,
  0b1101101: 2,
  0b1111001: 3,
  0b0110011: 4,
  0b1011011: 5,
  0b1011111: 6,
  0b1110000: 7,
  0b1111111: 8,
  0b1111011: 9,
};

export type CellDebug = {
  box: OcrBox;
  fills: number[];
  bits: number;
  digit: number | null;
  distance: number;
};

export type SegmentReading = {
  text: string;
  digits: number[];
  decimalIndex: number | null;
  decimalBox?: OcrBox;
  confidence: number;
  cells: CellDebug[];
};

export function hammingDistance(a: number, b: number): number {
  let value = a ^ b;
  let count = 0;
  while (value !== 0) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}

function popcount(value: number): number {
  let count = 0;
  let rest = value;
  while (rest !== 0) {
    count += rest & 1;
    rest >>>= 1;
  }
  return count;
}

export function matchDigit(bits: number): {
  digit: number | null;
  distance: number;
} {
  if (popcount(bits) < MIN_LIT_SEGMENTS) {
    return { digit: null, distance: Number.POSITIVE_INFINITY };
  }

  const exact = DIGIT_TABLE[bits];
  if (exact !== undefined) return { digit: exact, distance: 0 };

  let best = Number.NaN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const key of Object.keys(DIGIT_TABLE)) {
    const distance = hammingDistance(bits, Number(key));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = DIGIT_TABLE[Number(key)];
    }
  }
  return {
    digit: bestDistance <= MAX_HAMMING_DISTANCE ? best : null,
    distance: bestDistance,
  };
}

function gapBetween(a: OcrBox, b: OcrBox): number {
  const gapX = Math.max(
    0,
    Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
  );
  const gapY = Math.max(
    0,
    Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)
  );
  return Math.max(gapX, gapY);
}

function union(a: OcrBox, b: OcrBox): OcrBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function isDigitLike(component: Component, referenceHeight: number): boolean {
  if (component.height < referenceHeight * MIN_CELL_HEIGHT_RATIO) return false;
  if (component.height > referenceHeight * MAX_CELL_HEIGHT_RATIO) return false;
  return component.width / Math.max(1, component.height) <= MAX_CELL_ASPECT;
}

function isDecimalLike(
  component: Component,
  referenceHeight: number,
  groupBottom: number,
  groupSpan: number
): boolean {
  return (
    component.height <= referenceHeight * DECIMAL_MAX_HEIGHT_RATIO &&
    component.area < referenceHeight * referenceHeight * DECIMAL_MAX_AREA_RATIO &&
    component.y + component.height >= groupBottom - groupSpan * DECIMAL_TOP_MARGIN
  );
}

function normalizeCells(cells: OcrBox[]): OcrBox[] {
  if (cells.length === 0) return cells;

  const top = Math.min(...cells.map((cell) => cell.y));
  const bottom = Math.max(...cells.map((cell) => cell.y + cell.height));
  const height = bottom - top;
  if (height <= 0) return cells;

  const wide = cells.filter(
    (cell) => cell.width >= cell.height * WIDE_CELL_RATIO
  );
  const width =
    wide.length > 0
      ? median(wide.map((cell) => cell.width))
      : height * DIGIT_ASPECT_RATIO;

  const normalized: OcrBox[] = [];
  let previousRight = 0;

  for (const cell of cells) {
    const right = cell.x + cell.width;
    const isNarrow = cell.width < width * NARROW_CELL_RATIO;
    const left = isNarrow ? Math.max(right - width, previousRight) : cell.x;
    const boxWidth = isNarrow ? Math.max(right - left, 1) : cell.width;
    normalized.push({
      x: Math.round(left),
      y: top,
      width: Math.round(boxWidth),
      height,
    });
    previousRight = Math.max(previousRight, left + boxWidth);
  }

  return normalized;
}

export function segmentCells(components: Component[]): {
  cells: OcrBox[];
  decimals: Component[];
} {
  const large = components.filter(
    (component) =>
      component.area >= MIN_COMPONENT_AREA &&
      component.height >= MIN_COMPONENT_HEIGHT
  );
  if (large.length === 0) return { cells: [], decimals: [] };

  const byArea = [...large].sort((a, b) => b.area - a.area).slice(0, 16);
  const referenceHeight = Math.max(...byArea.map((c) => c.height));
  if (referenceHeight <= 0) return { cells: [], decimals: [] };

  const candidates = large.filter((c) => isDigitLike(c, referenceHeight));
  if (candidates.length === 0) return { cells: [], decimals: [] };

  const groupTop = Math.min(...candidates.map((c) => c.y));
  const groupBottom = Math.max(...candidates.map((c) => c.y + c.height));
  const groupSpan = Math.max(1, groupBottom - groupTop);

  const decimals = candidates.filter((component) =>
    isDecimalLike(component, referenceHeight, groupBottom, groupSpan)
  );
  const decimalSet = new Set(decimals);
  const digits = candidates
    .filter((component) => !decimalSet.has(component))
    .sort((a, b) => a.x - b.x);
  if (digits.length === 0) return { cells: [], decimals };

  const mergeGap = referenceHeight * CELL_MERGE_GAP_RATIO;
  const cells: OcrBox[] = [];
  for (const component of digits) {
    const box: OcrBox = {
      x: component.x,
      y: component.y,
      width: component.width,
      height: component.height,
    };
    const previous = cells[cells.length - 1];
    if (!previous) {
      cells.push(box);
      continue;
    }
    const merged = union(previous, box);
    const closeEnough = gapBetween(previous, box) <= mergeGap;
    const stillDigitShaped =
      merged.width <= merged.height * MAX_CELL_UNION_ASPECT;
    if (closeEnough && stillDigitShaped) {
      cells[cells.length - 1] = merged;
    } else {
      cells.push(box);
    }
  }

  const kept = cells.filter(
    (cell) => cell.width >= cell.height * MIN_CELL_ASPECT
  );

  return { cells: normalizeCells(kept), decimals };
}

export function readCell(binary: BinaryImage, box: OcrBox): CellDebug {
  const fills = SEGMENT_ZONES.map((zone) =>
    inkRatio(
      binary,
      box.x + zone.x0 * box.width,
      box.y + zone.y0 * box.height,
      (zone.x1 - zone.x0) * box.width,
      (zone.y1 - zone.y0) * box.height
    )
  );

  let bits = 0;
  for (let index = 0; index < fills.length; index += 1) {
    if (fills[index] > ZONE_FILL_THRESHOLD) bits |= 1 << (6 - index);
  }

  const { digit, distance } = matchDigit(bits);
  return { box, fills, bits, digit, distance };
}

export function digitsToText(
  digits: number[],
  decimalIndex: number | null
): string {
  const head = digits.slice(0, decimalIndex ?? digits.length).join('');
  if (decimalIndex === null || decimalIndex === undefined) {
    return digits.join('');
  }
  const tail = digits.slice(decimalIndex).join('');
  return `${head}.${tail}`;
}

export function decodeSevenSegment(
  binary: BinaryImage,
  components: Component[]
): SegmentReading {
  const { cells: boxes, decimals } = segmentCells(components);

  if (boxes.length === 0) {
    return {
      text: '',
      digits: [],
      decimalIndex: null,
      confidence: 0,
      cells: [],
    };
  }

  const cells = boxes.map((box) => readCell(binary, box));
  const readable = cells.filter((cell) => cell.digit !== null);

  const decimal = decimals.sort((a, b) => a.x - b.x)[0];
  const decimalIndex = decimal
    ? cells.filter(
        (cell) => cell.box.x + cell.box.width / 2 < decimal.x + decimal.width / 2
      ).length
    : null;

  const confidence =
    readable.length === cells.length && cells.length > 0
      ? cells.reduce((total, cell) => total + (1 - cell.distance / 4), 0) /
        cells.length
      : 0;

  return {
    text: digitsToText(
      cells.flatMap((cell) => (cell.digit === null ? [] : [cell.digit])),
      decimalIndex
    ),
    digits: cells.flatMap((cell) => (cell.digit === null ? [] : [cell.digit])),
    decimalIndex,
    ...(decimal
      ? {
          decimalBox: {
            x: decimal.x,
            y: decimal.y,
            width: decimal.width,
            height: decimal.height,
          },
        }
      : {}),
    confidence,
    cells,
  };
}

export function summarizeSegments(reading: SegmentReading): string {
  const lines: string[] = [];
  for (const [index, cell] of reading.cells.entries()) {
    const label = cell.digit === null ? 'UNREADABLE' : `'${cell.digit}'`;
    const quality = cell.distance === 0 ? 'exact' : `d=${cell.distance}`;
    lines.push(
      `cell#${index + 1} box=${cell.box.x},${cell.box.y} ${cell.box.width}x${cell.box.height} bits=${cell.bits
        .toString(2)
        .padStart(7, '0')} -> ${label} (${quality})`
    );
  }
  if (reading.decimalBox) {
    lines.push(
      `decimal box=${reading.decimalBox.x},${reading.decimalBox.y} ${reading.decimalBox.width}x${reading.decimalBox.height} index=${reading.decimalIndex}`
    );
  }
  lines.push(
    `segments: ${reading.cells
      .map(
        (cell, index) =>
          `#${index + 1}[${cell.fills.map((fill) => fill.toFixed(2)).join(' ')}]`
      )
      .join('  ')}`
  );
  lines.push(
    `decoded: '${reading.text}' confidence=${reading.confidence.toFixed(2)}`
  );
  return lines.join('\n');
}
