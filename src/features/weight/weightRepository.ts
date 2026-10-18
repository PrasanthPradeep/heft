import { randomUUID } from 'expo-crypto';

import { getDatabase } from '@/db/database';
import type { StorageMode } from '@/features/settings/types';
import {
  deleteWeightRecordsByClientId,
  writeWeight,
} from '@/features/health-connect/healthConnectAdapter';
import { listCachedWeights, upsertCachedWeights } from '@/features/health-connect/weightCache';

import {
  compareByMeasuredAtDesc,
  rowToLocalEntry,
  rowToPendingEntry,
  type PendingWeightRow,
  type WeightCacheRow,
  type WeightEntry,
  type WeightEntryInput,
  type WeightEntryRow,
} from './types';
import {
  normalizeNote,
  normalizeWeightKg,
  validateMeasuredAt,
} from './weightCalculations';

export interface WeightRepository {
  listWeights(): Promise<WeightEntry[]>;
  addWeight(input: WeightEntryInput): Promise<WeightEntry>;
  updateWeight(id: string, input: WeightEntryInput): Promise<WeightEntry>;
  deleteWeight(id: string): Promise<void>;
  /** Removes every Heft-owned measurement. Never touches other apps' records. */
  deleteAllWeights(): Promise<void>;
}

function normalizeInput(input: WeightEntryInput) {
  return {
    weightKg: normalizeWeightKg(input.weightKg),
    measuredAt: validateMeasuredAt(input.measuredAt),
    note: normalizeNote(input.note),
  };
}

const LOCAL_EDIT_ERROR =
  'This measurement was not created in Heft, so it cannot be changed here.';

/** Ignore malformed legacy/cache rows so they cannot break screens or charts. */
function hasUsableWeight(entry: WeightEntry): boolean {
  return (
    typeof entry.weightKg === 'number' &&
    Number.isFinite(entry.weightKg) &&
    entry.weightKg >= 1 &&
    entry.weightKg <= 500
  );
}

/** Local-only mode: SQLite is the authoritative weight history. */
export class LocalWeightRepository implements WeightRepository {
  async listWeights(): Promise<WeightEntry[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<WeightEntryRow>(
      'SELECT * FROM weight_entries ORDER BY measured_at DESC'
    );
    return rows.map(rowToLocalEntry).filter(hasUsableWeight);
  }

