export type MeasurementSource = 'manual' | 'ocr' | 'import';

export type SyncStatus = 'pending' | 'synced' | 'conflict';

export type Measurement = {
  id: string;
  userId: string | null;
  weightGrams: number;
  scaleProfile: string | null;
  measuredAt: string;
  source: MeasurementSource;
  ocrRawText: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
};

export type WeightEntryRow = {
  id: string;
  user_id: string | null;
  weight_grams: number;
  scale_profile: string | null;
  measured_at: string;
  source: MeasurementSource;
  ocr_raw_text: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
};

export function rowToMeasurement(row: WeightEntryRow): Measurement {
  return {
    id: row.id,
    userId: row.user_id,
    weightGrams: row.weight_grams,
    scaleProfile: row.scale_profile,
    measuredAt: row.measured_at,
    source: row.source,
    ocrRawText: row.ocr_raw_text,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncStatus: row.sync_status,
  };
}
