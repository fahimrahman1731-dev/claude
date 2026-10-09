import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { MODE_INFO } from '../../engine/config';
import { computeStats, isGraded } from '../../engine/stats';
import type { Mode, ResultKind } from '../../engine/types';
import { useApp, useSettings } from '../app-context';
import { DailyChart, Empty, HBars } from '../components';
import { date, pct, secs } from '../format';

const ERROR_LABEL: Record<string, string> = {
  'missing-letters': 'Missing letters',
  'extra-letters': 'Extra letters',
  'wrong-letters': 'Wrong letters',
  transposition: 'Letters swapped',
  'double-letter': 'Double / single letter',
  'ie-ei': 'ie / ei',
  'wrong-ending': 'Wrong ending',
  'wrong-form': 'Wrong grammatical form',
  'uk-spelling': 'British spelling',
  'different-word': 'Different word',
  empty: 'Empty / timed out',
};

export function StatsPage() {
  const { db, store } = useApp();
  const settings = useSettings();
  const progress = useLiveQuery(() => db.progress.toArray(), [db]);
  const attempts = useLiveQuery(() => db.attempts.toArray(), [db]);
  const sessions = useLiveQuery(() => db.sessions.orderBy('startedAt').reverse().limit(15).toArray(), [db]);
  const irResults = useLiveQuery(() => db.irResults.toArray(), [db]);
  const irByPart = useMemo(() => {
    const m = new Map<string, { n: number; score: number }>();
    for (const r of irResults ?? []) {
      const x = m.get(r.part) ?? { n: 0, score: 0 };
      x.n++;
      x.score += r.score ?? (r.correct ? 1 : 0);
      m.set(r.part, x);
    }
    return m;
  }, [irResults]);
  const stats = useMemo(
    () => (progress && attempts ? computeStats(store.words, progress, attempts, { now: Date.now(), retentionReviews: settings.retentionReviews }) : undefined),
    [progress, attempts, store, settings.retentionReviews],
  );
  const byMode = useMemo(() => {
    const m = new Map<Mode, { graded: number; correct: number; ms: number; answered: number }>();
    for (const a of attempts ?? []) {
      const r = m.get(a.mode) ?? { graded: 0, correct: 0, ms: 0, answered: 0 };
      if (isGraded(a.result)) r.graded++;
      if (a.result === 'correct') r.correct++;
      if (a.result === 'correct' || a.result === 'incorrect') {
        r.ms += a.responseMs;
        r.answered++;
      }
      m.set(a.mode, r);
    }
    return m;
  }, [attempts]);
  const byPriority = useMemo(() => {
    const m = { high: { g: 0, c: 0 }, medium: { g: 0, c: 0 }, low: { g: 0, c: 0 } };
    for (const a of attempts ?? []) {
      const w = store.byId.get(a.wordId);
      if (!w || !isGraded(a.result)) continue;
      m[w.basePriority].g++;
      if (a.result === 'correct') m[w.basePriority].c++;
    }
    return m;
  }, [attempts, store]);
  const errorTypes = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attempts ?? []) if (a.result !== 'correct' && a.result !== 'skipped') for (const t of a.errorTypes) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [attempts]);

  if (!stats) return <p className="muted">Loading…</p>;
  const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);
  const RESULTS: [ResultKind, string][] = [
    ['correct', 'Correct'],
    ['incorrect', 'Incorrect'],
    ['timeout', 'Timed out'],
    ['unanswered', 'Unanswered (empty)'],
    ['skipped', 'Skipped'],
  ];
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Statistics</h1>
          <p className="muted">
            {total.toLocaleString()} answers recorded. Accuracy = correct ÷ graded answers (correct, incorrect, timed out, unanswered). Skips are counted
            separately and never affect accuracy or mastery.
          </p>
        </div>
      </div>
      {total === 0 ? (
        <div className="card">
          <Empty title="No answers yet">
            <p>Statistics appear after your first practice session.</p>
          </Empty>
        </div>
      ) : (
        <>
          {irByPart.size > 0 && (
            <div className="card">
              <h2>Interactive Reading by question type</h2>
              <HBars
                format={(v) => pct(v)}
                rows={[
                  ['complete-sentences', 'Complete the Sentences (each missing word)'],
                  ['complete-passage', 'Complete the Passage'],
                  ['highlight', 'Highlight the Answer (average score)'],
                  ['main-idea', 'Identify the Idea'],
                  ['title', 'Title the Passage'],
                ].map(([k, label]) => {
                  const x = irByPart.get(k);
                  return { label, value: x ? x.score / x.n : undefined, max: 1, note: x ? `(${x.n})` : '' };
                })}
              />
            </div>
          )}
          <div className="grid grid-2">
            <div className="card">
              <h2>Results</h2>
              <HBars format={(v) => v.toLocaleString()} rows={RESULTS.map(([k, l]) => ({ label: l, value: stats.counts[k], max: total }))} />
            </div>
            <div className="card">
              <h2>Accuracy by mode</h2>
              <HBars
                format={(v) => pct(v)}
                rows={(Object.keys(MODE_INFO) as Mode[]).map((m) => {
                  const r = byMode.get(m);
                  return { label: MODE_INFO[m].title, value: r?.graded ? r.correct / r.graded : undefined, max: 1, note: r ? `(${r.graded})` : '' };
                })}
              />
            </div>
            <div className="card">
              <h2>Accuracy by difficulty</h2>
              <HBars
                format={(v) => pct(v)}
                rows={(['easy', 'intermediate', 'advanced'] as const).map((d) => ({
                  label: d[0].toUpperCase() + d.slice(1),
                  value: stats.accuracyByDifficulty[d].pct,
                  max: 1,
                  note: `(${stats.accuracyByDifficulty[d].graded})`,
                }))}
              />
            </div>
            <div className="card">
              <h2>Accuracy by study-material priority</h2>
              <HBars
                format={(v) => pct(v)}
                rows={(['high', 'medium', 'low'] as const).map((k) => ({
                  label: k === 'low' ? 'Lower' : k[0].toUpperCase() + k.slice(1),
                  value: byPriority[k].g ? byPriority[k].c / byPriority[k].g : undefined,
                  max: 1,
                  note: `(${byPriority[k].g})`,
                }))}
              />
            </div>
            <div className="card">
              <h2>Average response time by mode</h2>
              <HBars
                format={(v) => secs(v)}
                rows={(Object.keys(MODE_INFO) as Mode[]).map((m) => {
                  const r = byMode.get(m);
                  return { label: MODE_INFO[m].title, value: r?.answered ? r.ms / r.answered : undefined, max: 30000 };
                })}
              />
              <p className="tiny muted" style={{ marginTop: 8 }}>
                Submitted answers only (timeouts excluded). Read and Complete time is per gap.
              </p>
            </div>
            <div className="card">
              <h2>Kinds of spelling mistakes</h2>
              {errorTypes.length === 0 ? (
                <p className="muted small">No mistakes yet.</p>
              ) : (
                <HBars format={(v) => String(v)} rows={errorTypes.map(([k, n]) => ({ label: ERROR_LABEL[k] ?? k, value: n, max: errorTypes[0][1] }))} />
              )}
            </div>
          </div>
          <div className="card">
            <h2>Daily practice (last 30 days)</h2>
            <DailyChart rows={stats.daily} goal={settings.dailyGoal} />
          </div>
          <div className="card">
            <h2>Recent sessions</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th className="num">Done</th>
                    <th className="num">Correct</th>
                    <th className="num">Missed</th>
                    <th className="num">Best streak</th>
                  </tr>
                </thead>
                <tbody>
                  {(sessions ?? []).map((s) => (
                    <tr key={s.id}>
                      <td className="small">{date(s.startedAt)}</td>
                      <td className="small">
                        {MODE_INFO[s.mode].title}
                        {s.focus !== 'normal' ? ` (${s.focus})` : ''}
                      </td>
                      <td className="small">{s.status}</td>
                      <td className="num">
                        {s.index}/{s.target}
                      </td>
                      <td className="num">{s.tally.correct}</td>
                      <td className="num">{s.tally.incorrect + s.tally.timeout + s.tally.unanswered}</td>
                      <td className="num">{s.bestStreak ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
