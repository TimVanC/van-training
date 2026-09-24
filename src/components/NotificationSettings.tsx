import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import type { NotificationPreferences } from '../types/notifications';
import { defaultPreferences, loadPreferences, savePreferences } from '../utils/notificationSettings';
import {
  disablePush,
  enablePush,
  getCurrentSubscription,
  isIos,
  isPushSupported,
  isStandalone,
  notificationPermission,
} from '../utils/push';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Status {
  kind: 'ok' | 'error' | 'info';
  text: string;
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? 'switch--on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

function unsupportedMessage(): string {
  if (isIos() && !isStandalone()) {
    return 'On iPhone, notifications only work once the app is on your Home Screen. In Safari tap Share, then "Add to Home Screen", and open it from there.';
  }
  return "This browser doesn't support push notifications.";
}

function NotificationSettings({ userId }: { userId: string }): React.JSX.Element {
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultPreferences);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const supported = isPushSupported();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loadedPrefs = await loadPreferences(userId);
      if (cancelled) return;
      setPrefs(loadedPrefs);
      setLoaded(true);
      // Re-attach silently if reminders are on but this device lost its
      // subscription (new phone, cleared data) and permission is still granted.
      if (loadedPrefs.enabled && isPushSupported() && notificationPermission() === 'granted') {
        const existing = await getCurrentSubscription();
        if (!existing && !cancelled) await enablePush(userId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function persist(next: NotificationPreferences): Promise<void> {
    setPrefs(next);
    const ok = await savePreferences(userId, next);
    if (!ok) setStatus({ kind: 'error', text: "Couldn't save settings. Try again." });
  }

  async function handleMasterToggle(on: boolean): Promise<void> {
    setStatus(null);
    if (!on) {
      setBusy(true);
      await disablePush();
      await persist({ ...prefs, enabled: false });
      setBusy(false);
      return;
    }
    if (!supported) {
      setStatus({ kind: 'info', text: unsupportedMessage() });
      return;
    }
    setBusy(true);
    const result = await enablePush(userId);
    setBusy(false);
    if (result === 'subscribed') {
      await persist({ ...prefs, enabled: true });
      setStatus({ kind: 'ok', text: 'Reminders are on for this device.' });
    } else if (result === 'denied') {
      setStatus({
        kind: 'error',
        text: 'Notifications are blocked for Van Training. Allow them in your phone Settings → Notifications, then try again.',
      });
    } else {
      setStatus({ kind: 'error', text: "Couldn't turn on notifications. Try again." });
    }
  }

  async function handleTest(): Promise<void> {
    setStatus(null);
    setBusy(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const response = await fetch('/api/sendTestNotification', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = (await response.json().catch(() => ({}))) as { sent?: number; error?: string };
      if (!response.ok) {
        setStatus({ kind: 'error', text: body.error ?? 'Test failed. Try again.' });
      } else if ((body.sent ?? 0) === 0) {
        setStatus({ kind: 'error', text: 'No device accepted the test. Toggle reminders off and on, then retry.' });
      } else {
        setStatus({ kind: 'ok', text: 'Sent. Check your notifications.' });
      }
    } catch {
      setStatus({ kind: 'error', text: 'Test failed. Check your connection.' });
    } finally {
      setBusy(false);
    }
  }

  function toggleDay(day: number): void {
    const days = prefs.days.includes(day)
      ? prefs.days.filter((d) => d !== day)
      : [...prefs.days, day].sort((a, b) => a - b);
    void persist({ ...prefs, days });
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title">Workout reminders</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Push notifications</div>
          <div className="settings-row-sub">A morning heads-up and an evening nudge if nothing's logged.</div>
        </div>
        <Toggle on={prefs.enabled} onChange={(on) => void handleMasterToggle(on)} label="Push notifications" />
      </div>

      {loaded && !supported && !prefs.enabled && <p className="settings-note settings-note--warn">{unsupportedMessage()}</p>}

      {prefs.enabled && (
        <>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Morning reminder</div>
              <div className="settings-row-sub">Which split day is up today.</div>
            </div>
            <div className="settings-row-controls">
              <input
                type="time"
                className="time-input"
                value={prefs.morningTime}
                disabled={!prefs.morningEnabled}
                onChange={(e) => void persist({ ...prefs, morningTime: e.target.value || prefs.morningTime })}
                aria-label="Morning reminder time"
              />
              <Toggle
                on={prefs.morningEnabled}
                onChange={(on) => void persist({ ...prefs, morningEnabled: on })}
                label="Morning reminder"
              />
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Evening reminder</div>
              <div className="settings-row-sub">Only if you haven't logged a workout yet.</div>
            </div>
            <div className="settings-row-controls">
              <input
                type="time"
                className="time-input"
                value={prefs.eveningTime}
                disabled={!prefs.eveningEnabled}
                onChange={(e) => void persist({ ...prefs, eveningTime: e.target.value || prefs.eveningTime })}
                aria-label="Evening reminder time"
              />
              <Toggle
                on={prefs.eveningEnabled}
                onChange={(on) => void persist({ ...prefs, eveningEnabled: on })}
                label="Evening reminder"
              />
            </div>
          </div>
          <div className="settings-row settings-row--stack">
            <div className="settings-row-label">Remind me on</div>
            <div className="day-chips" role="group" aria-label="Reminder days">
              {DAY_LABELS.map((label, day) => (
                <button
                  key={DAY_NAMES[day]}
                  type="button"
                  className={`day-chip ${prefs.days.includes(day) ? 'day-chip--on' : ''}`}
                  aria-pressed={prefs.days.includes(day)}
                  aria-label={DAY_NAMES[day]}
                  onClick={() => toggleDay(day)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="settings-btn" onClick={() => void handleTest()} disabled={busy}>
            {busy ? 'Working…' : 'Send test notification'}
          </button>
          <p className="settings-note">Times are in your phone's timezone ({prefs.timezone.replace(/_/g, ' ')}).</p>
        </>
      )}

      {status && <p className={`settings-status settings-status--${status.kind}`}>{status.text}</p>}
    </section>
  );
}

export default NotificationSettings;
