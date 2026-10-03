import { supabase } from './supabaseClient';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** POST to one of the coach endpoints as the signed-in user; errors come back as a message to show. */
export async function postCoachJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) return { ok: false, error: json.error ?? 'Something went wrong. Try again.' };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: 'No connection. Check your signal and try again.' };
  }
}
