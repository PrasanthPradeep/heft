import { Platform } from 'react-native';

import {
  REMINDER_CHANNEL_ID,
  buildReminders,
  type ReminderSettings,
  type ScheduledReminder,
} from './schedule';

type NotificationsModule = typeof import('expo-notifications');

/**
 * `unavailable` is a real state here, not a stand-in for an error: it is what an
 * APK built before notifications existed reports when newer JavaScript reaches
 * it over the air.
 */
export type ReminderPermission =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'unavailable';

export type ReminderSyncResult = {
  /** How many reminders the OS is holding once the sync settles. */
  scheduled: number;
  permission: ReminderPermission;
};

let loaded: NotificationsModule | null | undefined;
let handlerInstalled = false;

/**
 * expo-notifications reaches for its native module while it is being imported,
 * so a top-level `import` would throw on an APK that predates the module — and
 * an over-the-air update can absolutely reach such an APK. Requiring it lazily
 * turns that crash into a feature the app reports as unavailable, and the
 * in-app banner carries on as if nothing happened.
 */
function loadNotifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the import is allowed to fail; see above.
    loaded = require('expo-notifications') as NotificationsModule;
  } catch {
    loaded = null;
  }

  if (loaded && !handlerInstalled) {
    handlerInstalled = true;
    // A reminder that lands while Heft is open should still be readable, but
    // silent: the user is already looking at the app.
    loaded.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }

  return loaded;
}

/** Whether this build can post notifications at all. */
export function remindersSupported(): boolean {
  return loadNotifications() !== null;
}

/** Reads the current permission without ever prompting. */
export async function getReminderPermission(): Promise<ReminderPermission> {
  const notifications = loadNotifications();
  if (!notifications) return 'unavailable';

  try {
    const status = await notifications.getPermissionsAsync();
    if (status.granted) return 'granted';
    return status.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * Asks for permission. Only ever called from the settings screen, at the moment
 * the user switches a reminder on — never on launch.
 */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  const notifications = loadNotifications();
  if (!notifications) return 'unavailable';

  try {
    const existing = await notifications.getPermissionsAsync();
    if (existing.granted) return 'granted';
    if (!existing.canAskAgain) return 'denied';

    const asked = await notifications.requestPermissionsAsync();
    if (asked.granted) return 'granted';
    return asked.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

async function ensureChannel(
  notifications: NotificationsModule
): Promise<void> {
  if (Platform.OS !== 'android') return;

  await notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Reminders',
    description: 'Weigh-in and water reminders you set up in Heft.',
    importance: notifications.AndroidImportance.DEFAULT,
  });
}

async function scheduleOne(
  notifications: NotificationsModule,
  reminder: ScheduledReminder
): Promise<void> {
  const content = {
    title: reminder.title,
    body: reminder.body,
    // Silent on purpose: these are nudges, not alerts.
    sound: false,
    data: { kind: reminder.kind, key: reminder.key },
  };

  if (reminder.trigger.type === 'weekly') {
    await notifications.scheduleNotificationAsync({
      identifier: reminder.key,
      content,
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.WEEKLY,
        channelId: REMINDER_CHANNEL_ID,
        weekday: reminder.trigger.weekday,
        hour: reminder.trigger.hour,
        minute: reminder.trigger.minute,
      },
    });
    return;
  }

  await notifications.scheduleNotificationAsync({
    identifier: reminder.key,
    content,
    trigger: {
      type: notifications.SchedulableTriggerInputTypes.DAILY,
      channelId: REMINDER_CHANNEL_ID,
      hour: reminder.trigger.hour,
      minute: reminder.trigger.minute,
    },
  });
}

/**
 * Makes the OS schedule match the settings.
 *
 * Safe to call often: the schedule is tiny, so it is rebuilt from scratch every
 * time rather than diffed. Calling it on each launch is also what survives a
 * reboot, since Android drops pending alarms when it restarts.
 */
export async function syncReminders(
  settings: ReminderSettings
): Promise<ReminderSyncResult> {
  const notifications = loadNotifications();
  if (!notifications) return { scheduled: 0, permission: 'unavailable' };

  try {
    // Clears anything a previous launch left behind, including stale entries
    // from a schedule the user has since changed or switched off.
    await notifications.cancelAllScheduledNotificationsAsync();

    const wanted = buildReminders(settings);
    if (wanted.length === 0) {
      return { scheduled: 0, permission: await getReminderPermission() };
    }

    const permission = await getReminderPermission();
    if (permission !== 'granted') return { scheduled: 0, permission };

    await ensureChannel(notifications);
    for (const reminder of wanted) {
      await scheduleOne(notifications, reminder);
    }

    return { scheduled: wanted.length, permission };
  } catch {
    return { scheduled: 0, permission: 'unavailable' };
  }
}
