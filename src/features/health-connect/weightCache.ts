import type { SQLiteDatabase } from 'expo-sqlite';

import { rowToCachedEntry, type WeightCacheRow, type WeightEntry } from '@/features/weight/types';

import type { HealthConnectWeight } from './healthConnectAdapter';

/** Minimal database surface so helpers work on the pool or inside a transaction. */
type DbHandle = Pick<SQLiteDatabase, 'runAsync'>;

const UPSERT_SQL = `
  INSERT INTO weight_cache (
    external_id, client_record_id, weight_kg, measured_at,
    source_package, recording_method, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(external_id) DO UPDATE SET
    client_record_id = excluded.client_record_id,
    weight_kg = excluded.weight_kg,
    measured_at = excluded.measured_at,
    source_package = excluded.source_package,
    recording_method = excluded.recording_method,
    updated_at = excluded.updated_at
`;

/**
 * Inserts or updates cache rows keyed on the Health Connect record id, so
 * repeated reads never duplicate a record.
 */
export async function upsertCachedWeights(
  db: DbHandle,
  records: HealthConnectWeight[],
  updatedAt: string = new Date().toISOString()
): Promise<void> {
  for (const record of records) {
    await db.runAsync(
      UPSERT_SQL,
      record.externalId,
      record.clientRecordId,
      record.weightKg,
      record.measuredAt,
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
export async function replaceCacheWindow(
  db: SQLiteDatabase,
  startTime: string,
  endTime: string,
  records: HealthConnectWeight[]
): Promise<void> {
  const updatedAt = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      'DELETE FROM weight_cache WHERE measured_at >= ? AND measured_at <= ?',
      startTime,
      endTime
    );
    await upsertCachedWeights(txn, records, updatedAt);
  });
}

export async function listCachedWeights(
  db: SQLiteDatabase
): Promise<WeightEntry[]> {
  const rows = await db.getAllAsync<WeightCacheRow>(
    'SELECT * FROM weight_cache'
  );
  return rows.map(rowToCachedEntry);
}
