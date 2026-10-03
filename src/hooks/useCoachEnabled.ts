import { useEffect, useState } from 'react';

let known: boolean | null = null;
let pending: Promise<boolean> | null = null;

function fetchCoachEnabled(): Promise<boolean> {
  pending ??= fetch('/api/coachStatus')
    .then((response) => (response.ok ? response.json() : { enabled: false }))
    .then((body: { enabled?: boolean }) => body.enabled === true)
    .catch(() => false)
    .then((enabled) => {
      known = enabled;
      return enabled;
    });
  return pending;
}

/**
 * True once the server confirms Coach Van is configured. Entry points to the
 * coach stay hidden until then, so nobody is sent to a chat that can't answer.
 */
export function useCoachEnabled(): boolean {
  const [enabled, setEnabled] = useState(known === true);

  useEffect(() => {
    if (known !== null) return;
    let cancelled = false;
    void fetchCoachEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
