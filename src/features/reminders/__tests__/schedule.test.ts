import {
  MAX_WATER_PROMPTS,
  buildReminders,
  describeWaterWindow,
  pickReminderSettings,
  type ReminderSettings,
  waterPromptHours,
} from '../schedule';
import { DEFAULT_PREFERENCES } from '@/features/settings/types';

const OFF: ReminderSettings = {
  reminderEnabled: false,
  reminderRepeat: 'daily',
  reminderWeekday: 2,
  reminderHour: 7,
  reminderMinute: 0,
  waterReminderEnabled: false,
  waterStartHour: 9,
  waterEndHour: 21,
  waterIntervalHours: 2,
};

const settings = (patch: Partial<ReminderSettings> = {}): ReminderSettings => ({
  ...OFF,
  ...patch,
});

describe('waterPromptHours', () => {
  it('steps across the window and includes the end hour', () => {
    expect(waterPromptHours(9, 21, 2)).toEqual([9, 11, 13, 15, 17, 19, 21]);
  });

  it('handles a window that is a single hour', () => {
    expect(waterPromptHours(14, 14, 3)).toEqual([14]);
  });

  it('returns nothing when the window ends before it starts', () => {
    expect(waterPromptHours(20, 8, 2)).toEqual([]);
  });

  it('treats a zero or negative interval as hourly rather than looping forever', () => {
    expect(waterPromptHours(9, 11, 0)).toEqual([9, 10, 11]);
    expect(waterPromptHours(9, 11, -4)).toEqual([9, 10, 11]);
  });

  it('stops at the ceiling instead of filling the day', () => {
    const hours = waterPromptHours(0, 23, 1);
    expect(hours).toHaveLength(MAX_WATER_PROMPTS);
    expect(hours[0]).toBe(0);
    expect(hours[MAX_WATER_PROMPTS - 1]).toBe(MAX_WATER_PROMPTS - 1);
  });
});

describe('buildReminders', () => {
  it('schedules nothing when both reminders are off', () => {
    expect(buildReminders(settings())).toEqual([]);
  });

  it('schedules a daily weigh-in', () => {
    const reminders = buildReminders(
      settings({ reminderEnabled: true, reminderHour: 6, reminderMinute: 30 })
    );

    expect(reminders).toHaveLength(1);
    expect(reminders[0].kind).toBe('weigh-in');
    expect(reminders[0].trigger).toEqual({
      type: 'daily',
      hour: 6,
      minute: 30,
    });
  });

  it('schedules a weekly weigh-in on the chosen weekday', () => {
    const reminders = buildReminders(
      settings({ reminderEnabled: true, reminderRepeat: 'weekly', reminderWeekday: 7 })
    );

    expect(reminders).toHaveLength(1);
    expect(reminders[0].trigger).toEqual({
      type: 'weekly',
      weekday: 7,
      hour: 7,
      minute: 0,
    });
  });

  it('schedules one water reminder per hour in the window', () => {
    const reminders = buildReminders(
      settings({ waterReminderEnabled: true, waterStartHour: 9, waterEndHour: 13, waterIntervalHours: 2 })
    );

    expect(reminders.map((reminder) => reminder.trigger)).toEqual([
      { type: 'daily', hour: 9, minute: 0 },
      { type: 'daily', hour: 11, minute: 0 },
      { type: 'daily', hour: 13, minute: 0 },
    ]);
    expect(reminders.every((reminder) => reminder.kind === 'water')).toBe(true);
  });

  it('gives every reminder a unique key when both are on', () => {
    const reminders = buildReminders(
      settings({
        reminderEnabled: true,
        waterReminderEnabled: true,
        waterStartHour: 9,
        waterEndHour: 15,
        waterIntervalHours: 2,
      })
    );

    const keys = reminders.map((reminder) => reminder.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(reminders).toHaveLength(5);
  });

  it('keeps titles and bodies free of formatting characters', () => {
    const reminders = buildReminders(
      settings({ reminderEnabled: true, waterReminderEnabled: true })
    );

    for (const reminder of reminders) {
      expect(reminder.title.trim()).toBe(reminder.title);
      expect(reminder.body.trim()).toBe(reminder.body);
      expect(reminder.title).not.toContain('*');
      expect(reminder.body).not.toContain('*');
    }
  });
});

describe('pickReminderSettings', () => {
  it('takes only the fields that decide the schedule', () => {
    const picked = pickReminderSettings({
      ...DEFAULT_PREFERENCES,
      weightUnit: 'lb',
      goalWeightKg: 72,
      aiMethod: 'chatgpt',
      reminderEnabled: true,
      reminderHour: 8,
    });

    expect(picked).toEqual({
      reminderEnabled: true,
      reminderRepeat: 'daily',
      reminderWeekday: 2,
      reminderHour: 8,
      reminderMinute: 0,
      waterReminderEnabled: false,
      waterStartHour: 9,
      waterEndHour: 21,
      waterIntervalHours: 2,
    });
    expect(Object.keys(picked)).not.toContain('weightUnit');
  });
});

describe('describeWaterWindow', () => {
  it('describes a spread of reminders', () => {
    const description = describeWaterWindow(
      settings({ waterStartHour: 9, waterEndHour: 21, waterIntervalHours: 2 })
    );

    expect(description).toBe('7 a day, every 2 hours from 09:00 to 21:00');
  });

  it('speaks plainly when there is only one prompt', () => {
    expect(
      describeWaterWindow(
        settings({ waterStartHour: 14, waterEndHour: 14, waterIntervalHours: 2 })
      )
    ).toBe('1 a day, at 14:00');
  });

  it('says so when the window is empty', () => {
    expect(
      describeWaterWindow(
        settings({ waterStartHour: 20, waterEndHour: 8, waterIntervalHours: 2 })
      )
    ).toBe('Nothing scheduled yet.');
  });
});
