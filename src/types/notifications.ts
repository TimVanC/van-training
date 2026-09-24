/** Per-user reminder preferences as edited on the Settings page. */
export interface NotificationPreferences {
  enabled: boolean;
  morningEnabled: boolean;
  /** "HH:MM" (24h). */
  morningTime: string;
  eveningEnabled: boolean;
  /** "HH:MM" (24h). */
  eveningTime: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  timezone: string;
}

/** Row shape of public.notification_settings. */
export interface NotificationSettingsRow {
  user_id: string;
  enabled: boolean;
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  days: number[] | null;
  timezone: string | null;
}
