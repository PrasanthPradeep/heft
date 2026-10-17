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
  await db.execAsync('PRAGMA journal_mode = WAL;');
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

/** Deletes all user data (measurements, cache and pending writes). */
export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(
      'DELETE FROM weight_entries; DELETE FROM weight_cache; DELETE FROM pending_weights;'
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
      'DELETE FROM weight_entries; DELETE FROM weight_cache; DELETE FROM pending_weights; DELETE FROM preferences;'
    );
  });
}
