import { useEffect, useMemo } from 'react';

import type { AppPreferences } from '@/features/settings/types';
import { syncReminders } from './notifications';
import { pickReminderSettings } from './schedule';

/**
 * Keeps the OS notification schedule in step with the settings.
 *
 * Runs once per launch and again whenever a reminder setting changes. The launch
 * run is not redundant: Android drops pending alarms when it restarts, so
 * re-registering on the way in is what makes a weekly reminder survive a reboot.
 */
export function useReminderSync(
  ready: boolean,
  preferences: AppPreferences
): void {
  // Narrowed to the fields that decide the schedule, so changing the weight unit
  // or the goal weight does not tear down and rebuild the alarms.
  const settings = useMemo(() => pickReminderSettings(preferences), [preferences]);

  useEffect(() => {
    if (!ready) return;

    syncReminders(settings).catch(() => {
      // Reminders are a convenience. If scheduling fails the in-app banner still
      // works, so there is nothing here worth interrupting the user about.
    });
  }, [ready, settings]);
}
