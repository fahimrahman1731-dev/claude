import { mistakes } from './progress';
import type { AttemptRecord, Difficulty, ResultKind, VocabWord, WordProgress } from './types';

/**
 * Definitions used everywhere in the app:
 * - Graded attempt = correct, incorrect, timeout or unanswered. Skips are not graded.
 * - Accuracy = correct ÷ graded attempts. A timeout or an empty answer counts as not correct.
 * - Average response time = mean time of submitted answers (correct + incorrect);
 *   timeouts are left out because their time is just the timer length.
 * - Mastery % = mastered unique words ÷ total unique words × 100.
 */
export const GRADED: ResultKind[] = ['correct', 'incorrect', 'timeout', 'unanswered'];

export function isGraded(r: ResultKind): boolean {
  return r !== 'skipped';
}

export function dateKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dateKey(dt.getTime());
}

export function streaks(activeDays: Set<string>, now: number): { current: number; longest: number } {
  const today = dateKey(now);
  let start = activeDays.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (activeDays.has(start)) {
    current++;
    start = addDays(start, -1);
  }
  const sorted = [...activeDays].sort();
  let longest = 0;
  let run = 0;
  let prev: string | undefined;
  for (const k of sorted) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return { current, longest: Math.max(longest, current) };
}

export interface DailyRow {
  date: string;
  correct: number;
  incorrect: number;
  timeout: number;
  unanswered: number;
  skipped: number;
  graded: number;
}

export interface DashboardStats {
  totalWords: number;
  attemptedWords: number;
  remainingWords: number;
  masteredWords: number;
  /** Words whose latest answer was a mistake (in the Mistake Bank, not fixed yet). */
  mistakeWords: number;
  /** Words never answered. */
  newWords: number;
  masteryPct: number;
  counts: Record<ResultKind, number>;
  graded: number;
  accuracy: number | undefined;
  accuracyByDifficulty: Record<Difficulty, { correct: number; graded: number; pct: number | undefined }>;
  currentStreak: number;
  longestStreak: number;
  avgResponseMs: number | undefined;
  totalPracticeMs: number;
  mostMissed: { wordId: string; word: string; mistakes: number }[];
  mostImproved: { wordId: string; word: string; before: number; after: number }[];
  daily: DailyRow[];
  todayGraded: number;
}

export function computeStats(
  words: VocabWord[],
  progress: WordProgress[],
  attempts: AttemptRecord[],
  opts: { now: number; days?: number },
): DashboardStats {
  const wordIds = new Set(words.map((w) => w.id));
  const byId = new Map(words.map((w) => [w.id, w]));
  const prog = progress.filter((p) => wordIds.has(p.wordId));
  const counts: Record<ResultKind, number> = { correct: 0, incorrect: 0, timeout: 0, unanswered: 0, skipped: 0 };
  const byDiff: DashboardStats['accuracyByDifficulty'] = {
    easy: { correct: 0, graded: 0, pct: undefined },
    intermediate: { correct: 0, graded: 0, pct: undefined },
    advanced: { correct: 0, graded: 0, pct: undefined },
  };
  const dailyMap = new Map<string, DailyRow>();
  const activeDays = new Set<string>();
  let answeredMs = 0;
  let answered = 0;
  let totalMs = 0;
  const perWord = new Map<string, AttemptRecord[]>();

  for (const a of attempts) {
    counts[a.result]++;
    totalMs += a.responseMs;
    const key = dateKey(a.at);
    let row = dailyMap.get(key);
    if (!row) {
      row = { date: key, correct: 0, incorrect: 0, timeout: 0, unanswered: 0, skipped: 0, graded: 0 };
      dailyMap.set(key, row);
    }
    row[a.result]++;
    if (isGraded(a.result)) {
      row.graded++;
      activeDays.add(key);
      const d = byDiff[a.difficulty] ?? byDiff.easy;
      d.graded++;
      if (a.result === 'correct') d.correct++;
      const list = perWord.get(a.wordId) ?? [];
      list.push(a);
      perWord.set(a.wordId, list);
    }
    if (a.result === 'correct' || a.result === 'incorrect') {
      answeredMs += a.responseMs;
      answered++;
    }
  }
  for (const d of Object.values(byDiff)) d.pct = d.graded ? d.correct / d.graded : undefined;
  const graded = counts.correct + counts.incorrect + counts.timeout + counts.unanswered;
  const mastered = prog.filter((p) => p.status === 'mastered').length;
  const mistakeWords = prog.filter((p) => p.status === 'learning').length;
  const attempted = prog.filter((p) => p.attempts > 0).length;
  const answeredWords = prog.filter((p) => p.status !== 'new').length;

  const mostMissed = prog
    .filter((p) => mistakes(p) > 0)
    .sort((a, b) => mistakes(b) - mistakes(a) || (b.lastPracticedAt ?? 0) - (a.lastPracticedAt ?? 0))
    .slice(0, 8)
    .map((p) => ({ wordId: p.wordId, word: byId.get(p.wordId)?.word ?? p.wordId, mistakes: mistakes(p) }));

  const mostImproved: DashboardStats['mostImproved'] = [];
  for (const [wordId, list] of perWord) {
    // Words removed from the library in an update are not shown.
    if (list.length < 4 || !byId.has(wordId)) continue;
    list.sort((a, b) => a.at - b.at);
    const half = Math.floor(list.length / 2);
    const acc = (xs: AttemptRecord[]) => xs.filter((x) => x.result === 'correct').length / xs.length;
    const before = acc(list.slice(0, half));
    const after = acc(list.slice(half));
    if (after > before) mostImproved.push({ wordId, word: byId.get(wordId)!.word, before, after });
  }
  mostImproved.sort((a, b) => b.after - b.before - (a.after - a.before));

  const days = opts.days ?? 30;
  const daily: DailyRow[] = [];
  const today = dateKey(opts.now);
  for (let i = days - 1; i >= 0; i--) {
    const k = addDays(today, -i);
    daily.push(dailyMap.get(k) ?? { date: k, correct: 0, incorrect: 0, timeout: 0, unanswered: 0, skipped: 0, graded: 0 });
  }
  const s = streaks(activeDays, opts.now);
  return {
    totalWords: words.length,
    attemptedWords: attempted,
    remainingWords: words.length - mastered,
    masteredWords: mastered,
    mistakeWords,
    newWords: words.length - answeredWords,
    masteryPct: words.length ? (mastered / words.length) * 100 : 0,
    counts,
    graded,
    accuracy: graded ? counts.correct / graded : undefined,
    accuracyByDifficulty: byDiff,
    currentStreak: s.current,
    longestStreak: s.longest,
    avgResponseMs: answered ? answeredMs / answered : undefined,
    totalPracticeMs: totalMs,
    mostMissed,
    mostImproved: mostImproved.slice(0, 8),
    daily,
    todayGraded: dailyMap.get(today)?.graded ?? 0,
  };
}
