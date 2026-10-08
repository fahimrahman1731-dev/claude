export type Difficulty = 'easy' | 'intermediate' | 'advanced';
export type Priority = 'high' | 'medium' | 'low';

/** The five practice modes. They stay separate because the DET tasks follow different rules. */
export type Mode = 'read-complete' | 'fill-blanks' | 'spelling' | 'small-words' | 'endings';

/**
 * How one question ended.
 * - correct / incorrect: the student submitted an answer.
 * - timeout: the countdown ended; whatever was typed was checked and was not correct.
 * - unanswered: submitted empty (or a Read and Complete gap left empty).
 * - skipped: the student pressed Skip. Skips never count toward accuracy or mastery.
 */
export type ResultKind = 'correct' | 'incorrect' | 'timeout' | 'unanswered' | 'skipped';

export type MasteryStatus = 'new' | 'learning' | 'mastered';

export type ContextOrigin = 'authored' | 'custom' | 'ai' | 'paragraph';

export interface Context {
  id: string;
  wordId: string;
  /** Sentence with any authoring brackets removed. */
  sentence: string;
  /** Character offsets of the target word inside `sentence`. */
  start: number;
  end: number;
  origin: ContextOrigin;
}

export interface SourceRef {
  id: string;
  title: string;
}

export interface VocabWord {
  id: string;
  word: string;
  pos: string[];
  definition: string;
  /** "source" = taken from the study materials; "app" = written for this app; "custom" = typed by the student. */
  definitionOrigin: 'source' | 'app' | 'custom';
  sourceDefinitions: string[];
  bengali?: string;
  bengaliOrigin?: 'app' | 'custom';
  /** Base word this form comes from (walked → walk), if any. */
  base?: string;
  /** Family key shared by related forms (develop, developed, development …). */
  family: string;
  /** Ending used in the Word Endings mode, e.g. "ment" for development. */
  ending?: { visible: string; hidden: string; label: string; change: 'none' | 'drop-e' | 'y-to-i' | 'double' | 'le-to-ly' | 'ic-to-ically' };
  difficulty: Difficulty;
  basePriority: Priority;
  /** Evidence score from the study materials (higher = more practice). */
  evidenceScore: number;
  evidence: string[];
  sources: string[];
  sections: string[];
  tags: string[];
  collocations: string[];
  ukVariants: string[];
  notes: string[];
  gapCount?: number;
  isSmallWord: boolean;
  isCustom: boolean;
  contexts: Context[];
}

export interface ParagraphGap {
  wordId: string;
  contextId: string;
  start: number;
  end: number;
}

export interface Paragraph {
  id: string;
  title: string;
  topic: string;
  difficulty: Difficulty;
  text: string;
  gaps: ParagraphGap[];
}

export interface VocabData {
  version: string;
  generatedAt: string;
  sources: SourceRef[];
  words: VocabWord[];
  paragraphs: Paragraph[];
}

/** One gap the student has to complete. */
export interface Gap {
  wordId: string;
  contextId: string;
  answer: string;
  visible: string;
  hiddenLength: number;
  ukVariants: string[];
}

export interface SentenceQuestion {
  kind: 'sentence';
  id: string;
  mode: Exclude<Mode, 'read-complete'>;
  wordId: string;
  contextId: string;
  sentence: string;
  before: string;
  after: string;
  gap: Gap;
  difficulty: Difficulty;
  origin: ContextOrigin;
  /** Base form shown as a hint in the Word Endings mode for irregular forms. */
  baseHint?: string;
}

export interface ParagraphQuestion {
  kind: 'paragraph';
  id: string;
  mode: 'read-complete';
  paragraphId: string;
  title: string;
  text: string;
  /** Text pieces between gaps: segments.length === gaps.length + 1. */
  segments: string[];
  gaps: Gap[];
  difficulty: Difficulty;
  origin: 'paragraph';
}

export type Question = SentenceQuestion | ParagraphQuestion;

export type ErrorType =
  | 'empty'
  | 'missing-letters'
  | 'extra-letters'
  | 'wrong-letters'
  | 'transposition'
  | 'double-letter'
  | 'ie-ei'
  | 'wrong-ending'
  | 'wrong-form'
  | 'uk-spelling'
  | 'different-word';

export interface WordProgress {
  wordId: string;
  status: MasteryStatus;
  /** Graded attempts: correct + incorrect + timeouts + unanswered (skips excluded). */
  attempts: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  unanswered: number;
  skips: number;
  consecutiveCorrect: number;
  consecutiveIncorrect: number;
  /** Every context ever answered correctly. */
  correctContextIds: string[];
  /** Contexts answered correctly since the last mistake. Mastery needs enough distinct ones here. */
  streakContextIds: string[];
  seenContextIds: string[];
  lastContextId?: string;
  totalResponseMs: number;
  answeredCount: number;
  firstPracticedAt?: number;
  lastPracticedAt?: number;
  /** Earliest time the word may be served again (later-session, next-day and longer reviews). */
  nextReviewAt?: number;
  /** Global question number after which the word is due again (short in-session intervals). */
  dueSeq?: number;
  lastSeq?: number;
  lastSessionId?: string;
  /** Position on the retention ladder after mastery. */
  intervalIndex: number;
  masteredAt?: number;
  history: { at: number; event: 'mastered' | 'retention-failed' | 'reopened' }[];
}

export interface AttemptRecord {
  /** Deterministic key (session + question number [+ gap]) so a double submit cannot record twice. */
  id: string;
  sessionId: string;
  questionId: string;
  mode: Mode;
  wordId: string;
  contextId: string;
  result: ResultKind;
  answer: string;
  correctAnswer: string;
  responseMs: number;
  at: number;
  seq: number;
  errorTypes: ErrorType[];
  hintUsed: boolean;
  difficulty: Difficulty;
}

export interface MistakeRecord {
  id: string;
  attemptId: string;
  wordId: string;
  word: string;
  answer: string;
  correctAnswer: string;
  sentence: string;
  contextId: string;
  mode: Mode;
  result: ResultKind;
  at: number;
  responseMs: number;
  previousMistakes: number;
  errorTypes: ErrorType[];
  rule: string;
  clue: string;
}
