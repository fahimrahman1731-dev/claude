import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkGap } from '../../engine/answer';
import { contextClues } from '../../engine/clues';
import { inModePool } from '../../engine/questions';
import { REASON_TEXT } from '../../engine/selection';
import { spellingRules, type Explanation } from '../../engine/spelling';
import type { InteractiveAnswers, Mode, ParagraphQuestion, SentenceQuestion, VocabWord } from '../../engine/types';
import type { GapOutcome, QuestionOutcome, SessionFocus, SessionRecord } from '../../db/db';
import { SaveError } from '../../services/practice';
import { useApp, useSettings } from '../app-context';
import { pct, secs } from '../format';
import { Link, navigate, wordPath } from '../router';
import { playTone } from '../sound';
import { LetterBoxes } from '../LetterBoxes';
import { InteractiveFeedback, InteractiveView } from './Interactive';
import { DetFrame, Timer, useCountdown, type FrameProps } from '../det';

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
    async (answers: string[], kind: Kind, hintUsed: boolean, interactive?: InteractiveAnswers) => {
      if (!session?.current || lock.current) return;
      lock.current = true;
      setBusy(true);
      setSaveError(null);
      try {
        const r = await service.submit(session.id, { questionId: session.current.question.id, answers, kind, hintUsed, interactive });
        setSession({ ...r.session });
        const settings = await service.getSettings();
        if (settings.sound && kind !== 'skip') playTone(r.outcome.gaps.every((g) => g.result === 'correct') ? 'good' : 'bad');
        for (const g of r.outcome.gaps) {
          if (g.becameMastered) notify(`“${g.word}” mastered and moved to the Completed Checklist.`, 'success');
          else if (g.lostMastery) notify(`“${g.word}” left the Completed Checklist and is now in your Mistake Bank.`, 'info');
        }
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

  const startNew = async (opts: { mode: Mode; focus: SessionFocus }) => {
    try {
      setSession(await service.startSession(opts));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

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

  if (session.status !== 'active') {
    return (
      <div className="det-shell">
        <main className="det-page">
          {saveError && <SaveErrorBox message={saveError} onReload={() => void load()} />}
          <Summary
            session={session}
            onRestart={() => startNew({ mode: session.mode, focus: session.focus === 'words' ? 'normal' : session.focus })}
            onPracticeMistakes={() => startNew({ mode: 'spelling', focus: 'mistakes' })}
          />
        </main>
      </div>
    );
  }
  const frame = { session, onEnd: () => void end() };
  return (
    <div className="det-shell">
      <main className="det-page">
        {saveError && <SaveErrorBox message={saveError} onReload={() => void load()} />}
        {session.current ? (
          session.current.question.kind === 'sentence' ? (
            <SentenceView key={session.current.question.id + session.index} frame={frame} q={session.current.question} busy={busy} onSubmit={submit} />
          ) : session.current.question.kind === 'paragraph' ? (
            <ParagraphView key={session.current.question.id + session.index} frame={frame} q={session.current.question} busy={busy} onSubmit={submit} />
          ) : (
            <InteractiveView
              key={session.current.question.id + session.index}
              frame={frame}
              q={session.current.question}
              current={session.current}
              busy={busy}
              onStep={(partial) => void service.saveInteractiveStep(session.id, session.current!.question.id, partial).catch(() => undefined)}
              onSubmit={(ir, kind) => submit([], kind, false, ir)}
            />
          )
        ) : session.lastOutcome ? (
          <Feedback frame={frame} outcome={session.lastOutcome} busy={busy} onNext={next} />
        ) : (
          <DetFrame frame={frame} title="Ready">
            <button className="btn primary" onClick={() => void next()}>
              Continue
            </button>
          </DetFrame>
        )}
      </main>
    </div>
  );
}

function SaveErrorBox({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <div className="alert error" role="alert" style={{ marginBottom: 14 }}>
      <strong>Progress not saved.</strong> {message}{' '}
      <button className="btn small" onClick={onReload}>
        Reload session
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- sentence question

const TITLES: Record<SentenceQuestion['mode'], string> = {
  'fill-blanks': 'Complete the sentence with the correct word',
  spelling: 'Type the missing letters to complete the word',
  'small-words': 'Complete the sentence with the correct word',
  endings: 'Type the missing ending of the word',
};

function SentenceView({ frame, q, busy, onSubmit }: { frame: FrameProps; q: SentenceQuestion; busy: boolean; onSubmit: (a: string[], k: Kind, hint: boolean) => void }) {
  const { store } = useApp();
  const settings = useSettings();
  const word = store.byId.get(q.wordId);
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  valueRef.current = value;
  const cur = frame.session.current!;
  const remaining = useCountdown(cur.startedAt, cur.limitMs, () => onSubmit([valueRef.current], 'timeout', false));
  const bnBefore = settings.language === 'en-bn' && settings.bengaliBeforeAnswer && !!word?.bengali;
  const submit = () => {
    if (!busy) onSubmit([value], 'submit', false);
  };
  return (
    <DetFrame
      frame={frame}
      timer={<Timer remaining={remaining} limitMs={cur.limitMs} />}
      title={TITLES[q.mode]}
      footer={
        <>
          {settings.showSkip && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => onSubmit([value], 'skip', false)}>
              Skip
            </button>
          )}
          <span className="det-foot-note">{REASON_TEXT[cur.reason] ?? ''}</span>
          <button type="button" className={`det-submit${value ? ' ready' : ''}`} disabled={busy} onClick={submit}>
            Submit
          </button>
        </>
      }
    >
      <p className="det-sentence">
        {q.before}
        <LetterBoxes
          given={q.gap.visible}
          length={q.gap.hiddenLength}
          value={value}
          onChange={setValue}
          onEnter={submit}
          autoFocus
          disabled={busy}
          label={`Missing letters: ${q.gap.hiddenLength} letters after “${q.gap.visible}”`}
        />
        {q.after}
      </p>
      {q.baseHint && (
        <p className="det-note">
          Base verb: <strong>{q.baseHint}</strong> (irregular)
        </p>
      )}
      {bnBefore && <p className="det-note bn">বাংলা: {word!.bengali}</p>}
    </DetFrame>
  );
}

// ---------------------------------------------------------------- paragraph question

function ParagraphView({ frame, q, busy, onSubmit }: { frame: FrameProps; q: ParagraphQuestion; busy: boolean; onSubmit: (a: string[], k: Kind, hint: boolean) => void }) {
  const [values, setValues] = useState<string[]>(() => q.gaps.map(() => ''));
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const cur = frame.session.current!;
  const remaining = useCountdown(cur.startedAt, cur.limitMs, () => onSubmit(valuesRef.current, 'timeout', false));
  const filled = values.filter((v) => v.trim()).length;
  const submit = () => {
    if (!busy) onSubmit(valuesRef.current, 'submit', false);
  };
  const focusGap = (i: number, enter: 'start' | 'end') => {
    const el = inputs.current[i];
    if (!el) return;
    el.dataset.enter = enter;
    el.focus();
  };
  return (
    <DetFrame
      frame={frame}
      timer={<Timer remaining={remaining} limitMs={cur.limitMs} />}
      title="Complete the text with the correct words"
      footer={
        <>
          <span className="det-foot-note">
            {filled}/{q.gaps.length} words typed
          </span>
          <button type="button" className={`det-submit${filled ? ' ready' : ''}`} disabled={busy} onClick={submit}>
            Submit
          </button>
        </>
      }
    >
      <h2 className="det-passage-title">{q.title}</h2>
      <p className="det-paragraph">
        {q.segments.map((seg, i) => (
          <span key={i}>
            {seg}
            {i < q.gaps.length && (
              <LetterBoxes
                given={q.gaps[i].visible}
                length={q.gaps[i].hiddenLength}
                value={values[i]}
                onChange={(v) => setValues((vs) => vs.map((x, k) => (k === i ? v : x)))}
                onFilled={() => focusGap(i + 1, 'start')}
                onBackspaceEmpty={i > 0 ? () => focusGap(i - 1, 'end') : undefined}
                onEnter={() => (i < q.gaps.length - 1 ? focusGap(i + 1, 'start') : submit())}
                autoFocus={i === 0}
                inputRef={(el) => {
                  inputs.current[i] = el;
                }}
                label={`Word ${i + 1} of ${q.gaps.length}: ${q.gaps[i].hiddenLength} missing letters after “${q.gaps[i].visible}”`}
                disabled={busy}
              />
            )}
          </span>
        ))}
      </p>
    </DetFrame>
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
      if (e.key === 'Enter' && !e.repeat && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
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
      {g.schedule && (
        <div className="explain">
          <h4>What happens now</h4>
          <div className="small">{g.schedule}</div>
        </div>
      )}
      {g.becameMastered && <div className="celebrate">🎉 Mastered! “{g.word}” moved to your Completed Checklist.</div>}
      {g.lostMastery && <div className="alert warn">“{g.word}” left the Completed Checklist and is now in your Mistake Bank.</div>}
    </div>
  );
}

function Feedback({ frame, outcome, busy, onNext }: { frame: FrameProps; outcome: QuestionOutcome; busy: boolean; onNext: () => void }) {
  const { store } = useApp();
  const settings = useSettings();
  const bn = settings.language === 'en-bn';
  const nextRef = useRef<HTMLButtonElement>(null);
  // The feedback appears while the answer is still being saved (button disabled); focus it once enabled.
  useEffect(() => {
    if (!busy) nextRef.current?.focus();
  }, [busy]);
  useNextKey(onNext, !busy);
  const { session } = frame;
  const last = session.index >= session.target;
  const kind = outcome.questionId.split('|')[0];
  const nextBtn = (
    <button
      ref={nextRef}
      className="det-submit ready"
      onClick={onNext}
      // A held-down Enter from the question would otherwise press this button too.
      onKeyDown={(e) => e.key === 'Enter' && e.repeat && e.preventDefault()}
      disabled={busy}
    >
      {last ? 'Finish session' : kind === 'read-complete' ? 'Next paragraph' : kind === 'interactive-reading' ? 'Next passage' : 'Next question'} <kbd>Enter</kbd>
    </button>
  );
  if (kind === 'read-complete') {
    return (
      <DetFrame frame={frame} title="Your answers" footer={nextBtn}>
        <ParagraphFeedback outcome={outcome} bn={bn} />
      </DetFrame>
    );
  }
  if (kind === 'interactive-reading') {
    return (
      <DetFrame frame={frame} title="Your answers" footer={nextBtn} wide>
        <InteractiveFeedback outcome={outcome} bn={bn} />
      </DetFrame>
    );
  }
  const g = outcome.gaps[0];
  const word = g ? store.byId.get(g.wordId) : undefined;
  if (!g || !word) return <DetFrame frame={frame} footer={nextBtn}>{null}</DetFrame>;
  const t = resultTitle(g, outcome.timedOut);
  const ctx = word.contexts.find((c) => c.id === g.contextId);
  return (
    <DetFrame frame={frame} footer={nextBtn}>
      <p className="det-sentence">
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
      {ctx?.src && <SourceLine src={ctx.src} />}
      <section className="feedback" aria-live="polite">
        <div className={`feedback-head ${t.cls}`}>
          {t.text}
          <span className="small muted" style={{ marginLeft: 'auto', fontWeight: 400 }}>
            {secs(outcome.responseMs)}
          </span>
        </div>
        <GapDetails g={g} word={word} before={ctx ? ctx.sentence.slice(0, ctx.start) : ''} after={ctx ? ctx.sentence.slice(ctx.end) : ''} mode={kind} bn={bn} />
      </section>
    </DetFrame>
  );
}

function ParagraphFeedback({ outcome, bn }: { outcome: QuestionOutcome; bn: boolean }) {
  const { store } = useApp();
  const p = store.paragraphs.find((x) => outcome.questionId === `read-complete|${x.id}`);
  const [open, setOpen] = useState<number | null>(null);
  if (!p) return <p className="muted">This paragraph is no longer in the library.</p>;
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
  const masteredNow = gaps.filter((g) => g.becameMastered).length;
  const toBank = new Set(gaps.filter((g) => g.wordId && (g.result === 'incorrect' || g.result === 'timeout' || g.result === 'unanswered')).map((g) => g.wordId)).size;
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
          {(masteredNow > 0 || toBank > 0) && (
            <div className="small">
              Newly mastered: <strong>{masteredNow}</strong> · Saved to your Mistake Bank: <strong>{toBank}</strong>
            </div>
          )}
          <h2 className="det-passage-title">{p.title}</h2>
          <p className="det-paragraph" style={{ margin: 0 }}>
            {parts}
          </p>
          <p className="tiny muted">Green = correct, red = missed. Select any word to see the explanation.</p>
          {p.src && <SourceLine src={p.src} />}
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
    </>
  );
}

/** Where a real sentence or text comes from (title, author, licence). */
function SourceLine({ src }: { src: string }) {
  const { store } = useApp();
  const cr = store.credit(src);
  if (!cr) return null;
  return (
    <p className="tiny muted" style={{ textAlign: 'center' }}>
      Source:{' '}
      {cr.url ? (
        <a href={cr.url} target="_blank" rel="noreferrer">
          {cr.label}
        </a>
      ) : (
        cr.label
      )}
    </p>
  );
}

// ---------------------------------------------------------------- summary

function Summary({ session, onRestart, onPracticeMistakes }: { session: SessionRecord; onRestart: () => Promise<void>; onPracticeMistakes: () => Promise<void> }) {
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
  /** Words missed in this session that are still in the Mistake Bank (not ones mastered again since). */
  const missed = useMemo(() => {
    const status = new Map((progress ?? []).map((p) => [p.wordId, p.status]));
    const m = new Map<string, number>();
    for (const a of attempts ?? []) if (a.result !== 'correct' && a.result !== 'skipped' && status.get(a.wordId) === 'learning') m.set(a.wordId, (m.get(a.wordId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [attempts, progress]);
  /** Words in the Mistake Bank now (from any session). */
  const toFix = useMemo(() => (progress ?? []).filter((p) => p.status === 'learning' && store.byId.has(p.wordId)).length, [progress, store]);
  /** New words still to ask in this skill (word drills only: texts and passages can be repeated). */
  const newLeft = useMemo(() => {
    if (session.focus !== 'normal' || session.mode === 'read-complete' || session.mode === 'interactive-reading') return Infinity;
    const status = new Map((progress ?? []).map((p) => [p.wordId, p.status]));
    return store.words.filter((w) => inModePool(w, session.mode) && (status.get(w.id) ?? 'new') === 'new').length;
  }, [progress, store, session.focus, session.mode]);
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
          <h2>{session.focus === 'mistakes' ? 'Fixed in this session' : 'Mastered in this session'}</h2>
          <p>{masteredNow.map((p) => store.byId.get(p.wordId)?.word).join(', ')}</p>
        </div>
      )}
      {missed.length > 0 && (
        <div className="card">
          <h2>Missed in this session</h2>
          <p className="muted small">
            {session.focus === 'mistakes'
              ? 'These words stay in your Mistake Bank. Practice them again: one correct answer masters a word.'
              : 'These words are now in your Mistake Bank. They will not come back by themselves: fix them in Practice My Mistakes, where one correct answer masters a word.'}
          </p>
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
        {session.focus === 'mistakes' ? (
          <button className="btn primary" disabled={!toFix} onClick={() => void onRestart()}>
            {toFix ? `Practice My Mistakes again (${toFix} to fix)` : 'Nothing left to fix'}
          </button>
        ) : (
          <>
            {newLeft > 0 && (
              <button className="btn primary" onClick={() => void onRestart()}>
                Practice again
              </button>
            )}
            {toFix > 0 && (
              <button className="btn" onClick={() => void onPracticeMistakes()}>
                Practice My Mistakes ({toFix} to fix)
              </button>
            )}
          </>
        )}
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
