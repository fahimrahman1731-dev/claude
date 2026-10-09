import { useEffect, useMemo, useRef, useState } from 'react';
import { IR_QUESTION_COUNT, IR_STEPS, tokenize } from '../../engine/interactive';
import type { InteractiveAnswers, InteractiveQuestion, InteractiveSet } from '../../engine/types';
import type { CurrentQuestion, QuestionOutcome } from '../../db/db';
import { useApp } from '../app-context';
import { pct } from '../format';
import { Link, wordPath } from '../router';
import { DetFrame, Timer, useCountdown, type FrameProps } from '../det';

type Kind = 'submit' | 'timeout' | 'skip';

const BLANK_LABEL = 'Select a word';

/** Passage text with paragraph breaks kept. */
function Paras({ children }: { children: React.ReactNode[] }) {
  return <div className="ir-passage-text">{children}</div>;
}

/** Splits [from, to) of the text into <p> blocks at blank lines, calling render for each piece. */
function paragraphs(text: string, from: number, to: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = from;
  const re = /\n\s*\n/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < to) {
    out.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  out.push({ start, end: to });
  return out.filter((p) => p.end > p.start);
}

export function InteractiveView({
  frame,
  q,
  current,
  busy,
  onStep,
  onSubmit,
}: {
  frame: FrameProps;
  q: InteractiveQuestion;
  current: CurrentQuestion;
  busy: boolean;
  onStep: (a: InteractiveAnswers) => void;
  onSubmit: (a: InteractiveAnswers, kind: Kind) => void;
}) {
  const { store } = useApp();
  const set = store.interactive.find((s) => s.id === q.setId);
  const [a, setA] = useState<InteractiveAnswers>(
    () => current.interactive ?? { step: 0, blanks: q.blanks.map(() => null), missing: null, highlights: [null, null], idea: null, title: null },
  );
  const aRef = useRef(a);
  aRef.current = a;
  const remaining = useCountdown(current.startedAt, current.limitMs, () => onSubmit(aRef.current, 'timeout'));
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [a.step]);
  if (!set) {
    return (
      <DetFrame frame={frame} title="Passage not found">
        <p className="muted">This passage is no longer in the library.</p>
        <button className="btn" onClick={() => onSubmit(a, 'skip')}>
          Skip it
        </button>
      </DetFrame>
    );
  }
  const step = IR_STEPS[Math.min(a.step, IR_STEPS.length - 1)];
  const last = a.step >= IR_STEPS.length - 1;
  const answered =
    step.part === 'complete-sentences'
      ? a.blanks.every((x) => x !== null)
      : step.part === 'complete-passage'
        ? a.missing !== null
        : step.part === 'highlight'
          ? !!a.highlights[step.n]
          : step.part === 'main-idea'
            ? a.idea !== null
            : a.title !== null;
  const goNext = () => {
    if (busy) return;
    if (last) onSubmit(a, 'submit');
    else {
      const next = { ...a, step: a.step + 1 };
      setA(next);
      onStep(next);
    }
  };
  const left = IR_QUESTION_COUNT - a.step;
  return (
    <DetFrame
      frame={frame}
      wide
      flush
      timer={<Timer remaining={remaining} limitMs={current.limitMs} unit={left === 1 ? 'for this question' : `for ${left} questions`} />}
      footer={
        <>
          <span className="det-foot-note">
            Question {a.step + 1} of {IR_QUESTION_COUNT} · {step.heading}
            {!answered && step.part === 'complete-sentences' && ' · choose a word for every blank to continue'}
          </span>
          <button type="button" className={`det-submit${answered ? ' ready' : ''}`} disabled={busy || !answered} onClick={goNext}>
            {last ? 'Submit' : 'Continue'}
          </button>
        </>
      }
    >
      <div className="ir-layout">
        <section className="ir-passage" aria-label="Passage">
          <div className="ir-label">Passage</div>
          <PassagePane set={set} q={q} a={a} setA={setA} />
        </section>
        <section className="ir-questions" aria-label="Question">
          <h2 className="ir-instruction" tabIndex={-1} ref={headingRef}>
            {step.instruction}
          </h2>
          <QuestionPane set={set} q={q} a={a} setA={setA} />
        </section>
      </div>
    </DetFrame>
  );
}

// ---------------------------------------------------------------- left side

