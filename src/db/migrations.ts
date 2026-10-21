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
  {
    version: 5,
    up: async (db) => {
      await db.execAsync(`
        -- Left over from the removed cloud-sync schema. Nothing reads or writes
        -- it any more, so drop it from databases that predate this version. A
        -- fresh install never created it, hence IF EXISTS.
        DROP TABLE IF EXISTS sync_outbox;
      `);
    },
  },
  {
    version: 6,
    up: async (db) => {
      await db.execAsync(`
        -- Water intake, mirroring the weight tables: water_entries is
        -- authoritative in local-only mode, water_cache is a disposable mirror
        -- of Health Connect, and pending_water holds writes that could not be
        -- sent yet. A single entry is capped at 10 L, which is far beyond any
        -- plausible glass or bottle and keeps bad input out of the totals.
        CREATE TABLE IF NOT EXISTS water_entries (
          id TEXT PRIMARY KEY NOT NULL,
          volume_ml REAL NOT NULL CHECK (volume_ml > 0 AND volume_ml <= 10000),
          logged_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS water_entries_logged_at_idx
          ON water_entries (logged_at DESC);

        CREATE TABLE IF NOT EXISTS water_cache (
          external_id TEXT PRIMARY KEY NOT NULL,
          client_record_id TEXT,
          volume_ml REAL NOT NULL CHECK (volume_ml > 0 AND volume_ml <= 10000),
          logged_at TEXT NOT NULL,
          source_package TEXT,
          recording_method INTEGER,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS water_cache_logged_at_idx
          ON water_cache (logged_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS water_cache_client_record_idx
          ON water_cache (client_record_id)
          WHERE client_record_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS pending_water (
          id TEXT PRIMARY KEY NOT NULL,
          volume_ml REAL NOT NULL CHECK (volume_ml > 0 AND volume_ml <= 10000),
          logged_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS pending_water_created_at_idx
          ON pending_water (created_at ASC);
      `);
    },
  },
  {
    version: 7,
    up: async (db) => {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.execAsync(`
          -- Assistant conversations. Messages live in ai_messages and point at
          -- one chat through chat_id. The bytes column is the UTF-8 size of the
          -- chat's message text, maintained on insert so retention never has to
          -- scan every message body.
          CREATE TABLE IF NOT EXISTS ai_chats (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            bytes INTEGER NOT NULL DEFAULT 0
          );

          CREATE INDEX IF NOT EXISTS ai_chats_updated_at_idx
            ON ai_chats (updated_at DESC);
        `);

        const columns = await txn.getAllAsync<{ name: string }>(
          'PRAGMA table_info(ai_messages);'
        );
        if (!columns.some((column) => column.name === 'chat_id')) {
          await txn.execAsync(
            'ALTER TABLE ai_messages ADD COLUMN chat_id TEXT;'
          );
        }

        const orphan = await txn.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM ai_messages WHERE chat_id IS NULL;'
        );
        if (orphan && orphan.count > 0) {
          const range = await txn.getFirstAsync<{
            first: string | null;
            last: string | null;
          }>(
            `SELECT MIN(created_at) AS first, MAX(created_at) AS last
             FROM ai_messages
             WHERE chat_id IS NULL;`
          );
          const createdAt = range?.first ?? new Date().toISOString();
          const updatedAt = range?.last ?? createdAt;
          const legacyId = 'legacy-chat';

          await txn.runAsync(
            `INSERT OR IGNORE INTO ai_chats
               (id, title, created_at, updated_at, bytes)
             VALUES (?, ?, ?, ?, 0)`,
            legacyId,
            'Previous conversation',
            createdAt,
            updatedAt
          );
          await txn.runAsync(
            'UPDATE ai_messages SET chat_id = ? WHERE chat_id IS NULL;',
            legacyId
          );
        }

        await txn.execAsync(`
          CREATE INDEX IF NOT EXISTS ai_messages_chat_id_idx
            ON ai_messages (chat_id);

          UPDATE ai_chats
          SET bytes = (
            SELECT COALESCE(SUM(LENGTH(CAST(m.content AS BLOB))), 0)
            FROM ai_messages m
            WHERE m.chat_id = ai_chats.id
          );
        `);
      });
    },
  },
  {
    version: 8,
    up: async (db) => {
      await db.runAsync(`
        -- A chat with no messages is not useful history. Earlier versions
        -- created the row before the first message; new versions keep it in
        -- memory until then, so remove any leftovers.
        DELETE FROM ai_chats
        WHERE NOT EXISTS (
          SELECT 1 FROM ai_messages m WHERE m.chat_id = ai_chats.id
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
