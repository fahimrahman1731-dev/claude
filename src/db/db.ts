import Dexie, { type Table } from 'dexie';
import type { AdaptiveState } from '../engine/adaptive';
import type { Settings } from '../engine/config';
import type { SelectionReason } from '../engine/selection';
import type { AttemptRecord, Context, InteractiveAnswers, IrPart, Mode, MistakeRecord, Question, ResultKind, VocabWord, WordProgress } from '../engine/types';

export interface GapOutcome {
  wordId: string;
  word: string;
  contextId: string;
  typed: string;
  full: string;
  correctAnswer: string;
  result: ResultKind;
  errorTypes: string[];
  becameMastered: boolean;
  lostMastery: boolean;
  schedule: string;
  usedUkVariant: boolean;
  previousMistakes: number;
}

/** Result of one comprehension part of an Interactive Reading set. */
export interface IrPartOutcome {
  part: IrPart;
  /** 0 for single parts; 0 or 1 for the two Highlight the Answer questions. */
  n: number;
  correct: boolean;
  /** 0 to 1 (Highlight the Answer gives partial credit; the others are 0 or 1). */
  score: number;
  /** Option chosen (choice parts) or text highlighted (highlight parts); '' = no answer. */
  chosen: string;
  expected: string;
}

export interface QuestionOutcome {
  questionId: string;
  index: number;
  gaps: GapOutcome[];
  /** Interactive Reading only: the comprehension parts (the missing words are in `gaps`). */
  parts?: IrPartOutcome[];
  /** Interactive Reading only: the option the student picked for each missing word. */
  blankChoices?: (string | null)[];
  responseMs: number;
  timedOut: boolean;
  skipped: boolean;
  savedAt: number;
}

export interface CurrentQuestion {
  question: Question;
  reason: SelectionReason;
  startedAt: number;
  /** null = untimed. */
  limitMs: number | null;
  /** Interactive Reading: answers given so far, saved after each part so a refresh resumes there. */
  interactive?: InteractiveAnswers;
}

export interface SessionRecord {
  id: string;
  mode: Mode;
  focus: SessionFocus;
  status: 'active' | 'completed' | 'abandoned';
  startedAt: number;
  endedAt?: number;
  /** Questions (or paragraphs) planned for this session. */
  target: number;
  newQuota: number;
  reviewQuota: number;
  /** Questions finished so far. */
  index: number;
  newIntroduced: number;
  reviewsServed: number;
  current?: CurrentQuestion;
  lastOutcome?: QuestionOutcome;
  lastWordId?: string;
  paragraphIds: string[];
  /** Interactive Reading sets served in this session (optional: older sessions have none). */
  interactiveIds?: string[];
  tally: Record<ResultKind, number>;
  /** Consecutive correct answers in this session, and the best run. */
  streak: number;
  bestStreak: number;
  /** For focused sessions: the words to practice (e.g. one word from the library). */
  wordIds?: string[];
  endReason?: string;
}

/** normal = mode rules; mistakes = Practice My Mistakes; mastered = review the Completed Checklist; words = chosen words. */
export type SessionFocus = 'normal' | 'mistakes' | 'mastered' | 'words';

export interface Meta {
  /** Global question counter used by the short review intervals. */
  seq: number;
  adaptive: AdaptiveState;
  paragraphServed: Record<string, number>;
  /** Interactive Reading sets served (optional: older saved data has none). */
  interactiveServed?: Record<string, number>;
  createdAt: number;
}

/** One answered comprehension part of an Interactive Reading set (for statistics). */
export interface IrResultRecord {
  /** session : question number : part : n, so a repeated submit cannot be stored twice. */
  id: string;
  sessionId: string;
  setId: string;
  part: IrPart;
  correct: boolean;
  score: number;
  answered: boolean;
  at: number;
}

export interface ImportRecord {
  id: string;
  at: number;
  fileName: string;
  status: 'ok' | 'partial' | 'failed';
  report: unknown;
}

export interface StoredContext extends Context {
  createdAt: number;
}

export interface KV {
  key: string;
  value: unknown;
}

/**
 * IndexedDB schema. Each table holds one kind of record; attempts are keyed
 * by session + question number so a repeated submit cannot be stored twice.
 */
export class AppDB extends Dexie {
  progress!: Table<WordProgress, string>;
  attempts!: Table<AttemptRecord, string>;
  mistakes!: Table<MistakeRecord, string>;
  sessions!: Table<SessionRecord, string>;
  kv!: Table<KV, string>;
  customWords!: Table<VocabWord, string>;
  aiContexts!: Table<StoredContext, string>;
  imports!: Table<ImportRecord, string>;
  irResults!: Table<IrResultRecord, string>;

  constructor(name = 'det-vocab-trainer') {
    super(name);
    this.version(1).stores({
      progress: 'wordId, status, nextReviewAt, lastPracticedAt',
      attempts: 'id, wordId, sessionId, at, result, mode',
      mistakes: 'id, wordId, at, result',
      sessions: 'id, startedAt, status',
      kv: 'key',
      customWords: 'id, word',
      aiContexts: 'id, wordId',
      imports: 'id, at',
    });
    // Version 2 adds Interactive Reading results. Existing data is kept as it is.
    this.version(2).stores({
      irResults: 'id, sessionId, setId, part, at',
    });
  }
}

export const SETTINGS_KEY = 'settings';
export const META_KEY = 'meta';

export type { Settings };
