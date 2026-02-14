import type { LiftSession } from '../types/session';

const STORAGE_KEY = 'van_training_active_session';

export function loadSession(): LiftSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LiftSession;
  } catch {
    return null;
  }
}

export function saveSession(session: LiftSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
