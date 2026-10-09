import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { DRILL_MODES, MODE_INFO, READING_MODES, questionSeconds, type TimerMode } from '../../engine/config';
import { inModePool } from '../../engine/questions';
import { mistakes } from '../../engine/progress';
import type { Difficulty, Mode } from '../../engine/types';
import { META_KEY, type Meta } from '../../db/db';
import { useApp, useProgressMap, useSettings } from '../app-context';
import { Segmented } from '../components';
import { Link, navigate } from '../router';

type Tab = 'reading' | 'drills';

/** Small pictures in the style of the DET practice page. */
function SkillIcon({ mode }: { mode: Mode }) {
  const blue = 'var(--det-blue)';
  const line = 'var(--lb-line)';
  switch (mode) {
    case 'fill-blanks':
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden>
          <rect x="4" y="16" width="12" height="16" rx="3" fill="var(--accent-soft)" stroke={blue} strokeWidth="2" />
          <rect x="18" y="14" width="12" height="20" rx="3" fill="var(--surface)" stroke={blue} strokeWidth="2.5" />
          <rect x="32" y="16" width="12" height="16" rx="3" fill="var(--surface)" stroke={line} strokeWidth="2" />
        </svg>
      );
    case 'read-complete':
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden>
          <rect x="6" y="6" width="36" height="36" rx="5" fill="var(--surface)" stroke={line} strokeWidth="2" />
          <rect x="11" y="13" width="9" height="5" rx="2" fill="var(--accent-soft)" stroke={blue} strokeWidth="1.5" />
          <path d="M23 15.5h14M11 24h12M11 32.5h6" stroke={line} strokeWidth="3" strokeLinecap="round" />
          <rect x="26" y="21.5" width="11" height="5" rx="2" fill="var(--accent-soft)" stroke={blue} strokeWidth="1.5" />
          <rect x="20" y="30" width="9" height="5" rx="2" fill="var(--accent-soft)" stroke={blue} strokeWidth="1.5" />
        </svg>
      );
    case 'interactive-reading':
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden>
          <rect x="6" y="6" width="34" height="34" rx="5" fill="var(--surface)" stroke={line} strokeWidth="2" />
          <path d="M12 15h20" stroke={blue} strokeWidth="3" strokeLinecap="round" opacity="0.5" />
          <circle cx="13" cy="24" r="2" fill={blue} />
          <path d="M18 24h12" stroke={line} strokeWidth="3" strokeLinecap="round" />
          <rect x="28" y="28" width="16" height="16" rx="3" fill={blue} />
          <path d="M33 32l7 4-3 1 2 3-2 1-2-3-2 2z" fill="#fff" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden>
          <rect x="6" y="12" width="36" height="24" rx="5" fill="var(--surface)" stroke={line} strokeWidth="2" />
          <text x="24" y="29" textAnchor="middle" fontSize="13" fontWeight="700" fill={blue}>
            {MODE_INFO[mode].short}
          </text>
        </svg>
      );
  }
}

