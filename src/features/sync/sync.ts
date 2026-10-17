import { getDatabase } from '@/db/database';
import { requireSupabase, supabase } from '@/lib/supabase';

import { rowToMeasurement, type WeightEntryRow } from '../measurements/types';

export type SyncSummary = {
  pushed: number;
  failed: number;
  skipped: boolean;
  reason?: 'not-configured' | 'unauthenticated';
  lastError?: string;
};

type OutboxRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
};

/**
 * Assigns ownership of local entries to the authenticated user. Rows that
 * already belong to someone else are left untouched so one account's pending
 * records can never be uploaded under another account.
 */
export async function assignPendingEntriesToUser(userId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE weight_entries
     SET user_id = ?, sync_status = 'pending', updated_at = ?
     WHERE user_id IS NULL`,
    userId,
    new Date().toISOString()
  );
}

function toRemoteRow(row: WeightEntryRow, userId: string) {
  const measurement = rowToMeasurement(row);
  return {
    id: measurement.id,
    user_id: userId,
    weight_grams: measurement.weightGrams,
    scale_profile: measurement.scaleProfile,
    measured_at: measurement.measuredAt,
    source: measurement.source,
    ocr_raw_text: measurement.ocrRawText,
    note: measurement.note,
    created_at: measurement.createdAt,
    updated_at: measurement.updatedAt,
    deleted_at: measurement.deletedAt,
  };
}

/**
 * Uploads pending entries via an idempotent upsert keyed on the local id.
 * The outbox item is only removed after the request succeeds.
 */
export async function syncPendingMeasurements(): Promise<SyncSummary> {
  if (!supabase) {
    return { pushed: 0, failed: 0, skipped: true, reason: 'not-configured' };
  }

  const client = requireSupabase();
  const { data: sessionData } = await client.auth.getSession();
  const userId = sessionData.session?.user.id;

  if (!userId) {
    return { pushed: 0, failed: 0, skipped: true, reason: 'unauthenticated' };
  }

  await assignPendingEntriesToUser(userId);

  const db = await getDatabase();
  const outbox = await db.getAllAsync<OutboxRow>(
    `SELECT * FROM sync_outbox ORDER BY created_at ASC`
  );

  let pushed = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const item of outbox) {
    const entry = await db.getFirstAsync<WeightEntryRow>(
      `SELECT * FROM weight_entries WHERE id = ?`,
      item.entity_id
    );

    // Entry vanished locally; nothing to push.
    if (!entry) {
      await db.runAsync(`DELETE FROM sync_outbox WHERE id = ?`, item.id);
      continue;
    }

    // Never upload another account's record.
    if (entry.user_id && entry.user_id !== userId) {
      await db.runAsync(`DELETE FROM sync_outbox WHERE id = ?`, item.id);
      continue;
    }

    const { error } = await client
      .from('weight_entries')
      .upsert(toRemoteRow(entry, userId), { onConflict: 'id' });

    if (error) {
      failed += 1;
      lastError = error.message;
      await db.runAsync(
        `UPDATE sync_outbox
         SET attempts = attempts + 1, last_error = ?
         WHERE id = ?`,
        error.message,
        item.id
      );
      // Stop on the first failure to preserve ordering; retry later.
      break;
    }

    await db.runAsync(
      `UPDATE weight_entries
       SET sync_status = 'synced', user_id = ?, updated_at = ?
       WHERE id = ?`,
      userId,
      new Date().toISOString(),
      entry.id
    );
    await db.runAsync(`DELETE FROM sync_outbox WHERE id = ?`, item.id);
    pushed += 1;
  }

  return { pushed, failed, skipped: false, lastError };
}
