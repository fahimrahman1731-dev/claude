import Dexie, { type Table } from 'dexie';
import type { AdaptiveState } from '../engine/adaptive';
import type { Settings } from '../engine/config';
import type { SelectionReason } from '../engine/selection';
import type { AttemptRecord, Context, Mode, MistakeRecord, Question, ResultKind, VocabWord, WordProgress } from '../engine/types';

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

export interface QuestionOutcome {
  questionId: string;
  index: number;
  gaps: GapOutcome[];
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
  createdAt: number;
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
  }
}

export const SETTINGS_KEY = 'settings';
export const META_KEY = 'meta';

export type { Settings };
