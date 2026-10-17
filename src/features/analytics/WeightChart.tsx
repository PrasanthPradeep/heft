import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatWeight } from '@/lib/format';
import type { WeightUnit } from '@/features/settings/types';
import { kgToLb } from '@/features/weight/weightCalculations';
import type { WeightEntry } from '@/features/weight/types';

import { lineSegments, scaleSeries } from './chartGeometry';
import { sortAscending } from './trendCalculations';

type WeightChartProps = {
  entries: WeightEntry[];
  unit?: WeightUnit;
  height?: number;
};

const LINE_THICKNESS = 2;

/**
 * Dependency-free line chart. Each segment between consecutive readings is a
 * thin view rotated about its left edge, so no native charting module is needed.
 */
export function WeightChart({
  entries,
  unit = 'kg',
  height = 160,
}: WeightChartProps) {
  const [width, setWidth] = useState(0);

  const values = useMemo(
    () =>
      sortAscending(entries).map((entry) =>
        unit === 'lb' ? kgToLb(entry.weightKg) : entry.weightKg
      ),
    [entries, unit]
  );

  const { points, min, max } = useMemo(
    () => scaleSeries(values, width, height),
    [values, width, height]
  );

  const segments = useMemo(() => lineSegments(points), [points]);

  if (values.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>
          Add at least two readings to see your trend.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <View
        style={[styles.plot, { height }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 &&
          segments.map((segment, index) => (
            <View
              key={`segment-${index}`}
              style={[
                styles.segment,
                {
                  left: segment.x,
                  top: segment.y - LINE_THICKNESS / 2,
                  width: segment.length,
                  transform: [
                    { translateX: -segment.length / 2 },
                    { rotate: `${segment.angleDeg}deg` },
                    { translateX: segment.length / 2 },
                  ],
                },
              ]}
            />
          ))}

        {width > 0 &&
          points.map((point, index) => (
            <View
              key={`point-${index}`}
              style={[
                styles.point,
                { left: point.x - 3, top: point.y - 3 },
              ]}
            />
          ))}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisText}>
          min {formatWeight(min, unit)} {unit}
        </Text>
        <Text style={styles.axisText}>
          max {formatWeight(max, unit)} {unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    width: '100%',
    borderRadius: Radius.md,
    backgroundColor: Colors.brandTint,
    overflow: 'hidden',
  },
  segment: {
    position: 'absolute',
    height: LINE_THICKNESS,
    borderRadius: LINE_THICKNESS,
    backgroundColor: Colors.brand,
  },
  point: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.brandDark,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  axisText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: Colors.brandTint,
    padding: Spacing.three,
  },
  emptyText: {
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
