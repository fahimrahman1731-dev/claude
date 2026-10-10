import { LEVELS, targetLevel } from './adaptive';
import { livePriorityScore } from './priority';
import { mistakes } from './progress';
import type { Context, Difficulty, Paragraph, VocabWord, WordProgress } from './types';

export type SelectionReason = 'new' | 'mistake-focus' | 'chosen' | 'mastered-review';

/** Shown under each question. Older saved sessions may still use the old reasons. */
export const REASON_TEXT: Record<string, string> = {
  new: 'New word',
  'mistake-focus': 'From your Mistake Bank',
  chosen: 'A word you chose',
  'mastered-review': 'A mastered word you chose to review',
  'mistake-review': 'From your Mistake Bank',
  'second-context': 'From your earlier practice',
  'due-review': 'From your earlier practice',
  'extra-practice': 'A word you chose',
  retention: 'A mastered word you chose to review',
};

export interface SelectionState {
  pool: VocabWord[];
  progress: Map<string, WordProgress>;
  sessionId: string;
  level: Difficulty;
  adaptive: boolean;
  lastWordId?: string;
  focus: 'normal' | 'mistakes' | 'mastered' | 'words';
  rng: () => number;
}

export interface Selection {
  word: VocabWord;
  reason: SelectionReason;
}

function byScore(progress: Map<string, WordProgress>) {
  return (a: VocabWord, b: VocabWord) => livePriorityScore(b, progress.get(b.id)) - livePriorityScore(a, progress.get(a.id));
}

/** Picks one of the first `k` items, so the order is priority-led but not mechanical. */
function pickTop<T>(items: T[], k: number, rng: () => number): T | undefined {
  if (!items.length) return undefined;
  return items[Math.floor(rng() * Math.min(k, items.length))];
}

/**
 * Chooses the next word. Every word is asked at most once per session, and nothing
 * comes back by itself:
 * - normal practice serves only words never answered yet (new words), highest priority
 *   first, near the current difficulty level. A missed word goes to the Mistake Bank
 *   and is not served here again;
 * - Practice My Mistakes serves only words whose latest answer was a mistake,
 *   most-missed first;
 * - "mastered" and "words" serve mastered words or the words the student picked.
 * Returns undefined when nothing is left, which ends the session.
 */
export function selectNext(state: SelectionState): Selection | undefined {
  const { pool, progress, sessionId, lastWordId, rng } = state;
  const open = (w: VocabWord) => {
    const p = progress.get(w.id);
    return w.id !== lastWordId && p?.lastSessionId !== sessionId;
  };

  if (state.focus === 'mistakes') {
    const missed = pool.filter((w) => open(w) && progress.get(w.id)?.status === 'learning');
    missed.sort((a, b) => {
      const pa = progress.get(a.id)!;
      const pb = progress.get(b.id)!;
      if (mistakes(pb) !== mistakes(pa)) return mistakes(pb) - mistakes(pa);
      return (pb.lastPracticedAt ?? 0) - (pa.lastPracticedAt ?? 0);
    });
    const w = missed[0];
    return w ? { word: w, reason: 'mistake-focus' } : undefined;
  }

  if (state.focus === 'mastered' || state.focus === 'words') {
    const cands = pool.filter((w) => open(w) && (state.focus === 'words' || progress.get(w.id)?.status === 'mastered'));
    cands.sort((a, b) => (progress.get(a.id)?.lastPracticedAt ?? 0) - (progress.get(b.id)?.lastPracticedAt ?? 0));
    const w = cands[0];
    return w ? { word: w, reason: state.focus === 'mastered' ? 'mastered-review' : 'chosen' } : undefined;
  }

  const fresh = pool.filter((w) => open(w) && (progress.get(w.id)?.status ?? 'new') === 'new');
  const target = targetLevel(state.level, state.adaptive, rng);
  // Nearest level that still has words, starting from the target.
  const order = [...LEVELS].sort((a, b) => Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(target)) - Math.abs(LEVELS.indexOf(b) - LEVELS.indexOf(target)));
  for (const lvl of order) {
    const cands = fresh.filter((w) => w.difficulty === lvl).sort(byScore(progress));
    const w = pickTop(cands, 4, rng);
    if (w) return { word: w, reason: 'new' };
  }
  return undefined;
}

/** Every word is practiced in one sentence: its first (best) one. */
export function chooseContext(w: VocabWord): Context {
  return w.contexts[0];
}

/**
 * Chooses a Read and Complete paragraph: unseen ones first, near the target
 * difficulty, and preferring paragraphs with more words not answered yet.
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
      for (const g of p.gaps) if ((progress.get(g.wordId)?.status ?? 'new') === 'new') s += 0.25;
      return { p, s: s + rng() };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]?.p;
}
