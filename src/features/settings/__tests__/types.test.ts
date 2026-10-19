import { coercePreferences, DEFAULT_PREFERENCES } from '../types';

describe('coercePreferences', () => {
  it('returns defaults for junk input', () => {
    expect(coercePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(coercePreferences('nope')).toEqual(DEFAULT_PREFERENCES);
    expect(coercePreferences(42)).toEqual(DEFAULT_PREFERENCES);
    expect(coercePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps valid values', () => {
    expect(
      coercePreferences({
        storageMode: 'health-connect',
        onboardingCompleted: true,
        weightUnit: 'lb',
        goalWeightKg: 68.5,
        reminderEnabled: true,
        reminderRepeat: 'weekly',
        reminderWeekday: 5,
        reminderHour: 6,
        reminderMinute: 30,
        waterReminderEnabled: true,
        waterStartHour: 8,
        waterEndHour: 20,
        waterIntervalHours: 3,
        waterTargetMl: 2500,
        aiMethod: 'chatgpt',
        aiModel: 'gpt-5',
        aiShareHealth: true,
      })
    ).toEqual({
      storageMode: 'health-connect',
      onboardingCompleted: true,
      weightUnit: 'lb',
      goalWeightKg: 68.5,
      reminderEnabled: true,
      reminderRepeat: 'weekly',
      reminderWeekday: 5,
      reminderHour: 6,
      reminderMinute: 30,
      waterReminderEnabled: true,
      waterStartHour: 8,
      waterEndHour: 20,
      waterIntervalHours: 3,
      waterTargetMl: 2500,
      aiMethod: 'chatgpt',
      aiModel: 'gpt-5',
      aiShareHealth: true,
    });
  });

  it('rejects unknown enum values', () => {
    const coerced = coercePreferences({
      storageMode: 'cloud',
      weightUnit: 'stone',
      aiMethod: 'telepathy',
    });
    expect(coerced.storageMode).toBe(DEFAULT_PREFERENCES.storageMode);
    expect(coerced.weightUnit).toBe(DEFAULT_PREFERENCES.weightUnit);
    expect(coerced.aiMethod).toBe(DEFAULT_PREFERENCES.aiMethod);
  });

  it('normalises the AI model field', () => {
    expect(coercePreferences({ aiModel: '  gpt-5  ' }).aiModel).toBe('gpt-5');
    expect(coercePreferences({ aiModel: '' }).aiModel).toBeNull();
    expect(coercePreferences({ aiModel: 42 }).aiModel).toBeNull();
    expect(coercePreferences({ aiModel: 'x'.repeat(201) }).aiModel).toBeNull();
  });

  it('drops an invalid goal weight', () => {
    expect(coercePreferences({ goalWeightKg: -3 }).goalWeightKg).toBeNull();
    expect(coercePreferences({ goalWeightKg: 5000 }).goalWeightKg).toBeNull();
    expect(
      coercePreferences({ goalWeightKg: 'heavy' }).goalWeightKg
    ).toBeNull();
  });

  it('clamps out-of-range reminder fields', () => {
    expect(coercePreferences({ reminderHour: 99 }).reminderHour).toBe(
      DEFAULT_PREFERENCES.reminderHour
    );
    expect(coercePreferences({ reminderMinute: -1 }).reminderMinute).toBe(
      DEFAULT_PREFERENCES.reminderMinute
    );
    expect(coercePreferences({ reminderWeekday: 0 }).reminderWeekday).toBe(
      DEFAULT_PREFERENCES.reminderWeekday
    );
    expect(coercePreferences({ reminderWeekday: 9 }).reminderWeekday).toBe(
      DEFAULT_PREFERENCES.reminderWeekday
    );
  });

  it('rejects an unknown reminder repeat and keeps a known one', () => {
    expect(
      coercePreferences({ reminderRepeat: 'fortnightly' }).reminderRepeat
    ).toBe(DEFAULT_PREFERENCES.reminderRepeat);
    expect(coercePreferences({ reminderRepeat: 'weekly' }).reminderRepeat).toBe(
      'weekly'
    );
  });

  it('falls back on out-of-range water reminder fields', () => {
    expect(coercePreferences({ waterStartHour: 30 }).waterStartHour).toBe(
      DEFAULT_PREFERENCES.waterStartHour
    );
    expect(coercePreferences({ waterEndHour: -2 }).waterEndHour).toBe(
      DEFAULT_PREFERENCES.waterEndHour
    );
    expect(coercePreferences({ waterIntervalHours: 0 }).waterIntervalHours).toBe(
      DEFAULT_PREFERENCES.waterIntervalHours
    );
    expect(
      coercePreferences({ waterIntervalHours: 99 }).waterIntervalHours
    ).toBe(DEFAULT_PREFERENCES.waterIntervalHours);
  });

  it('falls back to a usable window when the water hours are backwards', () => {
    // A backwards window would schedule nothing while still reading as "on",
    // which is worse than silently using the default day-time window.
    const coerced = coercePreferences({ waterStartHour: 22, waterEndHour: 6 });
    expect(coerced.waterStartHour).toBe(DEFAULT_PREFERENCES.waterStartHour);
    expect(coerced.waterEndHour).toBe(DEFAULT_PREFERENCES.waterEndHour);
  });

  it('keeps a plausible water target and rejects an implausible one', () => {
    expect(coercePreferences({ waterTargetMl: 3000 }).waterTargetMl).toBe(3000);
    expect(coercePreferences({ waterTargetMl: 0 }).waterTargetMl).toBe(
      DEFAULT_PREFERENCES.waterTargetMl
    );
    expect(coercePreferences({ waterTargetMl: 50 }).waterTargetMl).toBe(
      DEFAULT_PREFERENCES.waterTargetMl
    );
    expect(coercePreferences({ waterTargetMl: 50_000 }).waterTargetMl).toBe(
      DEFAULT_PREFERENCES.waterTargetMl
    );
    expect(coercePreferences({ waterTargetMl: 'lots' }).waterTargetMl).toBe(
      DEFAULT_PREFERENCES.waterTargetMl
    );
  });
});
