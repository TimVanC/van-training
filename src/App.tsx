import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/CalendarPage';
import MuscleLab from './pages/MuscleLab';
import PeakStrength from './pages/PeakStrength';
import LiftContainer from './pages/LiftContainer';
import Analytics from './pages/Analytics';
import AdminPortal from './pages/AdminPortal';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { supabase } from './utils/supabaseClient';
import { getSession } from './utils/auth';
import { ensureUserSetup } from './utils/ensureUserSetup';

function App(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    const setupStartedForUser = new Set<string>();

    function runPostAuthSetup(userId: string): void {
      if (setupStartedForUser.has(userId)) return;
      setupStartedForUser.add(userId);

      void (async () => {
        try {
          await ensureUserSetup(supabase, userId);
        } catch (error) {
          console.error('post-auth setup failed', error);
        }
      })();
    }

    // The stored session is read locally, so returning users skip a network
    // round trip before the first screen; onAuthStateChange below still signs
    // them out if the token can't be refreshed.
    getSession()
      .then((session) => {
        const currentUser = session?.user ?? null;
        if (!mounted) return;
        if (currentUser?.id) {
          runPostAuthSetup(currentUser.id);
        }
        setUser(currentUser);
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingAuth(false);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Recovery link landed — force the reset form regardless of session state,
        // and skip normal post-auth setup until the password is actually changed.
        if (mounted) {
          setUser(session?.user ?? null);
          setLoadingAuth(false);
          navigate('/reset-password', { replace: true });
        }
        return;
      }

      const nextUser = session?.user ?? null;
      if (nextUser?.id) {
        runPostAuthSetup(nextUser.id);
      }
      if (!mounted) return;
      setUser(nextUser);
      setLoadingAuth(false);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [navigate]);

  if (loadingAuth) {
    return (
      // Same markup index.html ships inside #root, so the splash doesn't flicker
      // when React takes over.
      <div className="app-splash" role="status" aria-label="Loading Van Training">
        <img src="/icons/icon-192.png" alt="" width="76" height="76" />
        <span className="app-splash-bar" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <Signup />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
      <Route path="/calendar" element={user ? <CalendarPage /> : <Navigate to="/login" replace />} />
      <Route path="/muscles" element={user ? <MuscleLab /> : <Navigate to="/login" replace />} />
      <Route path="/peak" element={user ? <PeakStrength /> : <Navigate to="/login" replace />} />
      <Route path="/lift/*" element={user ? <LiftContainer /> : <Navigate to="/login" replace />} />
      <Route path="/analytics" element={user ? <Analytics /> : <Navigate to="/login" replace />} />
      <Route path="/admin" element={user ? <AdminPortal /> : <Navigate to="/login" replace />} />
      <Route path="/settings" element={user ? <Settings /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  );
}

export default App;
