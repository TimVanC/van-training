import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import type { DashboardResponse } from '../types/dashboard';

/**
 * Fetches /api/getDashboard with a short-lived module cache so the Home and
 * Calendar pages share one request when the user flips between tabs.
 */
let cache: { data: DashboardResponse; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;
let inflight: Promise<DashboardResponse | null> | null = null;

async function fetchDashboard(): Promise<DashboardResponse | null> {
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const response = await fetch('/api/getDashboard', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return null;
    return (await response.json()) as DashboardResponse;
  } catch {
    return null;
  }
}

export function invalidateDashboardCache(): void {
  cache = null;
}

export function useDashboardData(): {
  data: DashboardResponse | null;
  loading: boolean;
  error: boolean;
} {
  // Cached data renders immediately; the effect below decides whether it is
  // fresh enough to keep (checking the clock is impure, so it stays out of render).
  const [data, setData] = useState<DashboardResponse | null>(cache?.data ?? null);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return;
    let cancelled = false;

    const request = inflight ?? (inflight = fetchDashboard());
    void request.then((result) => {
      inflight = null;
      if (result) cache = { data: result, fetchedAt: Date.now() };
      if (cancelled) return;
      if (result) {
        setData(result);
        setError(false);
      } else {
        setError(true);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
