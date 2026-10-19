import type { SQLiteDatabase } from 'expo-sqlite';

import {
  rowToCachedWaterEntry,
  type WaterCacheRow,
  type WaterEntry,
} from '@/features/water/types';

import type { HealthConnectHydration } from './hydrationAdapter';

/** Minimal database surface so helpers work on the pool or inside a transaction. */
type DbHandle = Pick<SQLiteDatabase, 'runAsync'>;

const UPSERT_SQL = `
  INSERT INTO water_cache (
    external_id, client_record_id, volume_ml, logged_at,
    source_package, recording_method, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(external_id) DO UPDATE SET
    client_record_id = excluded.client_record_id,
    volume_ml = excluded.volume_ml,
    logged_at = excluded.logged_at,
    source_package = excluded.source_package,
    recording_method = excluded.recording_method,
    updated_at = excluded.updated_at
`;

/**
 * Inserts or updates cache rows keyed on the Health Connect record id, so
 * repeated reads never duplicate a record.
 */
export async function upsertCachedHydration(
  db: DbHandle,
  records: HealthConnectHydration[],
  updatedAt: string = new Date().toISOString()
): Promise<void> {
  for (const record of records) {
    await db.runAsync(
      UPSERT_SQL,
      record.externalId,
      record.clientRecordId,
      record.volumeMl,
      record.loggedAt,
      record.sourcePackage,
      record.recordingMethod,
      updatedAt
    );
  }
}

/**
 * Replaces the cached records inside a time window in one transaction: rows that
 * are no longer returned by Health Connect are dropped, and the rest are
 * upserted. Only ever call this after a *complete* read of the window.
 */
export async function replaceHydrationWindow(
  db: SQLiteDatabase,
  startTime: string,
  endTime: string,
  records: HealthConnectHydration[]
): Promise<void> {
  const updatedAt = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      'DELETE FROM water_cache WHERE logged_at >= ? AND logged_at <= ?',
      startTime,
      endTime
    );
    await upsertCachedHydration(txn, records, updatedAt);
  });
}

export async function listCachedHydration(
  db: SQLiteDatabase
): Promise<WaterEntry[]> {
  const rows = await db.getAllAsync<WaterCacheRow>('SELECT * FROM water_cache');
  return rows.map(rowToCachedWaterEntry);
}
