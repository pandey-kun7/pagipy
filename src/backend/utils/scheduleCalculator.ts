import { DateTime, IANAZone } from 'luxon';
import { ScheduleType } from '../../shared/types.js';

export interface ScheduleOptions {
  schedule_type: ScheduleType;
  schedule_timezone: string;
  schedule_hour?: number | null;
  schedule_minute?: number | null;
  schedule_weekday?: number | null; // 1 = Monday ... 7 = Sunday
}

export function validateScheduleOptions(opts: ScheduleOptions): { valid: boolean; error?: string } {
  if (!['hourly', 'daily', 'weekly'].includes(opts.schedule_type)) {
    return { valid: false, error: `Invalid schedule type: ${opts.schedule_type}` };
  }

  if (!opts.schedule_timezone || !IANAZone.isValidSpecifier(opts.schedule_timezone)) {
    return { valid: false, error: `Invalid or unrecognized IANA timezone: "${opts.schedule_timezone}"` };
  }

  if (opts.schedule_type === 'hourly') {
    // Hourly schedule: clock-time must NOT be required
    return { valid: true };
  }

  if (opts.schedule_type === 'daily') {
    if (opts.schedule_hour === undefined || opts.schedule_hour === null || opts.schedule_hour < 0 || opts.schedule_hour > 23) {
      return { valid: false, error: 'Daily schedule requires schedule_hour between 0 and 23' };
    }
    if (opts.schedule_minute === undefined || opts.schedule_minute === null || opts.schedule_minute < 0 || opts.schedule_minute > 59) {
      return { valid: false, error: 'Daily schedule requires schedule_minute between 0 and 59' };
    }
    return { valid: true };
  }

  if (opts.schedule_type === 'weekly') {
    if (opts.schedule_weekday === undefined || opts.schedule_weekday === null || opts.schedule_weekday < 1 || opts.schedule_weekday > 7) {
      return { valid: false, error: 'Weekly schedule requires schedule_weekday between 1 (Monday) and 7 (Sunday)' };
    }
    if (opts.schedule_hour === undefined || opts.schedule_hour === null || opts.schedule_hour < 0 || opts.schedule_hour > 23) {
      return { valid: false, error: 'Weekly schedule requires schedule_hour between 0 and 23' };
    }
    if (opts.schedule_minute === undefined || opts.schedule_minute === null || opts.schedule_minute < 0 || opts.schedule_minute > 59) {
      return { valid: false, error: 'Weekly schedule requires schedule_minute between 0 and 59' };
    }
    return { valid: true };
  }

  return { valid: false, error: 'Unknown schedule configuration' };
}

export function computeNextRunAt(opts: ScheduleOptions, fromDate: Date = new Date()): Date {
  const validation = validateScheduleOptions(opts);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const zone = opts.schedule_timezone;
  const currentInZone = DateTime.fromJSDate(fromDate, { zone });

  if (opts.schedule_type === 'hourly') {
    // Top of the next hour
    const nextHour = currentInZone.plus({ hours: 1 }).startOf('hour');
    return nextHour.toJSDate();
  }

  if (opts.schedule_type === 'daily') {
    const targetHour = opts.schedule_hour!;
    const targetMinute = opts.schedule_minute!;

    let candidate = currentInZone.set({
      hour: targetHour,
      minute: targetMinute,
      second: 0,
      millisecond: 0,
    });

    if (candidate <= currentInZone) {
      candidate = candidate.plus({ days: 1 });
    }

    return candidate.toJSDate();
  }

  if (opts.schedule_type === 'weekly') {
    const targetWeekday = opts.schedule_weekday!; // 1=Mon, 7=Sun
    const targetHour = opts.schedule_hour!;
    const targetMinute = opts.schedule_minute!;

    let candidate = currentInZone.set({
      hour: targetHour,
      minute: targetMinute,
      second: 0,
      millisecond: 0,
    });

    // Calculate days to target weekday
    let daysToAdd = (targetWeekday - candidate.weekday + 7) % 7;
    if (daysToAdd === 0 && candidate <= currentInZone) {
      daysToAdd = 7;
    }

    candidate = candidate.plus({ days: daysToAdd });
    return candidate.toJSDate();
  }

  throw new Error(`Unsupported schedule type: ${opts.schedule_type}`);
}
