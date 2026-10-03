import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountSettings from '../components/AccountSettings';
import BottomNav from '../components/BottomNav';
import { useCoachEnabled } from '../hooks/useCoachEnabled';
import NotificationSettings from '../components/NotificationSettings';
import { supabase } from '../utils/supabaseClient';
import { isIos, isStandalone } from '../utils/push';

const ADMIN_EMAIL = 'timvancau@gmail.com';

function Settings(): React.JSX.Element {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const standalone = isStandalone();
  const coachEnabled = useCoachEnabled();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setUserId(data.session?.user?.id ?? null);
      setEmail(data.session?.user?.email ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page page--with-nav settings-page">
      <h1>Settings</h1>

      {userId && <NotificationSettings userId={userId} />}

      {!standalone && (
        <section className="settings-card">
          <h2 className="settings-card-title">Install as an app</h2>
          <p className="settings-note">
            {isIos()
              ? 'In Safari, tap Share, then "Add to Home Screen". Van Training opens full screen from your Home Screen, and that\'s also what makes reminders possible on iPhone.'
              : 'Open your browser menu and choose "Add to Home Screen" or "Install app" to run Van Training full screen.'}
          </p>
        </section>
      )}

      {(coachEnabled || email === ADMIN_EMAIL) && (
        <section className="settings-card">
          <h2 className="settings-card-title">Splits</h2>
          {coachEnabled && (
            <>
              <p className="settings-note">
                Upload a program or describe what you want, and Coach Van sets it up as a new split. Your current splits stay as
                they are.
              </p>
              <button type="button" className="settings-btn" onClick={() => navigate('/onboarding')}>
                Add a split with Coach Van
              </button>
            </>
          )}
          {email === ADMIN_EMAIL && (
            <button type="button" className="settings-btn" onClick={() => navigate('/admin')}>
              Admin portal
            </button>
          )}
        </section>
      )}

      <AccountSettings email={email} />

      <BottomNav />
    </div>
  );
}

export default Settings;