export function StartPracticePage() {
  const { store, service, db, notify } = useApp();
  const settings = useSettings();
  const progress = useProgressMap();
  const active = useLiveQuery(() => db.sessions.where('status').equals('active').first(), [db]);
  const meta = useLiveQuery(async () => (await db.kv.get(META_KEY))?.value as Meta | undefined, [db]);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('det.practiceTab') as Tab) || 'reading';
    } catch {
      return 'reading';
    }
  });
  const [starting, setStarting] = useState<Mode | null>(null);

  /** done / total for each card's progress bar. */
  const stats = useMemo(() => {
    const out = {} as Record<Mode, { done: number; total: number; unit: string; due: number }>;
    const now = Date.now();
    for (const m of [...READING_MODES, ...DRILL_MODES] as Mode[]) {
      if (m === 'read-complete') {
        const served = meta?.paragraphServed ?? {};
        out[m] = { done: store.paragraphs.filter((p) => served[p.id]).length, total: store.paragraphs.length, unit: 'texts done', due: 0 };
        continue;
      }
      if (m === 'interactive-reading') {
        const served = meta?.interactiveServed ?? {};
        out[m] = { done: store.interactive.filter((x) => served[x.id]).length, total: store.interactive.length, unit: 'passages done', due: 0 };
        continue;
      }
      const pool = store.words.filter((w) => inModePool(w, m));
      let mastered = 0;
      let due = 0;
      for (const w of pool) {
        const p = progress?.get(w.id);
        if (p?.status === 'mastered') mastered++;
        else if (p?.status === 'learning' && (p.nextReviewAt ?? 0) <= now) due++;
      }
      out[m] = { done: mastered, total: pool.length, unit: 'words mastered', due };
    }
    return out;
  }, [store, progress, meta]);
  const mistakeWords = useMemo(() => (progress ? [...progress.values()].filter((p) => mistakes(p) > 0 && p.status !== 'mastered' && store.byId.has(p.wordId)).length : 0), [progress, store]);

  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem('det.practiceTab', t);
    } catch {
      /* storage unavailable: the tab just isn't remembered */
    }
  };
  const start = async (m: Mode, focus: 'normal' | 'mistakes' = 'normal') => {
    if (starting) return;
    setStarting(m);
    try {
      await service.startSession({ mode: m, focus });
      navigate('/practice/session');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setStarting(null);
    }
  };
  const set = (patch: Parameters<typeof service.saveSettings>[0]) => void service.saveSettings(patch).catch((e) => notify(String(e), 'error'));
  const diffValue = settings.adaptive ? 'adaptive' : settings.difficulty;
  const timerText = (m: Mode) => {
    const secs = questionSeconds(settings, m, 'easy');
    if (secs === null) return 'untimed';
    const t = secs >= 60 ? `${Math.round((secs / 60) * 10) / 10} min` : `${secs} s`;
    return m === 'read-complete' ? `${t} per text` : m === 'interactive-reading' ? `${t} per passage` : `${t} per question`;
  };
  const modes: readonly Mode[] = tab === 'reading' ? READING_MODES : DRILL_MODES;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Practice skills</h1>
          <p className="muted">Choose a skill to start. Each one follows the DET’s own rules for that question type.</p>
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

      <div className="skill-tabs" role="tablist" aria-label="Skill group">
        <button role="tab" aria-selected={tab === 'reading'} onClick={() => choose('reading')}>
          Reading
        </button>
        <button role="tab" aria-selected={tab === 'drills'} onClick={() => choose('drills')}>
          Vocabulary drills
        </button>
      </div>

      <div className="skill-grid" role="tabpanel" aria-label={tab === 'reading' ? 'Reading' : 'Vocabulary drills'}>
        {modes.map((m) => {
          const st = stats[m];
          return (
            <button key={m} type="button" className="skill-card" disabled={!!starting || st.total === 0} onClick={() => void start(m)} aria-label={`Start ${MODE_INFO[m].title}`}>
              <span className="skill-icon">
                <SkillIcon mode={m} />
              </span>
              <span className="skill-main">
                <span className="skill-title">{starting === m ? 'Starting…' : MODE_INFO[m].title}</span>
                <span className="skill-bar" aria-hidden>
                  <span style={{ width: `${st.total ? (st.done / st.total) * 100 : 0}%` }} />
                </span>
                <span className="skill-sub">
                  <span>
                    {st.done.toLocaleString()}/{st.total.toLocaleString()} {st.unit}
                    {st.due > 0 && ` · ${st.due} due`}
                  </span>
                  <span>{timerText(m)}</span>
                </span>
                <span className="skill-desc">{MODE_INFO[m].description}</span>
              </span>
            </button>
          );
        })}
        {tab === 'drills' && (
          <div className="skill-card static">
            <span className="skill-icon" aria-hidden>
              <svg viewBox="0 0 48 48" width="44" height="44">
                <rect x="6" y="12" width="36" height="24" rx="5" fill="var(--bad-soft)" stroke="var(--bad)" strokeWidth="2" />
                <path d="M19 19l10 10M29 19L19 29" stroke="var(--bad)" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </span>
            <span className="skill-main">
              <span className="skill-title">Practice My Mistakes</span>
              <span className="skill-desc">Only words you have missed, most-missed first, in new sentences where possible.</span>
              <span>
                <button className="btn small" disabled={!mistakeWords || !!starting} onClick={() => void start('spelling', 'mistakes')}>
                  {mistakeWords ? `Practice ${mistakeWords} missed words` : 'No mistakes yet'}
                </button>
              </span>
            </span>
          </div>
        )}
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
              Timed uses DET-like times. {settings.timerMode === 'custom' && <Link to="/settings">Edit custom times</Link>}
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
            <span className="tiny muted">Adaptive moves up after steady success and down when you struggle.</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="small" style={{ fontWeight: 600 }}>
              Session length
            </span>
            <div className="row" style={{ gap: 8 }}>
              <label className="field compact">
                Questions
                <input type="number" min={1} max={200} value={settings.questionsPerSession} onChange={(e) => set({ questionsPerSession: clamp(e.target.value) })} />
              </label>
              <label className="field compact">
                Texts
                <input type="number" min={1} max={50} value={settings.paragraphsPerSession} onChange={(e) => set({ paragraphsPerSession: clamp(e.target.value, 50) })} />
              </label>
              <label className="field compact">
                Passages
                <input type="number" min={1} max={20} value={settings.interactivePerSession} onChange={(e) => set({ interactivePerSession: clamp(e.target.value, 20) })} />
              </label>
            </div>
            <span className="tiny muted">Questions: Fill in the Blanks and drills. Texts: Read and Complete. Passages: Interactive Reading.</span>
          </div>
        </div>
      </div>
      <p className="tiny muted">
        Practice questions in the DET format. They are not official DET questions, and no word or text is guaranteed to appear on the live test.
      </p>
    </div>
  );
}

function clamp(v: string, max = 200): number {
  return Math.max(1, Math.min(max, Number(v) || 1));
}
