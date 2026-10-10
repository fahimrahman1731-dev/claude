import { describe, expect, it } from 'vitest';
import { checkGap } from '../../src/engine/answer';
import { updateAdaptive, initialAdaptive } from '../../src/engine/adaptive';
import { derive, endingSplit } from '../../src/engine/morphology';
import { applyResult, inMistakeBank, migrateProgress, mistakes, newProgress, reopen } from '../../src/engine/progress';
import { livePriority, livePriorityScore } from '../../src/engine/priority';
import { sentenceQuestion, validateQuestion } from '../../src/engine/questions';
import { chooseContext, REASON_TEXT, selectNext, type SelectionState } from '../../src/engine/selection';
import { analyzeError } from '../../src/engine/spelling';
import { computeStats, streaks, dateKey } from '../../src/engine/stats';
import { clueSplit, halfSplit, locateTarget } from '../../src/engine/text';
import { checkContext, checkContextSet } from '../../src/engine/validate';
import type { ResultKind, WordProgress } from '../../src/engine/types';
import { makeWord } from '../helpers';

// Like every word in the app, a test word has one practice sentence.
const sig = makeWord('significant', ['The discovery had a significant impact on modern medicine.']);

describe('text and splitting', () => {
  it('splits like the DET: hidden part equals or exceeds visible part by one', () => {
    expect(halfSplit('the')).toEqual({ visible: 't', hiddenLength: 2 });
    expect(halfSplit('that')).toEqual({ visible: 'th', hiddenLength: 2 });
    expect(halfSplit('significant')).toEqual({ visible: 'signi', hiddenLength: 6 });
    // The app's default clue: half the word, but never more than 3 letters (1 to 3).
    expect(clueSplit('is')).toEqual({ visible: 'i', hiddenLength: 1 });
    expect(clueSplit('the')).toEqual({ visible: 't', hiddenLength: 2 });
    expect(clueSplit('city')).toEqual({ visible: 'ci', hiddenLength: 2 });
    expect(clueSplit('strange')).toEqual({ visible: 'str', hiddenLength: 4 });
    expect(clueSplit('confusing')).toEqual({ visible: 'con', hiddenLength: 6 });
    expect(clueSplit('confusing', 'half')).toEqual({ visible: 'conf', hiddenLength: 5 });
  });
  it('requires an unambiguous target', () => {
    expect(locateTarget('She put the cup on the table.', 'the')).toHaveProperty('error');
    const ok = locateTarget('She put [the] cup on a table.', 'the');
    expect(ok).toEqual({ sentence: 'She put the cup on a table.', start: 8, end: 11 });
    expect(locateTarget("It's a well-known fact.", 'well')).toHaveProperty('error');
  });
});

describe('answer checking', () => {
  const q = sentenceQuestion(sig, sig.contexts[0], 'fill-blanks');
  it('builds a valid question with at most 3 letters given (or half the word on request)', () => {
    expect(validateQuestion(q, sig)).toBeUndefined();
    expect(q.gap.visible).toBe('sig');
    expect(q.gap.hiddenLength).toBe(8);
    const half = sentenceQuestion(sig, sig.contexts[0], 'spelling', 'half');
    expect(half.gap.visible).toBe('signi');
    expect(validateQuestion(half, sig)).toBeUndefined();
  });
  it('accepts the missing letters or the whole word, exact spelling only', () => {
    expect(checkGap(q.gap, 'nificant', { acceptUk: false }).correct).toBe(true);
    expect(checkGap(q.gap, 'Significant', { acceptUk: false }).correct).toBe(true);
    expect(checkGap(q.gap, 'nificent', { acceptUk: false }).correct).toBe(false);
    expect(checkGap(q.gap, '', { acceptUk: false }).empty).toBe(true);
  });
  it('accepts UK spelling only when the mode allows it', () => {
    const org = makeWord('organize', ['We need to organize the files before Monday.'], { ukVariants: ['organise'] });
    const g = sentenceQuestion(org, org.contexts[0], 'fill-blanks').gap;
    expect(checkGap(g, 'organise', { acceptUk: true }).correct).toBe(true);
    const r = checkGap(g, 'organise', { acceptUk: false });
    expect(r.correct).toBe(false);
    expect(r.analysis?.types).toContain('uk-spelling');
  });
});

