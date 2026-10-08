import { initialAdaptive, updateAdaptive } from '../engine/adaptive';
import { checkGap } from '../engine/answer';
import { contextClues } from '../engine/clues';
import { DEFAULT_SETTINGS, MODE_INFO, questionSeconds, type Settings } from '../engine/config';
import { applyResult, mistakes, newProgress, reopen } from '../engine/progress';
import { inModePool, paragraphQuestion, sentenceQuestion } from '../engine/questions';
import { chooseContext, chooseParagraph, selectNext } from '../engine/selection';
import { spellingRules } from '../engine/spelling';
import type { AttemptRecord, Gap, MistakeRecord, Mode, Question, ResultKind, VocabWord, WordProgress } from '../engine/types';
import type { VocabStore } from '../data/vocabStore';
import { META_KEY, SETTINGS_KEY, type AppDB, type GapOutcome, type Meta, type QuestionOutcome, type SessionFocus, type SessionRecord } from '../db/db';

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
    const mode: Mode = focus !== 'normal' && opts.mode === 'read-complete' ? 'spelling' : opts.mode;
    const session: SessionRecord = {
      id: newId('s'),
      mode,
      focus,
      status: 'active',
      startedAt: now,
      target: opts.target ?? (mode === 'read-complete' ? settings.paragraphsPerSession : settings.questionsPerSession),
      newQuota: settings.newWordsPerSession,
      reviewQuota: settings.reviewsPerSession,
      index: 0,
      newIntroduced: 0,
      reviewsServed: 0,
      paragraphIds: [],
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
          const q = paragraphQuestion(p, this.store.byId);
          meta.paragraphServed[p.id] = (meta.paragraphServed[p.id] ?? 0) + 1;
          s.paragraphIds.push(p.id);
          const secs = questionSeconds(settings, 'read-complete', p.difficulty);
          s.current = { question: q, reason: 'new', startedAt: now, limitMs: secs === null ? null : secs * 1000 };
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
          const displayMode =
            s.focus !== 'normal' && s.mode === 'spelling' ? (sel.word.isSmallWord ? 'small-words' : 'spelling') : (s.mode as Exclude<Mode, 'read-complete'>);
          const q = sentenceQuestion(sel.word, ctx, displayMode);
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
      return await this.db.transaction('rw', [this.db.sessions, this.db.progress, this.db.attempts, this.db.mistakes, this.db.kv], async () => {
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
