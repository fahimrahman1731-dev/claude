import { useMemo, useState } from 'react';
import { COMPLETED_CATEGORIES, matchesCategory, type CompletedCategory } from '../../engine/categories';
import { accuracy } from '../../engine/progress';
import { useApp, useProgressMap, useSettings } from '../app-context';
import { Chips, DifficultyBadge, Empty, MarkedSentence, usePager } from '../components';
import { date, download, duration, pct, toCsv } from '../format';
import { Link, navigate, wordPath } from '../router';

export function CompletedPage() {
  const { store, service, notify } = useApp();
  const settings = useSettings();
  const progress = useProgressMap();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CompletedCategory>('all');
  const mastered = useMemo(
    () =>
      progress
        ? store.words
            .filter((w) => progress.get(w.id)?.status === 'mastered')
            .sort((a, b) => (progress.get(b.id)?.masteredAt ?? 0) - (progress.get(a.id)?.masteredAt ?? 0))
        : [],
    [store, progress],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mastered.filter((w) => matchesCategory(cat, w) && (!needle || w.word.includes(needle) || w.definition.toLowerCase().includes(needle) || (w.bengali ?? '').includes(needle)));
  }, [mastered, q, cat]);
  const { slice, pager, reset } = usePager(rows, 40);

  const exportCsv = () => {
    const data = rows.map((w) => {
      const p = progress!.get(w.id)!;
      return {
        word: w.word,
        part_of_speech: w.pos.join('/'),
        definition: w.definition,
        bengali: w.bengali ?? '',
        difficulty: w.difficulty,
        date_mastered: p.masteredAt ? new Date(p.masteredAt).toISOString().slice(0, 10) : '',
        attempts: p.attempts,
        accuracy_percent: Math.round((accuracy(p) ?? 0) * 100),
        practice_seconds: Math.round(p.totalResponseMs / 1000),
        example_1: w.contexts[0]?.sentence ?? '',
        example_2: w.contexts[1]?.sentence ?? '',
      };
    });
    download(`completed-checklist-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + toCsv(data), 'text/csv;charset=utf-8');
  };
  const review = async () => {
    try {
      await service.startSession({ mode: 'spelling', focus: 'mastered' });
      navigate('/practice/session');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  const reopen = async (id: string, word: string) => {
    try {
      await service.reopenWord(id);
      notify(`“${word}” is back in the Active Practice List. Its history is kept.`, 'success');
    } catch (e) {
      notify(`Could not reopen: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  if (!progress) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Completed Checklist</h1>
          <p className="muted">
            {mastered.length.toLocaleString()} mastered words — each spelled correctly in two different sentences with no mistake in between.
          </p>
        </div>
        <div className="row">
          <button className="btn" disabled={!mastered.length} onClick={() => void review()}>
            ↻ Review mastered words
          </button>
          <button className="btn" disabled={!rows.length} onClick={exportCsv}>
            ⇩ Export CSV
          </button>
        </div>
      </div>
      {mastered.length === 0 ? (
        <div className="card">
          <Empty title="No mastered words yet">
            <p>Answer a word correctly in two different sentences, without a mistake in between, and it will appear here.</p>
            <Link to="/practice" className="btn primary">
              Start practice
            </Link>
          </Empty>
        </div>
      ) : (
        <>
          <div className="row">
            <input
              type="search"
              placeholder="Search mastered words"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                reset();
              }}
              aria-label="Search mastered words"
              style={{ flex: '1 1 220px' }}
            />
          </div>
          <Chips
            label="Category"
            value={cat}
            onChange={(v) => {
              setCat(v);
              reset();
            }}
            options={COMPLETED_CATEGORIES.map((c) => ({ ...c, count: mastered.filter((w) => matchesCategory(c.value, w)).length }))}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Meaning</th>
                  <th>Mastered</th>
                  <th className="num">Attempts</th>
                  <th className="num">Accuracy</th>
                  <th className="num">Time</th>
                  <th>Difficulty</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slice.map((w) => {
                  const p = progress.get(w.id)!;
                  return (
                    <tr key={w.id}>
                      <td className="word-cell">
                        <Link to={wordPath(w.id)}>{w.word}</Link>
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <div>{w.definition}</div>
                        {settings.language === 'en-bn' && w.bengali && <div className="bn muted small">{w.bengali}</div>}
                        <details className="small">
                          <summary className="muted">Examples</summary>
                          <ul className="sentence-list">
                            {w.contexts.slice(0, 3).map((c) => (
                              <li key={c.id}>
                                <MarkedSentence sentence={c.sentence} start={c.start} end={c.end} />
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td className="small">{date(p.masteredAt)}</td>
                      <td className="num">{p.attempts}</td>
                      <td className="num">{pct(accuracy(p))}</td>
                      <td className="num">{duration(p.totalResponseMs)}</td>
                      <td>
                        <DifficultyBadge d={w.difficulty} />
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <Link to={wordPath(w.id)} className="btn small ghost">
                            History
                          </Link>
                          <button className="btn small" onClick={() => void reopen(w.id, w.word)}>
                            Reopen
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pager}
        </>
      )}
    </div>
  );
}
