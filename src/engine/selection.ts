import { LEVELS, targetLevel } from './adaptive';
import { livePriorityScore } from './priority';
import { mistakes } from './progress';
import type { Context, Difficulty, Paragraph, VocabWord, WordProgress } from './types';

export type SelectionReason = 'mistake-review' | 'second-context' | 'due-review' | 'retention' | 'new' | 'extra-practice' | 'mistake-focus';

export const REASON_TEXT: Record<SelectionReason, string> = {
  'mistake-review': 'Review of a recent mistake',
  'second-context': 'Needs a correct answer in a second sentence',
  'due-review': 'Due for review',
  retention: 'Retention check of a mastered word',
  new: 'New word',
  'extra-practice': 'Extra practice',
  'mistake-focus': 'From your Mistake Bank',
};

export interface SelectionState {
  pool: VocabWord[];
  progress: Map<string, WordProgress>;
  /** Global number of the question about to be asked. */
  seq: number;
  now: number;
  sessionId: string;
  newIntroduced: number;
  reviewsServed: number;
  quotas: { newWords: number; reviews: number };
  level: Difficulty;
  adaptive: boolean;
  retentionReviews: boolean;
  lastWordId?: string;
  focus: 'normal' | 'mistakes';
  rng: () => number;
}

export interface Selection {
  word: VocabWord;
  reason: SelectionReason;
}

function byScore(state: SelectionState) {
  return (a: VocabWord, b: VocabWord) => livePriorityScore(b, state.progress.get(b.id)) - livePriorityScore(a, state.progress.get(a.id));
}

/** Picks one of the first `k` items, so the order is priority-led but not mechanical. */
function pickTop<T>(items: T[], k: number, rng: () => number): T | undefined {
  if (!items.length) return undefined;
  return items[Math.floor(rng() * Math.min(k, items.length))];
}

/**
 * Chooses the next word. Order, most urgent first:
 * 1. words missed or answered once earlier in this session whose short interval has passed;
 * 2. a balanced mix of due reviews (earlier mistakes, second contexts, retention checks) and
 *    high-priority new words, within the session quotas;
 * 3. anything else, so a session never stalls.
 */
