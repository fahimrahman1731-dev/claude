import { initialAdaptive, updateAdaptive } from '../engine/adaptive';
import { checkGap } from '../engine/answer';
import { contextClues } from '../engine/clues';
import { DEFAULT_SETTINGS, MODE_INFO, questionSeconds, type Settings } from '../engine/config';
import { applyResult, mistakes, newProgress, reopen } from '../engine/progress';
import { chooseInteractive, emptyInteractiveAnswers, interactiveQuestion, interactiveSeconds, scoreInteractive } from '../engine/interactive';
import { inModePool, paragraphQuestion, sentenceQuestion } from '../engine/questions';
import { chooseContext, chooseParagraph, selectNext } from '../engine/selection';
import { spellingRules } from '../engine/spelling';
import type { AttemptRecord, Gap, InteractiveAnswers, InteractiveQuestion, MistakeRecord, Mode, Question, ResultKind, SentenceMode, VocabWord, WordProgress } from '../engine/types';
import type { VocabStore } from '../data/vocabStore';
import { META_KEY, SETTINGS_KEY, type AppDB, type GapOutcome, type IrPartOutcome, type Meta, type QuestionOutcome, type SessionFocus, type SessionRecord } from '../db/db';

export interface ServiceDeps {
  db: AppDB;
  store: VocabStore;
  now?: () => number;
  rng?: () => number;
}

export interface SubmitInput {
  questionId: string;
  /** One answer per gap (a sentence question has one gap). */
  answers: string[];
  kind: 'submit' | 'timeout' | 'skip';
  hintUsed?: boolean;
  /** Interactive Reading: everything the student chose. */
  interactive?: InteractiveAnswers;
}

export interface SubmitResult {
  session: SessionRecord;
  outcome: QuestionOutcome;
  /** True when this submit repeated one that was already saved; nothing new was recorded. */
  duplicate: boolean;
}

export class SaveError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SaveError';
  }
}

