import type { AppPreferences, ReminderRepeat } from '@/features/settings/types';

/**
 * The Android channel every Heft reminder is posted to. A channel is what lets
 * the OS group them, and lets the user quiet them without silencing anything
 * else the phone does.
 */
export const REMINDER_CHANNEL_ID = 'heft-reminders';

export type ReminderKind = 'weigh-in' | 'water';

/**
 * Exactly the preferences that decide the schedule, narrowed on purpose. The
 * reschedule effect keys off these, so changing the weight unit or the goal
 * weight never tears down and rebuilds the OS alarms.
 */
export type ReminderSettings = {
  reminderEnabled: boolean;
  reminderRepeat: ReminderRepeat;
  reminderWeekday: number;
  reminderHour: number;
  reminderMinute: number;
  waterReminderEnabled: boolean;
  waterStartHour: number;
  waterEndHour: number;
  waterIntervalHours: number;
};

/** Mirrors the two trigger shapes expo-notifications accepts for repeats. */
export type ReminderTrigger =
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: number; hour: number; minute: number };

export type ScheduledReminder = {
  kind: ReminderKind;
  /** Stable across reschedules, and visible in `dumpsys` while debugging. */
  key: string;
  title: string;
  body: string;
  trigger: ReminderTrigger;
};

/**
 * A ceiling on water prompts. Twelve a day is already more than anyone asked
 * for; past that the phone is handing out chores rather than reminders.
 */
export const MAX_WATER_PROMPTS = 12;

export const WATER_INTERVALS = [1, 2, 3, 4];

/** 1 = Sunday … 7 = Saturday, which is the weekday convention the OS uses. */
export const WEEKDAYS = [
  { value: 1, short: 'Sun', long: 'Sunday' },
  { value: 2, short: 'Mon', long: 'Monday' },
  { value: 3, short: 'Tue', long: 'Tuesday' },
  { value: 4, short: 'Wed', long: 'Wednesday' },
  { value: 5, short: 'Thu', long: 'Thursday' },
  { value: 6, short: 'Fri', long: 'Friday' },
  { value: 7, short: 'Sat', long: 'Saturday' },
];

/** Rounds to a whole number and pins it inside a range, so bad data can't loop. */
function wholeNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export function clockTime(hour: number, minute = 0): string {
  const safeHour = wholeNumber(hour, 0, 23);
  const safeMinute = wholeNumber(minute, 0, 59);
  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`;
}

/**
 * The hours a water reminder fires at: the start hour, then every
 * `intervalHours`, up to and including the end hour. A window that ends before
 * it starts yields nothing to schedule rather than an unbounded loop.
 */
export function waterPromptHours(
  startHour: number,
  endHour: number,
  intervalHours: number
): number[] {
  const start = wholeNumber(startHour, 0, 23);
  const end = wholeNumber(endHour, 0, 23);
  const step = wholeNumber(intervalHours, 1, 12);

  const hours: number[] = [];
  for (let hour = start; hour <= end; hour += step) {
    if (hours.length >= MAX_WATER_PROMPTS) break;
    hours.push(hour);
  }

  return hours;
}

/** A plain-language line for the settings card, e.g. "7 a day, 09:00-21:00". */
export function describeWaterWindow(settings: ReminderSettings): string {
  const hours = waterPromptHours(
    settings.waterStartHour,
    settings.waterEndHour,
    settings.waterIntervalHours
  );

  if (hours.length === 0) return 'Nothing scheduled yet.';

  const first = hours[0];
  const last = hours[hours.length - 1];
  const count = `${hours.length} a day`;
  if (hours.length === 1) return `${count}, at ${clockTime(first)}`;

  const every = settings.waterIntervalHours === 1 ? 'every hour' : `every ${settings.waterIntervalHours} hours`;
  return `${count}, ${every} from ${clockTime(first)} to ${clockTime(last)}`;
}

/**
 * Picks the reminder-relevant preferences out of the full set. Keeping this
 * explicit is what lets the sync hook depend on a small, honest object.
 */
export function pickReminderSettings(
  preferences: AppPreferences
): ReminderSettings {
  return {
    reminderEnabled: preferences.reminderEnabled,
    reminderRepeat: preferences.reminderRepeat,
    reminderWeekday: preferences.reminderWeekday,
    reminderHour: preferences.reminderHour,
    reminderMinute: preferences.reminderMinute,
    waterReminderEnabled: preferences.waterReminderEnabled,
    waterStartHour: preferences.waterStartHour,
    waterEndHour: preferences.waterEndHour,
    waterIntervalHours: preferences.waterIntervalHours,
  };
}

/**
 * The full list of reminders the OS should be holding for these settings.
 * Pure, so the schedule can be asserted in tests without a device.
 */
export function buildReminders(settings: ReminderSettings): ScheduledReminder[] {
  const reminders: ScheduledReminder[] = [];

  if (settings.reminderEnabled) {
    const hour = wholeNumber(settings.reminderHour, 0, 23);
    const minute = wholeNumber(settings.reminderMinute, 0, 59);

    if (settings.reminderRepeat === 'weekly') {
      reminders.push({
        kind: 'weigh-in',
        key: 'weigh-in-weekly',
        title: 'Time for your weekly weigh-in',
        body: 'A reading today keeps your trend accurate.',
        trigger: {
          type: 'weekly',
          weekday: wholeNumber(settings.reminderWeekday, 1, 7),
          hour,
          minute,
        },
      });
    } else {
      reminders.push({
        kind: 'weigh-in',
        key: 'weigh-in-daily',
        title: 'Time to weigh in',
        body: 'A reading today keeps your trend accurate.',
        trigger: { type: 'daily', hour, minute },
      });
    }
  }

  if (settings.waterReminderEnabled) {
    const hours = waterPromptHours(
      settings.waterStartHour,
      settings.waterEndHour,
      settings.waterIntervalHours
    );

    for (const hour of hours) {
      reminders.push({
        kind: 'water',
        key: `water-${clockTime(hour)}`,
        title: 'Drink some water',
        body: 'A glass now, then carry on.',
        trigger: { type: 'daily', hour, minute: 0 },
      });
    }
  }

  return reminders;
}
