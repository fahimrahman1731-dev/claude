import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { MODE_INFO } from '../../engine/config';
import { findOccurrences } from '../../engine/text';
import type { MistakeRecord } from '../../engine/types';
import { useApp, useProgressMap } from '../app-context';
import { Chips, Empty, StatusBadge, usePager } from '../components';
import { dateTime, secs } from '../format';
import { Link, navigate, wordPath } from '../router';

type Filter = 'frequent' | 'recent' | 'ending' | 'missing' | 'extra' | 'transposition' | 'form' | 'timeout';

const FILTERS: { value: Filter; label: string; test?: (m: MistakeRecord) => boolean }[] = [
  { value: 'frequent', label: 'Most frequently missed' },
  { value: 'recent', label: 'Recently missed' },
  { value: 'ending', label: 'Incorrect word endings', test: (m) => m.errorTypes.includes('wrong-ending') },
  { value: 'missing', label: 'Missing letters', test: (m) => m.errorTypes.includes('missing-letters') || (m.errorTypes.includes('double-letter') && m.answer.length < m.correctAnswer.length) },
  { value: 'extra', label: 'Extra letters', test: (m) => m.errorTypes.includes('extra-letters') || (m.errorTypes.includes('double-letter') && m.answer.length > m.correctAnswer.length) },
  { value: 'transposition', label: 'Letter transpositions', test: (m) => m.errorTypes.includes('transposition') || m.errorTypes.includes('ie-ei') },
  { value: 'form', label: 'Wrong grammatical forms', test: (m) => m.errorTypes.includes('wrong-form') },
  { value: 'timeout', label: 'Timed out', test: (m) => m.result === 'timeout' },
];

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

function MistakeItem({ m }: { m: MistakeRecord }) {
  return (
    <div className="mistake-item">
      <div className="row" style={{ gap: 8 }}>
        <strong>
          <Link to={wordPath(m.wordId)}>{m.word}</Link>
        </strong>
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = FILTERS.find((x) => x.value === filter)!;
    return (mistakes ?? []).filter((m) => (!f.test || f.test(m)) && (!needle || m.word.includes(needle)));
  }, [mistakes, filter, q]);
  const groups = useMemo(() => {
    const g = new Map<string, MistakeRecord[]>();
    for (const m of filtered) g.set(m.wordId, [...(g.get(m.wordId) ?? []), m]);
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length || b[1][0].at - a[1][0].at);
  }, [filtered]);
  const grouped = usePager(groups, 25);
  const flat = usePager(filtered, 40);

  const practice = async () => {
    try {
      await service.startSession({ mode: 'spelling', focus: 'mistakes' });
      navigate('/practice/session');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
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
            {mistakes.length} mistakes on {new Set(mistakes.map((m) => m.wordId)).size} words. Every wrong, timed-out or empty answer is saved here.
          </p>
        </div>
        <button className="btn primary big" disabled={!mistakes.length} onClick={() => void practice()}>
          ▶ Practice My Mistakes
        </button>
      </div>
      {mistakes.length === 0 ? (
        <div className="card">
          <Empty title="No mistakes yet">
            <p>When you miss a word, it is saved here with what you typed, the sentence, and the spelling rule.</p>
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
                        {p && <StatusBadge s={p.status} />}
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
                  <MistakeItem key={m.id} m={m} />
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
