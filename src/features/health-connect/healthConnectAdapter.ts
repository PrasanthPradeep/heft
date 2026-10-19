import {
  RecordingMethod,
  deleteRecordsByUuids,
  insertRecords,
  readRecords,
  type WeightRecord,
} from 'react-native-health-connect';

import { normalizeWeightKg } from '@/features/weight/weightCalculations';

import { ensureHealthConnectReady } from './healthConnectPermissions';

/** A weight record as returned by Health Connect. */
export type HealthConnectWeight = {
  externalId: string;
  /** Set when Heft wrote the record; used to gate edit/delete. */
  clientRecordId: string | null;
  weightKg: number;
  measuredAt: string;
  sourcePackage: string | null;
  recordingMethod: number | null;
};

export type WriteWeightInput = {
  /** Heft-generated id, stored as the Health Connect `clientRecordId`. */
  id: string;
  weightKg: number;
  measuredAt: string;
};

const MAX_PAGES = 50;
const PAGE_SIZE = 1000;

/**
 * Every record operation needs an initialised client. Callers already treat a
 * throw as "Health Connect is not usable right now" — queueing writes and
 * leaving caches untouched — so failing loudly here is the safe behaviour.
 */
async function requireReadyClient(): Promise<void> {
  if (!(await ensureHealthConnectReady())) {
    throw new Error('Health Connect is not available.');
  }
}

/**
 * Writes a single manual weight measurement and returns the Health Connect
 * record id. Health Connect rejects invalid values, and so do we.
 */
export async function writeWeight(input: WriteWeightInput): Promise<string> {
  await requireReadyClient();

  const weightKg = normalizeWeightKg(input.weightKg);
  const time = new Date(input.measuredAt).toISOString();

  const record: WeightRecord = {
    recordType: 'Weight',
    time,
    weight: { value: weightKg, unit: 'kilograms' },
    metadata: {
      clientRecordId: input.id,
      clientRecordVersion: 0,
      recordingMethod: RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY,
    },
  };

  const ids = await insertRecords([record]);
  const id = ids[0];
  if (!id) {
    throw new Error('Health Connect did not return a record id.');
  }
  return id;
}

/**
 * Reads weight records in a time range, following pagination to completion.
 * Only records with a usable id, timestamp and weight are returned.
 */
export async function readWeightHistory(
  startTime: string,
  endTime: string
): Promise<HealthConnectWeight[]> {
  await requireReadyClient();

  const results: HealthConnectWeight[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await readRecords('Weight', {
      timeRangeFilter: { operator: 'between', startTime, endTime },
      ascendingOrder: false,
      pageSize: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });

    for (const record of response.records) {
      const externalId = record.metadata?.id;
      const weightKg = record.weight?.inKilograms;

      if (!externalId || !Number.isFinite(weightKg) || weightKg <= 0) continue;
      if (!Number.isFinite(Date.parse(record.time))) continue;

      results.push({
        externalId,
        clientRecordId: record.metadata?.clientRecordId ?? null,
        weightKg,
        measuredAt: new Date(record.time).toISOString(),
        sourcePackage: record.metadata?.dataOrigin ?? null,
        recordingMethod: record.metadata?.recordingMethod ?? null,
      });
    }

    pageToken = response.pageToken || undefined;
    if (!pageToken) break;
  }

  return results;
}

/**
 * Reads the latest height record in centimetres. Health Connect stores height
 * in metres; values outside a plausible adult range are ignored so a bad record
 * never poisons BMI. Returns null when no usable record exists.
 */
export async function readLatestHealthConnectHeight(): Promise<number | null> {
  await requireReadyClient();

  const response = await readRecords('Height', {
    timeRangeFilter: {
      operator: 'before',
      endTime: new Date().toISOString(),
    },
    ascendingOrder: false,
    pageSize: 1,
  });

  const meters = response.records[0]?.height?.inMeters;
  if (!Number.isFinite(meters)) return null;

  const heightCm = meters * 100;
  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250) {
    return null;
  }

  return Math.round(heightCm * 10) / 10;
}

/**
 * Deletes Heft-originated records. Deleting by `clientRecordId` only ever
 * removes records this app created, so data from other apps is never touched.
 */
export async function deleteWeightRecordsByClientId(
  clientRecordIds: string[]
): Promise<void> {
  if (clientRecordIds.length === 0) return;
  await requireReadyClient();
  await deleteRecordsByUuids('Weight', [], clientRecordIds);
}
