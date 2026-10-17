export type WeightSource = 'manual' | 'health-connect';

/**
 * A weight reading as presented to the UI, independent of where it is stored.
 *
 * - Local mode: every entry is authoritative in SQLite (`owned: true`).
 * - Health Connect mode: entries mirror Health Connect. `owned` is true only for
 *   records Heft created (identified by `clientRecordId`); records synced from
 *   other apps are read-only. `pending` is true when a Heft entry could not be
 *   written to Health Connect yet and is queued locally.
 */
export type WeightEntry = {
  id: string;
  weightKg: number;
  /** ISO 8601 timestamp. */
  measuredAt: string;
  note: string | null;
  source: WeightSource;
  /** Health Connect record id (`metadata.id`), when known. */
  externalId: string | null;
  owned: boolean;
  pending: boolean;
};

export type WeightEntryInput = {
  weightKg: number;
  measuredAt: string;
  note?: string | null;
};

export type WeightEntryRow = {
  id: string;
  weight_kg: number;
  measured_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type WeightCacheRow = {
  external_id: string;
  client_record_id: string | null;
  weight_kg: number;
  measured_at: string;
  source_package: string | null;
  recording_method: number | null;
  updated_at: string;
};

export type PendingWeightRow = {
  id: string;
  weight_kg: number;
  measured_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToLocalEntry(row: WeightEntryRow): WeightEntry {
  return {
    id: row.id,
    weightKg: row.weight_kg,
    measuredAt: row.measured_at,
    note: row.note,
    source: 'manual',
    externalId: null,
    owned: true,
    pending: false,
  };
}

export function rowToCachedEntry(row: WeightCacheRow): WeightEntry {
  return {
    id: row.client_record_id ?? row.external_id,
    weightKg: row.weight_kg,
    measuredAt: row.measured_at,
    note: null,
    source: row.client_record_id ? 'manual' : 'health-connect',
    externalId: row.external_id,
    owned: row.client_record_id !== null,
    pending: false,
  };
}

export function rowToPendingEntry(row: PendingWeightRow): WeightEntry {
  return {
    id: row.id,
    weightKg: row.weight_kg,
    measuredAt: row.measured_at,
    note: row.note,
    source: 'manual',
    externalId: null,
    owned: true,
    pending: true,
  };
}

export function compareByMeasuredAtDesc(
  a: WeightEntry,
  b: WeightEntry
): number {
  return b.measuredAt.localeCompare(a.measuredAt);
}