describe('error analysis', () => {
  it('finds missing double letters', () => {
    expect(analyzeError('acommodate', 'accommodate').types).toContain('double-letter');
  });
  it('finds ie/ei swaps and transpositions', () => {
    expect(analyzeError('recieve', 'receive').types).toContain('ie-ei');
    expect(analyzeError('form', 'from').types).toContain('transposition');
  });
  it('finds a wrong ending', () => {
    expect(analyzeError('independant', 'independent').types).toContain('wrong-ending');
  });
  it('finds a wrong grammatical form', () => {
    expect(analyzeError('develop', 'developed', { familyForms: ['develop', 'development'] }).types).toContain('wrong-form');
  });
  it('finds missing and extra letters', () => {
    expect(analyzeError('enviroment', 'environment').types).toContain('missing-letters');
    expect(analyzeError('untill', 'until').types).toContain('double-letter');
  });
});

describe('morphology', () => {
  it('derives forms with the guide’s spelling rules', () => {
    expect(derive('making', 'make')).toMatchObject({ change: 'drop-e', suffix: 'ing' });
    expect(derive('stopped', 'stop')).toMatchObject({ change: 'double' });
    expect(derive('centuries', 'century')).toMatchObject({ change: 'y-to-i' });
    expect(derive('development', 'develop')).toMatchObject({ suffix: 'ment' });
  });
  it('chooses the hidden ending', () => {
    expect(endingSplit('development', 'develop')).toMatchObject({ visible: 'develop', hidden: 'ment' });
    expect(endingSplit('stopped', 'stop')).toMatchObject({ visible: 'stop', hidden: 'ped', change: 'double' });
    expect(endingSplit('information', undefined, ['ending:-tion', 'ending:-sion'])).toMatchObject({ hidden: 'tion' });
  });
});