function PassagePane({ set, q, a, setA }: { set: InteractiveSet; q: InteractiveQuestion; a: InteractiveAnswers; setA: (f: (x: InteractiveAnswers) => InteractiveAnswers) => void }) {
  const step = IR_STEPS[Math.min(a.step, IR_STEPS.length - 1)];
  if (step.part === 'complete-sentences') {
    // Only the first part of the passage is shown, with numbered blanks.
    const nodes: React.ReactNode[] = [];
    for (const [pi, para] of paragraphs(set.text, 0, set.sentencesPartEnd).entries()) {
      const pieces: React.ReactNode[] = [];
      let pos = para.start;
      set.blanks.forEach((b, i) => {
        if (b.start < para.start || b.end > para.end) return;
        pieces.push(set.text.slice(pos, b.start));
        const chosen = a.blanks[i];
        pieces.push(
          <span key={`b${i}`} className={`ir-blank${chosen !== null ? ' filled' : ''}`}>
            <span className="ir-num">{i + 1}</span>
            {chosen !== null ? q.blanks[i].options[chosen] : ''}
          </span>,
        );
        pos = b.end;
      });
      pieces.push(set.text.slice(pos, para.end));
      nodes.push(<p key={pi}>{pieces}</p>);
    }
    return <Paras>{nodes}</Paras>;
  }
  if (step.part === 'complete-passage') {
    const nodes = paragraphs(set.text, 0, set.text.length).map((para, pi) => {
      if (set.missing.start >= para.end || set.missing.end <= para.start) return <p key={pi}>{set.text.slice(para.start, para.end)}</p>;
      return (
        <p key={pi}>
          {set.text.slice(para.start, set.missing.start)}
          <span className={`ir-missing${a.missing !== null ? ' filled' : ''}`}>{a.missing !== null ? q.missing.options[a.missing] : ' '}</span>
          {set.text.slice(set.missing.end, para.end)}
        </p>
      );
    });
    return <Paras>{nodes}</Paras>;
  }
  if (step.part === 'highlight') {
    return (
      <Highlighter
        key={step.n}
        text={set.text}
        value={a.highlights[step.n]}
        onChange={(v) => setA((x) => ({ ...x, highlights: x.highlights.map((h, k) => (k === step.n ? v : h)) }))}
      />
    );
  }
  return <Paras>{paragraphs(set.text, 0, set.text.length).map((para, pi) => <p key={pi}>{set.text.slice(para.start, para.end)}</p>)}</Paras>;
}

/**
 * Highlight by dragging across words with a mouse, or by tapping the first and
 * then the last word on a touch screen.
 */
