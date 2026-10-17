import {
  decodeSevenSegment,
  digitsToText,
  matchDigit,
  segmentCells,
  summarizeSegments,
  ZONE_FILL_THRESHOLD,
} from '../segments';
import {
  binarize,
  connectedComponents,
  otsuThreshold,
  type BinaryImage,
} from '../pixels';

type SegmentName = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

const SEGMENT_SHAPES: Record<
  SegmentName,
  { x0: number; y0: number; x1: number; y1: number }
> = {
  A: { x0: 0.06, y0: 0.02, x1: 0.94, y1: 0.14 },
  G: { x0: 0.06, y0: 0.45, x1: 0.94, y1: 0.55 },
  D: { x0: 0.06, y0: 0.86, x1: 0.94, y1: 0.98 },
  F: { x0: 0.03, y0: 0.08, x1: 0.22, y1: 0.47 },
  B: { x0: 0.78, y0: 0.08, x1: 0.97, y1: 0.47 },
  E: { x0: 0.03, y0: 0.53, x1: 0.22, y1: 0.92 },
  C: { x0: 0.78, y0: 0.53, x1: 0.97, y1: 0.92 },
};

const DIGIT_SEGMENTS: Record<string, SegmentName[]> = {
  '0': ['A', 'B', 'C', 'D', 'E', 'F'],
  '1': ['B', 'C'],
  '2': ['A', 'B', 'D', 'E', 'G'],
  '3': ['A', 'B', 'C', 'D', 'G'],
  '4': ['B', 'C', 'F', 'G'],
  '5': ['A', 'C', 'D', 'F', 'G'],
  '6': ['A', 'C', 'D', 'E', 'F', 'G'],
  '7': ['A', 'B', 'C'],
  '8': ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  '9': ['A', 'B', 'C', 'D', 'F', 'G'],
};

type RenderOptions = {
  gap?: number;
  invert?: boolean;
  digitWidth?: number;
  digitHeight?: number;
  spacing?: number;
};

function paint(
  image: BinaryImage,
  x: number,
  y: number,
  width: number,
  height: number,
  value: number
) {
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(image.width, Math.round(x + width));
  const bottom = Math.min(image.height, Math.round(y + height));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      image.data[row * image.width + column] = value;
    }
  }
}

function renderDisplay(text: string, options: RenderOptions = {}): BinaryImage {
  const {
    gap = 0,
    invert = false,
    digitWidth = 44,
    digitHeight = 88,
    spacing = 14,
  } = options;

  const padding = 30;
  const slots = [...text].filter((character) => character !== '.').length;
  const hasDecimal = text.includes('.');
  const decimalWidth = hasDecimal ? Math.round(digitWidth * 0.4) : 0;
  const width = padding * 2 + slots * digitWidth + (slots - 1) * spacing + decimalWidth;
  const height = padding * 2 + digitHeight;
  const image: BinaryImage = {
    data: new Uint8Array(width * height),
    width,
    height,
  };

  const ink = invert ? 0 : 1;
  const background = invert ? 1 : 0;
  paint(image, 0, 0, width, height, background);

  let cursor = padding;
  let pendingDecimal = false;
  for (const character of text) {
    if (character === '.') {
      pendingDecimal = true;
      continue;
    }
    if (pendingDecimal) {
      paint(
        image,
        cursor,
        padding + digitHeight * 0.86,
        digitWidth * 0.22,
        digitHeight * 0.12,
        ink
      );
      cursor += decimalWidth;
      pendingDecimal = false;
    }

    const originX = cursor;
    const originY = padding;
    for (const segment of DIGIT_SEGMENTS[character] ?? []) {
      const shape = SEGMENT_SHAPES[segment];
      paint(
        image,
        originX + shape.x0 * digitWidth + gap,
        originY + shape.y0 * digitHeight + gap,
        (shape.x1 - shape.x0) * digitWidth - gap * 2,
        (shape.y1 - shape.y0) * digitHeight - gap * 2,
        ink
      );
    }
    cursor += digitWidth + spacing;
  }

  if (pendingDecimal) {
    paint(
      image,
      cursor,
      padding + digitHeight * 0.86,
      digitWidth * 0.22,
      digitHeight * 0.12,
      ink
    );
  }

  return image;
}

