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
