import type { Difficulty, InteractiveAnswers, InteractiveQuestion, InteractiveSet, IrPart, IrServedChoice } from './types';

/**
 * Interactive Reading: one passage, six questions, one shared timer.
 * The order and instructions follow the official DET format.
 */
export interface IrStep {
  part: IrPart;
  /** Which question of this part (the passage has two "Highlight the Answer" questions). */
  n: number;
  heading: string;
  instruction: string;
}

/**
 * Order and on-screen wording from the DET Technical Manual (2026) and Duolingo
 * Research Report DRR-22-02: Complete the Sentences, Complete the Passage, two
 * Highlight the Answer questions, Identify the Idea, Title the Passage.
 */
export const IR_STEPS: IrStep[] = [
  { part: 'complete-sentences', n: 0, heading: 'Complete the Sentences', instruction: 'Select the best option for each missing word' },
  { part: 'complete-passage', n: 0, heading: 'Complete the Passage', instruction: 'Select the best sentence to complete the passage' },
  { part: 'highlight', n: 0, heading: 'Highlight the Answer', instruction: 'Highlight text in the passage to answer the question below' },
  { part: 'highlight', n: 1, heading: 'Highlight the Answer', instruction: 'Highlight text in the passage to answer the question below' },
  { part: 'main-idea', n: 0, heading: 'Identify the Idea', instruction: 'Select the idea that is expressed in the passage' },
  { part: 'title', n: 0, heading: 'Title the Passage', instruction: 'Select the best title for the passage' },
];

/** DET timing: one passage gets 7 minutes, the one with more missing words 8 minutes. */
export function interactiveSeconds(set: { blanks: unknown[] }): number {
  return set.blanks.length >= 7 ? 480 : 420;
}

export const IR_QUESTION_COUNT = IR_STEPS.length;

/** Shuffles the right option in among the wrong ones. */
export function serveChoice(answer: string, distractors: string[], rng: () => number): IrServedChoice {
  const options = [answer, ...distractors.filter((d) => d !== answer)];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { options, answer: options.indexOf(answer) };
}

export function interactiveQuestion(set: InteractiveSet, rng: () => number): InteractiveQuestion {
  return {
    kind: 'interactive',
    id: `interactive-reading|${set.id}`,
    mode: 'interactive-reading',
    setId: set.id,
    difficulty: set.difficulty,
    origin: 'interactive',
    blanks: set.blanks.map((b) => serveChoice(b.answer, b.distractors, rng)),
    missing: serveChoice(set.text.slice(set.missing.start, set.missing.end), set.missing.distractors, rng),
    idea: serveChoice(set.idea.answer, set.idea.distractors, rng),
    titles: serveChoice(set.titles.answer, set.titles.distractors, rng),
  };
}

export function emptyInteractiveAnswers(q: InteractiveQuestion): InteractiveAnswers {
  return { step: 0, blanks: q.blanks.map(() => null), missing: null, highlights: [null, null], idea: null, title: null };
}

/**
 * Highlight the Answer is graded from 0 to 1 by how far the chosen start and end
 * are from the expected ones. Duolingo treats a selection as a point (start, end)
 * and lowers the grade with the distance; the exact formula is not published.
 * Approximation used here (in words): 1 for an exact match, otherwise
 * max(0, 1 − distance / max(4, answer length)).
 */
export function highlightScore(text: string, chosen: { start: number; end: number } | null, key: { start: number; end: number }): number {
  if (!chosen || chosen.end <= chosen.start) return 0;
  const tokens = tokenize(text);
  const first = (pos: number) => {
    const i = tokens.findIndex((t) => t.end > pos);
    return i < 0 ? tokens.length - 1 : i;
  };
  const last = (pos: number) => {
    for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].start < pos) return i;
    return 0;
  };
  const ks = first(key.start);
  const ke = last(key.end);
  const d = Math.hypot(first(chosen.start) - ks, last(chosen.end) - ke);
  if (d === 0) return 1;
  return Math.max(0, Math.round((1 - d / Math.max(4, ke - ks + 1)) * 100) / 100);
}

