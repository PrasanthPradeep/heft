export type ChartPoint = { x: number; y: number };

export type LineSegment = {
  x: number;
  y: number;
  length: number;
  angleDeg: number;
};

export type ScaledSeries = {
  points: ChartPoint[];
  min: number;
  max: number;
};

/**
 * Maps a numeric series into pixel coordinates inside a box. The highest value
 * sits at the top (`y = padding`), the lowest at the bottom. A single value is
 * centred horizontally.
 */
export function scaleSeries(
  values: number[],
  width: number,
  height: number,
  padding = 8
): ScaledSeries {
  if (values.length === 0 || width <= 0 || height <= 0) {
    return { points: [], min: 0, max: 0 };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  const points = values.map((value, index) => {
    const ratio = values.length === 1 ? 0.5 : index / (values.length - 1);
    return {
      x: padding + ratio * innerWidth,
      y: padding + innerHeight - ((value - min) / range) * innerHeight,
    };
  });

  return { points, min, max };
}

/**
 * Turns consecutive points into rotated line segments. Each segment starts at
 * the previous point; the renderer rotates a thin view around its left edge.
 */
export function lineSegments(points: ChartPoint[]): LineSegment[] {
  const segments: LineSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    segments.push({
      x: from.x,
      y: from.y,
      length: Math.hypot(dx, dy),
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }

  return segments;
}