function read(image: BinaryImage) {
  const components = connectedComponents(image);
  const reading = decodeSevenSegment(image, components);
  return { ...reading, debug: summarizeSegments(reading) };
}

describe('pixels', () => {
  it('otsu-separates digits from a flat background', () => {
    const image = renderDisplay('8');
    const gray = {
      data: Uint8Array.from(image.data, (value) => (value ? 230 : 40)),
      width: image.width,
      height: image.height,
    };
    const threshold = otsuThreshold(gray);
    expect(threshold).toBeGreaterThanOrEqual(40);
    expect(threshold).toBeLessThan(230);
    const binary = binarize(gray);
    expect(connectedComponents(binary).length).toBeGreaterThan(0);
    expect(read(binary).text).toBe('8');
  });

  it('keeps inverted (dark-on-light) displays readable', () => {
    const inverted = renderDisplay('8', { invert: true });
    const gray = {
      data: Uint8Array.from(inverted.data, (value) => (value ? 40 : 230)),
      width: inverted.width,
      height: inverted.height,
    };
    const binary = binarize(gray);
    expect(connectedComponents(binary).length).toBeGreaterThan(0);
    expect(read(binary).text).toBe('8');
  });

  it('joins diagonally touching pixels (8-connectivity)', () => {
    const image: BinaryImage = {
      data: new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      width: 3,
      height: 3,
    };
    const components = connectedComponents(image);
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({ x: 0, y: 0, width: 3, height: 3, area: 3 });
  });

  it('separates pixels that do not touch', () => {
    const image: BinaryImage = {
      data: new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 1]),
      width: 3,
      height: 3,
    };
    const components = connectedComponents(image);
    expect(components).toHaveLength(2);
    expect(components[0]).toMatchObject({ x: 0, y: 0, width: 2, height: 1, area: 2 });
    expect(components[1]).toMatchObject({ x: 2, y: 2, width: 1, height: 1, area: 1 });
  });
});

describe('matchDigit', () => {
  it('recognises every exact seven-segment pattern', () => {
    const patterns: Array<[number, number]> = [
      [0b1111110, 0],
      [0b0110000, 1],
      [0b1101101, 2],
      [0b1111001, 3],
      [0b0110011, 4],
      [0b1011011, 5],
      [0b1011111, 6],
      [0b1110000, 7],
      [0b1111111, 8],
      [0b1111011, 9],
    ];
    for (const [bits, digit] of patterns) {
      expect(matchDigit(bits)).toEqual({ digit, distance: 0 });
    }
  });

  it('accepts one segment of noise but refuses a bad match', () => {
    expect(matchDigit(0b1111110)).toEqual({ digit: 0, distance: 0 });
    expect(matchDigit(0b0111110)).toMatchObject({ digit: 0, distance: 1 });
    expect(matchDigit(0b0111111)).toMatchObject({ digit: 8, distance: 1 });
    expect(matchDigit(0b0000000)).toMatchObject({ digit: null });
    expect(matchDigit(0b0000001)).toMatchObject({ digit: null });
    expect(matchDigit(0b0000011).distance).toBeGreaterThan(2);
    expect(matchDigit(0b1010101).distance).toBeGreaterThan(2);
  });
});

describe('digitsToText', () => {
  it('places the decimal point', () => {
    expect(digitsToText([6, 0, 6, 5], 2)).toBe('60.65');
    expect(digitsToText([5, 5, 2], 2)).toBe('55.2');
    expect(digitsToText([8, 2, 4], null)).toBe('824');
    expect(digitsToText([6, 0, 6, 5], 0)).toBe('.6065');
  });
});

