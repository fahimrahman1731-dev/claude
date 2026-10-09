import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { computeStats } from '../../engine/stats';
import { useApp, useSettings } from '../app-context';
import { DailyChart, HBars, ProgressBar, Stat } from '../components';
import { duration, pct, secs } from '../format';
import { Link, wordPath } from '../router';

export function DashboardPage() {
  const { db, store, report, reportError } = useApp();
  const settings = useSettings();
  const progress = useLiveQuery(() => db.progress.toArray(), [db]);
  const attempts = useLiveQuery(() => db.attempts.toArray(), [db]);
  const active = useLiveQuery(() => db.sessions.where('status').equals('active').first(), [db]);
  const stats = useMemo(
    () => (progress && attempts ? computeStats(store.words, progress, attempts, { now: Date.now(), retentionReviews: settings.retentionReviews }) : undefined),
    [progress, attempts, store, settings.retentionReviews],
  );
  if (!stats) return <p className="muted">Loading…</p>;
  const failed = report?.sources.filter((s) => s.status !== 'ok') ?? [];
  const isNew = stats.graded === 0 && stats.counts.skipped === 0;
  const goalPct = Math.min(1, stats.todayGraded / Math.max(1, settings.dailyGoal));
  const custom = store.words.length - store.importedCount;
  const fromLists = store.words.filter((w) => w.evidence.includes('trusted-list')).length;
  const fromMaterials = store.importedCount - fromLists;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {fromMaterials.toLocaleString()} words from your study materials + {fromLists.toLocaleString()} from trusted DET-level word lists
            {custom > 0 ? ` + ${custom} of your own` : ''} · {store.paragraphs.length} Read and Complete texts · {store.interactive.length} Interactive Reading passages.
          </p>
        </div>
        <div className="row">
          {active ? (
            <Link to="/practice/session" className="btn primary big">
              ▶ Resume session ({active.index}/{active.target})
            </Link>
          ) : (
            <Link to="/practice" className="btn primary big">
              ▶ Start practice
            </Link>
          )}
        </div>
      </div>

      {(failed.length > 0 || reportError) && (
        <div className="alert error" role="alert">
          <strong>Import problem:</strong>{' '}
          {reportError ??
            failed.map((s) => `${s.title}: ${s.status === 'failed' ? 'failed' : 'partly imported'}${s.error ? ` (${s.error})` : ''}`).join('; ')}
          . Not every word from your materials may be available. <Link to="/report">See the import report</Link>.
        </div>
      )}

      {isNew && (
        <div className="card">
          <h2>Welcome! Here is how this works</h2>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Choose a mode in Start Practice. Small Grammar Words (D) or Fill in the Blanks (B) are good first steps.</li>
            <li>Each question shows the first half of a word. Type the missing letters; spelling must be exact.</li>
            <li>
              A word is <strong>mastered</strong> only after you spell it correctly in <strong>two different sentences</strong> with no mistake in between.
            </li>
            <li>Missed words come back after a few questions, in a new sentence, until you master them.</li>
          </ol>
        </div>
      )}

      <div className="grid grid-4">
        <Stat label="Mastered" value={`${stats.masteredWords.toLocaleString()}`} sub={`of ${stats.totalWords.toLocaleString()} unique words`} />
        <Stat label="Mastery" value={`${stats.masteryPct.toFixed(1)}%`} sub={<ProgressBar value={stats.masteredWords} max={stats.totalWords} label="Mastery percentage" good />} />
        <Stat label="Due for review" value={stats.dueWords} sub={`${stats.learningWords} words in progress`} />
        <Stat label="Accuracy" value={pct(stats.accuracy)} sub={`${stats.graded} graded answers`} />
        <Stat label="Attempted" value={stats.attemptedWords} sub={`${stats.remainingWords.toLocaleString()} not yet mastered`} />
        <Stat label="Practice streak" value={`${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}`} sub={`Longest: ${stats.longestStreak}`} />
        <Stat label="Average response" value={secs(stats.avgResponseMs)} sub="submitted answers only" />
        <Stat label="Total practice time" value={duration(stats.totalPracticeMs)} />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Today’s goal</h2>
            <Link to="/settings" className="small">
              Change
            </Link>
          </div>
          <p style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0 0 8px' }}>
            {stats.todayGraded} / {settings.dailyGoal} questions
          </p>
          <ProgressBar value={stats.todayGraded} max={settings.dailyGoal} label="Daily goal" good={goalPct >= 1} />
          <p className="small muted" style={{ marginTop: 8 }}>
            {goalPct >= 1 ? 'Goal reached — anything more is a bonus.' : `${settings.dailyGoal - stats.todayGraded} to go.`}
          </p>
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
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Daily practice (last 30 days)</h2>
          <Link to="/stats" className="small">
            More statistics
          </Link>
        </div>
        <DailyChart rows={stats.daily} goal={settings.dailyGoal} />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Most often missed</h2>
            <Link to="/mistakes" className="small">
              Mistake Bank
            </Link>
          </div>
          {stats.mostMissed.length === 0 ? (
            <p className="muted small">No mistakes yet.</p>
          ) : (
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {stats.mostMissed.map((m) => (
                <li key={m.wordId}>
                  <Link to={wordPath(m.wordId)}>{m.word}</Link> <span className="muted">— {m.mistakes} mistake{m.mistakes === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="card">
          <h2>Most improved</h2>
          {stats.mostImproved.length === 0 ? (
            <p className="muted small">Words appear here once your later answers beat your earlier ones (4+ attempts).</p>
          ) : (
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {stats.mostImproved.map((m) => (
                <li key={m.wordId}>
                  <Link to={wordPath(m.wordId)}>{m.word}</Link>{' '}
                  <span className="muted">
                    — {pct(m.before)} → {pct(m.after)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <p className="tiny muted">
        Mastery % = mastered unique words ÷ total unique words × 100. Accuracy = correct ÷ graded answers (correct, wrong, timed out and empty); skipped
        questions are not counted.
      </p>
    </div>
  );
}
