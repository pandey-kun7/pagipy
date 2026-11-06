import { describe, it, expect } from 'vitest';
import {
  computeNextRunAt,
  validateScheduleOptions,
} from '../../src/backend/utils/scheduleCalculator.js';
import { DateTime } from 'luxon';

describe('Schedule Calculator & Validation', () => {
  it('validates hourly schedule without requiring clock-time fields', () => {
    const valid = validateScheduleOptions({
      schedule_type: 'hourly',
      schedule_timezone: 'America/New_York',
    });
    expect(valid.valid).toBe(true);
  });

  it('calculates next hourly run as the start of the next hour', () => {
    const from = new Date('2026-11-05T14:23:45.000Z');
    const next = computeNextRunAt(
      {
        schedule_type: 'hourly',
        schedule_timezone: 'UTC',
      },
      from
    );
    expect(next.toISOString()).toBe('2026-11-05T15:00:00.000Z');
  });

  it('validates daily schedule requiring hour, minute, and timezone', () => {
    expect(
      validateScheduleOptions({
        schedule_type: 'daily',
        schedule_timezone: 'UTC',
      }).valid
    ).toBe(false);

    expect(
      validateScheduleOptions({
        schedule_type: 'daily',
        schedule_timezone: 'UTC',
        schedule_hour: 14,
        schedule_minute: 30,
      }).valid
    ).toBe(true);
  });

  it('calculates daily run for today if time is in the future, or tomorrow if past', () => {
    const from = new Date('2026-11-05T10:00:00.000Z');

    // Target 14:00 today UTC
    const nextToday = computeNextRunAt(
      {
        schedule_type: 'daily',
        schedule_timezone: 'UTC',
        schedule_hour: 14,
        schedule_minute: 0,
      },
      from
    );
    expect(nextToday.toISOString()).toBe('2026-11-05T14:00:00.000Z');

    // Target 09:00 (already past today at 10:00) -> should be tomorrow 09:00
    const nextTomorrow = computeNextRunAt(
      {
        schedule_type: 'daily',
        schedule_timezone: 'UTC',
        schedule_hour: 9,
        schedule_minute: 0,
      },
      from
    );
    expect(nextTomorrow.toISOString()).toBe('2026-11-06T09:00:00.000Z');
  });

  it('handles timezone offsets accurately for daily runs', () => {
    // 10:00 UTC = 05:00 America/New_York (EST, UTC-5)
    const from = new Date('2026-11-05T10:00:00.000Z');

    // Target 09:30 America/New_York
    const nextNy = computeNextRunAt(
      {
        schedule_type: 'daily',
        schedule_timezone: 'America/New_York',
        schedule_hour: 9,
        schedule_minute: 30,
      },
      from
    );

    const dtInNy = DateTime.fromJSDate(nextNy, { zone: 'America/New_York' });
    expect(dtInNy.hour).toBe(9);
    expect(dtInNy.minute).toBe(30);
    expect(dtInNy.day).toBe(5);
  });

  it('validates weekly schedule requiring weekday (1-7), hour, minute, timezone', () => {
    expect(
      validateScheduleOptions({
        schedule_type: 'weekly',
        schedule_timezone: 'UTC',
        schedule_hour: 10,
        schedule_minute: 0,
      }).valid
    ).toBe(false);

    expect(
      validateScheduleOptions({
        schedule_type: 'weekly',
        schedule_timezone: 'UTC',
        schedule_weekday: 1, // Monday
        schedule_hour: 10,
        schedule_minute: 0,
      }).valid
    ).toBe(true);
  });

  it('calculates weekly run for the next occurrence of target weekday', () => {
    // 2026-11-05 is a Thursday (weekday 4)
    const from = new Date('2026-11-05T10:00:00.000Z');

    // Target Friday (weekday 5) at 12:00 UTC
    const nextFri = computeNextRunAt(
      {
        schedule_type: 'weekly',
        schedule_timezone: 'UTC',
        schedule_weekday: 5,
        schedule_hour: 12,
        schedule_minute: 0,
      },
      from
    );

    expect(DateTime.fromJSDate(nextFri).weekday).toBe(5);
    expect(nextFri.toISOString()).toBe('2026-11-06T12:00:00.000Z');

    // Target Wednesday (weekday 3) at 12:00 UTC -> next week Wednesday
    const nextWed = computeNextRunAt(
      {
        schedule_type: 'weekly',
        schedule_timezone: 'UTC',
        schedule_weekday: 3,
        schedule_hour: 12,
        schedule_minute: 0,
      },
      from
    );

    expect(DateTime.fromJSDate(nextWed).weekday).toBe(3);
    expect(nextWed.toISOString()).toBe('2026-11-11T12:00:00.000Z');
  });

  it('rejects invalid IANA timezones', () => {
    const invalid = validateScheduleOptions({
      schedule_type: 'hourly',
      schedule_timezone: 'Invalid/NonExistent_Zone',
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.error).toContain('Invalid or unrecognized IANA timezone');
  });
});