function newId(prefix: string): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${r}`;
}

const EMPTY_TALLY = (): Record<ResultKind, number> => ({ correct: 0, incorrect: 0, timeout: 0, unanswered: 0, skipped: 0 });

/**
 * Runs practice sessions on top of the database. Every answer is saved in one
 * transaction (attempt + progress + mistake + session), keyed so that a
 * double click or a refresh cannot record the same question twice.
 */
export class PracticeService {
  readonly db: AppDB;
  store: VocabStore;
  private nowFn: () => number;
  private rng: () => number;

  constructor(deps: ServiceDeps) {
    this.db = deps.db;
    this.store = deps.store;
    this.nowFn = deps.now ?? Date.now;
    this.rng = deps.rng ?? Math.random;
  }

  now(): number {
    return this.nowFn();
  }

  // ---------------------------------------------------------------- settings & meta
  async getSettings(): Promise<Settings> {
    const row = await this.db.kv.get(SETTINGS_KEY);
    const stored = (row?.value ?? {}) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...stored, customTimers: { ...DEFAULT_SETTINGS.customTimers, ...(stored.customTimers ?? {}) } };
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.db.transaction('rw', this.db.kv, async () => {
      const next = { ...(await this.getSettings()), ...patch };
      await this.db.kv.put({ key: SETTINGS_KEY, value: next });
      if (patch.difficulty) {
        const meta = await this.getMeta();
        meta.adaptive = initialAdaptive(patch.difficulty);
        await this.db.kv.put({ key: META_KEY, value: meta });
      }
      return next;
    });
  }

  async getMeta(): Promise<Meta> {
    const row = await this.db.kv.get(META_KEY);
    const m = row?.value as Meta | undefined;
    return m ?? { seq: 0, adaptive: initialAdaptive(DEFAULT_SETTINGS.difficulty), paragraphServed: {}, createdAt: this.now() };
  }

  async progressMap(): Promise<Map<string, WordProgress>> {
    const all = await this.db.progress.toArray();
    return new Map(all.map((p) => [p.wordId, p]));
  }

  // ---------------------------------------------------------------- sessions
  async activeSession(): Promise<SessionRecord | undefined> {
    const active = await this.db.sessions.where('status').equals('active').toArray();
    return active.sort((a, b) => b.startedAt - a.startedAt)[0];
  }

  async startSession(opts: { mode: Mode; focus?: SessionFocus; wordIds?: string[]; target?: number }): Promise<SessionRecord> {
    const settings = await this.getSettings();
    const now = this.now();
    const focus = opts.focus ?? 'normal';
    const mode: Mode = focus !== 'normal' && (opts.mode === 'read-complete' || opts.mode === 'interactive-reading') ? 'spelling' : opts.mode;
    const session: SessionRecord = {
      id: newId('s'),
      mode,
      focus,
      status: 'active',
      startedAt: now,
      target: opts.target ?? (mode === 'read-complete' ? settings.paragraphsPerSession : mode === 'interactive-reading' ? settings.interactivePerSession : settings.questionsPerSession),
      newQuota: settings.newWordsPerSession,
      reviewQuota: settings.reviewsPerSession,
      index: 0,
      newIntroduced: 0,
      reviewsServed: 0,
      paragraphIds: [],
      interactiveIds: [],
      tally: EMPTY_TALLY(),
      streak: 0,
      bestStreak: 0,
      wordIds: opts.wordIds,
    };
    try {
      await this.db.transaction('rw', this.db.sessions, async () => {
        const active = await this.db.sessions.where('status').equals('active').toArray();
        for (const s of active) await this.db.sessions.put({ ...s, status: 'abandoned', endedAt: now, current: undefined, endReason: 'A new session was started.' });
        await this.db.sessions.add(session);
      });
    } catch (e) {
      throw new SaveError('The new session could not be saved.', e);
    }
    return this.advance(session.id);
  }

  /** Makes sure the session has a current question (or ends it when there is nothing left). */
  async advance(sessionId: string): Promise<SessionRecord> {
    const settings = await this.getSettings();
    const progress = await this.progressMap();
    try {
      return await this.db.transaction('rw', this.db.sessions, this.db.kv, async () => {
        const s = await this.db.sessions.get(sessionId);
        if (!s) throw new Error('Session not found.');
        if (s.status !== 'active' || s.current) return s;
        const now = this.now();
        if (s.index >= s.target) return this.finish(s, now, 'Session complete.');
        const meta = await this.getMeta();
        const level = settings.adaptive ? meta.adaptive.level : settings.difficulty;

        if (s.mode === 'read-complete') {
          const p = chooseParagraph(this.store.paragraphs, meta.paragraphServed, progress, level, this.rng, s.paragraphIds);
          if (!p) return this.finish(s, now, 'No more paragraphs are available.');
          const q = paragraphQuestion(p, this.store.byId, settings.clueRule);
          meta.paragraphServed[p.id] = (meta.paragraphServed[p.id] ?? 0) + 1;
          s.paragraphIds.push(p.id);
          const secs = questionSeconds(settings, 'read-complete', p.difficulty);
          s.current = { question: q, reason: 'new', startedAt: now, limitMs: secs === null ? null : secs * 1000 };
        } else if (s.mode === 'interactive-reading') {
          const served = (meta.interactiveServed ??= {});
          const set = chooseInteractive(this.store.interactive, served, level, this.rng, s.interactiveIds ?? []);
          if (!set) return this.finish(s, now, 'No more Interactive Reading passages are available.');
          const q = interactiveQuestion(set, this.rng);
          served[set.id] = (served[set.id] ?? 0) + 1;
          s.interactiveIds = [...(s.interactiveIds ?? []), set.id];
          // Timed mode uses the DET timing (7 or 8 minutes); custom and untimed follow the settings.
          const secs = settings.timerMode === 'timed' ? interactiveSeconds(set) : questionSeconds(settings, 'interactive-reading', set.difficulty);
          s.current = { question: q, reason: 'new', startedAt: now, limitMs: secs === null ? null : secs * 1000, interactive: emptyInteractiveAnswers(q) };
        } else {
          const pool =
            s.focus === 'words'
              ? (s.wordIds ?? []).map((id) => this.store.byId.get(id)).filter((w): w is VocabWord => !!w && w.contexts.length >= 1)
              : s.focus !== 'normal'
                ? this.store.words.filter((w) => w.contexts.length >= 1)
                : this.store.words.filter((w) => inModePool(w, s.mode));
          const sel = selectNext({
            pool,
            progress,
            seq: meta.seq + 1,
            now,
            sessionId: s.id,
            newIntroduced: s.newIntroduced,
            reviewsServed: s.reviewsServed,
            quotas: { newWords: s.newQuota, reviews: s.reviewQuota },
            level,
            adaptive: settings.adaptive,
            retentionReviews: settings.retentionReviews,
            lastWordId: s.lastWordId,
            focus: s.focus,
            rng: this.rng,
          });
          if (!sel) {
            return this.finish(
              s,
              now,
              s.focus === 'mistakes'
                ? 'No more mistakes are due right now. Well done!'
                : s.focus === 'mastered'
                  ? 'There are no mastered words to review yet.'
                  : `Nothing left to practice in ${MODE_INFO[s.mode].title} right now.`,
            );
          }
          const ctx = chooseContext(sel.word, progress.get(sel.word.id), this.rng);
          const displayMode: SentenceMode =
            s.focus !== 'normal' && s.mode === 'spelling' ? (sel.word.isSmallWord ? 'small-words' : 'spelling') : (s.mode as SentenceMode);
          const q = sentenceQuestion(sel.word, ctx, displayMode, settings.clueRule);
          if (sel.bucket === 'new') s.newIntroduced++;
          if (sel.bucket === 'review') s.reviewsServed++;
          const secs = questionSeconds(settings, displayMode, sel.word.difficulty);
          s.current = { question: q, reason: sel.reason, startedAt: now, limitMs: secs === null ? null : secs * 1000 };
        }
        s.lastOutcome = undefined;
        await this.db.sessions.put(s);
        await this.db.kv.put({ key: META_KEY, value: meta });
        return s;
      });
    } catch (e) {
      if (e instanceof SaveError) throw e;
      throw new SaveError('The next question could not be prepared or saved.', e);
    }
  }

  /** Saves Interactive Reading answers given so far, so a refresh resumes at the same part. */
  async saveInteractiveStep(sessionId: string, questionId: string, answers: InteractiveAnswers): Promise<void> {
    await this.db.transaction('rw', this.db.sessions, async () => {
      const s = await this.db.sessions.get(sessionId);
      if (!s?.current || s.current.question.id !== questionId) return;
      s.current.interactive = answers;
      await this.db.sessions.put(s);
    });
  }

  private async finish(s: SessionRecord, now: number, reason: string): Promise<SessionRecord> {
    s.status = 'completed';
    s.endedAt = now;
    s.current = undefined;
    s.endReason = reason;
    await this.db.sessions.put(s);
    return s;
  }

  async endSession(sessionId: string, reason = 'Ended by the student.'): Promise<SessionRecord | undefined> {
    return this.db.transaction('rw', this.db.sessions, async () => {
      const s = await this.db.sessions.get(sessionId);
      if (!s || s.status !== 'active') return s;
      // An open question is not recorded: leaving early never counts as an answer.
      return this.finish(s, this.now(), reason);
    });
  }

  /**
   * Checks and saves the answer(s) for the current question.
   * Throws SaveError if the database write fails, so the student can be told.
   */
  async submit(sessionId: string, input: SubmitInput): Promise<SubmitResult> {
    const settings = await this.getSettings();
    const now = this.now();
    try {
      return await this.db.transaction('rw', [this.db.sessions, this.db.progress, this.db.attempts, this.db.mistakes, this.db.kv, this.db.irResults], async () => {
        const s = await this.db.sessions.get(sessionId);
        if (!s) throw new Error('Session not found.');
        if (!s.current || s.current.question.id !== input.questionId) {
          if (s.lastOutcome && s.lastOutcome.questionId === input.questionId) return { session: s, outcome: s.lastOutcome, duplicate: true };
          throw new Error('This question is no longer active.');
        }
        const cur = s.current;
        const q = cur.question;
        const elapsed = Math.max(0, now - cur.startedAt);
        const responseMs = cur.limitMs !== null ? Math.min(elapsed, cur.limitMs) : elapsed;
        const meta = await this.getMeta();
        meta.seq += 1;
        const seq = meta.seq;
        if (q.kind === 'interactive') return await this.submitInteractive(s, q, input, { now, seq, responseMs, meta, settings });
        const gaps: Gap[] = q.kind === 'sentence' ? [q.gap] : q.gaps;
        const perGapMs = Math.round(responseMs / Math.max(1, gaps.length));
        const outcomes: GapOutcome[] = [];

        for (let i = 0; i < gaps.length; i++) {
          const gap = gaps[i];
          const word = this.store.byId.get(gap.wordId);
          if (!word) continue;
          const typed = input.answers[i] ?? '';
          const attemptId = `${s.id}:${s.index}:${i}`;
          if (await this.db.attempts.get(attemptId)) throw new Error('duplicate');
          let result: ResultKind;
          let check: ReturnType<typeof checkGap> | undefined;
          if (input.kind === 'skip') result = 'skipped';
          else {
            check = checkGap(gap, typed, {
              acceptUk: q.mode === 'fill-blanks',
              familyForms: this.store.familyForms(word),
              base: word.base,
              ending: word.ending,
            });
            if (check.correct) result = 'correct';
            else if (input.kind === 'timeout') result = 'timeout';
            else if (check.empty) result = 'unanswered';
            else result = 'incorrect';
          }
          const prev = (await this.db.progress.get(word.id)) ?? newProgress(word.id);
          const applied = applyResult(prev, { result, contextId: gap.contextId, responseMs: perGapMs, at: now, seq, sessionId: s.id }, { reviewFrequency: settings.reviewFrequency, rng: this.rng });
          await this.db.progress.put(applied.progress);
          const attempt: AttemptRecord = {
            id: attemptId,
            sessionId: s.id,
            questionId: q.id,
            mode: q.mode,
            wordId: word.id,
            contextId: gap.contextId,
            result,
            answer: check?.full ?? '',
            correctAnswer: gap.answer,
            responseMs: perGapMs,
            at: now,
            seq,
            errorTypes: check?.analysis?.types ?? (result === 'timeout' ? ['empty'] : []),
            hintUsed: !!input.hintUsed,
            difficulty: word.difficulty,
          };
          await this.db.attempts.add(attempt);
          if (result === 'incorrect' || result === 'timeout' || result === 'unanswered') {
            const { before, after, sentence } = surroundings(q, i);
            const mistake: MistakeRecord = {
              id: attemptId,
              attemptId,
              wordId: word.id,
              word: word.word,
              answer: check?.full ?? '',
              correctAnswer: gap.answer,
              sentence,
              contextId: gap.contextId,
              mode: q.mode,
              result,
              at: now,
              responseMs: perGapMs,
              previousMistakes: mistakes(prev),
              errorTypes: attempt.errorTypes,
              rule: spellingRules(word)[0]?.en ?? '',
              clue: contextClues(word, before, after)[0]?.en ?? '',
            };
            await this.db.mistakes.put(mistake);
          }
          s.tally[result]++;
          if (result === 'correct') {
            s.streak++;
            s.bestStreak = Math.max(s.bestStreak, s.streak);
          } else if (result !== 'skipped') s.streak = 0;
          outcomes.push({
            wordId: word.id,
            word: word.word,
            contextId: gap.contextId,
            typed,
            full: check?.full ?? '',
            correctAnswer: gap.answer,
            result,
            errorTypes: attempt.errorTypes,
            becameMastered: applied.becameMastered,
            lostMastery: applied.lostMastery,
            schedule:
              s.focus === 'words' && applied.gap !== undefined
                ? `${applied.explanation} (In this practice-selected-words session it can come back sooner; normal practice keeps the spacing.)`
                : applied.explanation,
            usedUkVariant: !!check?.usedUkVariant,
            previousMistakes: mistakes(prev),
          });
          if (q.kind === 'sentence' && result !== 'skipped') meta.adaptive = updateAdaptive(meta.adaptive, result === 'correct').state;
        }
        if (q.kind === 'paragraph' && input.kind !== 'skip') {
          const graded = outcomes.filter((o) => o.result !== 'skipped');
          const acc = graded.length ? graded.filter((o) => o.result === 'correct').length / graded.length : 0;
          meta.adaptive = updateAdaptive(meta.adaptive, acc >= 0.8).state;
        }
        const outcome: QuestionOutcome = {
          questionId: q.id,
          index: s.index,
          gaps: outcomes,
          responseMs,
          timedOut: input.kind === 'timeout',
          skipped: input.kind === 'skip',
          savedAt: now,
        };
        s.index++;
        s.current = undefined;
        s.lastOutcome = outcome;
        s.lastWordId = q.kind === 'sentence' ? q.wordId : s.lastWordId;
        await this.db.sessions.put(s);
        await this.db.kv.put({ key: META_KEY, value: meta });
        return { session: s, outcome, duplicate: false };
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'This question is no longer active.') throw e;
      throw new SaveError('Your answer could not be saved. Your progress for this question was not recorded.', e);
    }
  }

  /** Scores and saves one Interactive Reading set (runs inside submit's transaction). */
  private async submitInteractive(
    s: SessionRecord,
    q: InteractiveQuestion,
    input: SubmitInput,
    ctx: { now: number; seq: number; responseMs: number; meta: Meta; settings: Settings },
  ): Promise<SubmitResult> {
    const { now, seq, responseMs, meta, settings } = ctx;
    const set = this.store.interactive.find((x) => x.id === q.setId);
    if (!set) throw new Error('This passage is no longer in the library.');
    const answers = input.interactive ?? s.current?.interactive ?? emptyInteractiveAnswers(q);
    const score = scoreInteractive(set, q, answers);
    const timedOut = input.kind === 'timeout';
    const resultOf = (correct: boolean, answered: boolean): ResultKind =>
      input.kind === 'skip' ? 'skipped' : correct ? 'correct' : timedOut && !answered ? 'timeout' : !answered ? 'unanswered' : 'incorrect';
    const perItemMs = Math.round(responseMs / Math.max(1, score.total));
    const outcomes: GapOutcome[] = [];
    const blankChoices: (string | null)[] = [];

    for (let i = 0; i < set.blanks.length; i++) {
      const b = set.blanks[i];
      const chosenIdx = answers.blanks[i] ?? null;
      const chosen = chosenIdx === null ? null : (q.blanks[i].options[chosenIdx] ?? null);
      blankChoices.push(chosen);
      const result = resultOf(score.blanks[i], chosen !== null);
      s.tally[result]++;
      if (result === 'correct') {
        s.streak++;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
      } else if (result !== 'skipped') s.streak = 0;
      const word = b.wordId ? this.store.byId.get(b.wordId) : undefined;
      const contextId = `ir:${set.id}:${i}`;
      const attemptId = `${s.id}:${s.index}:${i}`;
      if (!word) {
        outcomes.push({ wordId: '', word: b.answer, contextId, typed: chosen ?? '', full: chosen ?? '', correctAnswer: b.answer, result, errorTypes: [], becameMastered: false, lostMastery: false, schedule: '', usedUkVariant: false, previousMistakes: 0 });
        continue;
      }
      if (await this.db.attempts.get(attemptId)) throw new Error('duplicate');
      const prev = (await this.db.progress.get(word.id)) ?? newProgress(word.id);
      const applied = applyResult(prev, { result, contextId, responseMs: perItemMs, at: now, seq, sessionId: s.id }, { reviewFrequency: settings.reviewFrequency, rng: this.rng, recognitionOnly: true });
      await this.db.progress.put(applied.progress);
      await this.db.attempts.add({
        id: attemptId,
        sessionId: s.id,
        questionId: q.id,
        mode: 'interactive-reading',
        wordId: word.id,
        contextId,
        result,
        answer: chosen ?? '',
        correctAnswer: b.answer,
        responseMs: perItemMs,
        at: now,
        seq,
        errorTypes: result === 'incorrect' ? ['different-word'] : [],
        hintUsed: false,
        difficulty: word.difficulty,
      });
      if (result === 'incorrect' || result === 'timeout' || result === 'unanswered') {
        const sentence = sentenceAround(set.text, b.start, b.end);
        await this.db.mistakes.put({
          id: attemptId,
          attemptId,
          wordId: word.id,
          word: word.word,
          answer: chosen ?? '',
          correctAnswer: b.answer,
          sentence,
          contextId,
          mode: 'interactive-reading',
          result,
          at: now,
          responseMs: perItemMs,
          previousMistakes: mistakes(prev),
          errorTypes: result === 'incorrect' ? ['different-word'] : ['empty'],
          rule: b.why ?? '',
          clue: '',
        });
      }
      outcomes.push({
        wordId: word.id,
        word: word.word,
        contextId,
        typed: chosen ?? '',
        full: chosen ?? '',
        correctAnswer: b.answer,
        result,
        errorTypes: result === 'incorrect' ? ['different-word'] : [],
        becameMastered: false,
        lostMastery: applied.lostMastery,
        schedule: applied.explanation,
        usedUkVariant: false,
        previousMistakes: mistakes(prev),
      });
    }

    const parts: IrPartOutcome[] = [];
    for (const [k, p] of score.parts.entries()) {
      const result = resultOf(p.correct, p.answered);
      s.tally[result]++;
      if (result === 'correct') {
        s.streak++;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
      } else if (result !== 'skipped') s.streak = 0;
      parts.push({ part: p.part, n: p.n, correct: p.correct, score: p.score, chosen: p.chosen, expected: p.expected });
      await this.db.irResults.put({ id: `${s.id}:${s.index}:${p.part}:${p.n}:${k}`, sessionId: s.id, setId: set.id, part: p.part, correct: p.correct, score: p.score, answered: p.answered, at: now });
    }
    if (input.kind !== 'skip') meta.adaptive = updateAdaptive(meta.adaptive, score.correct / Math.max(1, score.total) >= 0.8).state;

    const outcome: QuestionOutcome = {
      questionId: q.id,
      index: s.index,
      gaps: outcomes,
      parts,
      blankChoices,
      responseMs,
      timedOut,
      skipped: input.kind === 'skip',
      savedAt: now,
    };
    s.index++;
    s.current = undefined;
    s.lastOutcome = outcome;
    await this.db.sessions.put(s);
    await this.db.kv.put({ key: META_KEY, value: meta });
    return { session: s, outcome, duplicate: false };
  }

  // ---------------------------------------------------------------- word management
  async reopenWord(wordId: string): Promise<void> {
    await this.db.transaction('rw', this.db.progress, async () => {
      const p = (await this.db.progress.get(wordId)) ?? newProgress(wordId);
      await this.db.progress.put(reopen(p, this.now()));
    });
  }

  /** Words not yet mastered (the Active Practice List). */
  activeWords(progress: Map<string, WordProgress>): VocabWord[] {
    return this.store.words.filter((w) => progress.get(w.id)?.status !== 'mastered');
  }
}

/** The sentence (and neighboring text) around one gap, for the Mistake Bank and clue explanations. */
function surroundings(q: Question, gapIndex: number): { before: string; after: string; sentence: string } {
  if (q.kind === 'sentence') return { before: q.before, after: q.after, sentence: q.sentence };
  if (q.kind === 'interactive') return { before: '', after: '', sentence: '' };
  const before = q.segments[gapIndex];
  const after = q.segments[gapIndex + 1];
  const full = q.segments.map((seg, k) => seg + (k < q.gaps.length ? q.gaps[k].answer : '')).join('');
  let offset = 0;
  for (let k = 0; k < gapIndex; k++) offset += q.segments[k].length + q.gaps[k].answer.length;
  offset += q.segments[gapIndex].length;
  let start = 0;
  for (const m of full.slice(0, offset).matchAll(/[.!?]["”’)]?\s+/g)) start = (m.index ?? 0) + m[0].length;
  const endMatch = /[.!?]["”’)]?(\s|$)/.exec(full.slice(offset));
  const end = endMatch ? offset + (endMatch.index ?? 0) + endMatch[0].trimEnd().length : full.length;
  return { before, after, sentence: full.slice(start, end).trim() };
}

/** The sentence of `text` that contains the span [start, end). */
export function sentenceAround(text: string, start: number, end: number): string {
  let from = 0;
  for (const m of text.slice(0, start).matchAll(/[.!?]["”’)]?\s+/g)) from = (m.index ?? 0) + m[0].length;
  const tail = /[.!?]["”’)]?(\s|$)/.exec(text.slice(end));
  const to = tail ? end + (tail.index ?? 0) + tail[0].trimEnd().length : text.length;
  return text.slice(from, to).trim();
}
