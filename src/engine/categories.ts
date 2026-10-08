import { MASTERY } from './config';
import { livePriority } from './priority';
import { mistakes } from './progress';
import type { VocabWord, WordProgress } from './types';

const ACADEMIC_TOPICS = ['General academic verbs', 'Describing words and adverbs', 'Verbs of informational passages', 'Describing words', 'Education', 'Education and study'];

/** Academic vocabulary: Fill in the Blanks level words and the academic topic lists in the materials. */
export function isAcademic(w: VocabWord): boolean {
  return (
    w.tags.some((t) => t === 'fib-level' || t === 'fib-meaning' || ACADEMIC_TOPICS.some((a) => t === `topic:${a}`)) ||
    (w.tags.includes('fib-official') && w.difficulty !== 'easy')
  );
}

export type ActiveFilter = 'all' | 'high' | 'missed' | 'small' | 'academic' | 'difficult' | 'due' | 'never';

export const ACTIVE_FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'all', label: 'All active words' },
  { value: 'high', label: 'High priority' },
  { value: 'missed', label: 'Frequently missed' },
  { value: 'small', label: 'Small grammar words' },
  { value: 'academic', label: 'Academic vocabulary' },
  { value: 'difficult', label: 'Difficult words' },
  { value: 'due', label: 'Due for review' },
  { value: 'never', label: 'Never attempted' },
];

export function matchesActiveFilter(f: ActiveFilter, w: VocabWord, p: WordProgress | undefined, now: number): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'high':
      return livePriority(w, p) === 'high';
    case 'missed':
      return !!p && mistakes(p) >= 2;
    case 'small':
      return w.isSmallWord;
    case 'academic':
      return isAcademic(w);
    case 'difficult':
      return w.difficulty === 'advanced' || (!!p && p.consecutiveIncorrect >= 2);
    case 'due':
      return !!p && p.status === 'learning' && (p.nextReviewAt ?? 0) <= now;
    case 'never':
      return !p || p.attempts === 0;
  }
}

/** Distinct sentences answered correctly since the last mistake, out of the number mastery needs. */
export function contextProgress(p: WordProgress | undefined): string {
  const n = p?.streakContextIds.length ?? 0;
  return `${Math.min(n, MASTERY.requiredDistinctContexts)}/${MASTERY.requiredDistinctContexts}`;
}

export type CompletedCategory = 'all' | 'small' | 'academic' | 'easy' | 'intermediate' | 'advanced' | 'custom';
export const COMPLETED_CATEGORIES: { value: CompletedCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'small', label: 'Small grammar words' },
  { value: 'academic', label: 'Academic' },
  { value: 'easy', label: 'Easy' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'custom', label: 'My words' },
];

export function matchesCategory(c: CompletedCategory, w: VocabWord): boolean {
  if (c === 'all') return true;
  if (c === 'small') return w.isSmallWord;
  if (c === 'academic') return isAcademic(w);
  if (c === 'custom') return w.isCustom;
  return w.difficulty === c;
}
