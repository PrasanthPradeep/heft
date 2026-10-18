import type { SQLiteDatabase } from 'expo-sqlite';

export type Migration = {
  version: number;
  up: (db: SQLiteDatabase) => Promise<void>;
};

/**
 * Ordered list of schema migrations. Each `version` must be unique and strictly
 * increasing. `runMigrations` applies every migration newer than the database's
 * current `PRAGMA user_version`, then records the new version.
 *
 * Never edit an already-shipped migration: add a new one instead.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS preferences (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );

        -- Authoritative store for local-only mode.
        CREATE TABLE IF NOT EXISTS weight_entries (
          id TEXT PRIMARY KEY NOT NULL,
          weight_kg REAL NOT NULL CHECK (weight_kg > 0 AND weight_kg < 1000),
          measured_at TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS weight_entries_measured_at_idx
          ON weight_entries (measured_at DESC);

        -- Disposable cache of Health Connect records. Health Connect remains the
        -- source of truth in that mode; this table only mirrors a read window.
        CREATE TABLE IF NOT EXISTS weight_cache (
          external_id TEXT PRIMARY KEY NOT NULL,
          client_record_id TEXT,
          weight_kg REAL NOT NULL CHECK (weight_kg > 0 AND weight_kg < 1000),
          measured_at TEXT NOT NULL,
          source_package TEXT,
          recording_method INTEGER,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS weight_cache_measured_at_idx
          ON weight_cache (measured_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS weight_cache_client_record_idx
          ON weight_cache (client_record_id)
          WHERE client_record_id IS NOT NULL;

        -- Manual entries that could not be written to Health Connect (offline,
        -- permission revoked, provider error). Retried on launch / Sync now.
        CREATE TABLE IF NOT EXISTS pending_weights (
          id TEXT PRIMARY KEY NOT NULL,
          weight_kg REAL NOT NULL CHECK (weight_kg > 0 AND weight_kg < 1000),
          measured_at TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS pending_weights_created_at_idx
          ON pending_weights (created_at ASC);
      `);
    },
  },
  {
    version: 2,
    up: async (db) => {
      // The previous Heft schema stored readings in grams and included sync
      // metadata. CREATE TABLE IF NOT EXISTS in v1 leaves that old table intact,
      // so upgrade it explicitly before the current repository writes to it.
      const columns = await db.getAllAsync<{ name: string }>(
        'PRAGMA table_info(weight_entries);'
      );
      const names = new Set(columns.map((column) => column.name));

      if (names.has('weight_kg')) return;
      if (!names.has('weight_grams')) {
        throw new Error(
          'Cannot migrate weight history: the existing weight_entries table has an unsupported schema.'
        );
      }

      await db.withExclusiveTransactionAsync(async (txn) => {
        // The v1 index may currently point at the legacy table. Drop it before
        // renaming, then create the current table and its index after copying.
        await txn.execAsync(`
          DROP INDEX IF EXISTS weight_entries_measured_at_idx;
          ALTER TABLE weight_entries RENAME TO weight_entries_legacy;

          CREATE TABLE weight_entries (
            id TEXT PRIMARY KEY NOT NULL,
            weight_kg REAL NOT NULL CHECK (weight_kg > 0 AND weight_kg < 1000),
            measured_at TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);

        await txn.execAsync(`
          INSERT INTO weight_entries (
            id, weight_kg, measured_at, note, created_at, updated_at
          )
          SELECT
            id,
            weight_grams / 1000.0,
            measured_at,
            note,
            COALESCE(created_at, measured_at),
            COALESCE(updated_at, created_at, measured_at)
          FROM weight_entries_legacy
          WHERE deleted_at IS NULL AND weight_grams > 0;

          DROP TABLE weight_entries_legacy;

          CREATE INDEX weight_entries_measured_at_idx
            ON weight_entries (measured_at DESC);
        `);
      });
    },
  },
  {
    version: 3,
    up: async (db) => {
      await db.execAsync(`
        -- Daily steps/exercise mirrored from Health Connect. Google Fit and other
        -- fitness apps sync their data there, so this is Heft's activity source.
        -- Disposable cache, like weight_cache.
        CREATE TABLE IF NOT EXISTS activity_daily (
          day TEXT PRIMARY KEY NOT NULL,
          steps INTEGER NOT NULL,
          exercise_minutes INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );

        -- Recent exercise sessions, mirrored from Health Connect.
        CREATE TABLE IF NOT EXISTS activity_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT,
          exercise_type INTEGER NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          minutes REAL NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS activity_sessions_start_time_idx
          ON activity_sessions (start_time DESC);
      `);
    },
  },
  {
    version: 4,
    up: async (db) => {
      await db.execAsync(`
        -- Local transcript for the built-in assistant. Kept on-device; only the
        -- messages the user chooses to send ever leave the phone.
        CREATE TABLE IF NOT EXISTS ai_messages (
          id TEXT PRIMARY KEY NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
];

/**
 * Applies pending migrations. `PRAGMA user_version` cannot be parameterised, so
 * the version literal is interpolated; every value comes from `MIGRATIONS`, which
 * is app-controlled and numeric.
 */
export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version;'
  );
  const currentVersion = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    await migration.up(db);
    await db.execAsync(`PRAGMA user_version = ${migration.version};`);
  }
}
