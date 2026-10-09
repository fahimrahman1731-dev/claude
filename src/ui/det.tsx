import { useEffect, useRef, useState } from 'react';
import { MODE_INFO } from '../engine/config';
import type { SessionRecord } from '../db/db';

// ---------------------------------------------------------------- DET-style frame

export interface FrameProps {
  session: SessionRecord;
  onEnd: () => void;
}

/** The white question card used by every task: timer and close button on top, the task in the middle, SUBMIT below. */
export function DetFrame({
  frame,
  timer,
  title,
  children,
  footer,
  wide,
  flush,
}: {
  frame: FrameProps;
  timer?: JSX.Element;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  /** No inner padding: the content (Interactive Reading's two panels) fills the card. */
  flush?: boolean;
}) {
  const { session, onEnd } = frame;
  const shown = Math.min(session.target, session.index + (session.current ? 1 : 0));
  return (
    <section className={`det-card${wide ? ' wide' : ''}`}>
      <header className="det-head">
        <div className="det-head-left">{timer}</div>
        <span className="det-count" title="Question in this session">
          {MODE_INFO[session.mode].title}
          {session.focus === 'mistakes' ? ' · My mistakes' : session.focus === 'mastered' ? ' · Review' : ''} · {shown} of {session.target}
        </span>
        <button type="button" className="det-close" aria-label="End session" title="End session" onClick={onEnd}>
          ✕
        </button>
      </header>
      <div className="det-progress" aria-hidden>
        <span style={{ width: `${(session.index / Math.max(1, session.target)) * 100}%` }} />
      </div>
      <div className={`det-body${flush ? ' flush' : ''}`}>
        {title && <h1 className="det-title">{title}</h1>}
        {children}
      </div>
      {footer && <footer className="det-foot">{footer}</footer>}
    </section>
  );
}

// ---------------------------------------------------------------- timer

export function useCountdown(startedAt: number, limitMs: number | null, onExpire: () => void) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => {
    if (limitMs === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [limitMs]);
  const remaining = limitMs === null ? null : Math.max(0, limitMs - (now - startedAt));
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !fired.current) {
      fired.current = true;
      cb.current();
    }
  }, [remaining]);
  return remaining;
}

/** "⏱ 0:10 for this question", like the DET; it turns red in the last seconds and never goes below 0:00. */
export function Timer({ remaining, limitMs, unit = 'for this question' }: { remaining: number | null; limitMs: number | null; unit?: string }) {
  if (remaining === null || limitMs === null)
    return (
      <span className="det-timer untimed" title="Untimed mode">
        <ClockIcon /> Untimed
      </span>
    );
  const s = Math.ceil(remaining / 1000);
  const low = remaining <= Math.min(5000, limitMs * 0.25);
  return (
    <span className={`det-timer${low ? ' low' : ''}`} role="timer" aria-live={low ? 'polite' : 'off'} aria-label={`${s} seconds left`}>
      <ClockIcon /> <strong>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</strong> <span className="det-timer-unit">{unit}</span>
    </span>
  );
}

function ClockIcon() {
  return (
    <svg className="det-clock" viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <circle cx="12" cy="13" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 13 L15.5 9.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10 2.8h4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

