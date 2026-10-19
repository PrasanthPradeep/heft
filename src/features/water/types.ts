export type WaterSource = 'manual' | 'health-connect';

/**
 * A water intake entry as presented to the UI, independent of where it lives.
 *
 * - Local mode: every entry is authoritative in SQLite (`owned: true`).
 * - Health Connect mode: entries mirror Health Connect. `owned` is true only for
 *   records Heft created (identified by `clientRecordId`); records imported from
 *   other apps are read-only. `pending` is true when a Heft entry could not be
 *   written to Health Connect yet and is queued locally.
 */
export type WaterEntry = {
  id: string;
  volumeMl: number;
  /** ISO 8601 timestamp. */
  loggedAt: string;
  source: WaterSource;
  /** Health Connect record id (`metadata.id`), when known. */
  externalId: string | null;
  owned: boolean;
  pending: boolean;
};

export type WaterEntryInput = {
  volumeMl: number;
  /** Defaults to the current time when omitted. */
  loggedAt?: string;
};

export type WaterEntryRow = {
  id: string;
  volume_ml: number;
  logged_at: string;
  created_at: string;
  updated_at: string;
};

export type WaterCacheRow = {
  external_id: string;
  client_record_id: string | null;
  volume_ml: number;
  logged_at: string;
  source_package: string | null;
  recording_method: number | null;
  updated_at: string;
};

export type PendingWaterRow = {
  id: string;
  volume_ml: number;
  logged_at: string;
  created_at: string;
  updated_at: string;
};

export function rowToLocalWaterEntry(row: WaterEntryRow): WaterEntry {
  return {
    id: row.id,
    volumeMl: row.volume_ml,
    loggedAt: row.logged_at,
    source: 'manual',
    externalId: null,
    owned: true,
    pending: false,
  };
}

export function rowToCachedWaterEntry(row: WaterCacheRow): WaterEntry {
  return {
    id: row.client_record_id ?? row.external_id,
    volumeMl: row.volume_ml,
    loggedAt: row.logged_at,
    source: row.client_record_id ? 'manual' : 'health-connect',
    externalId: row.external_id,
    owned: row.client_record_id !== null,
    pending: false,
  };
}

export function rowToPendingWaterEntry(row: PendingWaterRow): WaterEntry {
  return {
    id: row.id,
    volumeMl: row.volume_ml,
    loggedAt: row.logged_at,
    source: 'manual',
    externalId: null,
    owned: true,
    pending: true,
  };
}

export function compareByLoggedAtDesc(a: WaterEntry, b: WaterEntry): number {
  return b.loggedAt.localeCompare(a.loggedAt);
}
