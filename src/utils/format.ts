export type TimeFormat = 'mm:ss' | 'hh:mm:ss';

export function formatSecondsToMinSec(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function parseTimeInput(input: string, format: TimeFormat): number | null {
  const trimmed = input.trim();

  if (format === 'mm:ss') {
    const match = trimmed.match(/^(\d{1,3}):(\d{2})$/);
    if (!match) return null;
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    if (secs >= 60) return null;
    const total = mins * 60 + secs;
    return total > 0 ? total : null;
  }

  const match = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const secs = parseInt(match[3], 10);
  if (mins >= 60 || secs >= 60) return null;
  const total = hours * 3600 + mins * 60 + secs;
  return total > 0 ? total : null;
}

export function formatTotalSeconds(totalSeconds: number, format: TimeFormat): string {
  if (format === 'hh:mm:ss') {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
