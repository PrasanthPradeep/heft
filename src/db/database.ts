import * as SQLite from 'expo-sqlite';

import { runMigrations } from './migrations';

export const DATABASE_NAME = 'heft.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

/**
 * Opens (once) and returns the shared database handle. The schema is migrated
 * before the promise resolves, so callers never observe a half-built database.
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase();
  }
  return databasePromise;
}

async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // The home-screen widget opens this file with Android's framework SQLite,
  // while expo-sqlite uses its own bundled SQLite. WAL's shared-memory index is
  // not shared between the two libraries: a widget checkpoint can discard
  // frames expo-sqlite committed (preferences then revert on the next launch).
  // The rollback journal has no shared-memory index, so both libraries read the
  // same committed data. The busy timeout lets the widget's short reads finish
  // instead of failing a write.
  await db.execAsync('PRAGMA busy_timeout = 5000;');
  await db.execAsync('PRAGMA journal_mode = DELETE;');
  await runMigrations(db);
  return db;
}

/** Reads a value from the key/value preferences table. */
export async function readPreference(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM preferences WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

/** Upserts a value into the key/value preferences table. */
export async function writePreference(
  key: string,
  value: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO preferences (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

/** Deletes all user data (measurements, water, caches and pending writes). */
export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(
      'DELETE FROM weight_entries; DELETE FROM weight_cache; DELETE FROM pending_weights; DELETE FROM activity_daily; DELETE FROM activity_sessions; DELETE FROM ai_messages; DELETE FROM ai_chats; DELETE FROM water_entries; DELETE FROM water_cache; DELETE FROM pending_water;'
    );
  });
}

/**
 * Test/dev helper: wipes every table, including preferences. Not used at runtime.
 */
export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(
      'DELETE FROM weight_entries; DELETE FROM weight_cache; DELETE FROM pending_weights; DELETE FROM activity_daily; DELETE FROM activity_sessions; DELETE FROM ai_messages; DELETE FROM ai_chats; DELETE FROM water_entries; DELETE FROM water_cache; DELETE FROM pending_water; DELETE FROM preferences;'
    );
  });
}
