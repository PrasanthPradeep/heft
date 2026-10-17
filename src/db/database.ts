import * as SQLite from 'expo-sqlite';

export const DATABASE_NAME = 'heft.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase();
  }
  return databasePromise;
}

async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS weight_entries (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      device_id TEXT,
      weight_grams INTEGER NOT NULL
        CHECK (weight_grams BETWEEN 200 AND 400000),
      scale_profile TEXT,
      measured_at TEXT NOT NULL,
      source TEXT NOT NULL
        CHECK (source IN ('manual', 'ocr', 'import')),
      ocr_raw_text TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'synced', 'conflict'))
    );

    CREATE INDEX IF NOT EXISTS weight_entries_date_idx
      ON weight_entries(measured_at DESC);

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
  `);

  return db;
}

/**
 * Test/reset helper. Not used at runtime but handy while developing.
 */
export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM sync_outbox;
    DELETE FROM weight_entries;
  `);
}
