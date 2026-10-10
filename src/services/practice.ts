import { initialAdaptive, updateAdaptive } from '../engine/adaptive';
import { checkGap } from '../engine/answer';
import { contextClues } from '../engine/clues';
import { DEFAULT_SETTINGS, MODE_INFO, questionSeconds, type Settings } from '../engine/config';
import { applyResult, mistakes, newProgress, reopen } from '../engine/progress';
import { chooseInteractive, emptyInteractiveAnswers, interactiveQuestion, interactiveSeconds, scoreInteractive } from '../engine/interactive';
import { inModePool, paragraphQuestion, sentenceQuestion } from '../engine/questions';
import { chooseContext, chooseParagraph, selectNext } from '../engine/selection';
import { sentenceAt } from '../engine/sentences';
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

/** Reasons the current rules give for asking a word (see selectNext). */
const CURRENT_REASONS: string[] = ['new', 'mistake-focus', 'chosen', 'mastered-review'];

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
    const s = active.sort((a, b) => b.startedAt - a.startedAt)[0];
    if (s && (await this.staleQuestion(s))) {
      // Chosen under rules or data that no longer apply: ask a fresh question instead (nothing is recorded).
      s.current = undefined;
      s.lastOutcome = undefined;
      await this.db.sessions.put(s);
      return this.advance(s.id);
    }
    return s;
  }

  /**
   * An open word question that the current rules would not ask: one saved by the old review
   * schedule (a review, a second sentence, a retention check), a new-word question for a word
   * that has been answered since, or one whose sentence is no longer the word's sentence.
   */
  private async staleQuestion(s: SessionRecord): Promise<boolean> {
    const cur = s.current;
    if (!cur || cur.question.kind !== 'sentence') return false;
    if (!CURRENT_REASONS.includes(cur.reason)) return true;
    const w = this.store.byId.get(cur.question.wordId);
    if (!w || w.contexts[0]?.id !== cur.question.gap.contextId) return true;
    const status = (await this.db.progress.get(w.id))?.status ?? 'new';
    if (s.focus === 'normal') return status !== 'new';
    if (s.focus === 'mistakes') return status !== 'learning';
    return false;
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
      target: opts.target ?? (await this.defaultTarget(mode, focus, settings, opts.wordIds)),
      index: 0,
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

  /**
   * How many questions a new session plans. Every word is asked at most once per session, so
   * Practice My Mistakes covers every word waiting in the Mistake Bank, and the other word
   * sessions never plan more questions than they have words.
   */
  private async defaultTarget(mode: Mode, focus: SessionFocus, settings: Settings, wordIds?: string[]): Promise<number> {
    if (mode === 'read-complete') return settings.paragraphsPerSession;
    if (mode === 'interactive-reading') return settings.interactivePerSession;
    if (focus === 'words') return Math.max(1, wordIds?.length ?? 1);
    if (focus === 'normal') return settings.questionsPerSession;
    const progress = await this.progressMap();
    const want = focus === 'mistakes' ? 'learning' : 'mastered';
    const n = this.store.words.filter((w) => w.contexts.length >= 1 && progress.get(w.id)?.status === want).length;
    return focus === 'mistakes' ? Math.max(1, n) : Math.max(1, Math.min(settings.questionsPerSession, n));
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
        if (s.index >= s.target) return this.finish(s, now, s.focus === 'mistakes' ? this.nothingLeft(s, this.store.words, progress) : 'Session complete.');
        const meta = await this.getMeta();
        const level = settings.adaptive ? meta.adaptive.level : settings.difficulty;

        if (s.mode === 'read-complete') {
          const p = chooseParagraph(this.store.paragraphs, meta.paragraphServed, progress, level, this.rng, s.paragraphIds);
          if (!p) return this.finish(s, now, 'No more paragraphs are available.');
          // Words waiting in the Mistake Bank are shown whole: they are fixed only in Practice My Mistakes.
          const q = paragraphQuestion(p, this.store.byId, settings.clueRule, (id) => progress.get(id)?.status === 'learning');
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
            sessionId: s.id,
            level,
            adaptive: settings.adaptive,
            lastWordId: s.lastWordId,
            focus: s.focus,
            rng: this.rng,
          });
          if (!sel) return this.finish(s, now, this.nothingLeft(s, pool, progress));
          const ctx = chooseContext(sel.word);
          const displayMode: SentenceMode =
            s.focus !== 'normal' && s.mode === 'spelling' ? (sel.word.isSmallWord ? 'small-words' : 'spelling') : (s.mode as SentenceMode);
          const q = sentenceQuestion(sel.word, ctx, displayMode, settings.clueRule);
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

  /** Why a word session ended early: nothing left to ask under the one-pass rule. */
  private nothingLeft(s: SessionRecord, pool: VocabWord[], progress: Map<string, WordProgress>): string {
    if (s.focus === 'mistakes') {
      const open = pool.filter((w) => progress.get(w.id)?.status === 'learning').length;
      return open
        ? `You have tried every word in your Mistake Bank once in this session. ${open} still need${open === 1 ? 's' : ''} a correct answer: start Practice My Mistakes again.`
        : 'Your Mistake Bank is empty: every missed word is mastered. Well done!';
    }
    if (s.focus === 'mastered') return 'There are no more mastered words to review in this session.';
    if (s.focus === 'words') return 'You have answered every word you chose.';
    const missed = pool.filter((w) => progress.get(w.id)?.status === 'learning').length;
    // Words skipped in this session are still new: they come back in the next session.
    const skipped = pool.filter((w) => (progress.get(w.id)?.status ?? 'new') === 'new').length;
    const bank = missed ? ` ${missed} missed word${missed === 1 ? ' is' : 's are'} waiting in your Mistake Bank.` : '';
    if (skipped)
      return `You have been through every new word in ${MODE_INFO[s.mode].title} for this session. ${skipped} skipped word${skipped === 1 ? '' : 's'} will come up again next session.${bank}`;
    return `There are no new words left in ${MODE_INFO[s.mode].title}.${bank}`;
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
        if (q.kind === 'interactive') return await this.submitInteractive(s, q, input, { now, seq, responseMs, meta });
        const gaps: Gap[] = q.kind === 'sentence' ? [q.gap] : q.gaps;
        const perGapMs = Math.round(responseMs / Math.max(1, gaps.length));
        const outcomes: GapOutcome[] = [];

        // Check every gap first. A word can fill two gaps of one text: it gets one result for
        // the whole text (any miss counts), so it is never mastered and un-mastered in one answer.
        const checked = gaps.map((gap, i) => {
          const word = this.store.byId.get(gap.wordId);
          if (!word) return undefined;
          let result: ResultKind;
          let check: ReturnType<typeof checkGap> | undefined;
          if (input.kind === 'skip') result = 'skipped';
          else {
            check = checkGap(gap, input.answers[i] ?? '', {
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
          return { gap, word, result, check };
        });
        const deciding = new Map<string, number>();
        const rank = (r: ResultKind) => (r === 'skipped' ? 0 : r === 'correct' ? 1 : 2);
        checked.forEach((c, i) => {
          if (!c) return;
          const j = deciding.get(c.word.id);
          if (j === undefined || rank(c.result) > rank(checked[j]!.result)) deciding.set(c.word.id, i);
        });
        const applied = new Map<string, { prev: WordProgress; out: ReturnType<typeof applyResult> }>();
        for (const [wordId, i] of deciding) {
          const c = checked[i]!;
          const prev = (await this.db.progress.get(wordId)) ?? newProgress(wordId);
          const out = applyResult(prev, { result: c.result, contextId: c.gap.contextId, responseMs: perGapMs, at: now, seq, sessionId: s.id });
          await this.db.progress.put(out.progress);
          applied.set(wordId, { prev, out });
        }

        for (let i = 0; i < gaps.length; i++) {
          const c = checked[i];
          if (!c) continue;
          const { gap, word, result, check } = c;
          const typed = input.answers[i] ?? '';
          const attemptId = `${s.id}:${s.index}:${i}`;
          if (await this.db.attempts.get(attemptId)) throw new Error('duplicate');
          const { prev, out } = applied.get(word.id)!;
          const decides = deciding.get(word.id) === i;
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
            const { before, after, sentence, at } = surroundings(q, i);
            const mistake: MistakeRecord = {
              id: attemptId,
              attemptId,
              wordId: word.id,
              word: word.word,
              answer: check?.full ?? '',
              correctAnswer: gap.answer,
              sentence,
              answerStart: at,
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
            // A word's result is applied once per text: only that gap reports the change.
            becameMastered: decides && out.becameMastered,
            lostMastery: decides && out.lostMastery,
            schedule: decides ? out.explanation : `The same word is also in another gap of this text: ${out.explanation}`,
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
    ctx: { now: number; seq: number; responseMs: number; meta: Meta },
  ): Promise<SubmitResult> {
    const { now, seq, responseMs, meta } = ctx;
    const set = this.store.interactive.find((x) => x.id === q.setId);
    if (!set || set.blanks.length !== q.blanks.length) {
      // The passage was removed or changed by an update: close it without scoring anything.
      const outcome: QuestionOutcome = { questionId: q.id, index: s.index, gaps: [], parts: [], responseMs, timedOut: false, skipped: true, savedAt: now };
      s.index++;
      s.current = undefined;
      s.lastOutcome = outcome;
      await this.db.sessions.put(s);
      await this.db.kv.put({ key: META_KEY, value: meta });
      return { session: s, outcome, duplicate: false };
    }
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
      // Every blank is kept for the statistics, including words that are not in the library.
      await this.db.irResults.put({ id: `${s.id}:${s.index}:complete-sentences:${i}`, sessionId: s.id, setId: set.id, part: 'complete-sentences', correct: score.blanks[i], score: score.blanks[i] ? 1 : 0, answered: chosen !== null, at: now });
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
      // A word waiting in the Mistake Bank is fixed only in Practice My Mistakes: here its blank
      // counts for the passage score, but the word itself is left as it is.
      const waiting = prev.status === 'learning';
      const applied = waiting
        ? { progress: prev, becameMastered: false, lostMastery: false, explanation: 'This word is in your Mistake Bank: fix it in Practice My Mistakes.' }
        : applyResult(prev, { result, contextId, responseMs: perItemMs, at: now, seq, sessionId: s.id }, { recognitionOnly: true });
      if (!waiting) await this.db.progress.put(applied.progress);
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
      if (!waiting && (result === 'incorrect' || result === 'timeout' || result === 'unanswered')) {
        const { sentence, at } = sentenceAt(set.text, b.start, b.end);
        await this.db.mistakes.put({
          id: attemptId,
          attemptId,
          wordId: word.id,
          word: word.word,
          answer: chosen ?? '',
          correctAnswer: b.answer,
          sentence,
          answerStart: at,
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
function surroundings(q: Question, gapIndex: number): { before: string; after: string; sentence: string; at: number } {
  if (q.kind === 'sentence') return { before: q.before, after: q.after, sentence: q.sentence, at: q.before.length };
  if (q.kind === 'interactive') return { before: '', after: '', sentence: '', at: 0 };
  const before = q.segments[gapIndex];
  const after = q.segments[gapIndex + 1];
  const full = q.segments.map((seg, k) => seg + (k < q.gaps.length ? q.gaps[k].answer : '')).join('');
  let offset = 0;
  for (let k = 0; k < gapIndex; k++) offset += q.segments[k].length + q.gaps[k].answer.length;
  offset += q.segments[gapIndex].length;
  return { before, after, ...sentenceAt(full, offset, offset + q.gaps[gapIndex].answer.length) };
}
