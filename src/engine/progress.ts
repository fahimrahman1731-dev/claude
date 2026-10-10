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
  /**
   * The answer was chosen from options (Interactive Reading), not typed.
   * A right choice is recorded but never masters a word; a wrong one is a
   * mistake like any other and puts the word in the Mistake Bank.
   */
  recognitionOnly?: boolean;
}

export interface ApplyOutcome {
  progress: WordProgress;
  becameMastered: boolean;
  lostMastery: boolean;
  /** Plain-language result of this answer, shown to the student. */
  explanation: string;
}

export function mistakes(p: WordProgress): number {
  return p.incorrect + p.timeouts + p.unanswered;
}

/** Accuracy over graded attempts; skips are not attempts. */
export function accuracy(p: WordProgress): number | undefined {
  return p.attempts ? p.correct / p.attempts : undefined;
}

/** The word's latest answer was a mistake and it has not been fixed yet. */
export function inMistakeBank(p: WordProgress | undefined): boolean {
  return p?.status === 'learning';
}

/**
 * The learning rule in one pure function (nothing is saved here).
 *
 * Every word has one practice sentence, and the student goes through each word once:
 * - a correct typed answer masters the word at once (it moves to the Completed Checklist);
 * - a wrong, timed-out or empty answer puts it in the Mistake Bank. It never comes back
 *   by itself: the student fixes it in Practice My Mistakes, where one correct answer
 *   masters it;
 * - a skip is not counted: the word stays as it was and can come back in a later session;
 * - choosing a word from options (Interactive Reading) never masters it, but a wrong
 *   choice is a mistake like any other.
 * There are no scheduled reviews.
 */
export function applyResult(prev: WordProgress, ev: ResultEvent, opts: ApplyOptions = {}): ApplyOutcome {
  const p: WordProgress = {
    ...prev,
    correctContextIds: [...prev.correctContextIds],
    streakContextIds: [],
    seenContextIds: [...prev.seenContextIds],
    history: [...prev.history],
    // Left over from the old review schedule: never used now.
    nextReviewAt: undefined,
    dueSeq: undefined,
  };
  p.lastPracticedAt = ev.at;
  p.firstPracticedAt ??= ev.at;
  p.lastSeq = ev.seq;
  p.lastSessionId = ev.sessionId;
  p.lastContextId = ev.contextId;
  if (!p.seenContextIds.includes(ev.contextId)) p.seenContextIds.push(ev.contextId);

  if (ev.result === 'skipped') {
    p.skips++;
    return { progress: p, becameMastered: false, lostMastery: false, explanation: 'Skipped: not counted. The word can come up again in a later session.' };
  }

  p.attempts++;
  if (ev.result === 'correct') {
    p.correct++;
    p.consecutiveCorrect++;
    p.consecutiveIncorrect = 0;
    p.totalResponseMs += ev.responseMs;
    p.answeredCount++;
    if (!p.correctContextIds.includes(ev.contextId)) p.correctContextIds.push(ev.contextId);
    if (opts.recognitionOnly) {
      const explanation =
        prev.status === 'mastered'
          ? 'Chosen correctly.'
          : prev.status === 'learning'
            ? 'Chosen correctly. The word stays in your Mistake Bank until you type it correctly in Practice My Mistakes.'
            : 'Chosen correctly. Choosing from options does not master a word: it is mastered when you type it correctly.';
      return { progress: p, becameMastered: false, lostMastery: false, explanation };
    }
    if (prev.status === 'mastered') return { progress: p, becameMastered: false, lostMastery: false, explanation: 'Correct. The word is still mastered.' };
    p.status = 'mastered';
    p.masteredAt = ev.at;
    p.history.push({ at: ev.at, event: 'mastered' });
    return {
      progress: p,
      becameMastered: true,
      lostMastery: false,
      explanation:
        prev.status === 'learning'
          ? 'Correct: mastered. The word left your Mistake Bank and moved to your Completed Checklist.'
          : 'Correct: mastered. The word moved to your Completed Checklist.',
    };
  }

  // incorrect, timeout or unanswered: the word goes to (or stays in) the Mistake Bank
  if (ev.result === 'incorrect') {
    p.incorrect++;
    p.totalResponseMs += ev.responseMs;
    p.answeredCount++;
  } else if (ev.result === 'timeout') p.timeouts++;
  else p.unanswered++;
  p.consecutiveIncorrect++;
  p.consecutiveCorrect = 0;
  const lostMastery = prev.status === 'mastered';
  if (lostMastery) {
    p.masteredAt = undefined;
    p.history.push({ at: ev.at, event: 'lost-mastery' });
  }
  p.status = 'learning';
  const n = mistakes(p);
  const explanation =
    prev.status === 'learning'
      ? `Missed again (${n} mistakes on this word). It stays in your Mistake Bank until you answer it correctly.`
      : `Saved to your Mistake Bank${lostMastery ? ' (it left the Completed Checklist)' : ''}. It will not come back by itself: fix it in Practice My Mistakes, where one correct answer masters it.`;
  return { progress: p, becameMastered: false, lostMastery, explanation };
}

/** Puts a mastered word back among the new words at the student's request. History is kept. */
export function reopen(prev: WordProgress, at: number): WordProgress {
  return {
    ...prev,
    status: 'new',
    masteredAt: undefined,
    streakContextIds: [],
    consecutiveCorrect: 0,
    dueSeq: undefined,
    nextReviewAt: undefined,
    history: [...prev.history, { at, event: 'reopened' }],
  };
}

/**
 * Converts progress saved under the old rules (two sentences for mastery, scheduled
 * reviews) to the current ones: a word whose latest typed answer was correct is
 * mastered, a word with an unfixed mistake is in the Mistake Bank, anything else is new.
 * `lastMissAt` is the time of the word's latest wrong, timed-out or empty answer (from the
 * attempts log), used to tell whether a reopened word was missed again afterwards.
 * Used once when the database is upgraded and when an older backup is restored.
 */
export function migrateProgress(prev: WordProgress, lastMissAt?: number): WordProgress {
  const p: WordProgress = { ...prev, streakContextIds: [], dueSeq: undefined, nextReviewAt: undefined, history: [...prev.history] };
  if (prev.status !== 'learning') return p;
  const last = prev.history[prev.history.length - 1];
  if (prev.streakContextIds.length > 0) {
    // Typed correctly since the last mistake: one correct answer is now enough.
    p.status = 'mastered';
    p.masteredAt = prev.lastPracticedAt ?? prev.firstPracticedAt;
    p.history.push({ at: p.masteredAt ?? 0, event: 'mastered' });
  } else if (prev.consecutiveIncorrect > 0) p.status = 'learning';
  else if (last?.event === 'reopened') p.status = lastMissAt !== undefined && lastMissAt > last.at ? 'learning' : 'new';
  else p.status = mistakes(prev) > 0 ? 'learning' : 'new';
  return p;
}

/** The latest miss (wrong, timed-out or empty answer) per word, from attempt rows. */
export function lastMisses(attempts: { wordId: string; result: ResultKind; at: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of attempts) {
    if (a.result !== 'incorrect' && a.result !== 'timeout' && a.result !== 'unanswered') continue;
    if (a.at > (out.get(a.wordId) ?? -Infinity)) out.set(a.wordId, a.at);
  }
  return out;
}
