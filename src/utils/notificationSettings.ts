import { supabase } from './supabaseClient';
import type { NotificationPreferences, NotificationSettingsRow } from '../types/notifications';

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export function defaultPreferences(): NotificationPreferences {
  return {
    enabled: false,
    morningEnabled: true,
    morningTime: '08:00',
    eveningEnabled: true,
    eveningTime: '18:00',
    days: [0, 1, 2, 3, 4, 5, 6],
    timezone: browserTimezone(),
  };
}

/** Postgres `time` comes back as "08:00:00"; inputs want "08:00". */
function toHHMM(value: string): string {
  return value.slice(0, 5);
}

function rowToPreferences(row: NotificationSettingsRow): NotificationPreferences {
  return {
    enabled: row.enabled,
    morningEnabled: row.morning_enabled,
    morningTime: toHHMM(row.morning_time),
    eveningEnabled: row.evening_enabled,
    eveningTime: toHHMM(row.evening_time),
    days: row.days ?? [0, 1, 2, 3, 4, 5, 6],
    timezone: row.timezone ?? browserTimezone(),
  };
}

export async function loadPreferences(userId: string): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('user_id, enabled, morning_enabled, morning_time, evening_enabled, evening_time, days, timezone')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return defaultPreferences();
  return rowToPreferences(data as NotificationSettingsRow);
}

/** Upserts the full preference row; the timezone is always the browser's. */
export async function savePreferences(userId: string, prefs: NotificationPreferences): Promise<boolean> {
  const { error } = await supabase.from('notification_settings').upsert(
    {
      user_id: userId,
      enabled: prefs.enabled,
      morning_enabled: prefs.morningEnabled,
      morning_time: prefs.morningTime,
      evening_enabled: prefs.eveningEnabled,
      evening_time: prefs.eveningTime,
      days: prefs.days,
      timezone: browserTimezone(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  return !error;
}