/** A highlight counts as right in the tallies when it scores at least 0.8 (at most about one word off at each end). */
export const HIGHLIGHT_PASS = 0.8;

export interface InteractiveScore {
  blanks: boolean[];
  parts: { part: IrPart; n: number; correct: boolean; score: number; answered: boolean; chosen: string; expected: string }[];
  correct: number;
  total: number;
}

export function scoreInteractive(set: InteractiveSet, q: InteractiveQuestion, a: InteractiveAnswers): InteractiveScore {
  const blanks = q.blanks.map((b, i) => a.blanks[i] !== null && a.blanks[i] === b.answer);
  const opt = (c: IrServedChoice, i: number | null) => (i === null ? '' : (c.options[i] ?? ''));
  const parts: InteractiveScore['parts'] = [
    {
      part: 'complete-passage',
      n: 0,
      correct: a.missing === q.missing.answer,
      score: a.missing === q.missing.answer ? 1 : 0,
      answered: a.missing !== null,
      chosen: opt(q.missing, a.missing),
      expected: q.missing.options[q.missing.answer],
    },
    ...set.highlights.slice(0, 2).map((h, n) => {
      const chosen = a.highlights[n] ?? null;
      const score = highlightScore(set.text, chosen, h);
      return {
        part: 'highlight' as const,
        n,
        correct: score >= HIGHLIGHT_PASS,
        score,
        answered: !!chosen,
        chosen: chosen ? set.text.slice(chosen.start, chosen.end) : '',
        expected: set.text.slice(h.start, h.end),
      };
    }),
    { part: 'main-idea', n: 0, correct: a.idea === q.idea.answer, score: a.idea === q.idea.answer ? 1 : 0, answered: a.idea !== null, chosen: opt(q.idea, a.idea), expected: q.idea.options[q.idea.answer] },
    { part: 'title', n: 0, correct: a.title === q.titles.answer, score: a.title === q.titles.answer ? 1 : 0, answered: a.title !== null, chosen: opt(q.titles, a.title), expected: q.titles.options[q.titles.answer] },
  ];
  const correct = blanks.filter(Boolean).length + parts.filter((p) => p.correct).length;
  return { blanks, parts, correct, total: blanks.length + parts.length };
}

/**
 * Picks the next passage: never one already used in this session, then the
 * least-served ones, preferring the student's level.
 */
export function chooseInteractive(
  sets: InteractiveSet[],
  served: Record<string, number>,
  level: Difficulty,
  rng: () => number,
  exclude: string[] = [],
): InteractiveSet | undefined {
  let pool = sets.filter((s) => !exclude.includes(s.id));
  if (!pool.length) return undefined;
  // Like the DET, alternate narrative and expository passages within a session.
  const lastGenre = sets.find((s) => s.id === exclude[exclude.length - 1])?.genre;
  if (lastGenre && pool.some((s) => s.genre !== lastGenre)) pool = pool.filter((s) => s.genre !== lastGenre);
  const order: Difficulty[] = level === 'easy' ? ['easy', 'intermediate', 'advanced'] : level === 'intermediate' ? ['intermediate', 'easy', 'advanced'] : ['advanced', 'intermediate', 'easy'];
  const minServed = Math.min(...pool.map((s) => served[s.id] ?? 0));
  const fresh = pool.filter((s) => (served[s.id] ?? 0) === minServed);
  for (const d of order) {
    const atLevel = fresh.filter((s) => s.difficulty === d);
    if (atLevel.length) return atLevel[Math.floor(rng() * atLevel.length)];
  }
  return fresh[Math.floor(rng() * fresh.length)];
}

/** Splits text into word tokens with their offsets (used for highlighting). */
export function tokenize(text: string, from = 0, to = text.length): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /\S+/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < to) out.push({ start: m.index, end: Math.min(to, m.index + m[0].length) });
  return out;
}
