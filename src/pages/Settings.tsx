import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import NotificationSettings from '../components/NotificationSettings';
import { supabase } from '../utils/supabaseClient';
import { isIos, isStandalone } from '../utils/push';

const ADMIN_EMAIL = 'timvancau@gmail.com';

function Settings(): React.JSX.Element {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const standalone = isStandalone();

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

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

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

      <section className="settings-card">
        <h2 className="settings-card-title">Shortcuts</h2>
        <button type="button" className="settings-btn" onClick={() => navigate('/activities')}>
          Log cardio
        </button>
        {email === ADMIN_EMAIL && (
          <button type="button" className="settings-btn" onClick={() => navigate('/admin')}>
            Admin portal
          </button>
        )}
      </section>

      <section className="settings-card">
        <h2 className="settings-card-title">Account</h2>
        {email && <p className="settings-note">{email}</p>}
        <button type="button" className="settings-btn settings-btn--danger" onClick={() => void handleLogout()}>
          Log out
        </button>
      </section>

      <BottomNav />
    </div>
  );
}

export default Settings;
