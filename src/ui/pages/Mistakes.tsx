import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { MODE_INFO } from '../../engine/config';
import { findOccurrences } from '../../engine/text';
import type { MistakeRecord, WordProgress } from '../../engine/types';
import { useApp, useProgressMap } from '../app-context';
import { Chips, Empty, usePager } from '../components';
import { dateTime, secs } from '../format';
import { Link, navigate, wordPath } from '../router';

type Filter = 'frequent' | 'recent' | 'ending' | 'missing' | 'extra' | 'transposition' | 'form' | 'timeout';

const FILTERS: { value: Filter; label: string; test?: (m: MistakeRecord) => boolean }[] = [
  { value: 'frequent', label: 'By word (to fix first)' },
  { value: 'recent', label: 'Recently missed' },
  { value: 'ending', label: 'Incorrect word endings', test: (m) => m.errorTypes.includes('wrong-ending') },
  { value: 'missing', label: 'Missing letters', test: (m) => m.errorTypes.includes('missing-letters') || (m.errorTypes.includes('double-letter') && m.answer.length < m.correctAnswer.length) },
  { value: 'extra', label: 'Extra letters', test: (m) => m.errorTypes.includes('extra-letters') || (m.errorTypes.includes('double-letter') && m.answer.length > m.correctAnswer.length) },
  { value: 'transposition', label: 'Letter transpositions', test: (m) => m.errorTypes.includes('transposition') || m.errorTypes.includes('ie-ei') },
  { value: 'form', label: 'Wrong grammatical forms', test: (m) => m.errorTypes.includes('wrong-form') },
  { value: 'timeout', label: 'Timed out', test: (m) => m.result === 'timeout' },
];

/** Where a missed word stands now: still in the Mistake Bank, fixed (mastered), or back among the new words. */
type FixState = 'to-fix' | 'fixed' | 'new' | 'removed';

function fixState(p: WordProgress | undefined): FixState {
  return p?.status === 'learning' ? 'to-fix' : p?.status === 'mastered' ? 'fixed' : 'new';
}

const FIX_BADGE: Record<FixState, { cls: string; label: string; title: string }> = {
  'to-fix': { cls: 'learning', label: 'To fix', title: 'Still in your Mistake Bank. One correct answer in Practice My Mistakes masters it.' },
  fixed: { cls: 'mastered', label: '✓ Fixed', title: 'Answered correctly after the mistake: mastered.' },
  new: { cls: 'new', label: 'New again', title: 'Not in your Mistake Bank now. It will come up again as a new word.' },
  removed: { cls: 'neutral', label: 'Removed', title: 'This word is no longer in the library, so it cannot be practiced.' },
};

function FixBadge({ wordId, p }: { wordId: string; p: WordProgress | undefined }) {
  const { store } = useApp();
  const b = FIX_BADGE[store.byId.has(wordId) ? fixState(p) : 'removed'];
  return (
    <span className={`badge ${b.cls}`} title={b.title}>
      {b.label}
    </span>
  );
}

function Sentence({ m }: { m: MistakeRecord }) {
  const at = m.answerStart;
  const exact = at !== undefined && m.sentence.slice(at, at + m.correctAnswer.length).toLowerCase() === m.correctAnswer.toLowerCase();
  const occ = exact ? { start: at, end: at + m.correctAnswer.length } : findOccurrences(m.sentence, m.correctAnswer)[0];
  if (!occ) return <>{m.sentence}</>;
  return (
    <>
      {m.sentence.slice(0, occ.start)}
      <mark className="target">{m.sentence.slice(occ.start, occ.end)}</mark>
      {m.sentence.slice(occ.end)}
    </>
  );
}

/** One saved mistake. `fix` adds the word's To fix / Fixed badge (the list views; word cards show it once). */
function MistakeItem({ m, fix }: { m: MistakeRecord; fix?: { p: WordProgress | undefined } }) {
  return (
    <div className="mistake-item">
      <div className="row" style={{ gap: 8 }}>
        <strong>
          <Link to={wordPath(m.wordId)}>{m.word}</Link>
        </strong>
        {fix && <FixBadge wordId={m.wordId} p={fix.p} />}
        <span>
          {m.answer ? <span className="typed-wrong">{m.answer}</span> : <span className="muted">{m.result === 'timeout' ? '(time ran out)' : '(empty)'}</span>} →{' '}
          <strong>{m.correctAnswer}</strong>
        </span>
        <span className="muted tiny" style={{ marginLeft: 'auto' }}>
          {dateTime(m.at)} · {secs(m.responseMs)} · {MODE_INFO[m.mode].title} · earlier mistakes: {m.previousMistakes}
        </span>
      </div>
      <div className="small" style={{ marginTop: 4 }}>
        <Sentence m={m} />
      </div>
      {(m.rule || m.clue) && (
        <div className="tiny muted" style={{ marginTop: 4 }}>
          {m.rule && <div>Spelling rule: {m.rule}</div>}
          {m.clue && <div>Context clue: {m.clue}</div>}
        </div>
      )}
      <div className="tiny muted">
        Context ID {m.contextId} · {m.errorTypes.join(', ') || m.result}
      </div>
    </div>
  );
}

