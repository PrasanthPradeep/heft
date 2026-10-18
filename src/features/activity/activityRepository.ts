import { getDatabase } from '@/db/database';

import { listActivitySessions, listDailyActivity } from './activityCache';
import type { ActivitySession, DailyActivity } from './types';

/** Daily steps/exercise cached from Health Connect (empty in local-only mode). */
export async function loadDailyActivity(): Promise<DailyActivity[]> {
  const db = await getDatabase();
  return listDailyActivity(db);
}

export async function loadRecentSessions(
  limit = 10
): Promise<ActivitySession[]> {
  const db = await getDatabase();
  return listActivitySessions(db, limit);
}