  async addWeight(input: WeightEntryInput): Promise<WeightEntry> {
    const { weightKg, measuredAt, note } = normalizeInput(input);
    const db = await getDatabase();
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.runAsync(
      `INSERT INTO weight_entries
        (id, weight_kg, measured_at, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      weightKg,
      measuredAt,
      note,
      now,
      now
    );

    return {
      id,
      weightKg,
      measuredAt,
      note,
      source: 'manual',
      externalId: null,
      owned: true,
      pending: false,
    };
  }

  async updateWeight(id: string, input: WeightEntryInput): Promise<WeightEntry> {
    const { weightKg, measuredAt, note } = normalizeInput(input);
    const db = await getDatabase();

    const existing = await db.getFirstAsync<WeightEntryRow>(
      'SELECT * FROM weight_entries WHERE id = ?',
      id
    );
    if (!existing) {
      throw new Error('This measurement no longer exists.');
    }

    await db.runAsync(
      `UPDATE weight_entries
       SET weight_kg = ?, measured_at = ?, note = ?, updated_at = ?
       WHERE id = ?`,
      weightKg,
      measuredAt,
      note,
      new Date().toISOString(),
      id
    );

    return {
      id,
      weightKg,
      measuredAt,
      note,
      source: 'manual',
      externalId: null,
      owned: true,
      pending: false,
    };
  }

  async deleteWeight(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM weight_entries WHERE id = ?', id);
  }

  async deleteAllWeights(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM weight_entries');
  }
}

/** Health Connect mode: Health Connect is authoritative, SQLite is a cache. */
export class HealthConnectWeightRepository implements WeightRepository {
  async listWeights(): Promise<WeightEntry[]> {
    const db = await getDatabase();
    const [cached, pendingRows] = await Promise.all([
      listCachedWeights(db),
      db.getAllAsync<PendingWeightRow>('SELECT * FROM pending_weights'),
    ]);

    const byId = new Map<string, WeightEntry>();
    for (const entry of cached) byId.set(entry.id, entry);
    for (const row of pendingRows) byId.set(row.id, rowToPendingEntry(row));

    return [...byId.values()]
      .filter(hasUsableWeight)
      .sort(compareByMeasuredAtDesc);
  }

  async addWeight(input: WeightEntryInput): Promise<WeightEntry> {
    const { weightKg, measuredAt, note } = normalizeInput(input);
    const id = randomUUID();

    try {
      const externalId = await writeWeight({ id, weightKg, measuredAt });
      const db = await getDatabase();
      await upsertCachedWeights(db, [
        {
          externalId,
          clientRecordId: id,
          weightKg,
          measuredAt,
          sourcePackage: null,
          recordingMethod: null,
        },
      ]);

      return {
        id,
        weightKg,
        measuredAt,
        note,
        source: 'manual',
        externalId,
        owned: true,
        pending: false,
      };
    } catch {
      // Keep the entry so it is never lost; sync retries the write later.
      const db = await getDatabase();
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO pending_weights
          (id, weight_kg, measured_at, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        weightKg,
        measuredAt,
        note,
        now,
        now
      );

      return {
        id,
        weightKg,
        measuredAt,
        note,
        source: 'manual',
        externalId: null,
        owned: true,
        pending: true,
      };
    }
  }

  async updateWeight(id: string, input: WeightEntryInput): Promise<WeightEntry> {
    const { weightKg, measuredAt, note } = normalizeInput(input);
    const db = await getDatabase();

    const pending = await db.getFirstAsync<PendingWeightRow>(
      'SELECT * FROM pending_weights WHERE id = ?',
      id
    );
    if (pending) {
      await db.runAsync(
        `UPDATE pending_weights
         SET weight_kg = ?, measured_at = ?, note = ?, updated_at = ?
         WHERE id = ?`,
        weightKg,
        measuredAt,
        note,
        new Date().toISOString(),
        id
      );
      return {
        id,
        weightKg,
        measuredAt,
        note,
        source: 'manual',
        externalId: null,
        owned: true,
        pending: true,
      };
    }

    const cached = await db.getFirstAsync<WeightCacheRow>(
      'SELECT * FROM weight_cache WHERE client_record_id = ?',
      id
    );
    if (!cached) {
      throw new Error(LOCAL_EDIT_ERROR);
    }

    // Health Connect has no update call in this library: replace the record
    // under the same clientRecordId, falling back to the pending queue if the
    // replacement write fails so the edit is never lost.
    await deleteWeightRecordsByClientId([id]);

    try {
      const externalId = await writeWeight({ id, weightKg, measuredAt });
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          'DELETE FROM weight_cache WHERE client_record_id = ?',
          id
        );
        await upsertCachedWeights(txn, [
          {
            externalId,
            clientRecordId: id,
            weightKg,
            measuredAt,
            sourcePackage: null,
            recordingMethod: null,
          },
        ]);
      });

      return {
        id,
        weightKg,
        measuredAt,
        note,
        source: 'manual',
        externalId,
        owned: true,
        pending: false,
      };
    } catch {
      const now = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          'DELETE FROM weight_cache WHERE client_record_id = ?',
          id
        );
        await txn.runAsync(
          `INSERT INTO pending_weights
            (id, weight_kg, measured_at, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          weightKg,
          measuredAt,
          note,
          now,
          now
        );
      });

      return {
        id,
        weightKg,
        measuredAt,
        note,
        source: 'manual',
        externalId: null,
        owned: true,
        pending: true,
      };
    }
  }

  async deleteWeight(id: string): Promise<void> {
    const db = await getDatabase();

    const pending = await db.getFirstAsync<PendingWeightRow>(
      'SELECT id FROM pending_weights WHERE id = ?',
      id
    );
    if (pending) {
      await db.runAsync('DELETE FROM pending_weights WHERE id = ?', id);
      return;
    }

    const cached = await db.getFirstAsync<WeightCacheRow>(
      'SELECT * FROM weight_cache WHERE client_record_id = ?',
      id
    );
    if (!cached) {
      throw new Error(LOCAL_EDIT_ERROR);
    }

    // Throws on failure, leaving the cache row so the record stays visible.
    await deleteWeightRecordsByClientId([id]);
    await db.runAsync('DELETE FROM weight_cache WHERE external_id = ?', cached.external_id);
  }

  async deleteAllWeights(): Promise<void> {
    const db = await getDatabase();

    // Delete Heft-originated Health Connect records first so a failure leaves the
    // cache (and therefore the visible history) untouched and retryable.
    const owned = await db.getAllAsync<{ client_record_id: string }>(
      'SELECT client_record_id FROM weight_cache WHERE client_record_id IS NOT NULL'
    );
    if (owned.length > 0) {
      await deleteWeightRecordsByClientId(
        owned.map((row) => row.client_record_id)
      );
    }

    // Pending entries were never written to Health Connect, so they are simply dropped.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync('DELETE FROM weight_cache; DELETE FROM pending_weights;');
    });
  }
}

const localRepository = new LocalWeightRepository();
const healthConnectRepository = new HealthConnectWeightRepository();

export function getWeightRepository(mode: StorageMode): WeightRepository {
  return mode === 'health-connect' ? healthConnectRepository : localRepository;
}
