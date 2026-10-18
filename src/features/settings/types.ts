import type { AiMethod } from '@/features/ai/types';

export type StorageMode = 'health-connect' | 'local';

export type WeightUnit = 'kg' | 'lb';

export type AppPreferences = {
  storageMode: StorageMode;
  onboardingCompleted: boolean;
  weightUnit: WeightUnit;
  /** Optional goal weight, always stored in kilograms. */
  goalWeightKg: number | null;
  reminderEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
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
  reminderHour: 7,
  reminderMinute: 0,
  aiMethod: 'none',
  aiModel: null,
  aiShareHealth: false,
};

const STORAGE_MODES: StorageMode[] = ['health-connect', 'local'];
const WEIGHT_UNITS: WeightUnit[] = ['kg', 'lb'];
const AI_METHODS: AiMethod[] = ['none', 'chatgpt', 'api-key'];

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

  return {
    storageMode,
    onboardingCompleted: raw.onboardingCompleted === true,
    weightUnit,
    goalWeightKg,
    reminderEnabled: raw.reminderEnabled === true,
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
    aiMethod,
    aiModel,
    aiShareHealth: raw.aiShareHealth === true,
  };
}
