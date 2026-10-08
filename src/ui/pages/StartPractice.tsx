import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { MODE_INFO, MODE_TIMERS, questionSeconds, type TimerMode } from '../../engine/config';
import { inModePool } from '../../engine/questions';
import { mistakes } from '../../engine/progress';
import type { Difficulty, Mode } from '../../engine/types';
import { useApp, useProgressMap, useSettings } from '../app-context';
import { Segmented } from '../components';
import { Link, navigate } from '../router';

const MODES: Mode[] = ['read-complete', 'fill-blanks', 'spelling', 'small-words', 'endings'];

export function StartPracticePage() {
  const { store, service, db, notify } = useApp();
  const settings = useSettings();
  const progress = useProgressMap();
  const active = useLiveQuery(() => db.sessions.where('status').equals('active').first(), [db]);
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem('det.lastMode') as Mode) || 'fill-blanks';
    } catch {
      return 'fill-blanks';
    }
  });
  const [starting, setStarting] = useState(false);

  const stats = useMemo(() => {
    const now = Date.now();
    const out = {} as Record<Mode, { words: number; due: number; fresh: number }>;
    for (const m of MODES) {
      if (m === 'read-complete') {
        out[m] = { words: store.paragraphs.length, due: 0, fresh: store.paragraphs.length };
        continue;
      }
      const pool = store.words.filter((w) => inModePool(w, m));
      let due = 0;
      let fresh = 0;
      for (const w of pool) {
        const p = progress?.get(w.id);
        if (!p || p.status === 'new') fresh++;
        else if (p.status === 'learning' && (p.nextReviewAt ?? 0) <= now) due++;
      }
      out[m] = { words: pool.length, due, fresh };
    }
    return out;
  }, [store, progress]);
  const mistakeWords = useMemo(() => (progress ? [...progress.values()].filter((p) => mistakes(p) > 0 && p.status !== 'mastered').length : 0), [progress]);

  const start = async (m: Mode, focus: 'normal' | 'mistakes' = 'normal') => {
    if (starting) return;
    setStarting(true);
    try {
      try {
        localStorage.setItem('det.lastMode', m);
      } catch {
        /* storage unavailable: the choice just isn't remembered */
      }
      await service.startSession({ mode: m, focus });
      navigate('/practice/session');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setStarting(false);
    }
  };
  const set = (patch: Parameters<typeof service.saveSettings>[0]) => void service.saveSettings(patch).catch((e) => notify(String(e), 'error'));
  const diffValue = settings.adaptive ? 'adaptive' : settings.difficulty;
  const secs = questionSeconds(settings, mode, 'easy');

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Start Practice</h1>
          <p className="muted">Pick one task type. Each mode follows its own DET rules.</p>
        </div>
      </div>
      {active && (
        <div className="alert warn row">
          <span style={{ flex: 1 }}>
            You have an unfinished <strong>{MODE_INFO[active.mode].title}</strong> session ({active.index}/{active.target}).
          </span>
          <Link to="/practice/session" className="btn primary small">
            Resume
          </Link>
          <button className="btn small" onClick={() => void service.endSession(active.id, 'Discarded by the student.')}>
            Discard
          </button>
        </div>
      )}
      <div className="grid grid-3" role="group" aria-label="Practice mode">
        {MODES.map((m) => (
          <button key={m} type="button" className="mode-card" aria-pressed={mode === m} onClick={() => setMode(m)}>
            <span className="row">
              <span className="mode-letter">{MODE_INFO[m].short}</span>
              <strong>{MODE_INFO[m].title}</strong>
            </span>
            <span className="small muted">{MODE_INFO[m].description}</span>
            <span className="tiny">
              {m === 'read-complete' ? `${stats[m].words} paragraphs` : `${stats[m].words} words · ${stats[m].due} due · ${stats[m].fresh} new`}
            </span>
          </button>
        ))}
        <div className="mode-card" style={{ cursor: 'default' }}>
          <span className="row">
            <span className="mode-letter">✕</span>
            <strong>Practice My Mistakes</strong>
          </span>
          <span className="small muted">A session made only of words you have missed, most-missed first, in new sentences where possible.</span>
          <span>
            <button className="btn small" disabled={!mistakeWords || starting} onClick={() => void start('spelling', 'mistakes')}>
              {mistakeWords ? `Practice ${mistakeWords} missed words` : 'No mistakes yet'}
            </button>
          </span>
        </div>
      </div>

      <div className="card stack">
        <h2>Session options</h2>
        <div className="grid grid-3">
          <div className="stack" style={{ gap: 6 }}>
            <span className="small" style={{ fontWeight: 600 }}>
              Timer
            </span>
            <Segmented<TimerMode>
              label="Timer mode"
              value={settings.timerMode}
              onChange={(v) => set({ timerMode: v })}
              options={[
                { value: 'timed', label: 'Timed' },
                { value: 'untimed', label: 'Untimed' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            <span className="tiny muted">
              {secs === null ? 'No countdown.' : `${secs} s per ${mode === 'read-complete' ? 'paragraph' : 'question'}${settings.timerMode === 'timed' && mode !== 'read-complete' && settings.longerTimerForAdvanced ? ' (30 s for advanced words)' : ''}.`}{' '}
              Practice settings, not official timings. {settings.timerMode === 'custom' && <Link to="/settings">Edit custom times</Link>}
            </span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="small" style={{ fontWeight: 600 }}>
              Difficulty
            </span>
            <Segmented<'adaptive' | Difficulty>
              label="Difficulty"
              value={diffValue}
              onChange={(v) => (v === 'adaptive' ? set({ adaptive: true }) : set({ adaptive: false, difficulty: v }))}
              options={[
                { value: 'adaptive', label: 'Adaptive' },
                { value: 'easy', label: 'Easy' },
                { value: 'intermediate', label: 'Intermediate' },
                { value: 'advanced', label: 'Advanced' },
              ]}
            />
            <span className="tiny muted">Adaptive moves up after steady success and down when you struggle. Reviews of mistakes always continue.</span>
          </div>
          <label className="field">
            {mode === 'read-complete' ? 'Paragraphs per session' : 'Questions per session'}
            <input
              type="number"
              min={1}
              max={200}
              value={mode === 'read-complete' ? settings.paragraphsPerSession : settings.questionsPerSession}
              onChange={(e) => {
                const n = Math.max(1, Math.min(200, Number(e.target.value) || 1));
                set(mode === 'read-complete' ? { paragraphsPerSession: n } : { questionsPerSession: n });
              }}
            />
            <span className="hint">
              {mode === 'read-complete' ? `Default timer ${MODE_TIMERS['read-complete'] / 60} min per paragraph.` : `Up to ${settings.newWordsPerSession} new words and ${settings.reviewsPerSession} reviews (change in Settings).`}
            </span>
          </label>
        </div>
        <div className="row">
          <button className="btn primary big" disabled={starting} onClick={() => void start(mode)}>
            ▶ Start {MODE_INFO[mode].title}
          </button>
        </div>
      </div>
      <p className="tiny muted">
        These are practice questions built from the vocabulary and task patterns in your study materials. They are not official DET questions, and no word is
        guaranteed to appear on the live test.
      </p>
    </div>
  );
}
