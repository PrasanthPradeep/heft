export type GrayImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

export type BinaryImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

export type Component = {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
};

export function base64ToBytes(base64: string): Uint8Array {
  const comma = base64.indexOf(',');
  const clean = comma >= 0 ? base64.slice(comma + 1) : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function decodeJpegBase64(base64: string): GrayImage & {
  rgba: Uint8Array;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { decode } = require('jpeg-js') as typeof import('jpeg-js');
  const raw = decode(base64ToBytes(base64), {
    useTArray: true,
    formatAsRGBA: true,
  });
  return {
    rgba: raw.data as Uint8Array,
    data: new Uint8Array(raw.width * raw.height),
    width: raw.width,
    height: raw.height,
  };
}

export function toGray(image: GrayImage & { rgba?: Uint8Array }): GrayImage {
  const { rgba, width, height } = image;
  const data = new Uint8Array(width * height);
  if (!rgba) return { data, width, height };

  for (let index = 0, pixel = 0; index < data.length; index += 1, pixel += 4) {
    data[index] =
      (rgba[pixel] * 299 + rgba[pixel + 1] * 587 + rgba[pixel + 2] * 114) /
      1000;
  }
  return { data, width, height };
}

export function otsuThreshold(gray: GrayImage): number {
  const histogram = new Array<number>(256).fill(0);
  for (let index = 0; index < gray.data.length; index += 1) {
    histogram[gray.data[index]] += 1;
  }

  const total = gray.data.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;

  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value];
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += value * histogram[value];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) *
      (meanBackground - meanForeground);

    if (variance > bestVariance) {
      bestVariance = variance;
      best = value;
    }
  }

  return best;
}

export function binarize(gray: GrayImage): BinaryImage {
  const threshold = otsuThreshold(gray);
  const { width, height } = gray;
  const data = new Uint8Array(width * height);

  let bright = 0;
  for (let index = 0; index < gray.data.length; index += 1) {
    if (gray.data[index] > threshold) bright += 1;
  }
  const brightIsBackground = bright / gray.data.length > 0.5;

  for (let index = 0; index < gray.data.length; index += 1) {
    const isBright = gray.data[index] > threshold;
    data[index] = (brightIsBackground ? !isBright : isBright) ? 1 : 0;
  }

  return { data, width, height };
}

export function connectedComponents(binary: BinaryImage): Component[] {
  const { data, width, height } = binary;
  const labels = new Int32Array(width * height).fill(-1);
  const components: Component[] = [];
  const stack = new Int32Array(width * height);

  for (let start = 0; start < data.length; start += 1) {
    if (data[start] !== 1 || labels[start] !== -1) continue;

    const id = components.length;
    let top = 0;
    stack[top] = start;
    top += 1;
    labels[start] = id;

    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (top > 0) {
      top -= 1;
      const index = stack[top];
      const x = index % width;
      const y = (index - x) / width;

      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (data[next] !== 1 || labels[next] !== -1) continue;
          labels[next] = id;
          stack[top] = next;
          top += 1;
        }
      }
    }

    components.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area,
    });
  }

  return components;
}

export function inkRatio(
  binary: BinaryImage,
  x: number,
  y: number,
  width: number,
  height: number
): number {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(binary.width, Math.ceil(x + width));
  const bottom = Math.min(binary.height, Math.ceil(y + height));
  if (right <= left || bottom <= top) return 0;

  let ink = 0;
  let count = 0;
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      ink += binary.data[row * binary.width + column];
      count += 1;
    }
  }
  return count === 0 ? 0 : ink / count;
}
