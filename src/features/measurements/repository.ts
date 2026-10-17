import { randomUUID } from 'expo-crypto';

import { getDatabase } from '@/db/database';

import type { ScaleProfile } from '../camera/parser';
import {
  rowToMeasurement,
  type Measurement,
  type MeasurementSource,
  type WeightEntryRow,
} from './types';

export type SaveMeasurementInput = {
  weightKg: number;
  measuredAt: string;
  source: MeasurementSource;
  profile: ScaleProfile;
  ocrRawText?: string;
  note?: string;
};

/**
 * Validates a reading against the selected scale profile and returns the
 * canonical value in grams.
 */
export function validateWeightKg(
  weightKg: number,
  profile: ScaleProfile
): number {
  if (!Number.isFinite(weightKg)) {
    throw new Error('Weight must be a number.');
  }

  if (weightKg < profile.minKg || weightKg > profile.maxKg) {
    throw new Error(
      `Weight must be between ${profile.minKg} and ${profile.maxKg} kg for this scale.`
    );
  }

  const grams = Math.round(weightKg * 1000);

  // Reject readings with more precision than grams.
  if (Math.abs(weightKg * 1000 - grams) > 0.001) {
    throw new Error('Weight has too many decimal places.');
  }

  const graduationGrams = Math.round(profile.graduationKg * 1000);
  if (graduationGrams > 0 && grams % graduationGrams !== 0) {
    throw new Error(
      `Weight must be in ${profile.graduationKg} kg increments for this scale.`
    );
  }

  return grams;
}

export async function saveMeasurement(
  input: SaveMeasurementInput
): Promise<{ id: string; weightGrams: number; measuredAt: string }> {
  const grams = validateWeightKg(input.weightKg, input.profile);

  if (!Number.isFinite(Date.parse(input.measuredAt))) {
    throw new Error('Invalid measurement timestamp.');
  }

  const db = await getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO weight_entries (
        id, weight_grams, scale_profile, measured_at, source, ocr_raw_text,
        note, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      id,
      grams,
      input.profile.id,
      input.measuredAt,
      input.source,
      input.ocrRawText ?? null,
      input.note ?? null,
      now,
      now
    );

    await txn.runAsync(
      `INSERT INTO sync_outbox (
        id, entity_type, entity_id, operation, created_at
      ) VALUES (?, 'weight_entry', ?, 'upsert', ?)`,
      randomUUID(),
      id,
      now
    );
  });

  return { id, weightGrams: grams, measuredAt: input.measuredAt };
}

export async function listMeasurements(
  limit = 100
): Promise<Measurement[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<WeightEntryRow>(
    `SELECT * FROM weight_entries
     WHERE deleted_at IS NULL
     ORDER BY measured_at DESC
     LIMIT ?`,
    limit
  );
  return rows.map(rowToMeasurement);
}

export async function getLatestMeasurement(): Promise<Measurement | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<WeightEntryRow>(
    `SELECT * FROM weight_entries
     WHERE deleted_at IS NULL
     ORDER BY measured_at DESC
     LIMIT 1`
  );
  return row ? rowToMeasurement(row) : null;
}

export async function deleteMeasurement(id: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `UPDATE weight_entries
       SET deleted_at = ?, updated_at = ?, sync_status = 'pending'
       WHERE id = ?`,
      now,
      now,
      id
    );

    await txn.runAsync(
      `INSERT INTO sync_outbox (
        id, entity_type, entity_id, operation, created_at
      ) VALUES (?, 'weight_entry', ?, 'delete', ?)`,
      randomUUID(),
      id,
      now
    );
  });
}

export async function countPendingMeasurements(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM weight_entries
     WHERE deleted_at IS NULL AND sync_status = 'pending'`
  );
  return row?.count ?? 0;
}
