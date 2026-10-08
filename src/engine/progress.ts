import { MASTERY, SCHEDULER, type MasteryPolicy, type ReviewFrequency, type SchedulerConfig } from './config';
import type { ResultKind, WordProgress } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;

export function newProgress(wordId: string): WordProgress {
  return {
    wordId,
    status: 'new',
    attempts: 0,
    correct: 0,
    incorrect: 0,
    timeouts: 0,
    unanswered: 0,
    skips: 0,
    consecutiveCorrect: 0,
    consecutiveIncorrect: 0,
    correctContextIds: [],
    streakContextIds: [],
    seenContextIds: [],
    totalResponseMs: 0,
    answeredCount: 0,
    intervalIndex: 0,
    history: [],
  };
}

export interface ResultEvent {
  result: ResultKind;
  contextId: string;
  responseMs: number;
  /** Time of the answer (ms since epoch). */
  at: number;
  /** Global number of this question (it keeps counting across sessions). */
  seq: number;
  sessionId: string;
}

export interface ApplyOptions {
  scheduler?: SchedulerConfig;
  mastery?: MasteryPolicy;
  reviewFrequency?: ReviewFrequency;
  rng?: () => number;
}

export interface ApplyOutcome {
  progress: WordProgress;
  becameMastered: boolean;
  lostMastery: boolean;
  /** Other questions to wait before this word is due again (in-session intervals). */
  gap?: number;
  /** Days until the next review (mastered words). */
  days?: number;
  /** Plain-language reason for the new schedule, shown to the student. */
  explanation: string;
}

