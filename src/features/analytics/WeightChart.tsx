import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatShortDate, formatWeight } from '@/lib/format';
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
const Y_AXIS_WIDTH = 44;

/**
 * Dependency-free line chart. Each segment between consecutive readings is a
 * thin view rotated about its left edge, so no native charting module is needed.
 * Horizontal guides, a value axis, and first/last dates make the shape easier to
 * read without tapping a point.
 */
export function WeightChart({
  entries,
  unit = 'kg',
  height = 160,
}: WeightChartProps) {
  const [width, setWidth] = useState(0);

  const sortedEntries = useMemo(() => sortAscending(entries), [entries]);
  const values = useMemo(
    () =>
      sortedEntries.map((entry) =>
        unit === 'lb' ? kgToLb(entry.weightKg) : entry.weightKg
      ),
    [sortedEntries, unit]
  );

  const { points } = useMemo(
    () => scaleSeries(values, width, height),
    [values, width, height]
  );

  const segments = useMemo(() => lineSegments(points), [points]);
  const first = sortedEntries[0];
  const last = sortedEntries[sortedEntries.length - 1];
  const latestValue = values[values.length - 1];
  const dataMin = values.length > 0 ? Math.min(...values) : 0;
  const dataMax = values.length > 0 ? Math.max(...values) : 0;
  const mid = (dataMin + dataMax) / 2;

  if (values.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>
          {values.length === 1
            ? 'One reading so far. Add another to see your trend.'
            : 'Add at least two readings to see your trend.'}
        </Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.chartRow}>
        <View style={styles.plotColumn}>
          <View
            style={[styles.plot, { height }]}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              first && last
                ? `Weight trend from ${formatShortDate(
                    first.measuredAt
                  )} to ${formatShortDate(
                    last.measuredAt
                  )}. Lowest ${formatWeight(dataMin, unit)} ${unit}, highest ${formatWeight(
                    dataMax,
                    unit
                  )} ${unit}, latest ${formatWeight(latestValue, unit)} ${unit}.`
                : 'Weight trend'
            }>
            {width > 0 ? (
              <>
                {[8, height / 2, height - 8].map((top, index) => (
                  <View
                    key={`grid-${index}`}
                    style={[styles.grid, { top }]}
                  />
                ))}

                {segments.map((segment, index) => (
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

                {points.map((point, index) => {
                  const isLatest = index === points.length - 1;
                  const size = isLatest ? 10 : 6;
                  return (
                    <View
                      key={`point-${index}`}
                      style={[
                        styles.point,
                        isLatest && styles.latestPoint,
                        {
                          left: point.x - size / 2,
                          top: point.y - size / 2,
                          width: size,
                          height: size,
                          borderRadius: size / 2,
                        },
                      ]}
                    />
                  );
                })}
              </>
            ) : null}
          </View>

          <View style={styles.xAxis}>
            <Text style={styles.xAxisText}>
              {first ? formatShortDate(first.measuredAt) : ''}
            </Text>
            <Text style={styles.xAxisText}>
              {last ? formatShortDate(last.measuredAt) : ''}
            </Text>
          </View>
        </View>

        <View style={[styles.yAxis, { height }]}>
          <Text style={styles.axisText}>{formatWeight(dataMax, unit)}</Text>
          <Text style={styles.axisText}>{formatWeight(mid, unit)}</Text>
          <Text style={styles.axisText}>{formatWeight(dataMin, unit)}</Text>
        </View>
      </View>

      <Text style={styles.caption}>
        {sortedEntries.length} readings · latest{' '}
        {formatWeight(latestValue, unit)} {unit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  plotColumn: { flex: 1, minWidth: 0 },
  plot: {
    width: '100%',
    borderRadius: Radius.md,
    backgroundColor: Colors.brandTint,
    overflow: 'hidden',
  },
  grid: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  segment: {
    position: 'absolute',
    height: LINE_THICKNESS,
    borderRadius: LINE_THICKNESS,
    backgroundColor: Colors.brand,
  },
  point: {
    position: 'absolute',
    backgroundColor: Colors.brandDark,
  },
  latestPoint: {
    backgroundColor: Colors.brandDark,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  yAxis: {
    width: Y_AXIS_WIDTH,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: 2,
  },
  axisText: {
    color: Colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  xAxisText: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  caption: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: Spacing.one,
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
