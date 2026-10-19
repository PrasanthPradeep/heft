import { getDatabase } from '@/db/database';
import { readActivity } from '@/features/activity/activityAdapter';
import { replaceActivitySnapshot } from '@/features/activity/activityCache';
import { localDayKey, windowStartIso } from '@/features/activity/activityCalculations';
import {
  loadLastSyncedAt,
  loadPreferences,
  persistLastSyncedAt,
} from '@/features/settings/preferenceStore';
import type { PendingWaterRow } from '@/features/water/types';
import type { PendingWeightRow } from '@/features/weight/types';

import { readWeightHistory, writeWeight } from './healthConnectAdapter';
import {
  readHydrationHistory,
  writeHydration,
} from './hydrationAdapter';
import { replaceHydrationWindow, upsertCachedHydration } from './hydrationCache';
import {
  getActivityPermissionState,
  getHealthConnectStatus,
  getHydrationPermissionState,
  getWeightPermissionState,
  hasActivityAccess,
  hasHydrationAccess,
  initializeHealthConnect,
} from './healthConnectPermissions';
import { replaceCacheWindow, upsertCachedWeights } from './weightCache';

/**
 * Health Connect only exposes roughly the last 30 days without the separate
 * historical-read permission, so Heft syncs a 30-day window. Older history would
 * require requesting `READ_HEALTH_DATA_HISTORY` and a Play Store declaration.
 */
export const READ_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SyncStatus = 'ok' | 'skipped' | 'error';

export type SyncResult = {
  status: SyncStatus;
  reason?: string;
  /** Pending Heft entries successfully written to Health Connect. */
  written: number;
  /** Pending entries that still could not be written. */
  failed: number;
  /** Records read back from Health Connect into the cache. */
  imported: number;
  /** Days of activity (steps/exercise) refreshed into the cache. */
  activityDays: number;
  /** Pending water entries successfully written to Health Connect. */
  waterWritten: number;
  /** Pending water entries that still could not be written. */
  waterFailed: number;
  /** Hydration records read back from Health Connect into the cache. */
  waterImported: number;
  syncedAt: string | null;
};

function baseResult(
  status: SyncStatus,
  reason: string | undefined,
  syncedAt: string | null
): SyncResult {
  return {
    status,
    reason,
    written: 0,
    failed: 0,
    imported: 0,
    activityDays: 0,
    waterWritten: 0,
    waterFailed: 0,
    waterImported: 0,
    syncedAt,
  };
}

/** Writes queued manual entries to Health Connect, stopping at the first failure. */
async function flushPending(): Promise<{ written: number; failed: number }> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PendingWeightRow>(
    'SELECT * FROM pending_weights ORDER BY created_at ASC'
  );

  let written = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const externalId = await writeWeight({
        id: row.id,
        weightKg: row.weight_kg,
        measuredAt: row.measured_at,
      });

      await db.withExclusiveTransactionAsync(async (txn) => {
        await upsertCachedWeights(txn, [
          {
            externalId,
            clientRecordId: row.id,
            weightKg: row.weight_kg,
            measuredAt: row.measured_at,
            sourcePackage: null,
            recordingMethod: null,
          },
        ]);
        await txn.runAsync('DELETE FROM pending_weights WHERE id = ?', row.id);
      });

      written += 1;
    } catch {
      failed += 1;
      // Preserve ordering: retry the whole queue on the next sync.
      break;
    }
  }

  return { written, failed };
}

/** Mirrors the accessible Health Connect weight history into the local cache. */
async function refreshCache(): Promise<number> {
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - READ_WINDOW_DAYS * DAY_MS).toISOString();

  let records;
  try {
    records = await readWeightHistory(startTime, endTime);
  } catch {
    // Permission revoked mid-flight or an unavailable provider: leave the cache.
    return 0;
  }

  // Guard against a provider returning the same record twice.
  const unique = new Map(records.map((record) => [record.externalId, record]));

  const db = await getDatabase();
  await replaceCacheWindow(db, startTime, endTime, [...unique.values()]);

  return unique.size;
}

/**
 * Mirrors daily steps and exercise from Health Connect. The window starts at
 * local midnight so Health Connect's daily buckets align to calendar days.
 */
