import { useMemo, useState } from 'react';
import { ACTIVE_FILTERS, matchesActiveFilter, type ActiveFilter } from '../../engine/categories';
import { livePriority, livePriorityScore } from '../../engine/priority';
import { mistakes } from '../../engine/progress';
import { halfSplit } from '../../engine/text';
import { useApp, useProgressMap, useSettings } from '../app-context';
import { Chips, DifficultyBadge, Empty, PriorityBadge, StatusBadge, usePager } from '../components';
import { Link, navigate, wordPath } from '../router';

type Sort = 'priority' | 'mistakes' | 'status' | 'az';

export function ActiveListPage() {
  const { store, service, notify } = useApp();
  const settings = useSettings();
  const progress = useProgressMap();
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('priority');
  const [hide, setHide] = useState(false);

  const active = useMemo(() => (progress ? store.words.filter((w) => progress.get(w.id)?.status !== 'mastered') : []), [store, progress]);
  const counts = useMemo(() => {
    const c = {} as Record<ActiveFilter, number>;
    for (const f of ACTIVE_FILTERS) c[f.value] = active.filter((w) => matchesActiveFilter(f.value, w, progress?.get(w.id))).length;
    return c;
  }, [active, progress]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = active.filter(
      (w) => matchesActiveFilter(filter, w, progress?.get(w.id)) && (!needle || w.word.includes(needle) || (w.bengali ?? '').includes(needle)),
    );
    const p = (id: string) => progress?.get(id);
    list.sort((a, b) => {
      if (sort === 'az') return a.word.localeCompare(b.word);
      if (sort === 'mistakes') return (p(b.id) ? mistakes(p(b.id)!) : 0) - (p(a.id) ? mistakes(p(a.id)!) : 0) || a.word.localeCompare(b.word);
      // Mistake Bank words first (most missed first), then new words by priority.
      if (sort === 'status') {
        const ma = p(a.id)?.status === 'learning' ? 1 : 0;
        const mb = p(b.id)?.status === 'learning' ? 1 : 0;
        if (ma !== mb) return mb - ma;
        if (ma) return mistakes(p(b.id)!) - mistakes(p(a.id)!) || a.word.localeCompare(b.word);
        return livePriorityScore(b, p(b.id)) - livePriorityScore(a, p(a.id)) || a.word.localeCompare(b.word);
      }
      return livePriorityScore(b, p(b.id)) - livePriorityScore(a, p(a.id)) || a.word.localeCompare(b.word);
    });
    return list;
  }, [active, filter, q, sort, progress]);
  const { slice, pager, reset } = usePager(rows, 50);

  const practiceList = async () => {
    const ids = rows.filter((w) => w.contexts.length >= 1).slice(0, 300).map((w) => w.id);
    if (!ids.length) return;
    try {
      await service.startSession({ mode: 'spelling', focus: 'words', wordIds: ids });
      navigate('/practice/session');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  if (!progress) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Active Practice List</h1>
          <p className="muted">
            {active.length.toLocaleString()} words not yet mastered: new words and words in your <Link to="/mistakes">Mistake Bank</Link>. Each word has one
            sentence, and one correct answer masters it and moves it to your Completed Checklist.
          </p>
        </div>
        <button className="btn primary" disabled={!rows.length} onClick={() => void practiceList()}>
          ▶ Practice this list
        </button>
      </div>
      <Chips
        label="Filter"
        value={filter}
        onChange={(v) => {
          setFilter(v);
          reset();
        }}
        options={ACTIVE_FILTERS.map((f) => ({ ...f, count: counts[f.value] }))}
      />
      <div className="row">
        <input
          type="search"
          placeholder="Search a word or Bengali meaning"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            reset();
          }}
          aria-label="Search active words"
          style={{ flex: '1 1 220px' }}
        />
        <label className="row small">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="priority">Priority</option>
            <option value="mistakes">Most mistakes</option>
            <option value="status">Mistake Bank first</option>
            <option value="az">A–Z</option>
          </select>
        </label>
        <label className="check small">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide spellings (show first half only)
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <Empty title={active.length === 0 ? 'Everything is mastered!' : 'No words match this filter'}>
            {active.length === 0 ? <p>Every imported word is in your Completed Checklist.</p> : <p>Try another filter or search.</p>}
          </Empty>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Word</th>
                  {settings.language === 'en-bn' && <th>বাংলা</th>}
                  <th>Difficulty</th>
                  <th>Priority</th>
                  <th className="num">Mistakes</th>
                  <th className="num">Correct</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((w) => {
                  const p = progress.get(w.id);
                  const split = halfSplit(w.word);
                  return (
                    <tr key={w.id}>
                      <td className="word-cell">
                        <Link to={wordPath(w.id)}>{hide ? `${split.visible}${'_'.repeat(split.hiddenLength)}` : w.word}</Link>
                        {w.isCustom && <span className="badge neutral" style={{ marginLeft: 6 }}>mine</span>}
                        {w.contexts.length < 1 && (
                          <span className="badge neutral" style={{ marginLeft: 6 }} title="Add one practice sentence on the word’s page to practice it">
                            needs a sentence
                          </span>
                        )}
                      </td>
                      {settings.language === 'en-bn' && <td className="bn">{w.bengali ?? <span className="muted">—</span>}</td>}
                      <td>
                        <DifficultyBadge d={w.difficulty} />
                      </td>
                      <td>
                        <PriorityBadge p={livePriority(w, p)} />
                      </td>
                      <td className="num">{p ? mistakes(p) : 0}</td>
                      <td className="num">{p?.correct ?? 0}</td>
                      <td>
                        <StatusBadge s={p?.status ?? 'new'} />
                        {p?.status === 'learning' && (
                          <span className="small muted" style={{ marginLeft: 6 }}>
                            {mistakes(p)} mistake{mistakes(p) === 1 ? '' : 's'}
                          </span>
                        )}
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