export function selectNext(state: SelectionState): Selection | undefined {
  const { pool, progress, seq, now, sessionId, lastWordId, rng } = state;
  const notLast = (w: VocabWord) => w.id !== lastWordId;
  const isDue = (p: WordProgress) => (p.dueSeq === undefined || p.dueSeq <= seq) && (p.nextReviewAt ?? 0) <= now;

  if (state.focus === 'mistakes') {
    const missed = pool.filter((w) => {
      const p = progress.get(w.id);
      return p && mistakes(p) > 0 && notLast(w) && (p.dueSeq === undefined || p.dueSeq <= seq);
    });
    missed.sort((a, b) => {
      const pa = progress.get(a.id)!;
      const pb = progress.get(b.id)!;
      const ma = pa.status === 'mastered' ? 0 : 1;
      const mb = pb.status === 'mastered' ? 0 : 1;
      if (ma !== mb) return mb - ma;
      if (pb.consecutiveIncorrect !== pa.consecutiveIncorrect) return pb.consecutiveIncorrect - pa.consecutiveIncorrect;
      if (mistakes(pb) !== mistakes(pa)) return mistakes(pb) - mistakes(pa);
      return (pb.lastPracticedAt ?? 0) - (pa.lastPracticedAt ?? 0);
    });
    const w = missed[0];
    return w ? { word: w, reason: 'mistake-focus' } : undefined;
  }

  const urgent: VocabWord[] = [];
  const dueLearning: VocabWord[] = [];
  const retention: VocabWord[] = [];
  const fresh: VocabWord[] = [];
  const waiting: VocabWord[] = [];
  for (const w of pool) {
    if (!notLast(w)) continue;
    const p = progress.get(w.id);
    if (!p || p.status === 'new') {
      if (!p || p.dueSeq === undefined || p.dueSeq <= seq) fresh.push(w);
      else waiting.push(w);
      continue;
    }
    if (p.status === 'learning') {
      if (p.lastSessionId === sessionId && p.dueSeq !== undefined && p.dueSeq <= seq) urgent.push(w);
      else if (isDue(p)) dueLearning.push(w);
      else waiting.push(w);
    } else if (p.status === 'mastered' && state.retentionReviews && (p.nextReviewAt ?? Infinity) <= now && (p.dueSeq === undefined || p.dueSeq <= seq)) {
      retention.push(w);
    }
  }

  if (urgent.length) {
    urgent.sort((a, b) => {
      const pa = progress.get(a.id)!;
      const pb = progress.get(b.id)!;
      const overdue = seq - pb.dueSeq! - (seq - pa.dueSeq!);
      return overdue !== 0 ? overdue : livePriorityScore(b, pb) - livePriorityScore(a, pa);
    });
    const p = progress.get(urgent[0].id)!;
    return { word: urgent[0], reason: p.consecutiveIncorrect > 0 ? 'mistake-review' : 'second-context' };
  }

  dueLearning.sort(byScore(state));
  retention.sort((a, b) => (progress.get(a.id)!.nextReviewAt ?? 0) - (progress.get(b.id)!.nextReviewAt ?? 0));
  const reviewQueue: Selection[] = [
    ...dueLearning.map((w) => ({ word: w, reason: (progress.get(w.id)!.consecutiveIncorrect > 0 ? 'mistake-review' : 'due-review') as SelectionReason })),
    ...retention.map((w) => ({ word: w, reason: 'retention' as SelectionReason })),
  ];
  const reviewOpen = state.reviewsServed < state.quotas.reviews && reviewQueue.length > 0;
  const newOpen = state.newIntroduced < state.quotas.newWords && fresh.length > 0;

  const pickNew = (): Selection | undefined => {
    const target = targetLevel(state.level, state.adaptive, rng);
    // Nearest level that still has words, starting from the target.
    const order = [...LEVELS].sort((a, b) => Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(target)) - Math.abs(LEVELS.indexOf(b) - LEVELS.indexOf(target)));
    for (const lvl of order) {
      const cands = fresh.filter((w) => w.difficulty === lvl).sort(byScore(state));
      const w = pickTop(cands, 4, rng);
      if (w) return { word: w, reason: 'new' };
    }
    return undefined;
  };

  if (reviewOpen && newOpen) {
    // Keep the ratio of new to review questions close to the quotas.
    const preferNew = state.newIntroduced * state.quotas.reviews <= state.reviewsServed * state.quotas.newWords;
    return preferNew ? pickNew() ?? reviewQueue[0] : reviewQueue[0];
  }
  if (reviewOpen) return reviewQueue[0];
  if (newOpen) return pickNew();

  // Quotas used up or nothing due: keep the session going.
  if (reviewQueue.length) return { ...reviewQueue[0], reason: reviewQueue[0].reason };
  const extra = pickNew();
  if (extra) return extra;
  waiting.sort((a, b) => (progress.get(a.id)?.dueSeq ?? 0) - (progress.get(b.id)?.dueSeq ?? 0));
  if (waiting.length) return { word: waiting[0], reason: 'extra-practice' };
  const any = pool.filter(notLast);
  const w = pickTop(any, any.length, rng);
  return w ? { word: w, reason: 'extra-practice' } : pool[0] ? { word: pool[0], reason: 'extra-practice' } : undefined;
}

/**
 * Picks a sentence for the word: first one that would add a new distinct
 * context toward mastery, never the sentence used last time when another
 * exists, and preferably one not seen before.
 */
export function chooseContext(w: VocabWord, p: WordProgress | undefined, rng: () => number): Context {
  const ctxs = w.contexts;
  if (ctxs.length <= 1 || !p) return ctxs[Math.floor(rng() * ctxs.length)] ?? ctxs[0];
  let best: Context[] = [];
  let bestScore = -Infinity;
  for (const c of ctxs) {
    let s = 0;
    if (!p.streakContextIds.includes(c.id)) s += 4;
    if (!p.correctContextIds.includes(c.id)) s += 2;
    if (!p.seenContextIds.includes(c.id)) s += 1;
    if (c.id === p.lastContextId) s -= 10;
    if (s > bestScore) {
      bestScore = s;
      best = [c];
    } else if (s === bestScore) best.push(c);
  }
  return best[Math.floor(rng() * best.length)];
}

/**
 * Chooses a Read and Complete paragraph: unseen ones first, near the target
 * difficulty, and preferring paragraphs whose gaps contain words being learned.
 */
export function chooseParagraph(
  paragraphs: Paragraph[],
  served: Record<string, number>,
  progress: Map<string, WordProgress>,
  level: Difficulty,
  rng: () => number,
  exclude: string[] = [],
): Paragraph | undefined {
  const scored = paragraphs
    .filter((p) => !exclude.includes(p.id))
    .map((p) => {
      let s = -3 * (served[p.id] ?? 0);
      s -= Math.abs(LEVELS.indexOf(p.difficulty) - LEVELS.indexOf(level)) * 2;
      for (const g of p.gaps) {
        const pr = progress.get(g.wordId);
        if (pr?.status === 'learning') s += pr.consecutiveIncorrect > 0 ? 1 : 0.5;
      }
      return { p, s: s + rng() };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]?.p;
}