describe('mastery: one correct answer, mistakes go to the Mistake Bank', () => {
  const base = newProgress(sig.id);
  const c1 = sig.contexts[0].id;
  const ev = (result: ResultKind, seq: number, sessionId = 's1') => ({ result, contextId: c1, responseMs: 3000, at: 1_000_000 + seq, seq, sessionId });

  it('one correct typed answer masters a new word at once', () => {
    const a = applyResult(base, ev('correct', 1));
    expect(a.becameMastered).toBe(true);
    expect(a.lostMastery).toBe(false);
    expect(a.progress.status).toBe('mastered');
    expect(a.progress.masteredAt).toBe(1_000_001);
    expect(a.progress).toMatchObject({ attempts: 1, correct: 1, consecutiveCorrect: 1, correctContextIds: [c1], streakContextIds: [] });
    expect(a.progress.history).toEqual([{ at: 1_000_001, event: 'mastered' }]);
    expect(a.explanation).toMatch(/mastered/i);
    expect(a.explanation).toMatch(/Completed Checklist/);
  });

  it('a wrong, timed-out or empty answer puts the word in the Mistake Bank', () => {
    for (const [result, field] of [
      ['incorrect', 'incorrect'],
      ['timeout', 'timeouts'],
      ['unanswered', 'unanswered'],
    ] as const) {
      const a = applyResult(base, ev(result, 1));
      expect(a.becameMastered, result).toBe(false);
      expect(a.lostMastery, result).toBe(false);
      expect(a.progress.status, result).toBe('learning');
      expect(inMistakeBank(a.progress), result).toBe(true);
      expect(a.progress[field], result).toBe(1);
      expect(a.progress.attempts, result).toBe(1);
      expect(a.progress.consecutiveIncorrect, result).toBe(1);
      expect(mistakes(a.progress), result).toBe(1);
      expect(a.explanation, result).toMatch(/Mistake Bank/);
      expect(a.explanation, result).toMatch(/Practice My Mistakes/);
      expect(a.explanation, result).not.toMatch(/review|due|interval|retention/i);
    }
  });

  it('another miss keeps the word in the Mistake Bank and counts the mistakes', () => {
    const a = applyResult(base, ev('incorrect', 1)).progress;
    const b = applyResult(a, ev('timeout', 2, 's2'));
    expect(b.progress.status).toBe('learning');
    expect(b.progress.consecutiveIncorrect).toBe(2);
    expect(mistakes(b.progress)).toBe(2);
    expect(b.explanation).toMatch(/2 mistakes/);
    expect(b.explanation).toMatch(/Mistake Bank/);
  });

  it('a correct answer on a word in the Mistake Bank masters it', () => {
    let p = applyResult(base, ev('incorrect', 1)).progress;
    p = applyResult(p, ev('incorrect', 2, 's2')).progress;
    const r = applyResult(p, ev('correct', 3, 's3'));
    expect(r.becameMastered).toBe(true);
    expect(r.progress.status).toBe('mastered');
    expect(inMistakeBank(r.progress)).toBe(false);
    expect(r.progress).toMatchObject({ attempts: 3, correct: 1, incorrect: 2, consecutiveIncorrect: 0, consecutiveCorrect: 1 });
    expect(r.explanation).toMatch(/left your Mistake Bank/);
  });

  it('a correct answer on a mastered word keeps it mastered', () => {
    const p = applyResult(base, ev('correct', 1)).progress;
    const r = applyResult(p, ev('correct', 2, 's2'));
    expect(r.becameMastered).toBe(false);
    expect(r.progress.status).toBe('mastered');
    expect(r.progress.masteredAt).toBe(1_000_001);
    expect(r.progress.history.map((h) => h.event)).toEqual(['mastered']);
  });

  it('a mistake on a mastered word loses mastery and puts it in the Mistake Bank', () => {
    const p = applyResult(base, ev('correct', 1)).progress;
    const r = applyResult(p, ev('timeout', 30, 's2'));
    expect(r.lostMastery).toBe(true);
    expect(r.becameMastered).toBe(false);
    expect(r.progress.status).toBe('learning');
    expect(r.progress.masteredAt).toBeUndefined();
    expect(r.progress.history.map((h) => h.event)).toEqual(['mastered', 'lost-mastery']);
    expect(r.explanation).toMatch(/Mistake Bank/);
    expect(r.explanation).toMatch(/left the Completed Checklist/);
  });

  it('choosing the right word from options (recognitionOnly) never masters a word', () => {
    const fresh = applyResult(base, ev('correct', 1), { recognitionOnly: true });
    expect(fresh.becameMastered).toBe(false);
    expect(fresh.progress.status).toBe('new');
    expect(fresh.progress.correct).toBe(1);
    expect(fresh.explanation).toMatch(/does not master/);

    const missed = applyResult(base, ev('incorrect', 1)).progress;
    const stays = applyResult(missed, ev('correct', 2, 's2'), { recognitionOnly: true });
    expect(stays.becameMastered).toBe(false);
    expect(stays.progress.status).toBe('learning');
    expect(stays.explanation).toMatch(/Mistake Bank/);

    const mastered = applyResult(base, ev('correct', 1)).progress;
    const still = applyResult(mastered, ev('correct', 2, 's2'), { recognitionOnly: true });
    expect(still.progress.status).toBe('mastered');
    expect(still.lostMastery).toBe(false);
  });

  it('a wrong choice from options is a mistake like any other', () => {
    const a = applyResult(base, ev('incorrect', 1), { recognitionOnly: true });
    expect(a.progress.status).toBe('learning');
    expect(a.progress.incorrect).toBe(1);
    const mastered = applyResult(base, ev('correct', 1)).progress;
    const b = applyResult(mastered, ev('incorrect', 2, 's2'), { recognitionOnly: true });
    expect(b.lostMastery).toBe(true);
    expect(b.progress.status).toBe('learning');
    expect(b.progress.history.map((h) => h.event)).toEqual(['mastered', 'lost-mastery']);
  });

  it('skips change nothing but are counted as skips', () => {
    const a = applyResult(base, ev('skipped', 1));
    const b = applyResult(a.progress, ev('skipped', 2));
    expect(b.progress.status).toBe('new');
    expect(b.progress.attempts).toBe(0);
    expect(b.progress.skips).toBe(2);
    expect(b.progress.lastSessionId).toBe('s1');
    expect(b.becameMastered).toBe(false);
    expect(b.explanation).toMatch(/not counted/);

    const missed = applyResult(base, ev('incorrect', 1)).progress;
    const skipped = applyResult(missed, ev('skipped', 2, 's2')).progress;
    expect(skipped.status).toBe('learning');
    expect(mistakes(skipped)).toBe(1);
    expect(skipped.attempts).toBe(1);
    const mastered = applyResult(base, ev('correct', 1)).progress;
    expect(applyResult(mastered, ev('skipped', 2, 's2')).progress.status).toBe('mastered');
  });

  it('never schedules a review, and clears any review left over from old data', () => {
    const old: WordProgress = { ...base, status: 'learning', dueSeq: 14, nextReviewAt: 99, streakContextIds: ['x'], incorrect: 1, attempts: 1 };
    for (const result of ['correct', 'incorrect', 'timeout', 'unanswered', 'skipped'] as const) {
      for (const from of [base, old]) {
        const r = applyResult(from, ev(result, 5)).progress;
        expect(r.dueSeq, result).toBeUndefined();
        expect(r.nextReviewAt, result).toBeUndefined();
        expect(r.streakContextIds, result).toEqual([]);
      }
    }
  });

  it('reopening a mastered word makes it new again and keeps its history', () => {
    const p = applyResult(base, ev('correct', 1)).progress;
    const r = reopen(p, 2_000_000);
    expect(r.status).toBe('new');
    expect(r.masteredAt).toBeUndefined();
    expect(r.correct).toBe(1);
    expect(r.history.map((h) => h.event)).toEqual(['mastered', 'reopened']);
  });
});