export function pickInRange([min, max]: [number, number], rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

const ORDINAL = ['1st', '2nd', '3rd'];

export function mistakes(p: WordProgress): number {
  return p.incorrect + p.timeouts + p.unanswered;
}

/** Accuracy over graded attempts; skips are not attempts. */
export function accuracy(p: WordProgress): number | undefined {
  return p.attempts ? p.correct / p.attempts : undefined;
}

/**
 * The scheduler and mastery rules in one pure function: given a word's
 * progress and one result, returns the new progress and the reason for the
 * new schedule. Nothing is persisted here.
 *
 * Mastery = exact spelling, correct in `requiredDistinctContexts` different
 * contexts, with no mistake in between. A skip or a view never counts.
 */
export function applyResult(prev: WordProgress, ev: ResultEvent, opts: ApplyOptions = {}): ApplyOutcome {
  const cfg = opts.scheduler ?? SCHEDULER;
  const policy = opts.mastery ?? MASTERY;
  const mult = cfg.reviewFrequency[opts.reviewFrequency ?? 'normal'];
  const rng = opts.rng ?? Math.random;
  const p: WordProgress = {
    ...prev,
    correctContextIds: [...prev.correctContextIds],
    streakContextIds: [...prev.streakContextIds],
    seenContextIds: [...prev.seenContextIds],
    history: [...prev.history],
  };
  p.lastPracticedAt = ev.at;
  p.firstPracticedAt ??= ev.at;
  p.lastSeq = ev.seq;
  p.lastSessionId = ev.sessionId;
  p.lastContextId = ev.contextId;
  if (!p.seenContextIds.includes(ev.contextId)) p.seenContextIds.push(ev.contextId);

  if (ev.result === 'skipped') {
    p.skips++;
    const gap = pickInRange(cfg.skipGap, rng);
    p.dueSeq = ev.seq + gap + 1;
    return {
      progress: p,
      becameMastered: false,
      lostMastery: false,
      gap,
      explanation: `Skipped: back after about ${gap} other questions. Skips never count toward mastery.`,
    };
  }

  p.attempts++;
  if (ev.result === 'correct') {
    p.correct++;
    p.consecutiveCorrect++;
    p.consecutiveIncorrect = 0;
    p.totalResponseMs += ev.responseMs;
    p.answeredCount++;
    if (!p.correctContextIds.includes(ev.contextId)) p.correctContextIds.push(ev.contextId);
    if (!p.streakContextIds.includes(ev.contextId)) p.streakContextIds.push(ev.contextId);

    if (prev.status === 'mastered') {
      p.intervalIndex = Math.min(prev.intervalIndex + 1, cfg.retentionDays.length - 1);
      const days = cfg.retentionDays[p.intervalIndex] * mult;
      p.nextReviewAt = ev.at + days * DAY_MS;
      p.dueSeq = undefined;
      return { progress: p, becameMastered: false, lostMastery: false, days, explanation: `Retention check passed: next review in ${fmtDays(days)}.` };
    }
    if (p.streakContextIds.length >= policy.requiredDistinctContexts) {
      p.status = 'mastered';
      p.masteredAt = ev.at;
      p.history.push({ at: ev.at, event: 'mastered' });
      p.intervalIndex = 0;
      const days = cfg.retentionDays[0] * mult;
      p.nextReviewAt = ev.at + days * DAY_MS;
      p.dueSeq = undefined;
      return {
        progress: p,
        becameMastered: true,
        lostMastery: false,
        days,
        explanation: `Correct in ${policy.requiredDistinctContexts} different sentences with no mistake in between: mastered. First retention check in ${fmtDays(days)}.`,
      };
    }
    p.status = 'learning';
    const gap = pickInRange(cfg.secondContextGap, rng);
    p.dueSeq = ev.seq + gap + 1;
    p.nextReviewAt = ev.at;
    const need = policy.requiredDistinctContexts - p.streakContextIds.length;
    return {
      progress: p,
      becameMastered: false,
      lostMastery: false,
      gap,
      explanation: `Correct (${p.streakContextIds.length} of ${policy.requiredDistinctContexts} sentences). ${need} more correct answer${need > 1 ? 's' : ''} in a different sentence needed; asked again after about ${gap} other questions.`,
    };
  }

  // incorrect, timeout or unanswered: all reset the mastery streak
  if (ev.result === 'incorrect') {
    p.incorrect++;
    p.totalResponseMs += ev.responseMs;
    p.answeredCount++;
  } else if (ev.result === 'timeout') p.timeouts++;
  else p.unanswered++;
  p.consecutiveIncorrect++;
  p.consecutiveCorrect = 0;
  p.streakContextIds = [];
  p.intervalIndex = 0;
  let lostMastery = false;
  if (prev.status === 'mastered') {
    if (policy.retentionFailureReopens) {
      p.status = 'learning';
      p.masteredAt = undefined;
      p.history.push({ at: ev.at, event: 'retention-failed' });
      lostMastery = true;
    }
  } else p.status = 'learning';
  const step = Math.min(p.consecutiveIncorrect, cfg.mistakeGaps.length) - 1;
  const gap = pickInRange(cfg.mistakeGaps[step], rng);
  p.dueSeq = ev.seq + gap + 1;
  p.nextReviewAt = ev.at;
  const which = ORDINAL[Math.min(p.consecutiveIncorrect, 3) - 1] + (p.consecutiveIncorrect >= 3 ? ' (or later)' : '');
  return {
    progress: p,
    becameMastered: false,
    lostMastery,
    gap,
    explanation: `${which} mistake in a row: back after about ${gap} other question${gap === 1 ? '' : 's'}, in a different sentence.${lostMastery ? ' This word left the Completed Checklist until you master it again.' : ''}`,
  };
}

/** Puts a mastered word back into active practice at the student's request. History is kept. */
export function reopen(prev: WordProgress, at: number): WordProgress {
  return {
    ...prev,
    status: prev.attempts > 0 ? 'learning' : 'new',
    masteredAt: undefined,
    streakContextIds: [],
    consecutiveCorrect: 0,
    dueSeq: undefined,
    nextReviewAt: at,
    intervalIndex: 0,
    history: [...prev.history, { at, event: 'reopened' }],
  };
}

function fmtDays(d: number): string {
  if (d < 1) return `${Math.round(d * 24)} hours`;
  const r = Math.round(d * 10) / 10;
  return `${r} day${r === 1 ? '' : 's'}`;
}
