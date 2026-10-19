import type { AiMethod } from '@/features/ai/types';
import { DEFAULT_WATER_TARGET_ML } from '@/features/water/waterCalculations';

export type StorageMode = 'health-connect' | 'local';

export type WeightUnit = 'kg' | 'lb';

export type ReminderRepeat = 'daily' | 'weekly';

export type AppPreferences = {
  storageMode: StorageMode;
  onboardingCompleted: boolean;
  weightUnit: WeightUnit;
  /** Optional goal weight, always stored in kilograms. */
  goalWeightKg: number | null;
  /** Weigh-in reminder. Off by default, and so is the notification permission. */
  reminderEnabled: boolean;
  reminderRepeat: ReminderRepeat;
  /** 1 = Sunday … 7 = Saturday, matching the OS weekday convention. */
  reminderWeekday: number;
  reminderHour: number;
  reminderMinute: number;
  /** Independent water reminder: prompts spread across a daily window. */
  waterReminderEnabled: boolean;
  waterStartHour: number;
  waterEndHour: number;
  waterIntervalHours: number;
  /** Daily water target in millilitres, used by the dashboard progress bar. */
  waterTargetMl: number;
  /** How the built-in assistant reaches a model. Off by default. */
  aiMethod: AiMethod;
  /** Selected model slug, shared by both connection methods. */
  aiModel: string | null;
  /** Whether the user agreed to attach weight/trend data to assistant messages. */
  aiShareHealth: boolean;
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  storageMode: 'local',
  onboardingCompleted: false,
  weightUnit: 'kg',
  goalWeightKg: null,
  reminderEnabled: false,
  reminderRepeat: 'daily',
  // Monday: a week is easier to plan at its start than in its middle.
  reminderWeekday: 2,
  reminderHour: 7,
  reminderMinute: 0,
  waterReminderEnabled: false,
  waterStartHour: 9,
  waterEndHour: 21,
  waterIntervalHours: 2,
  waterTargetMl: DEFAULT_WATER_TARGET_ML,
  aiMethod: 'none',
  aiModel: null,
  aiShareHealth: false,
};

const STORAGE_MODES: StorageMode[] = ['health-connect', 'local'];
const WEIGHT_UNITS: WeightUnit[] = ['kg', 'lb'];
const AI_METHODS: AiMethod[] = ['none', 'chatgpt', 'api-key'];
const REMINDER_REPEATS: ReminderRepeat[] = ['daily', 'weekly'];

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : fallback;
}

/**
 * Defensively rebuilds preferences from persisted JSON. Corrupt or partial data
 * must never crash startup, so every field falls back to its default.
 */
export function coercePreferences(input: unknown): AppPreferences {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_PREFERENCES };
  }

  const raw = input as Record<string, unknown>;

  const storageMode = STORAGE_MODES.includes(raw.storageMode as StorageMode)
    ? (raw.storageMode as StorageMode)
    : DEFAULT_PREFERENCES.storageMode;

  const weightUnit = WEIGHT_UNITS.includes(raw.weightUnit as WeightUnit)
    ? (raw.weightUnit as WeightUnit)
    : DEFAULT_PREFERENCES.weightUnit;

  const goalWeightKg =
    typeof raw.goalWeightKg === 'number' &&
    Number.isFinite(raw.goalWeightKg) &&
    raw.goalWeightKg > 0 &&
    raw.goalWeightKg < 1000
      ? raw.goalWeightKg
      : null;

  const aiMethod = AI_METHODS.includes(raw.aiMethod as AiMethod)
    ? (raw.aiMethod as AiMethod)
    : DEFAULT_PREFERENCES.aiMethod;

  const aiModel =
    typeof raw.aiModel === 'string' &&
    raw.aiModel.trim().length > 0 &&
    raw.aiModel.length <= 200
      ? raw.aiModel.trim()
      : null;

  const reminderRepeat = REMINDER_REPEATS.includes(
    raw.reminderRepeat as ReminderRepeat
  )
    ? (raw.reminderRepeat as ReminderRepeat)
    : DEFAULT_PREFERENCES.reminderRepeat;

  const waterStartHour = clampInt(
    raw.waterStartHour,
    0,
    23,
    DEFAULT_PREFERENCES.waterStartHour
  );
  const waterEndHour = clampInt(
    raw.waterEndHour,
    0,
    23,
    DEFAULT_PREFERENCES.waterEndHour
  );

  // A window that ends before it starts would schedule nothing at all, which is
  // worse than falling back: the switch would read "on" and never fire once.
  const waterWindowIsSane = waterEndHour >= waterStartHour;

  return {
    storageMode,
    onboardingCompleted: raw.onboardingCompleted === true,
    weightUnit,
    goalWeightKg,
    reminderEnabled: raw.reminderEnabled === true,
    reminderRepeat,
    reminderWeekday: clampInt(
      raw.reminderWeekday,
      1,
      7,
      DEFAULT_PREFERENCES.reminderWeekday
    ),
    reminderHour: clampInt(
      raw.reminderHour,
      0,
      23,
      DEFAULT_PREFERENCES.reminderHour
    ),
    reminderMinute: clampInt(
      raw.reminderMinute,
      0,
      59,
      DEFAULT_PREFERENCES.reminderMinute
    ),
    waterReminderEnabled: raw.waterReminderEnabled === true,
    waterStartHour: waterWindowIsSane
      ? waterStartHour
      : DEFAULT_PREFERENCES.waterStartHour,
    waterEndHour: waterWindowIsSane
      ? waterEndHour
      : DEFAULT_PREFERENCES.waterEndHour,
    waterIntervalHours: clampInt(
      raw.waterIntervalHours,
      1,
      12,
      DEFAULT_PREFERENCES.waterIntervalHours
    ),
    // Anything outside a plausible daily intake falls back rather than clamping:
    // a corrupt 50 ml target would make the progress bar meaningless.
    waterTargetMl: clampInt(
      raw.waterTargetMl,
      500,
      5000,
      DEFAULT_PREFERENCES.waterTargetMl
    ),
    aiMethod,
    aiModel,
    aiShareHealth: raw.aiShareHealth === true,
  };
}