describe('decodeSevenSegment', () => {
  it('decodes all ten digits', () => {
    for (const character of '0123456789') {
      const result = read(renderDisplay(character));
      expect({ character, text: result.text }).toEqual({
        character,
        text: character,
      });
      expect(result.confidence).toBe(1);
    }
  });

  it('reads a full reading with a decimal point', () => {
    const result = read(renderDisplay('60.65'));
    expect(result.text).toBe('60.65');
    expect(result.decimalIndex).toBe(2);
    expect(result.confidence).toBe(1);
    expect(result.cells).toHaveLength(4);
    expect(result.decimalBox).toBeDefined();
  });

  it('reads 55.2', () => {
    const result = read(renderDisplay('55.2'));
    expect(result.text).toBe('55.2');
    expect(result.decimalIndex).toBe(2);
  });

  it('reads integer-only displays', () => {
    expect(read(renderDisplay('72')).text).toBe('72');
    expect(read(renderDisplay('100')).text).toBe('100');
  });

  it('handles gapped segments that are not connected', () => {
    const result = read(renderDisplay('60.65', { gap: 3 }));
    expect(result.text).toBe('60.65');
    expect(result.confidence).toBe(1);
  });

  it('survives heavy gapping', () => {
    const result = read(renderDisplay('88.88', { gap: 4 }));
    expect(result.text).toBe('88.88');
  });

  it('tolerates salt-and-pepper noise', () => {
    const image = renderDisplay('60.65');
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let index = 0; index < image.data.length; index += 1) {
      if (random() < 0.03) image.data[index] = image.data[index] ? 0 : 1;
    }
    const result = read(image);
    expect(result.text).toBe('60.65');
  });

  it('ignores a glare blob that is not a digit', () => {
    const image = renderDisplay('60.65');
    paint(image, 200, 20, 40, 40, 1);
    expect(read(image).text).toBe('60.65');
  });

  it('reports unreadable rather than guessing when a digit is occluded', () => {
    const image = renderDisplay('60.65');
    paint(image, 100, 30, 60, 50, 1);
    const result = read(image);
    expect(result.confidence).toBe(0);
    expect(result.text).not.toBe('60.65');
  });

  it('reports unreadable rather than guessing on a blank frame', () => {
    const image: BinaryImage = {
      data: new Uint8Array(200 * 60),
      width: 200,
      height: 60,
    };
    const result = read(image);
    expect(result.cells).toHaveLength(0);
    expect(result.text).toBe('');
    expect(result.confidence).toBe(0);
  });

  it('decodes a real-shaped photo: dark frame, bright digits, unit glyphs', () => {
    const image = renderDisplay('60.65', { gap: 2 });
    paint(image, 150, 20, 26, 16, 1);
    paint(image, 150, 40, 26, 16, 1);
    paint(image, 150, 60, 26, 12, 1);
    const result = read(image);
    expect(result.text).toBe('60.65');
  });

  it('exposes a debug dump that names every cell and its fills', () => {
    const debug = read(renderDisplay('60.65')).debug;
    expect(debug).toContain('cell#1');
    expect(debug).toContain('decimal');
    expect(debug).toContain("decoded: '60.65'");
    expect(debug).toContain('segments:');
  });
});

describe('segmentCells', () => {
  it('groups gapped segments of one digit into a single cell', () => {
    const image = renderDisplay('8', { gap: 4 });
    const components = connectedComponents(image);
    expect(components.length).toBeGreaterThan(1);
    const { cells } = segmentCells(components);
    expect(cells).toHaveLength(1);
  });

  it('does not merge neighbouring digits', () => {
    const components = connectedComponents(renderDisplay('88'));
    const { cells } = segmentCells(components);
    expect(cells).toHaveLength(2);
  });

  it('keeps a decimal blob out of the digit cells', () => {
    const components = connectedComponents(renderDisplay('8.8'));
    const { cells, decimals } = segmentCells(components);
    expect(cells).toHaveLength(2);
    expect(decimals).toHaveLength(1);
  });
});

describe('zone calibration', () => {
  it('lit segments clear the fill threshold and unlit ones do not', () => {
    const image = renderDisplay('8');
    const reading = decodeSevenSegment(image, connectedComponents(image));
    for (const fill of reading.cells[0].fills) {
      expect(fill).toBeGreaterThan(ZONE_FILL_THRESHOLD);
    }

    const one = read(renderDisplay('1'));
    expect(one.text).toBe('1');
    const fills = one.cells[0].fills;
    expect(fills[1]).toBeGreaterThan(ZONE_FILL_THRESHOLD);
    expect(fills[2]).toBeGreaterThan(ZONE_FILL_THRESHOLD);
    expect(fills[0]).toBeLessThan(ZONE_FILL_THRESHOLD);
    expect(fills[6]).toBeLessThan(ZONE_FILL_THRESHOLD);
  });
});
