import {
  RecordingMethod,
  deleteRecordsByUuids,
  insertRecords,
  readRecords,
  type HydrationRecord,
} from 'react-native-health-connect';

import {
  hydrationInterval,
  normalizeVolumeMl,
} from '@/features/water/waterCalculations';

import { ensureHealthConnectReady } from './healthConnectPermissions';

/** A hydration record as returned by Health Connect. */
export type HealthConnectHydration = {
  externalId: string;
  /** Set when Heft wrote the record; used to gate delete. */
  clientRecordId: string | null;
  volumeMl: number;
  loggedAt: string;
  sourcePackage: string | null;
  recordingMethod: number | null;
};

export type WriteHydrationInput = {
  /** Heft-generated id, stored as the Health Connect `clientRecordId`. */
  id: string;
  volumeMl: number;
  loggedAt: string;
};

const MAX_PAGES = 50;
const PAGE_SIZE = 1000;

/**
 * Every record operation needs an initialised client. Callers treat a throw as
 * "Health Connect is not usable right now" — queueing writes and leaving caches
 * untouched — so failing loudly here is the safe behaviour.
 */
async function requireReadyClient(): Promise<void> {
  if (!(await ensureHealthConnectReady())) {
    throw new Error('Health Connect is not available.');
  }
}

/**
 * Writes one manual drink and returns the Health Connect record id.
 *
 * Health Connect validates that `startTime` is *strictly* before `endTime`
 * (`IllegalArgumentException: startTime must be before endTime.`), and this
 * client version exposes no single-instant hydration builder, so a drink is
 * written as a one-second interval. Reads only use `startTime`, so the extra
 * second never affects totals or day grouping.
 */
export async function writeHydration(
  input: WriteHydrationInput
): Promise<string> {
  await requireReadyClient();

  const volumeMl = normalizeVolumeMl(input.volumeMl);
  const { startTime, endTime } = hydrationInterval(input.loggedAt);

  const record: HydrationRecord = {
    recordType: 'Hydration',
    startTime,
    endTime,
    volume: { value: volumeMl, unit: 'milliliters' },
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
 * Reads hydration records in a time range, following pagination to completion.
 * Only records with a usable id, timestamp and volume are returned.
 */
export async function readHydrationHistory(
  startTime: string,
  endTime: string
): Promise<HealthConnectHydration[]> {
  await requireReadyClient();

  const results: HealthConnectHydration[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await readRecords('Hydration', {
      timeRangeFilter: { operator: 'between', startTime, endTime },
      ascendingOrder: false,
      pageSize: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });

    for (const record of response.records) {
      const externalId = record.metadata?.id;
      const volumeMl = record.volume?.inMilliliters;
      const loggedAt = record.startTime;

      if (!externalId || !Number.isFinite(volumeMl) || volumeMl <= 0) continue;
      if (!Number.isFinite(Date.parse(loggedAt))) continue;

      results.push({
        externalId,
        clientRecordId: record.metadata?.clientRecordId ?? null,
        volumeMl,
        loggedAt: new Date(loggedAt).toISOString(),
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
 * Deletes Heft-originated records. Deleting by `clientRecordId` only ever
 * removes records this app created, so water logged elsewhere is never touched.
 */
export async function deleteHydrationRecordsByClientId(
  clientRecordIds: string[]
): Promise<void> {
  if (clientRecordIds.length === 0) return;
  await requireReadyClient();
  await deleteRecordsByUuids('Hydration', [], clientRecordIds);
}
