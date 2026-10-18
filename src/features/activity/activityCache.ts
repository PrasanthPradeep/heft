import type { SQLiteDatabase } from 'expo-sqlite';

import type { ActivitySession, ActivitySnapshot, DailyActivity } from './types';

type DailyRow = { day: string; steps: number; exercise_minutes: number };
type SessionRow = {
  id: string;
  title: string | null;
  exercise_type: number;
  start_time: string;
  end_time: string;
  minutes: number;
};

function rowToDaily(row: DailyRow): DailyActivity {
  return {
    day: row.day,
    steps: row.steps,
    exerciseMinutes: row.exercise_minutes,
  };
}

function rowToSession(row: SessionRow): ActivitySession {
  return {
    id: row.id,
    title: row.title,
    exerciseType: row.exercise_type,
    startTime: row.start_time,
    endTime: row.end_time,
    minutes: row.minutes,
  };
}

/**
 * Replaces the cached activity window in one transaction. Only call this after a
 * *complete* read of the window: days and sessions no longer returned by Health
 * Connect are dropped. `keepFromDay` is the first local day of the window.
 */
export async function replaceActivitySnapshot(
  db: SQLiteDatabase,
  keepFromDay: string,
  windowStartIso: string,
  snapshot: ActivitySnapshot
): Promise<void> {
  const updatedAt = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM activity_daily WHERE day >= ?', keepFromDay);
    for (const entry of snapshot.days) {
      await txn.runAsync(
        `INSERT INTO activity_daily (day, steps, exercise_minutes, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET
           steps = excluded.steps,
           exercise_minutes = excluded.exercise_minutes,
           updated_at = excluded.updated_at`,
        entry.day,
        entry.steps,
        entry.exerciseMinutes,
        updatedAt
      );
    }

    await txn.runAsync(
      'DELETE FROM activity_sessions WHERE start_time >= ?',
      windowStartIso
    );
    for (const session of snapshot.sessions) {
      await txn.runAsync(
        `INSERT INTO activity_sessions
           (id, title, exercise_type, start_time, end_time, minutes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           exercise_type = excluded.exercise_type,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           minutes = excluded.minutes,
           updated_at = excluded.updated_at`,
        session.id,
        session.title,
        session.exerciseType,
        session.startTime,
        session.endTime,
        session.minutes,
        updatedAt
      );
    }
  });
}

export async function listDailyActivity(
  db: SQLiteDatabase
): Promise<DailyActivity[]> {
  const rows = await db.getAllAsync<DailyRow>(
    'SELECT day, steps, exercise_minutes FROM activity_daily ORDER BY day ASC'
  );
  return rows.map(rowToDaily);
}

export async function listActivitySessions(
  db: SQLiteDatabase,
  limit = 20
): Promise<ActivitySession[]> {
  const rows = await db.getAllAsync<SessionRow>(
    'SELECT id, title, exercise_type, start_time, end_time, minutes FROM activity_sessions ORDER BY start_time DESC LIMIT ?',
    limit
  );
  return rows.map(rowToSession);
}
