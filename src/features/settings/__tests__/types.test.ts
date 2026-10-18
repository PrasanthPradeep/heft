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
        reminderHour: 6,
        reminderMinute: 30,
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
      reminderHour: 6,
      reminderMinute: 30,
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
  });
});
