import { randomUUID } from 'expo-crypto';

import { getDatabase } from '@/db/database';
import {
  deleteHydrationRecordsByClientId,
  writeHydration,
} from '@/features/health-connect/hydrationAdapter';
import {
  listCachedHydration,
  upsertCachedHydration,
} from '@/features/health-connect/hydrationCache';
import type { StorageMode } from '@/features/settings/types';

import {
  compareByLoggedAtDesc,
  rowToLocalWaterEntry,
  rowToPendingWaterEntry,
  type PendingWaterRow,
  type WaterCacheRow,
  type WaterEntry,
  type WaterEntryInput,
  type WaterEntryRow,
} from './types';
import {
  MAX_VOLUME_ML,
  normalizeVolumeMl,
  validateLoggedAt,
} from './waterCalculations';

export interface WaterRepository {
  listWater(): Promise<WaterEntry[]>;
  addWater(input: WaterEntryInput): Promise<WaterEntry>;
  /** Removes one Heft-owned entry. Imported records cannot be deleted here. */
  deleteWater(id: string): Promise<void>;
  /** Removes every Heft-owned entry. Never touches other apps' records. */
  deleteAllWater(): Promise<void>;
}

function normalizeInput(input: WaterEntryInput) {
  return {
    volumeMl: normalizeVolumeMl(input.volumeMl),
    loggedAt: validateLoggedAt(input.loggedAt ?? new Date().toISOString()),
  };
}

const LOCAL_EDIT_ERROR =
  'This water entry was not created in Heft, so it cannot be changed here.';

/** Ignore malformed legacy/cache rows so they cannot break totals. */
function hasUsableVolume(entry: WaterEntry): boolean {
  return (
    typeof entry.volumeMl === 'number' &&
    Number.isFinite(entry.volumeMl) &&
    entry.volumeMl >= 1 &&
    entry.volumeMl <= MAX_VOLUME_ML
  );
}

/** Local-only mode: SQLite is the authoritative water log. */
export class LocalWaterRepository implements WaterRepository {
  async listWater(): Promise<WaterEntry[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<WaterEntryRow>(
      'SELECT * FROM water_entries ORDER BY logged_at DESC'
    );
    return rows.map(rowToLocalWaterEntry).filter(hasUsableVolume);
  }

  async addWater(input: WaterEntryInput): Promise<WaterEntry> {
    const { volumeMl, loggedAt } = normalizeInput(input);
    const db = await getDatabase();
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.runAsync(
      `INSERT INTO water_entries
        (id, volume_ml, logged_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      volumeMl,
      loggedAt,
      now,
      now
    );

    return {
      id,
      volumeMl,
      loggedAt,
      source: 'manual',
      externalId: null,
      owned: true,
      pending: false,
    };
  }

  async deleteWater(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM water_entries WHERE id = ?', id);
  }

  async deleteAllWater(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM water_entries');
  }
}

/** Health Connect mode: Health Connect is authoritative, SQLite is a cache. */
export class HealthConnectWaterRepository implements WaterRepository {
  async listWater(): Promise<WaterEntry[]> {
    const db = await getDatabase();
    const [cached, pendingRows] = await Promise.all([
      listCachedHydration(db),
      db.getAllAsync<PendingWaterRow>('SELECT * FROM pending_water'),
    ]);

    const byId = new Map<string, WaterEntry>();
    for (const entry of cached) byId.set(entry.id, entry);
    for (const row of pendingRows) byId.set(row.id, rowToPendingWaterEntry(row));

    return [...byId.values()]
      .filter(hasUsableVolume)
      .sort(compareByLoggedAtDesc);
  }

  async addWater(input: WaterEntryInput): Promise<WaterEntry> {
    const { volumeMl, loggedAt } = normalizeInput(input);
    const id = randomUUID();

    try {
      const externalId = await writeHydration({ id, volumeMl, loggedAt });
      const db = await getDatabase();
      await upsertCachedHydration(db, [
        {
          externalId,
          clientRecordId: id,
          volumeMl,
          loggedAt,
          sourcePackage: null,
          recordingMethod: null,
        },
      ]);

      return {
        id,
        volumeMl,
        loggedAt,
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
        `INSERT INTO pending_water
          (id, volume_ml, logged_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        volumeMl,
        loggedAt,
        now,
        now
      );

      return {
        id,
        volumeMl,
        loggedAt,
        source: 'manual',
        externalId: null,
        owned: true,
        pending: true,
      };
    }
  }

  async deleteWater(id: string): Promise<void> {
    const db = await getDatabase();

    const pending = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM pending_water WHERE id = ?',
      id
    );
    if (pending) {
      await db.runAsync('DELETE FROM pending_water WHERE id = ?', id);
      return;
    }

    const cached = await db.getFirstAsync<WaterCacheRow>(
      'SELECT * FROM water_cache WHERE client_record_id = ?',
      id
    );
    if (!cached) {
      throw new Error(LOCAL_EDIT_ERROR);
    }

    // Throws on failure, leaving the cache row so the entry stays visible.
    await deleteHydrationRecordsByClientId([id]);
    await db.runAsync(
      'DELETE FROM water_cache WHERE external_id = ?',
      cached.external_id
    );
  }

  async deleteAllWater(): Promise<void> {
    const db = await getDatabase();

    // Delete Heft-originated Health Connect records first so a failure leaves the
    // cache (and therefore the visible log) untouched and retryable.
    const owned = await db.getAllAsync<{ client_record_id: string }>(
      'SELECT client_record_id FROM water_cache WHERE client_record_id IS NOT NULL'
    );
    if (owned.length > 0) {
      await deleteHydrationRecordsByClientId(
        owned.map((row) => row.client_record_id)
      );
    }

    // Pending entries were never written to Health Connect, so they are dropped.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync('DELETE FROM water_cache; DELETE FROM pending_water;');
    });
  }
}

const localRepository = new LocalWaterRepository();
const healthConnectRepository = new HealthConnectWaterRepository();

export function getWaterRepository(mode: StorageMode): WaterRepository {
  return mode === 'health-connect' ? healthConnectRepository : localRepository;
}
