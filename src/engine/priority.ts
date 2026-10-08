import { PRIORITY } from './config';
import { accuracy, mistakes } from './progress';
import type { Priority, VocabWord, WordProgress } from './types';

export function levelFor(score: number): Priority {
  return score >= PRIORITY.highAt ? 'high' : score >= PRIORITY.mediumAt ? 'medium' : 'low';
}

/**
 * Live priority = evidence from the study materials + the student's own history.
 * Repeated mistakes push a word up (even a rare one); steady success pushes a
 * common word down so it needs less frequent review.
 */
export function livePriorityScore(w: VocabWord, p?: WordProgress): number {
  let score = w.evidenceScore;
  if (!p) return score;
  score += PRIORITY.perConsecutiveMistake * p.consecutiveIncorrect;
  score += PRIORITY.perMistake * Math.min(mistakes(p), PRIORITY.mistakeCap);
  const acc = accuracy(p);
  if (p.consecutiveCorrect > 0 && acc !== undefined && acc >= 0.8) {
    score += PRIORITY.perConsecutiveCorrect * Math.min(p.consecutiveCorrect, PRIORITY.consecutiveCorrectCap);
  }
  if (p.status === 'mastered') score += PRIORITY.masteredPenalty;
  return Math.round(score * 10) / 10;
}

export function livePriority(w: VocabWord, p?: WordProgress): Priority {
  return levelFor(livePriorityScore(w, p));
}