describe('migrating progress saved under the old rules', () => {
  const old = (over: Partial<WordProgress>): WordProgress => ({ ...newProgress(sig.id), firstPracticedAt: 10, lastPracticedAt: 50, ...over });

  it('a word typed correctly since its last mistake is mastered', () => {
    const p = migrateProgress(old({ status: 'learning', attempts: 2, correct: 1, incorrect: 1, consecutiveCorrect: 1, streakContextIds: ['c2'], dueSeq: 40, nextReviewAt: 77 }));
    expect(p.status).toBe('mastered');
    expect(p.masteredAt).toBe(50);
    expect(p.history.map((h) => h.event)).toEqual(['mastered']);
    expect(p.streakContextIds).toEqual([]);
    expect(p.dueSeq).toBeUndefined();
    expect(p.nextReviewAt).toBeUndefined();
  });

  it('a word whose latest answer was a mistake stays in the Mistake Bank', () => {
    const p = migrateProgress(old({ status: 'learning', attempts: 2, correct: 1, incorrect: 1, consecutiveIncorrect: 1, dueSeq: 12 }));
    expect(p.status).toBe('learning');
    expect(p.dueSeq).toBeUndefined();
    expect(p.history).toEqual([]);
  });

  it('a reopened word is new', () => {
    const p = migrateProgress(old({ status: 'learning', attempts: 2, correct: 2, history: [{ at: 20, event: 'mastered' }, { at: 30, event: 'reopened' }] }));
    expect(p.status).toBe('new');
    expect(p.history.map((h) => h.event)).toEqual(['mastered', 'reopened']);
  });

  it('a mistake followed only by a right choice from options stays in the Mistake Bank', () => {
    // Under the old rules a right choice in Interactive Reading reset the mistake run but never counted toward mastery.
    const p = migrateProgress(old({ status: 'learning', attempts: 2, correct: 1, incorrect: 1, consecutiveCorrect: 1, consecutiveIncorrect: 0, streakContextIds: [] }));
    expect(p.status).toBe('learning');
  });

  it('a word only ever chosen correctly from options is new', () => {
    const p = migrateProgress(old({ status: 'learning', attempts: 1, correct: 1, consecutiveCorrect: 1, streakContextIds: [] }));
    expect(p.status).toBe('new');
  });

  it('mastered and new words keep their status; old review data is cleared', () => {
    const m = old({ status: 'mastered', attempts: 2, correct: 2, masteredAt: 40, intervalIndex: 2, nextReviewAt: 9_999, streakContextIds: ['c1', 'c2'], history: [{ at: 40, event: 'mastered' }] });
    const pm = migrateProgress(m);
    expect(pm.status).toBe('mastered');
    expect(pm.masteredAt).toBe(40);
    expect(pm.history).toEqual(m.history);
    expect(pm.nextReviewAt).toBeUndefined();
    expect(pm.streakContextIds).toEqual([]);
    const n = old({ status: 'new', skips: 1, dueSeq: 8 });
    const pn = migrateProgress(n);
    expect(pn.status).toBe('new');
    expect(pn.skips).toBe(1);
    expect(pn.dueSeq).toBeUndefined();
  });

  it('does not change the saved object it is given', () => {
    const o = old({ status: 'learning', streakContextIds: ['c1'], dueSeq: 3 });
    migrateProgress(o);
    expect(o).toMatchObject({ status: 'learning', streakContextIds: ['c1'], dueSeq: 3, history: [] });
  });
});

