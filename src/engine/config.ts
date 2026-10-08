import type { Difficulty, Mode } from './types';

/**
 * All learning rules live here so they can be read, tested and tuned in one place.
 * These are practice settings chosen for this app, not official DET rules or
 * scientific constants.
 */
export interface SchedulerConfig {
  /** Questions to wait after the 1st, 2nd and 3rd+ consecutive mistake: [min, max] other questions. */
  mistakeGaps: [number, number][];
  /** After a first correct answer, wait this many other questions before asking in a new context. */
  secondContextGap: [number, number];
  /** After a skip, wait this many other questions. */
  skipGap: [number, number];
  /** Retention ladder for mastered words, in days. */
  retentionDays: number[];
  /** Multiplies retention intervals: "intensive" reviews mastered words sooner. */
  reviewFrequency: Record<ReviewFrequency, number>;
}

export type ReviewFrequency = 'intensive' | 'normal' | 'relaxed';

export interface MasteryPolicy {
  /** Correct answers in different contexts, without a mistake in between, needed for mastery. */
  requiredDistinctContexts: number;
  /** A retention-review mistake sends a mastered word back to the Active Practice List. */
  retentionFailureReopens: boolean;
}

export const SCHEDULER: SchedulerConfig = {
  mistakeGaps: [
    [3, 5],
    [1, 2],
    [1, 1],
  ],
  secondContextGap: [6, 10],
  skipGap: [4, 8],
  retentionDays: [1, 3, 7, 16, 35, 75],
  reviewFrequency: { intensive: 0.6, normal: 1, relaxed: 1.5 },
};

export const MASTERY: MasteryPolicy = {
  requiredDistinctContexts: 2,
  retentionFailureReopens: true,
};

/** Weights for the live priority score (study-material evidence + personal history). */
export const PRIORITY = {
  highAt: 6,
  mediumAt: 3,
  perConsecutiveMistake: 2.5,
  perMistake: 1,
  mistakeCap: 6,
  perConsecutiveCorrect: -0.5,
  consecutiveCorrectCap: 4,
  masteredPenalty: -3,
};

/** Rolling window used by Adaptive Difficulty. */
export const ADAPTIVE = {
  window: 8,
  stepUpAt: 0.85,
  stepDownAt: 0.5,
  /** Chance of choosing a new word one level below / above the current level. */
  below: 0.15,
  above: 0.15,
};

export type TimerMode = 'timed' | 'untimed' | 'custom';

export const TIMER_PRESETS = {
  quick: 10,
  standard: 20,
  difficult: 30,
  paragraph: 180,
};

/** Default seconds per question for each mode in Timed Mode. */
export const MODE_TIMERS: Record<Mode, number> = {
  'read-complete': TIMER_PRESETS.paragraph,
  'fill-blanks': TIMER_PRESETS.standard,
  spelling: TIMER_PRESETS.standard,
  'small-words': TIMER_PRESETS.quick,
  endings: TIMER_PRESETS.standard,
};

export type LanguagePref = 'en' | 'en-bn';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  difficulty: Difficulty;
  adaptive: boolean;
  timerMode: TimerMode;
  /** Per-mode durations used in Timed Mode. */
  modeTimers: Record<Mode, number>;
  /** Advanced words get the "difficult vocabulary" duration when it is longer. */
  longerTimerForAdvanced: boolean;
  customSeconds: number;
  questionsPerSession: number;
  newWordsPerSession: number;
  reviewsPerSession: number;
  dailyGoal: number;
  language: LanguagePref;
  /** Show the Bengali meaning before answering (off = exam-like). */
  bengaliBeforeAnswer: boolean;
  sound: boolean;
  theme: Theme;
  reviewFrequency: ReviewFrequency;
  retentionReviews: boolean;
  showSkip: boolean;
  paragraphsPerSession: number;
}

/**
 * Defaults for a student who finds DET reading and spelling hard:
 * adaptive difficulty that starts easy, fewer new words, more reviews,
 * frequent retention checks and Bengali help after each answer.
 */
export const DEFAULT_SETTINGS: Settings = {
  difficulty: 'easy',
  adaptive: true,
  timerMode: 'timed',
  modeTimers: { ...MODE_TIMERS },
  longerTimerForAdvanced: true,
  customSeconds: 25,
  questionsPerSession: 20,
  newWordsPerSession: 8,
  reviewsPerSession: 12,
  dailyGoal: 40,
  language: 'en-bn',
  bengaliBeforeAnswer: false,
  sound: false,
  theme: 'system',
  reviewFrequency: 'intensive',
  retentionReviews: true,
  showSkip: true,
  paragraphsPerSession: 3,
};

export const MODE_INFO: Record<Mode, { title: string; short: string; description: string }> = {
  'read-complete': {
    title: 'Read and Complete',
    short: 'A',
    description:
      'A paragraph with many half-written words. Type the missing letters of each one. Small grammar words and content words are scored separately. American spelling only.',
  },
  'fill-blanks': {
    title: 'Fill in the Blanks',
    short: 'B',
    description:
      'One sentence, one partly visible noun, verb, adjective or adverb. Use the clue word and the grammar to finish it. Small words like "the" and "of" never appear here.',
  },
  spelling: {
    title: 'Word Spelling Practice',
    short: 'C',
    description:
      'Spell one word from its first half, with the letter count shown. Leans on spelling traps, endings and words you have missed before.',
  },
  'small-words': {
    title: 'Small Grammar Words',
    short: 'D',
    description:
      'The, and, to, of, in … About 4 in 10 Read and Complete gaps in the guide’s sample were small words. Quick, short drills.',
  },
  endings: {
    title: 'Word Endings and Families',
    short: 'E',
    description:
      'The stem is shown; type the ending (-tion, -ment, -ness, -ed, -ing …). Irregular forms show the base verb as a hint.',
  },
};
