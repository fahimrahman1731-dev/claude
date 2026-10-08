import { useMemo, useState, type ReactNode } from 'react';
import type { Difficulty, MasteryStatus, Priority } from '../engine/types';
import type { DailyRow } from '../engine/stats';
import { useApp } from './app-context';

export function PriorityBadge({ p }: { p: Priority }) {
  return <span className={`badge ${p}`}>{p === 'high' ? 'High' : p === 'medium' ? 'Medium' : 'Lower'} priority</span>;
}

export function DifficultyBadge({ d }: { d: Difficulty }) {
  return <span className={`badge ${d}`}>{d === 'easy' ? 'Easy' : d === 'intermediate' ? 'Intermediate' : 'Advanced'}</span>;
}

export function StatusBadge({ s }: { s: MasteryStatus }) {
  return <span className={`badge ${s}`}>{s === 'mastered' ? '✓ Mastered' : s === 'learning' ? 'Learning' : 'Not started'}</span>;
}

export function ProgressBar({ value, max = 1, label, good }: { value: number; max?: number; label: string; good?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`bar${good ? ' good' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="chip" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="muted"> · {o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function usePager<T>(items: T[], size = 50) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const cur = Math.min(page, pages - 1);
  const slice = useMemo(() => items.slice(cur * size, cur * size + size), [items, cur, size]);
  const pager = (
    <div className="pager">
      <span className="muted small">
        {items.length ? `${cur * size + 1}–${Math.min(items.length, cur * size + size)} of ${items.length}` : '0 items'}
      </span>
      <button className="btn small" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
        Previous
      </button>
      <button className="btn small" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
        Next
      </button>
    </div>
  );
  return { slice, pager, reset: () => setPage(0) };
}

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} className={`alert toast ${t.kind === 'error' ? 'error' : t.kind === 'success' ? 'success' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span style={{ flex: 1 }}>{t.text}</span>
          <button className="btn small ghost" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/** Highlights the target word inside a sentence. */
export function MarkedSentence({ sentence, start, end }: { sentence: string; start: number; end: number }) {
  return (
    <>
      {sentence.slice(0, start)}
      <mark className="target">{sentence.slice(start, end)}</mark>
      {sentence.slice(end)}
    </>
  );
}

/**
 * Daily practice history as stacked bars: correct answers and missed answers
 * (incorrect + timed out + unanswered). Hover or focus a day for exact counts;
 * a table view is available for screen readers and print.
 */
export function DailyChart({ rows, goal }: { rows: DailyRow[]; goal?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const pad = { l: 30, r: 8, t: 10, b: 22 };
  const missed = (r: DailyRow) => r.incorrect + r.timeout + r.unanswered;
  const max = Math.max(goal ?? 0, ...rows.map((r) => r.correct + missed(r)), 4);
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const bw = plotW / rows.length;
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const gap = 2;
  return (
    <div className="chart-wrap">
      <div className="legend" aria-hidden>
        <span>
          <i style={{ background: 'var(--series-1)' }} />
          Correct
        </span>
        <span>
          <i style={{ background: 'var(--series-2)' }} />
          Missed (wrong, timed out, empty)
        </span>
        {goal ? <span>— — Daily goal ({goal})</span> : null}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Questions answered per day, correct and missed">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(i * step)} y2={y(i * step)} stroke={i === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
            <text x={pad.l - 6} y={y(i * step) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">
              {i * step}
            </text>
          </g>
        ))}
        {goal ? <line x1={pad.l} x2={W - pad.r} y1={y(goal)} y2={y(goal)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} /> : null}
        {rows.map((r, i) => {
          const x = pad.l + i * bw + bw * 0.18;
          const w = Math.max(2, bw * 0.64);
          const c = r.correct;
          const m = missed(r);
          const yC = y(c);
          const yM = y(c + m);
          const rad = Math.min(4, w / 2);
          const seg = (y0: number, y1: number, fill: string, roundTop: boolean) => {
            const h = y1 - y0;
            if (h <= 0) return null;
            return roundTop ? (
              <path d={`M${x},${y1} V${y0 + rad} Q${x},${y0} ${x + rad},${y0} H${x + w - rad} Q${x + w},${y0} ${x + w},${y0 + rad} V${y1} Z`} fill={fill} />
            ) : (
              <rect x={x} y={y0} width={w} height={h} fill={fill} />
            );
          };
          return (
            <g key={r.date}>
              {seg(yC, y(0), 'var(--series-1)', m === 0)}
              {m > 0 && seg(yM, yC - (c > 0 ? gap : 0), 'var(--series-2)', true)}
              {(i % Math.ceil(rows.length / 7) === 0 || i === rows.length - 1) && (
                <text x={x + w / 2} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">
                  {r.date.slice(5)}
                </text>
              )}
              <rect
                x={pad.l + i * bw}
                y={pad.t}
                width={bw}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${r.date}: ${c} correct, ${m} missed`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div className="chart-tip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: 24 }}>
          <strong>{rows[hover].date}</strong>
          <div>
            <i style={{ background: 'var(--series-1)' }} />
            {rows[hover].correct} correct
          </div>
          <div>
            <i style={{ background: 'var(--series-2)' }} />
            {missed(rows[hover])} missed
          </div>
          {rows[hover].skipped > 0 && <div className="muted">{rows[hover].skipped} skipped</div>}
        </div>
      )}
      <details className="small" style={{ marginTop: 8 }}>
        <summary className="muted">Show as table</summary>
        <div className="table-wrap" style={{ marginTop: 8, maxHeight: 260 }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Correct</th>
                <th className="num">Incorrect</th>
                <th className="num">Timed out</th>
                <th className="num">Empty</th>
                <th className="num">Skipped</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.graded || r.skipped)
                .map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td className="num">{r.correct}</td>
                    <td className="num">{r.incorrect}</td>
                    <td className="num">{r.timeout}</td>
                    <td className="num">{r.unanswered}</td>
                    <td className="num">{r.skipped}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Labeled horizontal bars for a single measure (e.g. accuracy by difficulty). */
export function HBars({ rows, format }: { rows: { label: string; value: number | undefined; max: number; note?: string }[]; format: (v: number) => string }) {
  return (
    <div className="hbar">
      {rows.map((r) => (
        <Row key={r.label} {...r} format={format} />
      ))}
    </div>
  );
}

function Row({ label, value, max, note, format }: { label: string; value: number | undefined; max: number; note?: string; format: (v: number) => string }) {
  return (
    <>
      <span>
        {label}
        {note && <span className="muted tiny"> {note}</span>}
      </span>
      <ProgressBar value={value ?? 0} max={max} label={label} />
      <span className="num">{value === undefined ? '—' : format(value)}</span>
    </>
  );
}