export function MistakesPage() {
  const { db, service, store, notify } = useApp();
  const progress = useProgressMap();
  const mistakes = useLiveQuery(() => db.mistakes.orderBy('at').reverse().toArray(), [db]);
  const [filter, setFilter] = useState<Filter>('frequent');
  const [q, setQ] = useState('');
  const [starting, setStarting] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = FILTERS.find((x) => x.value === filter)!;
    return (mistakes ?? []).filter((m) => (!f.test || f.test(m)) && (!needle || m.word.includes(needle)));
  }, [mistakes, filter, q]);
  const groups = useMemo(() => {
    const g = new Map<string, MistakeRecord[]>();
    for (const m of filtered) g.set(m.wordId, [...(g.get(m.wordId) ?? []), m]);
    // Words still to fix first, then the most-missed, then the most recent.
    const rank = (id: string) => (fixState(progress?.get(id)) === 'to-fix' ? 0 : 1);
    return [...g.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length || b[1][0].at - a[1][0].at);
  }, [filtered, progress]);
  /** Words in the Mistake Bank now: what Practice My Mistakes will serve. */
  const toFix = useMemo(() => (progress ? [...progress.values()].filter((p) => p.status === 'learning' && store.byId.has(p.wordId)).length : 0), [progress, store]);
  /** Missed words that were later answered correctly. */
  const fixed = useMemo(() => new Set((mistakes ?? []).filter((m) => progress?.get(m.wordId)?.status === 'mastered').map((m) => m.wordId)).size, [mistakes, progress]);
  const grouped = usePager(groups, 25);
  const flat = usePager(filtered, 40);

  const practice = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await service.startSession({ mode: 'spelling', focus: 'mistakes' });
      navigate('/practice/session');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setStarting(false);
    }
  };

  if (!mistakes) return <p className="muted">Loading…</p>;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, f.test ? mistakes.filter(f.test).length : mistakes.length]));
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Mistake Bank</h1>
          <p className="muted">
            {mistakes.length} mistakes on {new Set(mistakes.map((m) => m.wordId)).size} words. Every wrong, timed-out or empty answer is saved here (words removed from the library are marked).
          </p>
          <p style={{ marginTop: 6 }}>
            <strong>{toFix}</strong> word{toFix === 1 ? '' : 's'} to fix · <strong>{fixed}</strong> fixed
          </p>
          <p className="small muted" style={{ marginTop: 6 }}>
            Missed words never come back by themselves: practice them here. One correct answer masters a word.
          </p>
        </div>
        <div className="stack" style={{ gap: 4, justifyItems: 'end' }}>
          <button className="btn primary big" disabled={!toFix || starting} onClick={() => void practice()} aria-describedby={progress && !toFix ? 'nothing-to-fix' : undefined}>
            ▶ Practice My Mistakes
          </button>
          {progress && !toFix && (
            <span id="nothing-to-fix" className="tiny muted">
              {mistakes.length ? 'Nothing to fix: no word is in your Mistake Bank now.' : 'Nothing to fix yet.'}
            </span>
          )}
        </div>
      </div>
      {mistakes.length === 0 ? (
        <div className="card">
          <Empty title="No mistakes yet">
            <p>When you miss a word, it is saved here with what you typed, the sentence, and the spelling rule. The word waits here until you answer it correctly in Practice My Mistakes.</p>
          </Empty>
        </div>
      ) : (
        <>
          <Chips
            label="Filter mistakes"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              grouped.reset();
              flat.reset();
            }}
            options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))}
          />
          <input type="search" placeholder="Search a word" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search mistakes" />
          {filtered.length === 0 ? (
            <div className="card">
              <Empty title="No mistakes of this kind" />
            </div>
          ) : filter === 'frequent' ? (
            <>
              <div className="stack">
                {grouped.slice.map(([wordId, list]) => {
                  const w = store.byId.get(wordId);
                  const p = progress?.get(wordId);
                  return (
                    <div className="card" key={wordId}>
                      <div className="card-head">
                        <h2>
                          <Link to={wordPath(wordId)}>{w?.word ?? list[0].word}</Link>{' '}
                          <span className="muted small">
                            {list.length} mistake{list.length === 1 ? '' : 's'}
                          </span>
                        </h2>
                        {progress && <FixBadge wordId={wordId} p={p} />}
                      </div>
                      <details>
                        <summary className="small">
                          Latest: {list[0].answer ? <span className="typed-wrong">{list[0].answer}</span> : <span className="muted">(no answer)</span>} → <strong>{list[0].correctAnswer}</strong>
                        </summary>
                        {list.map((m) => (
                          <MistakeItem key={m.id} m={m} />
                        ))}
                      </details>
                    </div>
                  );
                })}
              </div>
              {grouped.pager}
            </>
          ) : (
            <>
              <div className="card">
                {flat.slice.map((m) => (
                  <MistakeItem key={m.id} m={m} fix={progress ? { p: progress.get(m.wordId) } : undefined} />
                ))}
              </div>
              {flat.pager}
            </>
          )}
        </>
      )}
    </div>
  );
}
