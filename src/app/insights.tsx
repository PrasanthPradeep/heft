import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Card, Label, Screen, Title } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDateTime, formatSigned, formatWeight } from '@/lib/format';
import { WeightChart } from '@/features/analytics/WeightChart';
import { loadDailyActivity } from '@/features/activity/activityRepository';
import {
  summarizeActivity,
  type ActivitySummary,
} from '@/features/activity/activityCalculations';
import type { DailyActivity } from '@/features/activity/types';
import {
  computeGoalProgress,
  nextMilestone,
  reachedMilestones,
  rollingAverage,
  weeklyChange,
  monthlyChange,
} from '@/features/analytics/trendCalculations';
import { loadLastSyncedAt } from '@/features/settings/preferenceStore';
import { usePreferences } from '@/features/settings/preferences';
import { kgToLb, parseWeightInput } from '@/features/weight/weightCalculations';
import type { WeightEntry } from '@/features/weight/types';
import { getWeightRepository } from '@/features/weight/weightRepository';

function changeInUnit(
  value: number | null,
  unit: 'kg' | 'lb'
): number | null {
  if (value === null) return null;
  return unit === 'lb' ? kgToLb(value) : value;
}

function activitySummaryFor(days: DailyActivity[]): ActivitySummary {
  return summarizeActivity(days);
}

export default function InsightsScreen() {
  const { preferences, updatePreferences } = usePreferences();
  const unit = preferences.weightUnit;
  const repository = getWeightRepository(preferences.storageMode);

  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(
    null
  );
  const [goalInput, setGoalInput] = useState(
    preferences.goalWeightKg
      ? formatWeight(preferences.goalWeightKg, unit)
      : ''
  );

  const load = useCallback(async () => {
    const [rows, syncedAt, activityDays] = await Promise.all([
      repository.listWeights(),
      loadLastSyncedAt(),
      loadDailyActivity(),
    ]);
    setEntries(rows);
    setLastSyncedAt(syncedAt);
    setActivitySummary(activityDays.length > 0 ? activitySummaryFor(activityDays) : null);
  }, [repository]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        // The screen still renders with whatever it has.
      });
    }, [load])
  );

  const averages = rollingAverage(entries, 7);
  const latestAverage = averages.length > 0 ? averages[averages.length - 1] : null;
  const weekly = changeInUnit(weeklyChange(entries), unit);
  const monthly = changeInUnit(monthlyChange(entries), unit);
  const goal = computeGoalProgress(entries, preferences.goalWeightKg);
  const reached = goal ? reachedMilestones(goal.progress) : [];
  const next = goal ? nextMilestone(goal.progress) : null;

  async function saveGoal() {
    if (goalInput.trim().length === 0) {
      await updatePreferences({ goalWeightKg: null });
      return;
    }

    try {
      const goalWeightKg = parseWeightInput(goalInput, unit);
      await updatePreferences({ goalWeightKg });
    } catch (error) {
      Alert.alert(
        'Check the goal',
        error instanceof Error ? error.message : 'Enter a valid weight.'
      );
    }
  }

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Insights</Title>

        <Card style={styles.card}>
          <Label>Weight trend</Label>
          <WeightChart entries={entries} unit={unit} />
        </Card>

        <View style={styles.statRow}>
          <Card style={styles.stat}>
            <Text style={styles.statLabel}>7-day average</Text>
            <Text style={styles.statValue}>
              {latestAverage ? formatWeight(latestAverage.averageKg, unit) : '--'}
              <Text style={styles.statUnit}> {unit}</Text>
            </Text>
          </Card>
          <Card style={styles.stat}>
            <Text style={styles.statLabel}>Weekly change</Text>
            <Text style={styles.statValue}>
              {weekly === null ? '--' : formatSigned(weekly)}
              <Text style={styles.statUnit}> {unit}</Text>
            </Text>
          </Card>
          <Card style={styles.stat}>
            <Text style={styles.statLabel}>30-day change</Text>
            <Text style={styles.statValue}>
              {monthly === null ? '--' : formatSigned(monthly)}
              <Text style={styles.statUnit}> {unit}</Text>
            </Text>
          </Card>
        </View>

        <Card style={styles.card}>
          <Label>Goal weight ({unit})</Label>
          <View style={styles.goalRow}>
            <TextInput
              value={goalInput}
              onChangeText={(text) => setGoalInput(text.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              placeholder={unit === 'lb' ? '160' : '72'}
              style={styles.goalInput}
            />
            <Button
              label="Update"
              variant="secondary"
              onPress={saveGoal}
              style={styles.goalButton}
            />
          </View>

          {goal ? (
            <View style={styles.goalProgress}>
              <Text style={styles.goalText}>
                {formatWeight(goal.currentKg, unit)} {unit} of{' '}
                {formatWeight(goal.goalKg, unit)} {unit} ·{' '}
                {Math.round(goal.progress * 100)}%
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round(goal.progress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.goalDetail}>
                {goal.remainingKg < 0.05
                  ? 'Goal reached. Well done!'
                  : `${formatWeight(goal.remainingKg, unit)} ${unit} to go`}
                {'(from '}
                {formatWeight(goal.startKg, unit)} {unit}
                {')'}
              </Text>
              <Text style={styles.milestoneText}>
                {reached.length > 0
                  ? `Milestones: ${reached
                      .map((milestone) => `${Math.round(milestone * 100)}%`)
                      .join(', ')}`
                  : 'No milestones reached yet'}
                {next !== null
                  ? ` · Next: ${Math.round(next * 100)}%`
                  : ''}
              </Text>
            </View>
          ) : (
            <Text style={styles.hint}>
              Set a goal weight to track progress and milestones.
            </Text>
          )}
        </Card>

        {preferences.storageMode === 'health-connect' ? (
          <Card style={styles.card}>
            <Label>Health Connect</Label>
            <Text style={styles.hint}>
              {lastSyncedAt
                ? `Last synced ${formatDateTime(lastSyncedAt)}`
                : 'Not synced yet.'}
            </Text>
            <Text style={styles.hint}>
              Heft reads the last 30 days of weight from Health Connect.
            </Text>
            {activitySummary ? (
              <Text style={styles.hint}>
                Activity: {Math.round(activitySummary.averageSteps7d ?? 0).toLocaleString()}{' '}
                steps/day average · {activitySummary.exerciseMinutes7d} exercise
                minutes this week · active {activitySummary.activeDays7d}/7 days.
              </Text>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
  card: { gap: Spacing.two, padding: Spacing.three },
  statRow: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, padding: Spacing.three, gap: Spacing.one },
  statLabel: { color: Colors.textSecondary, fontSize: 12 },
  statValue: { fontSize: 20, fontWeight: '700', color: Colors.text },
  statUnit: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },
  goalRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  goalInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.three,
    backgroundColor: Colors.surface,
    fontSize: 18,
  },
  goalButton: { paddingHorizontal: Spacing.four },
  goalProgress: { gap: Spacing.two, marginTop: Spacing.two },
  goalText: { fontWeight: '700', color: Colors.text, fontSize: 16 },
  progressTrack: {
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.brandTint,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.brand,
  },
  goalDetail: { color: Colors.textSecondary, fontSize: 14 },
  milestoneText: { color: Colors.textMuted, fontSize: 13 },
  hint: { color: Colors.textSecondary, lineHeight: 21 },
});