describe('priority', () => {
  it('rises with repeated mistakes and falls with steady success', () => {
    const p0 = newProgress(sig.id);
    const missed: WordProgress = { ...p0, status: 'learning', attempts: 3, incorrect: 3, consecutiveIncorrect: 3 };
    const easy: WordProgress = { ...p0, status: 'mastered', attempts: 6, correct: 6, consecutiveCorrect: 6 };
    expect(livePriorityScore(sig, missed)).toBeGreaterThan(livePriorityScore(sig));
    expect(livePriorityScore(sig, easy)).toBeLessThan(livePriorityScore(sig));
    expect(livePriority(sig, missed)).toBe('high');
  });
});

describe('selection', () => {
  const words = ['apple', 'river', 'garden', 'window', 'teacher', 'market'].map((w) => makeWord(w, [`The ${w} was the first thing we noticed.`]));
  const state = (over: Partial<SelectionState> = {}): SelectionState => ({
    pool: words,
    progress: new Map(),
    sessionId: 's1',
    level: 'easy',
    adaptive: false,
    focus: 'normal',
    rng: () => 0,
    ...over,
  });
  const prog = (i: number, over: Partial<WordProgress>): [string, WordProgress] => [words[i].id, { ...newProgress(words[i].id), ...over }];
  const missed = (n: number, over: Partial<WordProgress> = {}): Partial<WordProgress> => ({ status: 'learning', attempts: n, incorrect: n, consecutiveIncorrect: n, lastSessionId: 's0', ...over });

  it('normal practice serves only new words, never one already asked in this session', () => {
    const progress = new Map([
      prog(0, missed(1)),
      prog(1, { status: 'mastered', attempts: 1, correct: 1, lastSessionId: 's0' }),
      prog(2, { status: 'new', skips: 1, lastSessionId: 's1' }), // skipped earlier in this session
      prog(3, { status: 'new', skips: 1, lastSessionId: 's0' }), // skipped in an earlier session
    ]);
    const served = new Set<string>();
    for (const r of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const sel = selectNext(state({ progress, rng: () => r }));
      expect(sel?.reason).toBe('new');
      served.add(sel!.word.word);
    }
    expect([...served].sort()).toEqual(['market', 'teacher', 'window']);
  });

  it('never serves a missed word in normal practice, even when it is the only word left', () => {
    const progress = new Map(words.map((_, i) => (i === 2 ? prog(i, missed(3)) : prog(i, { status: 'mastered', attempts: 1, correct: 1 }))));
    expect(selectNext(state({ progress, sessionId: 's9' }))).toBeUndefined();
  });

  it('returns undefined when no new words remain in this session', () => {
    const progress = new Map(words.map((_, i) => prog(i, i % 2 ? { status: 'new', skips: 1, lastSessionId: 's1' } : { status: 'mastered', attempts: 1, correct: 1 })));
    expect(selectNext(state({ progress }))).toBeUndefined();
    // A later session can serve the skipped (still new) words.
    expect(selectNext(state({ progress, sessionId: 's2' }))?.reason).toBe('new');
  });

  it('does not repeat the last word', () => {
    const only = words.slice(0, 2);
    for (const r of [0, 0.6, 0.99]) expect(selectNext(state({ pool: only, lastWordId: only[0].id, rng: () => r }))?.word.id).toBe(only[1].id);
  });

  it('Practice My Mistakes serves only words in the Mistake Bank, most-missed first, each once per session', () => {
    const progress = new Map([
      prog(0, missed(1)),
      prog(1, missed(4)),
      prog(2, missed(2)),
      prog(3, { status: 'mastered', attempts: 6, correct: 1, incorrect: 5 }), // fixed: no longer an open mistake
      prog(4, { status: 'new', skips: 2 }),
    ]);
    const served: string[] = [];
    for (let i = 0; i < 6; i++) {
      const sel = selectNext(state({ focus: 'mistakes', progress }));
      if (!sel) break;
      expect(sel.reason).toBe('mistake-focus');
      served.push(sel.word.word);
      // Answered (right or wrong) in this session: not served again in it.
      progress.set(sel.word.id, { ...progress.get(sel.word.id)!, lastSessionId: 's1' });
    }
    expect(served).toEqual(['river', 'garden', 'apple']);
    // A new Practice My Mistakes session serves them again.
    expect(selectNext(state({ focus: 'mistakes', progress, sessionId: 's2' }))?.word.word).toBe('river');
  });

  it('Practice My Mistakes breaks ties by the most recent mistake', () => {
    const progress = new Map([prog(0, missed(2, { lastPracticedAt: 100 })), prog(1, missed(2, { lastPracticedAt: 300 })), prog(2, missed(2, { lastPracticedAt: 200 }))]);
    expect(selectNext(state({ focus: 'mistakes', progress }))?.word.word).toBe('river');
  });

  it('returns undefined when the Mistake Bank is empty', () => {
    const progress = new Map([prog(0, { status: 'mastered', attempts: 2, correct: 1, incorrect: 1 })]);
    expect(selectNext(state({ focus: 'mistakes', progress }))).toBeUndefined();
  });

  it('reviewing mastered words and chosen words is only what the student started', () => {
    const progress = new Map([prog(0, { status: 'mastered', attempts: 1, correct: 1 }), prog(1, missed(1))]);
    const m = selectNext(state({ focus: 'mastered', progress }));
    expect(m).toEqual({ word: words[0], reason: 'mastered-review' });
    expect(selectNext(state({ focus: 'mastered', progress: new Map([...progress, prog(0, { status: 'mastered', lastSessionId: 's1' })]) }))).toBeUndefined();
    const c = selectNext(state({ focus: 'words', pool: [words[1]], progress }));
    expect(c).toEqual({ word: words[1], reason: 'chosen' });
  });

  it('every word is practiced in its one sentence', () => {
    for (const w of words) expect(chooseContext(w)).toBe(w.contexts[0]);
    expect(chooseContext(sig)).toBe(sig.contexts[0]);
  });

  it('explains every selection reason, including ones saved by older sessions', () => {
    for (const r of ['new', 'mistake-focus', 'chosen', 'mastered-review', 'mistake-review', 'second-context', 'due-review', 'extra-practice', 'retention'])
      expect(REASON_TEXT[r], r).toBeTruthy();
    expect(Object.values(REASON_TEXT).join(' ')).not.toMatch(/due|retention|interval|second sentence/i);
  });
});

