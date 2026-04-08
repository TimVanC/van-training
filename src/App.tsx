import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Routes, Route, Navigate } from 'react-router-dom';
import ActivitySelection from './pages/ActivitySelection';
import LiftContainer from './pages/LiftContainer';
import Run from './pages/Run';
import Bike from './pages/Bike';
import Swim from './pages/Swim';
import Analytics from './pages/Analytics';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { supabase } from './utils/supabaseClient';
import { getCurrentUser } from './utils/auth';
import { ensureUserSetup } from './utils/ensureUserSetup';
import { seedSplitFromCsv } from './utils/seedSplitFromCsv';

function App(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  useEffect(() => {
    let mounted = true;
    const setupStartedForUser = new Set<string>();

    function runPostAuthSetup(userId: string): void {
      if (setupStartedForUser.has(userId)) return;
      setupStartedForUser.add(userId);

      void (async () => {
        try {
          await ensureUserSetup(supabase, userId);
          await seedSplitFromCsv(supabase, userId);
        } catch (error) {
          console.error('post-auth setup failed', error);
        }
      })();
    }

    getCurrentUser()
      .then((currentUser) => {
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

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
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
  }, []);

  if (loadingAuth) {
    return (
      <div className="page">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <Signup />} />
      <Route path="/" element={user ? <ActivitySelection /> : <Navigate to="/login" replace />} />
      <Route path="/lift/*" element={user ? <LiftContainer /> : <Navigate to="/login" replace />} />
      <Route path="/run" element={user ? <Run /> : <Navigate to="/login" replace />} />
      <Route path="/bike" element={user ? <Bike /> : <Navigate to="/login" replace />} />
      <Route path="/swim" element={user ? <Swim /> : <Navigate to="/login" replace />} />
      <Route path="/analytics" element={user ? <Analytics /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  );
}

export default App;