function Highlighter({ text, value, onChange }: { text: string; value: { start: number; end: number } | null; onChange: (v: { start: number; end: number } | null) => void }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const paras = useMemo(() => paragraphs(text, 0, text.length), [text]);
  const drag = useRef<{ anchor: number; pointer: string } | null>(null);
  const [pendingTap, setPendingTap] = useState<number | null>(null);
  const range = useMemo(() => {
    if (!value) return null;
    const a = tokens.findIndex((t) => t.end > value.start);
    let b = -1;
    for (let i = tokens.length - 1; i >= 0; i--)
      if (tokens[i].start < value.end) {
        b = i;
        break;
      }
    return a >= 0 && b >= a ? [a, b] : null;
  }, [value, tokens]);
  const setRange = (i: number, j: number) => {
    const [x, y] = i <= j ? [i, j] : [j, i];
    onChange({ start: tokens[x].start, end: tokens[y].end });
  };
  const indexAt = (e: React.PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const i = el?.closest('[data-i]')?.getAttribute('data-i');
    return i === null || i === undefined ? -1 : Number(i);
  };
  const down = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    if (e.pointerType !== 'mouse' && pendingTap !== null) {
      setRange(pendingTap, i);
      setPendingTap(null);
      return;
    }
    if (e.pointerType === 'mouse' && e.shiftKey && range) {
      setRange(range[0], i);
      return;
    }
    drag.current = { anchor: i, pointer: e.pointerType };
    setRange(i, i);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.pointer !== 'mouse' || !(e.buttons & 1)) return;
    const i = indexAt(e);
    if (i >= 0) setRange(drag.current.anchor, i);
  };
  const up = () => {
    if (drag.current && drag.current.pointer !== 'mouse') setPendingTap(drag.current.anchor);
    drag.current = null;
  };
  useEffect(() => {
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });
  let k = 0;
  return (
    <div className="ir-passage-text highlightable" onPointerMove={move}>
      {paras.map((para, pi) => {
        const words: React.ReactNode[] = [];
        while (k < tokens.length && tokens[k].start < para.end) {
          const i = k;
          const on = range && i >= range[0] && i <= range[1];
          const joined = range && i > range[0] && i <= range[1];
          words.push(
            <span key={i}>
              {i > 0 && tokens[i - 1].end < para.start ? '' : i > 0 ? <span className={joined ? 'hl' : undefined}> </span> : null}
              <span data-i={i} className={`tok${on ? ' hl' : ''}${pendingTap === i ? ' anchor' : ''}`} onPointerDown={down(i)}>
                {text.slice(tokens[i].start, tokens[i].end)}
              </span>
            </span>,
          );
          k++;
        }
        return <p key={pi}>{words}</p>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------- right side

function Choice({ name, options, value, onChange }: { name: string; options: string[]; value: number | null; onChange: (i: number) => void }) {
  return (
    <div className="ir-options" role="radiogroup" aria-label={name}>
      {options.map((o, i) => (
        <label key={i} className={`ir-option${value === i ? ' on' : ''}`}>
          <input type="radio" name={name} checked={value === i} onChange={() => onChange(i)} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

function QuestionPane({ set, q, a, setA }: { set: InteractiveSet; q: InteractiveQuestion; a: InteractiveAnswers; setA: (f: (x: InteractiveAnswers) => InteractiveAnswers) => void }) {
  const step = IR_STEPS[Math.min(a.step, IR_STEPS.length - 1)];
  switch (step.part) {
    case 'complete-sentences':
      return (
        <ol className="ir-selects">
          {q.blanks.map((b, i) => (
            <li key={i}>
              <span className="ir-num">{i + 1}</span>
              <select
                aria-label={`Missing word ${i + 1}`}
                value={a.blanks[i] ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  setA((x) => ({ ...x, blanks: x.blanks.map((y, k) => (k === i ? v : y)) }));
                }}
              >
                <option value="">{BLANK_LABEL}</option>
                {b.options.map((o, k) => (
                  <option key={k} value={k}>
                    {o}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ol>
      );
    case 'complete-passage':
      return <Choice name="Missing sentence" options={q.missing.options} value={a.missing} onChange={(i) => setA((x) => ({ ...x, missing: i }))} />;
    case 'highlight': {
      const h = a.highlights[step.n];
      return (
        <div className="stack">
          <p className="ir-question">{set.highlights[step.n]?.question}</p>
          <div className="ir-answer-box" aria-live="polite">
            <span className="tiny muted">Your answer</span>
            <div>{h ? set.text.slice(h.start, h.end) : <span className="muted">Click and drag to highlight text (on a phone: tap the first word, then the last).</span>}</div>
          </div>
          {h && (
            <button type="button" className="btn small" onClick={() => setA((x) => ({ ...x, highlights: x.highlights.map((v, k) => (k === step.n ? null : v)) }))}>
              Clear highlight
            </button>
          )}
        </div>
      );
    }
    case 'main-idea':
      return <Choice name="Main idea" options={q.idea.options} value={a.idea} onChange={(i) => setA((x) => ({ ...x, idea: i }))} />;
    case 'title':
      return <Choice name="Title" options={q.titles.options} value={a.title} onChange={(i) => setA((x) => ({ ...x, title: i }))} />;
  }
}

// ---------------------------------------------------------------- feedback

const PART_NAME: Record<string, string> = {
  'complete-passage': 'Complete the Passage',
  highlight: 'Highlight the Answer',
  'main-idea': 'Identify the Idea',
  title: 'Title the Passage',
};

export function InteractiveFeedback({ outcome, bn }: { outcome: QuestionOutcome; bn: boolean }) {
  const { store } = useApp();
  const setId = outcome.questionId.split('|')[1];
  const set = store.interactive.find((s) => s.id === setId);
  if (!set) return <p className="muted">This passage is no longer in the library.</p>;
  const blanks = outcome.gaps;
  const parts = outcome.parts ?? [];
  const correct = blanks.filter((g) => g.result === 'correct').length + parts.filter((p) => p.correct).length;
  // CS blanks were scored right/wrong; Highlight the Answer gives partial credit.
  const total = blanks.length + parts.length;
  return (
    <div className="stack">
      <div className={`feedback-head ${correct === total ? 'good' : correct / total >= 0.6 ? 'neutral' : 'bad'}`} style={{ borderRadius: 10 }}>
        {correct}/{total} correct ({pct(correct / Math.max(1, total))}){outcome.timedOut && <span className="small">· time ran out</span>}
      </div>
      <div className="ir-layout">
        <section className="ir-passage">
          <div className="ir-label">Passage — {set.titles.answer}</div>
          <div className="ir-passage-text">
            {paragraphs(set.text, 0, set.text.length).map((para, pi) => {
              const marks = [
                ...set.blanks.map((b, i) => ({ start: b.start, end: b.end, cls: blanks[i]?.result === 'correct' ? 'ok' : 'no', label: String(i + 1) })),
                ...set.highlights.slice(0, 2).map((h, n) => ({ start: h.start, end: h.end, cls: 'key', label: `H${n + 1}` })),
                { start: set.missing.start, end: set.missing.end, cls: 'sent', label: 'S' },
              ]
                .filter((m) => m.start >= para.start && m.end <= para.end)
                .sort((x, y) => x.start - y.start);
              const out: React.ReactNode[] = [];
              let pos = para.start;
              for (const m of marks) {
                if (m.start < pos) continue;
                out.push(set.text.slice(pos, m.start));
                out.push(
                  <mark key={`${m.label}-${m.start}`} className={`ir-mark ${m.cls}`} title={m.label}>
                    {set.text.slice(m.start, m.end)}
                  </mark>,
                );
                pos = m.end;
              }
              out.push(set.text.slice(pos, para.end));
              return <p key={pi}>{out}</p>;
            })}
          </div>
          <p className="tiny muted">
            Source: {set.source.title}
            {set.source.author ? `, ${set.source.author}` : ''} ({set.source.license}){set.source.note ? ` — ${set.source.note}` : ''}
          </p>
        </section>
        <section className="ir-questions stack">
          <div className="explain">
            <h4>Complete the Sentences</h4>
            <ol className="ir-review">
              {set.blanks.map((b, i) => {
                const g = blanks[i];
                const chosen = outcome.blankChoices?.[i] ?? null;
                const ok = g?.result === 'correct';
                const w = b.wordId ? store.byId.get(b.wordId) : undefined;
                return (
                  <li key={i} className={ok ? 'ok' : 'no'}>
                    {ok ? '✓' : '✕'} <strong>{b.answer}</strong>
                    {!ok && <span className="muted"> — you chose {chosen ? <span className="typed-wrong">{chosen}</span> : 'nothing'}</span>}
                    {w && (
                      <>
                        {' '}
                        <Link to={wordPath(w.id)} className="tiny">
                          word
                        </Link>
                        {bn && w.bengali && <span className="bn"> · {w.bengali}</span>}
                      </>
                    )}
                    {b.why && <div className="tiny muted">{b.why}</div>}
                  </li>
                );
              })}
            </ol>
          </div>
          {parts.map((p, i) => (
            <div key={i} className="explain">
              <h4>
                {p.correct ? '✓' : '✕'} {PART_NAME[p.part]}
                {p.part === 'highlight' ? ` ${p.n + 1} — score ${(p.score ?? (p.correct ? 1 : 0)).toFixed(2)} of 1` : ''}
              </h4>
              {p.part === 'highlight' && <div className="small">{set.highlights[p.n]?.question}</div>}
              {!p.correct && (
                <div className="small">
                  Your answer: {p.chosen ? <span className="typed-wrong">{p.chosen}</span> : <span className="muted">none</span>}
                </div>
              )}
              <div className="small">
                Answer: <strong>{p.expected}</strong>
              </div>
              {p.part === 'complete-passage' && set.missing.why && <div className="tiny muted">{set.missing.why}</div>}
              {p.part === 'main-idea' && set.idea.why && <div className="tiny muted">{set.idea.why}</div>}
              {p.part === 'title' && set.titles.why && <div className="tiny muted">{set.titles.why}</div>}
            </div>
          ))}
          <p className="tiny muted">Choosing a missing word from options is recorded, but words are mastered by spelling them (Fill in the Blanks and Read and Complete).</p>
        </section>
      </div>
    </div>
  );
}