describe('context validation', () => {
  it('rejects near-duplicate contexts', () => {
    const a = checkContext('Maria found a significant error in the report.', 'significant', 'w:significant', 'authored').context!;
    const b = checkContext('John found a significant error in the report.', 'significant', 'w:significant', 'authored').context!;
    const r = checkContextSet([a, b], 'significant');
    expect(r.kept).toHaveLength(1);
    expect(r.rejected[0].reason).toMatch(/too similar/);
  });
  it('rejects sentences without the exact spelling', () => {
    expect(checkContext('The results were significantly better.', 'significant', 'x', 'authored').errors.length).toBeGreaterThan(0);
  });
});

describe('adaptive difficulty and stats', () => {
  it('steps up after consistent success and down after struggle', () => {
    let s = initialAdaptive('easy');
    let change;
    for (let i = 0; i < 8; i++) ({ state: s, change } = updateAdaptive(s, true));
    expect(change).toBe('up');
    expect(s.level).toBe('intermediate');
    for (let i = 0; i < 8; i++) ({ state: s, change } = updateAdaptive(s, false));
    expect(s.level).toBe('easy');
  });
  it('counts streak days', () => {
    const day = 86_400_000;
    const now = new Date(2026, 9, 8, 12).getTime();
    const keys = new Set([dateKey(now), dateKey(now - day), dateKey(now - 2 * day), dateKey(now - 5 * day)]);
    expect(streaks(keys, now)).toEqual({ current: 3, longest: 3 });
  });
  it('computes mastery percentage from unique words, and counts Mistake Bank and new words', () => {
    const river = makeWord('river', ['The river was wide and slow.']);
    const lake = makeWord('lake', ['We swam in the lake every summer.']);
    const p = { ...newProgress(sig.id), status: 'mastered' as const, attempts: 1, correct: 1 };
    const q = { ...newProgress(river.id), status: 'learning' as const, attempts: 1, incorrect: 1, consecutiveIncorrect: 1 };
    const skipped = { ...newProgress(lake.id), skips: 1 };
    const st = computeStats([sig, river, lake, makeWord('market', ['The market opens early on Sunday.'])], [p, q, skipped], [], { now: Date.now() });
    expect(st.totalWords).toBe(4);
    expect(st.masteredWords).toBe(1);
    expect(st.masteryPct).toBe(25);
    expect(st.mistakeWords).toBe(1);
    expect(st.newWords).toBe(2);
    expect(st.remainingWords).toBe(3);
    expect(st.mostMissed.map((m) => m.word)).toEqual(['river']);
  });
});
