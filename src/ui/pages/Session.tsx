import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { checkGap } from '../../engine/answer';
import { contextClues } from '../../engine/clues';
import { MODE_INFO } from '../../engine/config';
import { REASON_TEXT } from '../../engine/selection';
import { spellingRules, type Explanation } from '../../engine/spelling';
import type { Gap, ParagraphQuestion, SentenceQuestion, VocabWord } from '../../engine/types';
import type { GapOutcome, QuestionOutcome, SessionRecord } from '../../db/db';
import { SaveError } from '../../services/practice';
import { useApp, useSettings } from '../app-context';
import { DifficultyBadge, ProgressBar } from '../components';
import { pct, secs } from '../format';
import { Link, navigate, wordPath } from '../router';
import { playTone } from '../sound';

type Kind = 'submit' | 'timeout' | 'skip';

export function SessionPage() {
  const { service, notify } = useApp();
  const [session, setSession] = useState<SessionRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lock = useRef(false);

  const load = useCallback(async () => {
    try {
      let s = await service.activeSession();
      if (!s) {
        const recent = (await service.db.sessions.orderBy('startedAt').reverse().limit(1).toArray())[0];
        setSession(recent && recent.status === 'completed' && Date.now() - (recent.endedAt ?? 0) < 6 * 3600_000 ? recent : null);
        return;
      }
      if (!s.current && !s.lastOutcome) s = await service.advance(s.id);
      setSession(s);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (answers: string[], kind: Kind, hintUsed: boolean) => {
      if (!session?.current || lock.current) return;
      lock.current = true;
      setBusy(true);
      setSaveError(null);
      try {
        const r = await service.submit(session.id, { questionId: session.current.question.id, answers, kind, hintUsed });
        setSession({ ...r.session });
        const settings = await service.getSettings();
        if (settings.sound && kind !== 'skip') playTone(r.outcome.gaps.every((g) => g.result === 'correct') ? 'good' : 'bad');
        for (const g of r.outcome.gaps) if (g.becameMastered) notify(`“${g.word}” mastered and moved to the Completed Checklist.`, 'success');
      } catch (e) {
        const msg = e instanceof SaveError ? e.message : `Could not save: ${e instanceof Error ? e.message : String(e)}`;
        setSaveError(msg);
        notify(msg, 'error');
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [session, service, notify],
  );

  const next = useCallback(async () => {
    if (!session || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      setSession({ ...(await service.advance(session.id)) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
      notify(msg, 'error');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [session, service, notify]);

  const end = async () => {
    if (!session) return;
    if (session.status === 'active' && !window.confirm('End this session? The open question will not be recorded.')) return;
    if (session.status === 'active') await service.endSession(session.id);
    navigate('/practice');
  };

  if (session === undefined) {
    return (
      <div className="boot" role="status">
        <div className="spinner" aria-hidden />
        <p>Preparing your session…</p>
        {saveError && <p className="alert error">{saveError}</p>}
      </div>
    );
  }
  if (session === null) {
    return (
      <div className="focus-shell">
        <div className="focus-main">
          <div className="card empty">
            <h3>No practice session is running</h3>
            <p>Choose a mode to start one.</p>
            <Link to="/practice" className="btn primary">
              Start practice
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const done = session.index;
  return (
    <div className="focus-shell">
      <div className="focus-top">
        <button className="btn small" onClick={() => void end()}>
          {session.status === 'active' ? '✕ End' : '← Back'}
        </button>
        <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
          {MODE_INFO[session.mode].title}
          {session.focus === 'mistakes' ? ' · My mistakes' : session.focus === 'mastered' ? ' · Review mastered' : session.focus === 'words' ? ' · Chosen words' : ''}
        </span>
        <ProgressBar value={done} max={session.target} label="Session progress" />
        <span className="small" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {done}/{session.target}
        </span>
      </div>
      <main className="focus-main">
        {saveError && (
          <div className="alert error" role="alert" style={{ marginBottom: 14 }}>
            <strong>Progress not saved.</strong> {saveError}{' '}
            <button className="btn small" onClick={() => void load()}>
              Reload session
            </button>
          </div>
        )}
        {session.status !== 'active' ? (
          <Summary
            session={session}
            onRestart={async () => {
              try {
                setSession(await service.startSession({ mode: session.mode, focus: session.focus === 'words' ? 'normal' : session.focus }));
              } catch (e) {
                notify(e instanceof Error ? e.message : String(e), 'error');
              }
            }}
          />
        ) : session.current ? (
          session.current.question.kind === 'sentence' ? (
            <SentenceView key={session.current.question.id + session.index} session={session} q={session.current.question} busy={busy} onSubmit={submit} />
          ) : (
            <ParagraphView key={session.current.question.id + session.index} session={session} q={session.current.question} busy={busy} onSubmit={submit} />
          )
        ) : session.lastOutcome ? (
          <Feedback session={session} outcome={session.lastOutcome} busy={busy} onNext={next} />
        ) : (
          <div className="card empty">
            <button className="btn primary" onClick={() => void next()}>
              Continue
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- timer

function useCountdown(startedAt: number, limitMs: number | null, onExpire: () => void) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => {
    if (limitMs === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [limitMs]);
  const remaining = limitMs === null ? null : Math.max(0, limitMs - (now - startedAt));
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !fired.current) {
      fired.current = true;
      cb.current();
    }
  }, [remaining]);
  return remaining;
}

function Timer({ remaining, limitMs }: { remaining: number | null; limitMs: number | null }) {
  if (remaining === null || limitMs === null) return <span className="timer muted" title="Untimed mode">Untimed</span>;
  const s = Math.ceil(remaining / 1000);
  const frac = remaining / limitMs;
  const r = 14;
  const c = 2 * Math.PI * r;
  const low = remaining <= Math.min(5000, limitMs * 0.25);
  const label = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
  return (
    <span className={`timer${low ? ' low' : ''}`} role="timer" aria-live={low ? 'polite' : 'off'} aria-label={`${s} seconds left`}>
      <svg className="timer-ring" viewBox="0 0 34 34" aria-hidden>
        <circle cx="17" cy="17" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="4" />
        <circle cx="17" cy="17" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} strokeLinecap="round" transform="rotate(-90 17 17)" />
      </svg>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------- sentence question

const INSTRUCTIONS: Record<string, string> = {
  'fill-blanks': 'Type the missing letters to complete the word in the sentence.',
  spelling: 'Complete the word. Use the sentence, the letter count and the grammar.',
  'small-words': 'Complete the small grammar word.',
  endings: 'The stem is shown. Type the ending that fits the sentence.',
};

function GapInput({
  gap,
  value,
  onChange,
  onKeyDown,
  autoFocus,
  inputRef,
  label,
  disabled,
}: {
  gap: Gap;
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const width = `${Math.max(gap.hiddenLength, value.length, 2) + 0.8}ch`;
  return (
    <span className="gap">
      <span className="vis">{gap.visible}</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={label}
        placeholder={'_'.repeat(gap.hiddenLength)}
        maxLength={gap.answer.length + 2}
        style={{ width }}
        disabled={disabled}
      />
    </span>
  );
}

function SentenceView({ session, q, busy, onSubmit }: { session: SessionRecord; q: SentenceQuestion; busy: boolean; onSubmit: (a: string[], k: Kind, hint: boolean) => void }) {
  const { store } = useApp();
  const settings = useSettings();
  const word = store.byId.get(q.wordId);
  const [value, setValue] = useState('');
  const [hint, setHint] = useState<'none' | 'en' | 'bn'>('none');
  const valueRef = useRef('');
  valueRef.current = value;
  const cur = session.current!;
  const remaining = useCountdown(cur.startedAt, cur.limitMs, () => onSubmit([valueRef.current], 'timeout', hint !== 'none'));
  const bnOn = settings.language === 'en-bn';
  const submit = () => {
    if (!busy) onSubmit([value], 'submit', hint !== 'none');
  };
  return (
    <>
      <div className="q-meta">
        <span>
          Question <strong>{session.index + 1}</strong> of {session.target}
        </span>
        {word && <DifficultyBadge d={word.difficulty} />}
        <span>{REASON_TEXT[cur.reason]}</span>
        <span title="Correct answers in a row">🔥 Streak {session.streak}</span>
        <Timer remaining={remaining} limitMs={cur.limitMs} />
      </div>
      <div className="q-card">
        <p className="q-instruction">{INSTRUCTIONS[q.mode]}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="q-sentence">
            {q.before}
            <GapInput gap={q.gap} value={value} onChange={setValue} autoFocus label={`Missing letters, ${q.gap.hiddenLength} letters after “${q.gap.visible}”`} disabled={busy} />
            {q.after}
          </p>
          <p className="letters">
            {q.gap.visible.length + q.gap.hiddenLength} letters · {q.gap.hiddenLength} missing
            {q.mode === 'endings' && word?.ending && <> · ending to type: {q.gap.hiddenLength} letters</>}
            {q.baseHint && (
              <>
                {' '}
                · base verb: <strong>{q.baseHint}</strong> (irregular)
              </>
            )}
          </p>
          {(hint !== 'none' || (bnOn && settings.bengaliBeforeAnswer)) && word && (
            <div className="hint-box">
              {(hint === 'en' || hint === 'bn') && word.definition && (
                <div>
                  <strong>Meaning:</strong> {word.definition}
                </div>
              )}
              {bnOn && word.bengali && (hint === 'bn' || settings.bengaliBeforeAnswer) && (
                <div className="bn">
                  <strong>বাংলা:</strong> {word.bengali}
                </div>
              )}
            </div>
          )}
          <div className="q-actions">
            <button type="submit" className="btn primary big" disabled={busy}>
              Submit <kbd>Enter</kbd>
            </button>
            {settings.showSkip && (
              <button type="button" className="btn" disabled={busy} onClick={() => onSubmit([value], 'skip', hint !== 'none')}>
                Skip
              </button>
            )}
            <span className="spacer" />
            {word?.definition && hint === 'none' && (
              <button type="button" className="btn small ghost" onClick={() => setHint('en')}>
                💡 Hint: meaning
              </button>
            )}
            {bnOn && word?.bengali && hint !== 'bn' && !settings.bengaliBeforeAnswer && (
              <button type="button" className="btn small ghost bn" onClick={() => setHint('bn')}>
                বাংলা hint
              </button>
            )}
          </div>
        </form>
      </div>
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Type only the missing letters (or the whole word). Spelling must be exact. Practice question, not an official DET item.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- paragraph question

function ParagraphView({ session, q, busy, onSubmit }: { session: SessionRecord; q: ParagraphQuestion; busy: boolean; onSubmit: (a: string[], k: Kind, hint: boolean) => void }) {
  const [values, setValues] = useState<string[]>(() => q.gaps.map(() => ''));
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const cur = session.current!;
  const remaining = useCountdown(cur.startedAt, cur.limitMs, () => onSubmit(valuesRef.current, 'timeout', false));
  const filled = values.filter((v) => v.trim()).length;
  const onKey = (i: number) => (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (i < q.gaps.length - 1) inputs.current[i + 1]?.focus();
      else if (!busy) onSubmit(values, 'submit', false);
    }
  };
  return (
    <>
      <div className="q-meta">
        <span>
          Paragraph <strong>{session.index + 1}</strong> of {session.target}
        </span>
        <DifficultyBadge d={q.difficulty} />
        <span>
          {filled}/{q.gaps.length} gaps filled
        </span>
        <Timer remaining={remaining} limitMs={cur.limitMs} />
      </div>
      <div className="q-card">
        <h2>{q.title}</h2>
        <p className="q-instruction">
          Type the missing letters in each word. Start with the small words, then the content words. <kbd>Enter</kbd> or <kbd>Tab</kbd> moves to the next gap; <kbd>Enter</kbd> in the last gap submits. American spelling only.
        </p>
        <p className="q-sentence paragraph">
          {q.segments.map((seg, i) => (
            <span key={i}>
              {seg}
              {i < q.gaps.length && (
                <GapInput
                  gap={q.gaps[i]}
                  value={values[i]}
                  onChange={(v) => setValues((vs) => vs.map((x, k) => (k === i ? v : x)))}
                  onKeyDown={onKey(i)}
                  autoFocus={i === 0}
                  inputRef={(el) => {
                    inputs.current[i] = el;
                  }}
                  label={`Gap ${i + 1} of ${q.gaps.length}: ${q.gaps[i].hiddenLength} missing letters after “${q.gaps[i].visible}”`}
                  disabled={busy}
                />
              )}
            </span>
          ))}
        </p>
        <div className="q-actions">
          <button className="btn primary big" disabled={busy} onClick={() => onSubmit(values, 'submit', false)}>
            Submit paragraph
          </button>
          <span className="muted small">Empty gaps score zero, so type a guess in every gap.</span>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- feedback

function Explain({ title, items, bn }: { title: string; items: Explanation[]; bn: boolean }) {
  if (!items.length) return null;
  return (
    <div className="explain">
      <h4>{title}</h4>
      <ul>
        {items.map((x, i) => (
          <li key={i}>
            {x.en}
            {bn && x.bn && <span className="bn">{x.bn}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useNextKey(onNext: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onNext, enabled]);
}

function resultTitle(g: GapOutcome, timedOut: boolean): { cls: string; text: string } {
  switch (g.result) {
    case 'correct':
      return { cls: 'good', text: g.usedUkVariant ? '✓ Correct (British spelling accepted here)' : '✓ Correct' };
    case 'skipped':
      return { cls: 'neutral', text: 'Skipped — not counted' };
    case 'timeout':
      return { cls: 'bad', text: '⏱ Time is up' };
    case 'unanswered':
      return { cls: 'bad', text: timedOut ? '⏱ Time is up' : 'No answer' };
    default:
      return { cls: 'bad', text: '✕ Not quite' };
  }
}

function GapDetails({ g, word, before, after, mode, bn }: { g: GapOutcome; word: VocabWord; before: string; after: string; mode: string; bn: boolean }) {
  const { store } = useApp();
  const analysis =
    g.result === 'correct' || g.result === 'skipped'
      ? undefined
      : checkGap({ wordId: word.id, contextId: g.contextId, answer: g.correctAnswer, visible: '', hiddenLength: g.correctAnswer.length, ukVariants: word.ukVariants }, g.full, {
          acceptUk: mode === 'fill-blanks',
          familyForms: store.familyForms(word),
          base: word.base,
          ending: word.ending,
        }).analysis;
  const family = store.familyOf(word).filter((w) => w.id !== word.id);
  const clues = contextClues(word, before, after);
  const rules = spellingRules(word);
  return (
    <div className="feedback-body">
      <div className="answer-line">
        {g.result !== 'correct' && g.full && (
          <div className="small">
            You typed: <span className="typed-wrong">{g.full}</span>
          </div>
        )}
        <div>
          Correct spelling: <strong>{g.correctAnswer}</strong>{' '}
          <Link to={wordPath(word.id)} className="small" target="_blank" rel="noreferrer">
            word details ↗
          </Link>
        </div>
      </div>
      {analysis && <Explain title="What went wrong" items={analysis.messages} bn={bn} />}
      <div className="explain">
        <h4>Meaning</h4>
        <div>
          {word.definition || <span className="muted">No definition available.</span>}{' '}
          {word.pos.length > 0 && <span className="muted small">({word.pos.join(', ')})</span>}
        </div>
        {bn && word.bengali && <div className="bn">বাংলা: {word.bengali}</div>}
      </div>
      <Explain title="Why it fits the sentence" items={clues} bn={bn} />
      <Explain title="Spelling pattern" items={rules} bn={bn} />
      {family.length > 0 && (
        <div className="explain">
          <h4>Word family</h4>
          <div>{[word, ...family].map((w) => w.word).join(' · ')}</div>
        </div>
      )}
      <div className="explain">
        <h4>Next review</h4>
        <div className="small">{g.schedule}</div>
      </div>
      {g.becameMastered && <div className="celebrate">🎉 Mastered! “{g.word}” moved to your Completed Checklist.</div>}
      {g.lostMastery && <div className="alert warn">“{g.word}” went back to the Active Practice List after this retention check.</div>}
    </div>
  );
}

function Feedback({ session, outcome, busy, onNext }: { session: SessionRecord; outcome: QuestionOutcome; busy: boolean; onNext: () => void }) {
  const { store } = useApp();
  const settings = useSettings();
  const bn = settings.language === 'en-bn';
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => nextRef.current?.focus(), []);
  useNextKey(onNext, !busy);
  const last = session.index >= session.target;
  const nextBtn = (
    <button ref={nextRef} className="btn primary big" onClick={onNext} disabled={busy}>
      {last ? 'Finish session' : 'Next question'} <kbd>Enter</kbd>
    </button>
  );
  if (outcome.questionId.startsWith('read-complete|')) {
    return <ParagraphFeedback session={session} outcome={outcome} nextBtn={nextBtn} bn={bn} />;
  }
  const g = outcome.gaps[0];
  const word = g ? store.byId.get(g.wordId) : undefined;
  if (!g || !word) return <div className="card">{nextBtn}</div>;
  const t = resultTitle(g, outcome.timedOut);
  const ctx = word.contexts.find((c) => c.id === g.contextId);
  return (
    <>
      <div className="q-card">
        <p className="q-sentence">
          {ctx ? (
            <>
              {ctx.sentence.slice(0, ctx.start)}
              <span className={`gap ${g.result === 'correct' ? 'ok' : 'no'}`}>
                <span className="filled">{ctx.sentence.slice(ctx.start, ctx.end)}</span>
              </span>
              {ctx.sentence.slice(ctx.end)}
            </>
          ) : (
            g.correctAnswer
          )}
        </p>
      </div>
      <section className="feedback" aria-live="polite">
        <div className={`feedback-head ${t.cls}`}>
          {t.text}
          <span className="small muted" style={{ marginLeft: 'auto', fontWeight: 400 }}>
            {secs(outcome.responseMs)}
          </span>
        </div>
        <GapDetails g={g} word={word} before={ctx ? ctx.sentence.slice(0, ctx.start) : ''} after={ctx ? ctx.sentence.slice(ctx.end) : ''} mode={outcome.questionId.split('|')[0]} bn={bn} />
      </section>
      <div className="q-actions">{nextBtn}</div>
    </>
  );
}

function ParagraphFeedback({ session, outcome, nextBtn, bn }: { session: SessionRecord; outcome: QuestionOutcome; nextBtn: JSX.Element; bn: boolean }) {
  const { store } = useApp();
  const p = store.paragraphs.find((x) => outcome.questionId === `read-complete|${x.id}`);
  const [open, setOpen] = useState<number | null>(null);
  if (!p) return <div className="card">{nextBtn}</div>;
  const gaps = outcome.gaps;
  const correct = gaps.filter((g) => g.result === 'correct').length;
  const small = gaps.filter((g) => store.byId.get(g.wordId)?.isSmallWord);
  const smallCorrect = small.filter((g) => g.result === 'correct').length;
  const content = gaps.length - small.length;
  const contentCorrect = correct - smallCorrect;
  let pos = 0;
  const parts: JSX.Element[] = [];
  p.gaps.forEach((gp, i) => {
    parts.push(<span key={`t${i}`}>{p.text.slice(pos, gp.start)}</span>);
    const g = gaps[i];
    parts.push(
      <span key={`g${i}`} className={`gap ${g?.result === 'correct' ? 'ok' : 'no'}`}>
        <button className="filled" style={{ font: 'inherit', cursor: 'pointer', color: 'inherit', border: 0 }} onClick={() => setOpen(i)} title={g && g.result !== 'correct' ? `You typed: ${g.full || '(nothing)'}` : 'Correct'}>
          {p.text.slice(gp.start, gp.end)}
        </button>
      </span>,
    );
    pos = gp.end;
  });
  parts.push(<span key="end">{p.text.slice(pos)}</span>);
  const wrong = gaps.map((g, i) => ({ g, i })).filter(({ g }) => g.result !== 'correct');
  const sel = open !== null ? gaps[open] : undefined;
  const selWord = sel ? store.byId.get(sel.wordId) : undefined;
  const selGap = open !== null ? p.gaps[open] : undefined;
  return (
    <>
      <section className="feedback" aria-live="polite">
        <div className={`feedback-head ${correct === gaps.length ? 'good' : correct / gaps.length >= 0.6 ? 'neutral' : 'bad'}`}>
          {correct}/{gaps.length} words correct ({pct(correct / Math.max(1, gaps.length))})
          {outcome.timedOut && <span className="small">· time ran out</span>}
        </div>
        <div className="feedback-body">
          <div className="small">
            Small grammar words: <strong>{smallCorrect}/{small.length}</strong> · Content words: <strong>{contentCorrect}/{content}</strong>
            {small.length > smallCorrect && <span className="muted"> — small words are the quickest points; fill them first.</span>}
          </div>
          <p className="q-sentence paragraph" style={{ margin: 0 }}>
            {parts}
          </p>
          <p className="tiny muted">Green = correct, red = missed. Select any word to see the explanation.</p>
          {wrong.length > 0 && (
            <div className="explain">
              <h4>Your mistakes</h4>
              <ul>
                {wrong.map(({ g, i }) => (
                  <li key={i}>
                    <button className="btn small ghost" onClick={() => setOpen(i)}>
                      {g.full ? <span className="typed-wrong">{g.full}</span> : <span className="muted">(empty)</span>} → <strong>{g.correctAnswer}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
      {sel && selWord && selGap && (
        <section className="feedback">
          <div className={`feedback-head ${resultTitle(sel, outcome.timedOut).cls}`}>
            {resultTitle(sel, outcome.timedOut).text}: {sel.correctAnswer}
            <button className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
          <GapDetails g={sel} word={selWord} before={p.text.slice(0, selGap.start)} after={p.text.slice(selGap.end)} mode="read-complete" bn={bn} />
        </section>
      )}
      <div className="q-actions">{nextBtn}</div>
      <p className="tiny muted">Session paragraph {session.index} of {session.target}.</p>
    </>
  );
}

// ---------------------------------------------------------------- summary

function Summary({ session, onRestart }: { session: SessionRecord; onRestart: () => Promise<void> }) {
  const { db, store } = useApp();
  const attempts = useLiveQuery(() => db.attempts.where('sessionId').equals(session.id).toArray(), [session.id]);
  const progress = useLiveQuery(() => db.progress.toArray(), []);
  const t = session.tally;
  const graded = t.correct + t.incorrect + t.timeout + t.unanswered;
  const masteredNow = useMemo(() => {
    if (!progress || !attempts) return [];
    const ids = new Set(attempts.map((a) => a.wordId));
    return progress.filter((p) => ids.has(p.wordId) && p.status === 'mastered' && (p.masteredAt ?? 0) >= session.startedAt);
  }, [progress, attempts, session.startedAt]);
  const missed = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attempts ?? []) if (a.result !== 'correct' && a.result !== 'skipped') m.set(a.wordId, (m.get(a.wordId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [attempts]);
  return (
    <div className="stack">
      <div className="card">
        <h1>Session finished</h1>
        <p className="muted">{session.endReason}</p>
        <div className="grid grid-4" style={{ marginTop: 12 }}>
          <div className="stat">
            <span className="label">Accuracy</span>
            <span className="value">{pct(graded ? t.correct / graded : undefined)}</span>
          </div>
          <div className="stat">
            <span className="label">Correct</span>
            <span className="value">{t.correct}</span>
            <span className="sub">
              {t.incorrect} wrong · {t.timeout} timed out · {t.unanswered} empty · {t.skipped} skipped
            </span>
          </div>
          <div className="stat">
            <span className="label">Best streak</span>
            <span className="value">{session.bestStreak}</span>
          </div>
          <div className="stat">
            <span className="label">Newly mastered</span>
            <span className="value">{masteredNow.length}</span>
          </div>
        </div>
      </div>
      {masteredNow.length > 0 && (
        <div className="card">
          <h2>Mastered in this session</h2>
          <p>{masteredNow.map((p) => store.byId.get(p.wordId)?.word).join(', ')}</p>
        </div>
      )}
      {missed.length > 0 && (
        <div className="card">
          <h2>Missed in this session</h2>
          <p className="muted small">These words are already scheduled to come back soon, in different sentences.</p>
          <p>
            {missed.map(([id, n], i) => (
              <span key={id}>
                {i > 0 && ', '}
                <Link to={wordPath(id)}>{store.byId.get(id)?.word ?? id}</Link>
                {n > 1 && <span className="muted"> ×{n}</span>}
              </span>
            ))}
          </p>
        </div>
      )}
      <div className="row">
        <button className="btn primary" onClick={() => void onRestart()}>
          Practice again
        </button>
        <Link to="/practice" className="btn">
          Choose another mode
        </Link>
        <Link to="/" className="btn ghost">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
