import { lineSegments, scaleSeries } from '../chartGeometry';

describe('scaleSeries', () => {
  it('maps the series into the padded box', () => {
    const { points, min, max } = scaleSeries([10, 20, 30], 100, 50, 8);
    expect(min).toBe(10);
    expect(max).toBe(30);
    expect(points).toEqual([
      { x: 8, y: 42 },
      { x: 50, y: 25 },
      { x: 92, y: 8 },
    ]);
  });

  it('centres a single value horizontally', () => {
    const { points } = scaleSeries([75], 100, 60, 10);
    expect(points).toHaveLength(1);
    expect(points[0].x).toBe(50);
  });

  it('handles flat series without dividing by zero', () => {
    const { points } = scaleSeries([75, 75], 100, 50, 8);
    expect(points.every((point) => Number.isFinite(point.y))).toBe(true);
  });

  it('returns nothing for empty input or a zero-sized box', () => {
    expect(scaleSeries([], 100, 50).points).toEqual([]);
    expect(scaleSeries([1, 2], 0, 50).points).toEqual([]);
  });
});

describe('lineSegments', () => {
  it('builds one segment per consecutive pair', () => {
    const segments = lineSegments([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].length).toBeCloseTo(5, 6);
    expect(segments[0].angleDeg).toBeCloseTo(53.1301, 3);
  });

  it('produces no segments for a single point', () => {
    expect(lineSegments([{ x: 1, y: 1 }])).toEqual([]);
  });
});
