export type Difficulty = 'easy' | 'intermediate' | 'advanced';
export type Priority = 'high' | 'medium' | 'low';

/**
 * Practice modes. The first three are the DET reading tasks; the other three are
 * extra vocabulary drills. They stay separate because each follows its own rules.
 */
export type Mode = 'fill-blanks' | 'read-complete' | 'interactive-reading' | 'spelling' | 'small-words' | 'endings';

/** Modes that ask one sentence with one word to complete. */
export type SentenceMode = 'fill-blanks' | 'spelling' | 'small-words' | 'endings';

/**
 * How one question ended.
 * - correct / incorrect: the student submitted an answer.
 * - timeout: the countdown ended; whatever was typed was checked and was not correct.
 * - unanswered: submitted empty (or a Read and Complete gap left empty).
 * - skipped: the student pressed Skip. Skips never count toward accuracy or mastery.
 */
export type ResultKind = 'correct' | 'incorrect' | 'timeout' | 'unanswered' | 'skipped';

/**
 * new = not answered yet; learning = the latest answer was a mistake, so the word is
 * in the Mistake Bank; mastered = answered correctly (Completed Checklist).
 */
export type MasteryStatus = 'new' | 'learning' | 'mastered';

export type ContextOrigin = 'authored' | 'collected' | 'custom' | 'ai' | 'paragraph' | 'interactive';

export interface Context {
  id: string;
  wordId: string;
  /** Sentence with any authoring brackets removed. */
  sentence: string;
  /** Character offsets of the target word inside `sentence`. */
  start: number;
  end: number;
  origin: ContextOrigin;
  /** Where a collected sentence comes from: a text id (see VocabData.texts) or 'wordnet'. */
  src?: string;
}

/** A real text that sentences, Read and Complete texts or Interactive Reading passages were taken from. */
export interface TextSource {
  id: string;
  title: string;
  /** Attribution line: title, author, site, licence. */
  credit: string;
  url?: string;
  license: string;
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
  /**
   * "source" = taken from the study materials; "dictionary" = Princeton WordNet;
   * "app" = written for this app; "custom" = typed by the student.
   */
  definitionOrigin: 'source' | 'dictionary' | 'app' | 'custom';
  sourceDefinitions: string[];
  /** Princeton WordNet definition (most common sense for the word's part of speech), when it is not already the main definition. */
  dictionaryDefinition?: string;
  bengali?: string;
  /** "dictionary" = Apertium English–Bengali dictionary; "app" = written for this app; "custom" = typed by the student. */
  bengaliOrigin?: 'dictionary' | 'app' | 'custom';
  /** Bengali equivalents listed in the Apertium English–Bengali dictionary (collected, may be less specific). */
  bengaliDictionary?: string[];
  /** CEFR level from CEFR-J (A1–B2) or Octanove (C1–C2), for the word or its base form. */
  cefr?: string;
  /** Trusted word lists that contain the word or its base form (NGSL, NAWL). */
  lists?: string[];
  /** wordfreq Zipf frequency (about 3 = once per million words). */
  zipf?: number;
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
  /** Source text id (see VocabData.texts) for collected texts. */
  src?: string;
}

export interface VocabData {
  version: string;
  generatedAt: string;
  sources: SourceRef[];
  words: VocabWord[];
  paragraphs: Paragraph[];
  interactive: InteractiveSet[];
  /** Real texts used for sentences, Read and Complete and Interactive Reading, with their attribution. */
  texts?: TextSource[];
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
  mode: SentenceMode;
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

export type Question = SentenceQuestion | ParagraphQuestion | InteractiveQuestion;

// ---------------------------------------------------------------- Interactive Reading

/** The parts of one Interactive Reading set, in the order the DET asks them. */
export type IrPart = 'complete-sentences' | 'complete-passage' | 'highlight' | 'main-idea' | 'title';

/** A missing word in "Complete the Sentences": the answer plus the wrong options (traps). */
export interface IrBlank {
  /** Offsets of the answer word in the passage text. */
  start: number;
  end: number;
  answer: string;
  distractors: string[];
  /** Library word for the answer, when there is one (its progress is updated). */
  wordId?: string;
  /** Why the answer fits and the traps do not (shown after answering). */
  why?: string;
}

/** A multiple-choice part: the correct option and the wrong ones. */
export interface IrChoice {
  answer: string;
  distractors: string[];
  why?: string;
}

/** "Highlight the Answer": a question whose answer is a span of the passage. */
export interface IrHighlight {
  question: string;
  /** Offsets of the expected answer in the passage text. */
  start: number;
  end: number;
}

export interface InteractiveSet {
  id: string;
  title: string;
  topic: string;
  genre: 'narrative' | 'expository';
  difficulty: Difficulty;
  /** Full passage; paragraphs are separated by a blank line. */
  text: string;
  /** End offset of the part of the passage shown during "Complete the Sentences". */
  sentencesPartEnd: number;
  blanks: IrBlank[];
  /** The sentence removed in "Complete the Passage" (offsets in `text`) and the wrong sentences offered with it. */
  missing: { start: number; end: number; distractors: string[]; why?: string };
  highlights: IrHighlight[];
  idea: IrChoice;
  titles: IrChoice;
  source: { id: string; title: string; author?: string; url?: string; license: string; note?: string };
}

/** One option list as served: shuffled, with the index of the right option. */
export interface IrServedChoice {
  options: string[];
  answer: number;
}

export interface InteractiveQuestion {
  kind: 'interactive';
  id: string;
  mode: 'interactive-reading';
  setId: string;
  difficulty: Difficulty;
  origin: 'interactive';
  blanks: IrServedChoice[];
  missing: IrServedChoice;
  idea: IrServedChoice;
  titles: IrServedChoice;
}

/** What the student chose. null = not answered (time ran out). */
export interface InteractiveAnswers {
  /** Index of the part the student is on (saved so a refresh resumes there). */
  step: number;
  blanks: (number | null)[];
  missing: number | null;
  highlights: ({ start: number; end: number } | null)[];
  idea: number | null;
  title: number | null;
}

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
  /** Kept for data saved under the old two-sentence rule; always empty now. */
  streakContextIds: string[];
  seenContextIds: string[];
  lastContextId?: string;
  totalResponseMs: number;
  answeredCount: number;
  firstPracticedAt?: number;
  lastPracticedAt?: number;
  /** From the old review schedule (there are no scheduled reviews now); cleared on the next answer. */
  nextReviewAt?: number;
  /** From the old review schedule; cleared on the next answer. */
  dueSeq?: number;
  lastSeq?: number;
  lastSessionId?: string;
  /** From the old review schedule; not used. */
  intervalIndex: number;
  masteredAt?: number;
  /** 'retention-failed' comes from the old review schedule; 'lost-mastery' = a mastered word was missed. */
  history: { at: number; event: 'mastered' | 'retention-failed' | 'lost-mastery' | 'reopened' }[];
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
  /** Where the missed word starts in `sentence` (records saved before this was added have none). */
  answerStart?: number;
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
