import { readPreference, writePreference } from '@/db/database';

import { coercePreferences, DEFAULT_PREFERENCES, type AppPreferences } from './types';

const PREFERENCES_KEY = 'app.preferences';
const LAST_SYNCED_KEY = 'app.lastSyncedAt';

/** Loads preferences, falling back to defaults on missing/corrupt data. */
export async function loadPreferences(): Promise<AppPreferences> {
  const raw = await readPreference(PREFERENCES_KEY);
  if (!raw) return { ...DEFAULT_PREFERENCES };

  try {
    return coercePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function persistPreferences(
  preferences: AppPreferences
): Promise<void> {
  await writePreference(PREFERENCES_KEY, JSON.stringify(preferences));
}

/** Timestamp of the last successful Health Connect sync, if any. */
export async function loadLastSyncedAt(): Promise<string | null> {
  return readPreference(LAST_SYNCED_KEY);
}

export async function persistLastSyncedAt(iso: string): Promise<void> {
  await writePreference(LAST_SYNCED_KEY, iso);
}
