import { useEffect, useRef, useState } from 'react';
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
import Onboarding from './pages/Onboarding';
import CoachChat from './pages/CoachChat';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { supabase } from './utils/supabaseClient';
import { getSession } from './utils/auth';

const onboardedKey = (userId: string) => `van_training_onboarded:${userId}`;

/**
 * A user with no workout days yet has nothing to log against, so they go
 * through the onboarding coach first. Anyone who already has a split is
 * remembered locally and never asked again; if the check itself fails we
 * assume they're set up rather than risk trapping an existing user.
 */
async function checkNeedsOnboarding(userId: string): Promise<boolean> {
  try {
    if (localStorage.getItem(onboardedKey(userId)) === '1') return false;
  } catch {
    // Storage unavailable — fall through to the query.
  }
  // RLS scopes this to the caller's own workouts.
  const { data, error } = await supabase.from('workouts').select('id').limit(1);
  if (error) return false;
  if ((data ?? []).length === 0) return true;
  markOnboarded(userId);
  return false;
}

function markOnboarded(userId: string): void {
  try {
    localStorage.setItem(onboardedKey(userId), '1');
  } catch {
    // Not fatal: the check just runs again next launch.
  }
}

function App(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  // Set once the user finishes or skips onboarding, so later auth events
  // (token refreshes) don't send them back to it this session.
  const onboardingDismissed = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    const checks = new Map<string, Promise<boolean>>();

    /** Resolve the signed-in user's onboarding state (once per user), then show the app. */
    function settle(nextUser: User | null): void {
      if (!nextUser) {
        onboardingDismissed.current = false;
        setUser(null);
        setNeedsOnboarding(false);
        setLoadingAuth(false);
        return;
      }
      let check = checks.get(nextUser.id);
      if (!check) {
        check = checkNeedsOnboarding(nextUser.id);
        checks.set(nextUser.id, check);
      }
      void check.then((needed) => {
        if (!mounted) return;
        setNeedsOnboarding(needed && !onboardingDismissed.current);
        setUser(nextUser);
        setLoadingAuth(false);
      });
    }

    // The stored session is read locally, so returning users skip a network
    // round trip before the first screen; onAuthStateChange below still signs
    // them out if the token can't be refreshed.
    getSession().then((session) => {
      if (mounted) settle(session?.user ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Recovery link landed — force the reset form regardless of session state.
        if (mounted) {
          setUser(session?.user ?? null);
          setLoadingAuth(false);
          navigate('/reset-password', { replace: true });
        }
        return;
      }
      if (mounted) settle(session?.user ?? null);
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
      <Route
        path="/"
        element={
          !user ? <Navigate to="/login" replace /> : needsOnboarding ? <Navigate to="/onboarding" replace /> : <Dashboard />
        }
      />
      <Route
        path="/onboarding"
        element={
          user ? (
            <Onboarding
              onDone={(saved) => {
                if (saved) markOnboarded(user.id);
                onboardingDismissed.current = true;
                setNeedsOnboarding(false);
              }}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="/calendar" element={user ? <CalendarPage /> : <Navigate to="/login" replace />} />
      <Route path="/muscles" element={user ? <MuscleLab /> : <Navigate to="/login" replace />} />
      <Route path="/peak" element={user ? <PeakStrength /> : <Navigate to="/login" replace />} />
      <Route path="/lift/*" element={user ? <LiftContainer /> : <Navigate to="/login" replace />} />
      <Route path="/coach" element={user ? <CoachChat /> : <Navigate to="/login" replace />} />
      <Route path="/analytics" element={user ? <Analytics /> : <Navigate to="/login" replace />} />
      <Route path="/admin" element={user ? <AdminPortal /> : <Navigate to="/login" replace />} />
      <Route path="/settings" element={user ? <Settings /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  );
}

export default App;