async function refreshActivity(): Promise<number> {
  const now = new Date();
  const endTime = now.toISOString();
  const startTime = windowStartIso(now, READ_WINDOW_DAYS);
  const keepFromDay = localDayKey(new Date(startTime));

  let snapshot;
  try {
    snapshot = await readActivity(startTime, endTime);
  } catch {
    // Permission revoked mid-flight or an unavailable provider: leave the cache.
    return 0;
  }

  const db = await getDatabase();
  await replaceActivitySnapshot(db, keepFromDay, startTime, snapshot);

  return snapshot.days.length;
}

/**
 * Writes queued water entries to Health Connect, stopping at the first failure
 * so the queue keeps its order.
 */
async function flushPendingWater(): Promise<{ written: number; failed: number }> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PendingWaterRow>(
    'SELECT * FROM pending_water ORDER BY created_at ASC'
  );

  let written = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const externalId = await writeHydration({
        id: row.id,
        volumeMl: row.volume_ml,
        loggedAt: row.logged_at,
      });

      await db.withExclusiveTransactionAsync(async (txn) => {
        await upsertCachedHydration(txn, [
          {
            externalId,
            clientRecordId: row.id,
            volumeMl: row.volume_ml,
            loggedAt: row.logged_at,
            sourcePackage: null,
            recordingMethod: null,
          },
        ]);
        await txn.runAsync('DELETE FROM pending_water WHERE id = ?', row.id);
      });

      written += 1;
    } catch {
      failed += 1;
      // Preserve ordering: retry the whole queue on the next sync.
      break;
    }
  }

  return { written, failed };
}

/** Mirrors the accessible Health Connect hydration history into the cache. */
async function refreshHydration(): Promise<number> {
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - READ_WINDOW_DAYS * DAY_MS).toISOString();

  let records;
  try {
    records = await readHydrationHistory(startTime, endTime);
  } catch {
    // Permission revoked mid-flight or an unavailable provider: leave the cache.
    return 0;
  }

  // Guard against a provider returning the same record twice.
  const unique = new Map(records.map((record) => [record.externalId, record]));

  const db = await getDatabase();
  await replaceHydrationWindow(db, startTime, endTime, [...unique.values()]);

  return unique.size;
}

/**
 * Synchronises Health Connect:
 *   1. skip entirely in local-only mode;
 *   2. verify availability and current permissions (they can be revoked);
 *   3. retry queued Heft writes;
 *   4. mirror the accessible weight, hydration and activity into the cache;
 *   5. record the last successful sync time.
 */
export async function syncHealthConnect(): Promise<SyncResult> {
  const preferences = await loadPreferences();
  const lastSyncedAt = await loadLastSyncedAt();

  if (preferences.storageMode !== 'health-connect') {
    return baseResult('skipped', 'local-mode', lastSyncedAt);
  }

  const status = await getHealthConnectStatus();
  if (status !== 'available') {
    return baseResult('skipped', status, lastSyncedAt);
  }

  await initializeHealthConnect();

  const permissions = await getWeightPermissionState();
  const activityPermissions = await getActivityPermissionState();
  const hydrationPermissions = await getHydrationPermissionState();
  if (
    !permissions.canRead &&
    !permissions.canWrite &&
    !hasActivityAccess(activityPermissions) &&
    !hasHydrationAccess(hydrationPermissions)
  ) {
    return baseResult('skipped', 'no-permissions', lastSyncedAt);
  }

  let written = 0;
  let failed = 0;
  if (permissions.canWrite) {
    const flush = await flushPending();
    written = flush.written;
    failed = flush.failed;
  }

  let imported = 0;
  if (permissions.canRead) {
    imported = await refreshCache();
  }

  let activityDays = 0;
  if (hasActivityAccess(activityPermissions)) {
    activityDays = await refreshActivity();
  }

  let waterWritten = 0;
  let waterFailed = 0;
  if (hydrationPermissions.canWrite) {
    const flush = await flushPendingWater();
    waterWritten = flush.written;
    waterFailed = flush.failed;
  }

  let waterImported = 0;
  if (hydrationPermissions.canRead) {
    waterImported = await refreshHydration();
  }

  const syncedAt = new Date().toISOString();
  await persistLastSyncedAt(syncedAt);

  return {
    status: 'ok',
    written,
    failed,
    imported,
    activityDays,
    waterWritten,
    waterFailed,
    waterImported,
    syncedAt,
  };
}
