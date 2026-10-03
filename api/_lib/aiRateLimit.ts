import type { SupabaseClient } from '@supabase/supabase-js';

export interface RateLimitCaps {
  perMinute: number;
  perDay: number;
  perMonth: number;
}

function buckets(scope: string, now: Date): string[] {
  const iso = now.toISOString();
  return [
    `${scope}:m:${iso.slice(0, 16)}`, // 2026-10-03T14:22
    `${scope}:d:${iso.slice(0, 10)}`, // 2026-10-03
    `${scope}:M:${iso.slice(0, 7)}`, // 2026-10
  ];
}

/**
 * Count one AI request against the user's minute/day/month caps. Returns a
 * message when a cap is hit, null when the request may proceed. Enforced here,
 * never client-side: this is what keeps a script from running up the API bill.
 */
export async function checkAiRateLimit(
  supabase: SupabaseClient,
  userId: string,
  scope: string,
  caps: RateLimitCaps,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('increment_ai_usage', {
    p_user_id: userId,
    p_buckets: buckets(scope, new Date()),
  });
  if (error) {
    // Fail open: a broken counter must not take onboarding down.
    console.error('rate-limit increment failed:', error.message);
    return null;
  }
  const [minute, day, month] = (data ?? []) as number[];
  if (minute > caps.perMinute) return 'A little too fast. Give it a few seconds and try again.';
  if (day > caps.perDay) return "You've hit today's Coach Van limit. It resets tomorrow.";
  if (month > caps.perMonth) return "You've hit this month's Coach Van limit. It resets next month.";
  return null;
}
