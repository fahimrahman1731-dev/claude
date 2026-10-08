import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { MODE_INFO } from '../../engine/config';
import { livePriority, livePriorityScore } from '../../engine/priority';
import { accuracy, mistakes } from '../../engine/progress';
import { spellingRules } from '../../engine/spelling';
import { checkContext, checkContextSet } from '../../engine/validate';
import { generateContexts } from '../../services/ai';
import { useApp, useSettings } from '../app-context';
import { DifficultyBadge, MarkedSentence, PriorityBadge, StatusBadge } from '../components';
import { date, dateTime, pct, relative, secs } from '../format';
import { Link, navigate, wordPath } from '../router';

const RESULT_TEXT: Record<string, string> = { correct: '✓ correct', incorrect: '✕ wrong', timeout: '⏱ timed out', unanswered: '— empty', skipped: '↷ skipped' };
const ORIGIN_TEXT: Record<string, string> = { authored: 'app sentence', custom: 'your sentence', ai: 'AI sentence (validated)', paragraph: 'paragraph' };

export function WordDetailPage({ id }: { id: string }) {
  const { db, store, service, report, notify, reloadStore } = useApp();
  const settings = useSettings();
  const w = store.byId.get(id);
  const p = useLiveQuery(() => db.progress.get(id), [db, id]);
  const attempts = useLiveQuery(() => db.attempts.where('wordId').equals(id).reverse().sortBy('at'), [db, id]);
  const [newSentence, setNewSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const sectionLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of report?.sources ?? []) for (const sec of s.sections) m.set(sec.id, `${s.title} → ${sec.label}`);
    return m;
  }, [report]);

  if (!w) {
    return (
      <div className="card">
        <h1>Word not found</h1>
        <p>
          <Link to="/library">Back to the library</Link>
        </p>
      </div>
    );
  }
  const family = store.familyOf(w);
  const rules = spellingRules(w);
  const bn = settings.language === 'en-bn';
  const paragraphUses = store.paragraphs.filter((x) => x.gaps.some((g) => g.wordId === w.id));

  const practice = async () => {
    try {
      await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: Math.max(2, w.contexts.length) });
      navigate('/practice/session');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  const addSentence = async () => {
    const c = checkContext(newSentence, w.word, w.id, 'custom');
    if (!c.context) {
      notify(`Sentence not added: ${c.errors.join('; ')}`, 'error');
      return;
    }
    const set = checkContextSet([...w.contexts, c.context], w.word);
    if (set.rejected.some((r) => r.sentence === c.context!.sentence)) {
      notify(`Sentence not added: ${set.rejected.find((r) => r.sentence === c.context!.sentence)!.reason}`, 'error');
      return;
    }
    await db.aiContexts.put({ ...c.context, createdAt: Date.now() });
    await reloadStore();
    setNewSentence('');
    notify('Sentence added.', 'success');
  };
  const generate = async () => {
    setBusy(true);
    try {
      const r = await generateContexts(settings.aiEndpoint, w, 2);
      if (r.added.length) {
        await db.aiContexts.bulkPut(r.added.map((c) => ({ ...c, createdAt: Date.now() })));
        await reloadStore();
      }
      notify(`${r.added.length} new sentence(s) added${r.rejected.length ? `, ${r.rejected.length} rejected by validation` : ''}.`, r.added.length ? 'success' : 'info');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete your word “${w.word}” and its progress?`)) return;
    await db.transaction('rw', db.customWords, db.progress, db.aiContexts, async () => {
      await db.customWords.delete(w.id);
      await db.progress.delete(w.id);
      await db.aiContexts.where('wordId').equals(w.id).delete();
    });
    await reloadStore();
    navigate('/library');
  };

  return (
    <div className="stack">
      <p className="small">
        <Link to="/library">← Vocabulary Library</Link>
      </p>
      <div className="card">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="word-title">{w.word}</span>
          <span className="muted">{w.pos.join(', ')}</span>
          <StatusBadge s={p?.status ?? 'new'} />
          <DifficultyBadge d={w.difficulty} />
          <PriorityBadge p={livePriority(w, p)} />
          {w.isCustom && <span className="badge neutral">your word</span>}
        </div>
        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>Meaning</dt>
          <dd>
            {w.definition || <span className="muted">No definition</span>}{' '}
            <span className="muted tiny">({w.definitionOrigin === 'source' ? 'from your study materials' : w.definitionOrigin === 'custom' ? 'yours' : 'written for this app'})</span>
            {w.notes
              .filter((n) => n.startsWith('App definition: '))
              .map((n) => (
                <div key={n} className="small muted">
                  {n.replace('App definition: ', 'Also: ')}
                </div>
              ))}
          </dd>
          {bn && (
            <>
              <dt>বাংলা</dt>
              <dd className="bn">
                {w.bengali ?? <span className="muted">—</span>} {w.bengali && <span className="muted tiny">({w.bengaliOrigin === 'custom' ? 'yours' : 'app gloss, not from the materials'})</span>}
              </dd>
            </>
          )}
          {w.collocations.length > 0 && (
            <>
              <dt>Clue / partner words</dt>
              <dd>{w.collocations.join(' · ')}</dd>
            </>
          )}
          <dt>Word family</dt>
          <dd>
            {family.map((f, i) => (
              <span key={f.id}>
                {i > 0 && ' · '}
                {f.id === w.id ? <strong>{f.word}</strong> : <Link to={wordPath(f.id)}>{f.word}</Link>}
              </span>
            ))}
            {w.base && !store.byWord.has(w.base) && <span className="muted"> (base: {w.base})</span>}
          </dd>
          {w.ending && (
            <>
              <dt>Ending drill</dt>
              <dd>
                {w.ending.visible}
                <u>{w.ending.hidden}</u> <span className="muted">({w.ending.label})</span>
              </dd>
            </>
          )}
          {w.ukVariants.length > 0 && (
            <>
              <dt>British spelling</dt>
              <dd>
                {w.ukVariants.join(', ')} <span className="muted small">— accepted in Fill in the Blanks only</span>
              </dd>
            </>
          )}
          <dt>Source</dt>
          <dd className="small">
            {w.sections.map((s) => (
              <div key={s}>{sectionLabel.get(s) ?? s}</div>
            ))}
            <span className="muted">
              Evidence: {w.evidence.join(', ')} · evidence score {w.evidenceScore} → live score {livePriorityScore(w, p)}
              {w.gapCount ? ` · ${w.gapCount} gaps in the guide’s count` : ''}
            </span>
          </dd>
          {w.notes.filter((n) => !n.startsWith('App definition: ')).length > 0 && (
            <>
              <dt>Notes</dt>
              <dd className="small">{w.notes.filter((n) => !n.startsWith('App definition: ')).join('; ')}</dd>
            </>
          )}
        </dl>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={w.contexts.length < 1} onClick={() => void practice()}>
            ▶ Practice this word
          </button>
          {p?.status === 'mastered' && (
            <button className="btn" onClick={() => void service.reopenWord(w.id).then(() => notify('Reopened for practice.', 'success'))}>
              Reopen for practice
            </button>
          )}
          {w.isCustom && (
            <button className="btn danger" onClick={() => void remove()}>
              Delete my word
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Progress</h2>
          {!p || (p.attempts === 0 && p.skips === 0) ? (
            <p className="muted">Not practiced yet.</p>
          ) : (
            <dl className="kv">
              <dt>Status</dt>
              <dd>
                {p.status === 'mastered' ? `Mastered on ${date(p.masteredAt)}` : p.status === 'learning' ? 'Learning' : 'Not started'}
              </dd>
              <dt>Attempts</dt>
              <dd>
                {p.attempts} graded ({p.correct} correct, {p.incorrect} wrong, {p.timeouts} timed out, {p.unanswered} empty) · {p.skips} skipped
              </dd>
              <dt>Accuracy</dt>
              <dd>{pct(accuracy(p))}</dd>
              <dt>Streak</dt>
              <dd>
                {p.consecutiveCorrect} correct in a row · {p.consecutiveIncorrect} wrong in a row
              </dd>
              <dt>Contexts</dt>
              <dd>
                {p.streakContextIds.length} different sentence(s) correct since the last mistake · {p.correctContextIds.length} ever
              </dd>
              <dt>Average time</dt>
              <dd>{secs(p.answeredCount ? p.totalResponseMs / p.answeredCount : undefined)}</dd>
              <dt>Last practiced</dt>
              <dd>{dateTime(p.lastPracticedAt)}</dd>
              <dt>Next review</dt>
              <dd>{p.status === 'mastered' && !settings.retentionReviews ? 'Retention reviews are off' : relative(p.nextReviewAt, Date.now())}</dd>
              <dt>Mistakes</dt>
              <dd>{mistakes(p)}</dd>
              {p.history.length > 0 && (
                <>
                  <dt>History</dt>
                  <dd className="small">
                    {p.history.map((h, i) => (
                      <div key={i}>
                        {dateTime(h.at)}: {h.event === 'mastered' ? 'mastered' : h.event === 'retention-failed' ? 'missed a retention check (back to active)' : 'reopened for practice'}
                      </div>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          )}
        </div>
        <div className="card">
          <h2>Spelling pattern</h2>
          {rules.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {rules.map((r, i) => (
                <li key={i}>
                  {r.en}
                  {bn && r.bn && <div className="bn muted">{r.bn}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No special spelling trap recorded for this word.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Practice sentences ({w.contexts.length})</h2>
        {w.contexts.length < 2 && <div className="alert warn small">This word needs at least two different sentences before it can be mastered.</div>}
        <ol className="sentence-list">
          {w.contexts.map((c) => (
            <li key={c.id}>
              <MarkedSentence sentence={c.sentence} start={c.start} end={c.end} />{' '}
              <span className="muted tiny">
                {ORIGIN_TEXT[c.origin]}
                {p?.correctContextIds.includes(c.id) ? ' · answered correctly' : p?.seenContextIds.includes(c.id) ? ' · seen' : ''}
              </span>
            </li>
          ))}
        </ol>
        {paragraphUses.length > 0 && (
          <p className="small muted">
            Also a gap in {paragraphUses.length} Read and Complete paragraph(s): {paragraphUses.map((x) => x.title).join(', ')}.
          </p>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <input type="text" value={newSentence} onChange={(e) => setNewSentence(e.target.value)} placeholder={`Add your own sentence with “${w.word}”`} style={{ flex: '1 1 260px' }} aria-label="New sentence" />
          <button className="btn" disabled={!newSentence.trim()} onClick={() => void addSentence()}>
            Add sentence
          </button>
          <button className="btn" disabled={busy} onClick={() => void generate()} title={settings.aiEndpoint ? 'Ask the configured AI server for two more sentences' : 'Set up an AI server in Settings first'}>
            {busy ? 'Generating…' : '✨ Generate 2 more (AI)'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Answer history</h2>
        {!attempts?.length ? (
          <p className="muted small">No answers yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Mode</th>
                  <th>Result</th>
                  <th>Typed</th>
                  <th className="num">Time</th>
                  <th>Context</th>
                </tr>
              </thead>
              <tbody>
                {attempts.slice(0, 100).map((a) => (
                  <tr key={a.id}>
                    <td className="small">{dateTime(a.at)}</td>
                    <td className="small">{MODE_INFO[a.mode].title}</td>
                    <td className="small">{RESULT_TEXT[a.result]}</td>
                    <td className="small" style={{ fontFamily: 'var(--mono)' }}>
                      {a.answer || '—'}
                    </td>
                    <td className="num small">{secs(a.responseMs)}</td>
                    <td className="tiny muted">{a.contextId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
