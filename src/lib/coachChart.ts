/**
 * A chart Coach Van asked the app to draw alongside an answer. The model
 * supplies the spec; this module bounds and normalizes it before it reaches
 * the client. Pure module shared by the API function and the chart component.
 */

export interface CoachChartSeries {
  name: string;
  values: Array<number | null>;
}

export interface CoachChart {
  type: 'line' | 'bar';
  title: string;
  yLabel: string;
  labels: string[];
  series: CoachChartSeries[];
}

export const MAX_CHART_POINTS = 60;
export const MAX_CHART_SERIES = 4;

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

/** Returns a safe chart, or a message explaining what was wrong with the spec. */
export function sanitizeChart(input: unknown): { chart: CoachChart } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Chart spec must be an object.' };
  const raw = input as Record<string, unknown>;

  const type = raw.type === 'bar' ? 'bar' : raw.type === 'line' ? 'line' : null;
  if (!type) return { error: 'type must be "line" or "bar".' };

  if (!Array.isArray(raw.labels) || raw.labels.length === 0) return { error: 'labels must be a non-empty array.' };
  if (raw.labels.length > MAX_CHART_POINTS) return { error: `At most ${MAX_CHART_POINTS} points; aggregate first.` };
  const labels = raw.labels.map((l) => text(typeof l === 'number' ? String(l) : l, 24) || '—');

  if (!Array.isArray(raw.series) || raw.series.length === 0) return { error: 'series must be a non-empty array.' };
  if (raw.series.length > MAX_CHART_SERIES) return { error: `At most ${MAX_CHART_SERIES} series.` };

  const series: CoachChartSeries[] = [];
  for (const s of raw.series) {
    if (!s || typeof s !== 'object') return { error: 'Each series must be an object.' };
    const { name, values } = s as { name?: unknown; values?: unknown };
    if (!Array.isArray(values) || values.length !== labels.length) {
      return { error: 'Each series needs exactly one value per label (use null for gaps).' };
    }
    const cleaned = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
    if (cleaned.every((v) => v === null)) return { error: 'A series has no numeric values.' };
    series.push({ name: text(name, 40) || `Series ${series.length + 1}`, values: cleaned });
  }

  return {
    chart: { type, title: text(raw.title, 80) || 'Chart', yLabel: text(raw.yLabel, 24), labels, series },
  };
}
