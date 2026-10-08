import { useMemo, useRef, useState } from 'react';
import { livePriority } from '../../engine/priority';
import { searchWords, type SearchBy } from '../../engine/search';
import type { Difficulty, Priority } from '../../engine/types';
import { importWordList, makeCustomWord, type ImportReport } from '../../services/words';
import { useApp, useProgressMap, useSettings } from '../app-context';
import { DifficultyBadge, Empty, PriorityBadge, StatusBadge, usePager } from '../components';
import { Link, navigate, wordPath } from '../router';

const POS_LABEL: Record<string, string> = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', prep: 'preposition', conj: 'conjunction', pron: 'pronoun', det: 'determiner', aux: 'auxiliary', num: 'number', func: 'grammar word', interj: 'interjection' };

export function LibraryPage() {
  const { store } = useApp();
  const settings = useSettings();
  const progress = useProgressMap();
  const [q, setQ] = useState('');
  const [by, setBy] = useState<SearchBy>('word');
  const [pos, setPos] = useState('');
  const [diff, setDiff] = useState<'' | Difficulty>('');
  const [source, setSource] = useState('');
  const [prio, setPrio] = useState<'' | Priority>('');
  const [status, setStatus] = useState('');

  const sources = useMemo(() => {
    const s = new Map<string, string>();
    for (const src of store.data.sources) s.set(src.id, src.title);
    for (const w of store.words) for (const id of w.sources) if (!s.has(id)) s.set(id, id.startsWith('import:') ? `Imported: ${id.slice(7)}` : id === 'custom' ? 'My custom words' : id);
    return s;
  }, [store]);
  const allPos = useMemo(() => [...new Set(store.words.flatMap((w) => w.pos))].sort(), [store]);

  const rows = useMemo(
    () =>
      searchWords(store.words, q, by).filter((w) => {
        if (pos && !w.pos.includes(pos)) return false;
        if (diff && w.difficulty !== diff) return false;
        if (source && !w.sources.includes(source)) return false;
        const p = progress?.get(w.id);
        if (prio && livePriority(w, p) !== prio) return false;
        if (status && (p?.status ?? 'new') !== status) return false;
        return true;
      }),
    [store, q, by, pos, diff, source, prio, status, progress],
  );
  const { slice, pager, reset } = usePager(rows, 50);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Vocabulary Library</h1>
          <p className="muted">
            {store.words.length.toLocaleString()} words: {store.importedCount.toLocaleString()} from your study materials
            {store.words.length > store.importedCount ? `, ${store.words.length - store.importedCount} added by you` : ''}.
          </p>
        </div>
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row">
          <input
            type="search"
            placeholder={by === 'bengali' ? 'বাংলা অর্থ লিখুন' : by === 'suffix' ? 'e.g. -tion' : by === 'prefix' ? 'e.g. un' : 'Search the library'}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              reset();
            }}
            aria-label="Search the vocabulary library"
            style={{ flex: '1 1 240px' }}
            autoFocus
          />
          <select value={by} onChange={(e) => setBy(e.target.value as SearchBy)} aria-label="Search by">
            <option value="word">English word contains</option>
            <option value="prefix">Starts with (prefix)</option>
            <option value="suffix">Ends with (suffix)</option>
            <option value="meaning">English meaning</option>
            <option value="bengali">Bengali meaning</option>
          </select>
        </div>
        <div className="row">
          <select value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Part of speech">
            <option value="">Any part of speech</option>
            {allPos.map((p) => (
              <option key={p} value={p}>
                {POS_LABEL[p] ?? p}
              </option>
            ))}
          </select>
          <select value={diff} onChange={(e) => setDiff(e.target.value as Difficulty | '')} aria-label="Difficulty">
            <option value="">Any difficulty</option>
            <option value="easy">Easy</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            <option value="">Any source</option>
            {[...sources.entries()].map(([id, t]) => (
              <option key={id} value={id}>
                {t}
              </option>
            ))}
          </select>
          <select value={prio} onChange={(e) => setPrio(e.target.value as Priority | '')} aria-label="Priority">
            <option value="">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Lower</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="new">Not started</option>
            <option value="learning">Learning</option>
            <option value="mastered">Mastered</option>
          </select>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <Empty title="No words found">
            <p>Check the spelling, change the search type, or add it as your own word below.</p>
          </Empty>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Type</th>
                  <th>Meaning</th>
                  {settings.language === 'en-bn' && <th>বাংলা</th>}
                  <th>Difficulty</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((w) => {
                  const p = progress?.get(w.id);
                  return (
                    <tr key={w.id}>
                      <td className="word-cell">
                        <Link to={wordPath(w.id)}>{w.word}</Link>
                        {w.isCustom && <span className="badge neutral" style={{ marginLeft: 6 }}>mine</span>}
                      </td>
                      <td className="small muted">{w.pos.map((x) => POS_LABEL[x] ?? x).join(', ')}</td>
                      <td className="small">{w.definition || <span className="muted">—</span>}</td>
                      {settings.language === 'en-bn' && <td className="bn small">{w.bengali ?? '—'}</td>}
                      <td>
                        <DifficultyBadge d={w.difficulty} />
                      </td>
                      <td>
                        <PriorityBadge p={livePriority(w, p)} />
                      </td>
                      <td>
                        <StatusBadge s={p?.status ?? 'new'} />
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
      <AddWord />
      <ImportList />
    </div>
  );
}

function AddWord() {
  const { db, store, reloadStore, notify } = useApp();
  const [form, setForm] = useState({ word: '', pos: '', definition: '', bengali: '', difficulty: '' as '' | Difficulty, s1: '', s2: '', s3: '' });
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const settings = useSettings();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setSaving(true);
    setIssues([]);
    try {
      const res = makeCustomWord(
        { word: form.word, pos: form.pos, definition: form.definition, bengali: form.bengali, difficulty: form.difficulty || undefined, sentences: [form.s1, form.s2, form.s3] },
        store,
      );
      if (!res.word) {
        setIssues(res.errors);
        return;
      }
      const problems = res.sentenceIssues.map((x) => `“${x.sentence}”: ${x.reason}`);
      if (!res.practiceReady && settings.aiEndpoint) problems.push('Fewer than two valid sentences: you can generate more on the word’s page.');
      else if (!res.practiceReady) problems.push('Fewer than two valid, different sentences: the word is saved but cannot be practiced until you add more on its page.');
      await db.customWords.put(res.word);
      await reloadStore();
      setIssues(problems);
      notify(`Added “${res.word.word}”${res.practiceReady ? '' : ' (needs more sentences)'}.`, res.practiceReady ? 'success' : 'info');
      setForm({ word: '', pos: '', definition: '', bengali: '', difficulty: '', s1: '', s2: '', s3: '' });
      navigate(wordPath(res.word.id));
    } catch (e) {
      notify(`Could not save the word: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="card">
      <summary>
        <strong>Add your own word</strong> <span className="muted small">— kept separate from the imported materials, practiced like any other word</span>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="grid grid-3">
          <label className="field">
            Word
            <input type="text" value={form.word} onChange={set('word')} />
          </label>
          <label className="field">
            Part of speech <span className="hint">n, v, adj, adv …</span>
            <input type="text" value={form.pos} onChange={set('pos')} />
          </label>
          <label className="field">
            Difficulty
            <select value={form.difficulty} onChange={set('difficulty')}>
              <option value="">Guess from length</option>
              <option value="easy">Easy</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
        </div>
        <div className="grid grid-2">
          <label className="field">
            Meaning
            <input type="text" value={form.definition} onChange={set('definition')} />
          </label>
          <label className="field">
            Bengali translation (optional)
            <input type="text" className="bn" value={form.bengali} onChange={set('bengali')} />
          </label>
        </div>
        <label className="field">
          Example sentences <span className="hint">At least two, in clearly different situations. Each must contain the exact word. Use [brackets] if the word appears twice.</span>
          <input type="text" value={form.s1} onChange={set('s1')} placeholder="Sentence 1" />
          <input type="text" value={form.s2} onChange={set('s2')} placeholder="Sentence 2" />
          <input type="text" value={form.s3} onChange={set('s3')} placeholder="Sentence 3 (optional)" />
        </label>
        {issues.length > 0 && (
          <div className="alert warn">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {issues.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <button className="btn primary" disabled={!form.word.trim() || saving} onClick={() => void save()}>
            Add word
          </button>
        </div>
      </div>
    </details>
  );
}

function ImportList() {
  const { db, store, reloadStore, notify } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const onFile = async (f: File) => {
    let text = '';
    try {
      text = await f.text();
    } catch (e) {
      setReport({ fileName: f.name, status: 'failed', error: `Could not read the file: ${String(e)}`, rowsDetected: 0, imported: [], practiceReady: 0, alreadyInLibrary: [], duplicatesInFile: [], missingDefinitions: [], needSentences: [], failedRows: [], contextsAdded: 0 });
      return;
    }
    const { words, report: rep } = importWordList(f.name, text, store);
    try {
      await db.transaction('rw', db.customWords, db.imports, async () => {
        if (words.length) await db.customWords.bulkPut(words);
        await db.imports.put({ id: `imp_${Date.now()}`, at: Date.now(), fileName: f.name, status: rep.status, report: rep });
      });
      await reloadStore();
    } catch (e) {
      rep.status = 'failed';
      rep.error = `The words could not be saved: ${e instanceof Error ? e.message : String(e)}`;
      rep.imported = [];
    }
    setReport(rep);
    notify(rep.status === 'failed' ? `Import failed: ${rep.error ?? 'see the report'}` : `Imported ${rep.imported.length} words from ${f.name}.`, rep.status === 'failed' ? 'error' : 'success');
  };
  return (
    <details className="card">
      <summary>
        <strong>Import a word list</strong> <span className="muted small">— CSV, JSON or TXT</span>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>
          CSV needs a header row with <code>word</code>, and may include <code>pos</code>, <code>definition</code>, <code>bengali</code>, <code>difficulty</code> and{' '}
          <code>sentence1</code>, <code>sentence2</code> … columns. TXT: one word per line, optionally “word - meaning”. Words already in the library are skipped and
          listed in the report.
        </p>
        <div>
          <input ref={fileRef} type="file" accept=".csv,.json,.txt,.md" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} aria-label="Choose a word list file" />
        </div>
        {report && <ImportReportView r={report} />}
      </div>
    </details>
  );
}

export function ImportReportView({ r }: { r: ImportReport }) {
  return (
    <div className={`alert ${r.status === 'failed' ? 'error' : r.status === 'partial' ? 'warn' : 'success'}`} role="status">
      <strong>
        {r.fileName}: {r.status === 'ok' ? 'imported' : r.status === 'partial' ? 'partly imported' : 'import failed'}
      </strong>
      {r.error && <p style={{ margin: '4px 0' }}>{r.error}</p>}
      <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        <li>Rows detected: {r.rowsDetected}</li>
        <li>
          Imported: {r.imported.length} ({r.practiceReady} ready to practice)
        </li>
        {r.alreadyInLibrary.length > 0 && <li>Already in the library (skipped): {r.alreadyInLibrary.join(', ')}</li>}
        {r.duplicatesInFile.length > 0 && <li>Repeated in the file (skipped): {r.duplicatesInFile.join(', ')}</li>}
        {r.missingDefinitions.length > 0 && <li>Missing definitions: {r.missingDefinitions.join(', ')}</li>}
        {r.needSentences.length > 0 && <li>Need two valid sentences before practice: {r.needSentences.join(', ')}</li>}
        {r.failedRows.length > 0 && (
          <li>
            Failed rows:
            <ul>
              {r.failedRows.map((f) => (
                <li key={f.row}>
                  Row {f.row} ({f.text}): {f.reason}
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </div>
  );
}
