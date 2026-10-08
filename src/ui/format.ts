export function pct(v: number | undefined, digits = 0): string {
  return v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
}

export function secs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return `${(ms / 1000).toFixed(1)} s`;
}

export function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function date(t: number | undefined): string {
  if (!t) return '—';
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dateTime(t: number | undefined): string {
  if (!t) return '—';
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "in 3 days", "now", "2 h ago" style labels for review times. */
export function relative(t: number | undefined, now: number): string {
  if (t === undefined) return '—';
  const d = t - now;
  const abs = Math.abs(d);
  const fmt = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  let s: string;
  if (abs < 60_000) return d <= 0 ? 'due now' : 'in under a minute';
  if (abs < 3_600_000) s = fmt(Math.round(abs / 60_000), 'minute');
  else if (abs < 86_400_000) s = fmt(Math.round(abs / 3_600_000), 'hour');
  else s = fmt(Math.round(abs / 86_400_000), 'day');
  return d <= 0 ? `due (${s} ago)` : `in ${s}`;
}

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const head = Object.keys(rows[0]);
  return [head.join(','), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(','))].join('\n');
}

export function download(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
