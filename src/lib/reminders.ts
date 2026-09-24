/**
 * Workout reminder logic (pure, shared by the client and api/sendReminders).
 *
 * Two reminders per day, both in the user's own timezone:
 *  - morning: "you train today, here's the split day that's up"
 *  - evening: "nothing logged yet today — log it before the day ends"
 *
 * Each reminder fires at most once per local calendar day, and only inside a
 * window after its configured time so a late cron tick (or a user enabling
 * reminders at 5pm) never produces a "morning" ping at dinner.
 */

import { computeNextDayName, type RotationDay } from './rotation.js';

export const DEFAULT_TIMEZONE = 'America/New_York';
/** How long after the configured time a reminder may still be sent. */
export const REMINDER_WINDOW_MINUTES = 120;

export type ReminderKind = 'morning' | 'evening';

export interface ReminderSettings {
  enabled: boolean;
  morningEnabled: boolean;
  /** "HH:MM" (24h). */
  morningTime: string;
  eveningEnabled: boolean;
  /** "HH:MM" (24h). */
  eveningTime: string;
  /** Weekdays reminders are active on, 0 = Sunday … 6 = Saturday. */
  days: number[];
  timezone: string;
  /** Local "YYYY-MM-DD" a reminder was last sent on, if ever. */
  lastMorningSentOn: string | null;
  lastEveningSentOn: string | null;
}

export interface LocalTime {
  /** Local calendar date, "YYYY-MM-DD". */
  dateKey: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
}

/** Wall-clock time in an IANA timezone; unknown zones fall back to the default. */
export function localTimeIn(now: Date, timeZone: string): LocalTime {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = makeFormatter(timeZone);
  } catch {
    formatter = makeFormatter(DEFAULT_TIMEZONE);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: Math.max(0, WEEKDAYS.indexOf(parts.weekday)),
  };
}

/** "08:00" or "08:00:00" → minutes since midnight. Invalid input → 0. */
export function timeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return 0;
  const hours = Math.min(23, Number(match[1]));
  const minutes = Math.min(59, Number(match[2]));
  return hours * 60 + minutes;
}

/** Whether a reminder of `kind` should be sent right now for these settings. */
export function reminderDue(kind: ReminderKind, settings: ReminderSettings, local: LocalTime): boolean {
  if (!settings.enabled) return false;
  if (!settings.days.includes(local.weekday)) return false;
  const enabled = kind === 'morning' ? settings.morningEnabled : settings.eveningEnabled;
  if (!enabled) return false;
  const lastSent = kind === 'morning' ? settings.lastMorningSentOn : settings.lastEveningSentOn;
  if (lastSent === local.dateKey) return false;
  const target = timeToMinutes(kind === 'morning' ? settings.morningTime : settings.eveningTime);
  return local.minutes >= target && local.minutes < target + REMINDER_WINDOW_MINUTES;
}

export interface UpNextSession {
  /** ISO timestamp. */
  date: string;
  dayName: string;
  splitName: string;
}

export interface UpNextSplit {
  name: string;
  workouts: Array<{ name: string; order_index: number }>;
}

export interface UpNext {
  dayName: string;
  splitName: string;
}

/**
 * Which day is up next, mirroring the dashboard hero: follow the most recently
 * trained split and pick the rotation day that has gone longest untrained.
 * `sessions` must be sorted by date ascending.
 */
export function computeUpNext(sessions: UpNextSession[], splits: UpNextSplit[]): UpNext | null {
  const realSplits = splits.filter((s) => s.name.trim().toLowerCase() !== 'import split');
  if (realSplits.length === 0) return null;

  let active = realSplits[0];
  for (let i = sessions.length - 1; i >= 0; i--) {
    const match = realSplits.find((s) => s.name === sessions[i].splitName);
    if (match) {
      active = match;
      break;
    }
  }

  const lastTrained = new Map<string, string>();
  for (const session of sessions) {
    if (session.splitName && session.splitName !== active.name) continue;
    const existing = lastTrained.get(session.dayName) ?? '';
    if (session.date > existing) lastTrained.set(session.dayName, session.date);
  }

  const seen = new Set<string>();
  const days: RotationDay[] = [];
  for (const w of [...active.workouts].sort((a, b) => a.order_index - b.order_index)) {
    if (seen.has(w.name)) continue;
    seen.add(w.name);
    days.push({ name: w.name, lastTrained: lastTrained.get(w.name) });
  }
  const dayName = computeNextDayName(days);
  return dayName ? { dayName, splitName: active.name } : null;
}

export interface ReminderMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export function morningMessage(upNext: UpNext | null): ReminderMessage {
  if (!upNext) {
    return {
      title: 'Workout day',
      body: "Heads up: you've got a workout today. Log it when you're done.",
      tag: 'morning-reminder',
      url: '/',
    };
  }
  return {
    title: `Today: ${upNext.dayName}`,
    body: `Heads up: you train today. ${upNext.dayName} is up next in ${upNext.splitName}.`,
    tag: 'morning-reminder',
    url: '/',
  };
}

export function eveningMessage(upNext: UpNext | null): ReminderMessage {
  const day = upNext ? upNext.dayName : 'Your workout';
  return {
    title: "It's getting late",
    body: `Nothing logged today and you're running out of time. ${day} is still waiting. If you already trained, log it now.`,
    tag: 'evening-reminder',
    url: '/lift',
  };
}

export function testMessage(upNext: UpNext | null): ReminderMessage {
  return {
    title: 'Notifications are on',
    body: upNext
      ? `Test successful. Up next: ${upNext.dayName} (${upNext.splitName}).`
      : 'Test successful. Reminders will show up here.',
    tag: 'test-notification',
    url: '/settings',
  };
}
