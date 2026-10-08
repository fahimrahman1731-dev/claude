import { describe, expect, it } from 'vitest';
import { checkGap } from '../../src/engine/answer';
import { updateAdaptive, initialAdaptive } from '../../src/engine/adaptive';
import { derive, endingSplit } from '../../src/engine/morphology';
import { applyResult, newProgress } from '../../src/engine/progress';
import { livePriority, livePriorityScore } from '../../src/engine/priority';
import { sentenceQuestion, validateQuestion } from '../../src/engine/questions';
import { chooseContext, selectNext, type SelectionState } from '../../src/engine/selection';
import { analyzeError } from '../../src/engine/spelling';
import { computeStats, streaks, dateKey } from '../../src/engine/stats';
import { halfSplit, locateTarget } from '../../src/engine/text';
import { checkContext, checkContextSet } from '../../src/engine/validate';
import type { WordProgress } from '../../src/engine/types';
import { makeWord, seqRng } from '../helpers';

const sig = makeWord('significant', [
  'The discovery had a significant impact on modern medicine.',
  'Education plays a significant role in economic development.',
  'Prices rose by a significant amount after the storm.',
]);

describe('text and splitting', () => {
  it('splits like the DET: hidden part equals or exceeds visible part by one', () => {
    expect(halfSplit('the')).toEqual({ visible: 't', hiddenLength: 2 });
    expect(halfSplit('that')).toEqual({ visible: 'th', hiddenLength: 2 });
    expect(halfSplit('significant')).toEqual({ visible: 'signi', hiddenLength: 6 });
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
  it('builds a valid question', () => {
    expect(validateQuestion(q, sig)).toBeUndefined();
    expect(q.gap.visible).toBe('signi');
  });
  it('accepts the missing letters or the whole word, exact spelling only', () => {
    expect(checkGap(q.gap, 'ficant', { acceptUk: false }).correct).toBe(true);
    expect(checkGap(q.gap, 'Significant', { acceptUk: false }).correct).toBe(true);
    expect(checkGap(q.gap, 'ficent', { acceptUk: false }).correct).toBe(false);
    expect(checkGap(q.gap, '', { acceptUk: false }).empty).toBe(true);
  });
  it('accepts UK spelling only when the mode allows it', () => {
    const org = makeWord('organize', ['We need to organize the files before Monday.', 'Volunteers helped organize a food drive for families.'], { ukVariants: ['organise'] });
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

describe('scheduler and mastery', () => {
  const base = newProgress(sig.id);
  const ev = (result: 'correct' | 'incorrect' | 'timeout' | 'skipped', contextId: string, seq: number) => ({
    result,
    contextId,
    responseMs: 3000,
    at: 1_000_000 + seq,
    seq,
    sessionId: 's1',
  });
  const [c1, c2] = sig.contexts.map((c) => c.id);

  it('schedules a first mistake 3–5 questions later, then shorter', () => {
    const a = applyResult(base, ev('incorrect', c1, 10), { rng: () => 0 });
    expect(a.gap).toBe(3);
    expect(a.progress.dueSeq).toBe(14);
    const b = applyResult(a.progress, ev('incorrect', c2, 14), { rng: () => 0.99 });
    expect(b.gap).toBe(2);
    const c = applyResult(b.progress, ev('incorrect', c1, 17), { rng: () => 0.5 });
    expect(c.gap).toBe(1);
    expect(c.progress.consecutiveIncorrect).toBe(3);
  });

  it('masters only after two different contexts without a mistake in between', () => {
    const a = applyResult(base, ev('correct', c1, 1), { rng: () => 0 });
    expect(a.progress.status).toBe('learning');
    const same = applyResult(a.progress, ev('correct', c1, 9), { rng: () => 0 });
    expect(same.progress.status).toBe('learning');
    const b = applyResult(same.progress, ev('correct', c2, 20), { rng: () => 0 });
    expect(b.becameMastered).toBe(true);
    expect(b.progress.status).toBe('mastered');
  });

  it('a mistake resets the streak but keeps history', () => {
    const a = applyResult(base, ev('correct', c1, 1)).progress;
    const b = applyResult(a, ev('incorrect', c2, 5)).progress;
    const c = applyResult(b, ev('correct', c2, 10)).progress;
    expect(c.status).toBe('learning');
    expect(c.correct).toBe(2);
    expect(c.incorrect).toBe(1);
    expect(c.correctContextIds).toEqual([c1, c2]);
    expect(c.streakContextIds).toEqual([c2]);
  });

  it('skips never count toward mastery', () => {
    const a = applyResult(base, ev('skipped', c1, 1)).progress;
    const b = applyResult(a, ev('skipped', c2, 2)).progress;
    expect(b.status).toBe('new');
    expect(b.attempts).toBe(0);
    expect(b.skips).toBe(2);
  });

  it('a failed retention check reopens a mastered word', () => {
    let p = applyResult(base, ev('correct', c1, 1)).progress;
    p = applyResult(p, ev('correct', c2, 9)).progress;
    expect(p.status).toBe('mastered');
    const r = applyResult(p, ev('timeout', c1, 30));
    expect(r.lostMastery).toBe(true);
    expect(r.progress.status).toBe('learning');
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
  const words = ['apple', 'river', 'garden', 'window', 'teacher'].map((w) =>
    makeWord(w, [`The ${w} was the first thing we noticed.`, `Everyone talked about one ${w} for hours.`]),
  );
  const state = (over: Partial<SelectionState> = {}): SelectionState => ({
    pool: words,
    progress: new Map(),
    seq: 10,
    now: 5_000,
    sessionId: 's1',
    newIntroduced: 0,
    reviewsServed: 0,
    quotas: { newWords: 5, reviews: 5 },
    level: 'easy',
    adaptive: false,
    retentionReviews: true,
    focus: 'normal',
    rng: () => 0,
    ...over,
  });
  it('serves a missed word once its short interval has passed', () => {
    const p: WordProgress = { ...newProgress(words[2].id), status: 'learning', dueSeq: 10, lastSessionId: 's1', consecutiveIncorrect: 1, incorrect: 1, attempts: 1, nextReviewAt: 0 };
    const sel = selectNext(state({ progress: new Map([[p.wordId, p]]) }));
    expect(sel?.word.id).toBe(words[2].id);
    expect(sel?.reason).toBe('mistake-review');
  });
  it('waits while the interval has not passed', () => {
    const p: WordProgress = { ...newProgress(words[2].id), status: 'learning', dueSeq: 14, lastSessionId: 's1', consecutiveIncorrect: 1, incorrect: 1, attempts: 1, nextReviewAt: 0 };
    const sel = selectNext(state({ progress: new Map([[p.wordId, p]]) }));
    expect(sel?.word.id).not.toBe(words[2].id);
    expect(sel?.reason).toBe('new');
  });
  it('mistake focus serves the most-missed word first', () => {
    const a: WordProgress = { ...newProgress(words[0].id), status: 'learning', incorrect: 1, attempts: 1 };
    const b: WordProgress = { ...newProgress(words[1].id), status: 'learning', incorrect: 4, attempts: 4 };
    const sel = selectNext(state({ focus: 'mistakes', progress: new Map([[a.wordId, a], [b.wordId, b]]) }));
    expect(sel?.word.id).toBe(words[1].id);
  });
  it('chooses a new context after a mistake', () => {
    const w = words[0];
    const p: WordProgress = { ...newProgress(w.id), lastContextId: w.contexts[0].id, seenContextIds: [w.contexts[0].id] };
    expect(chooseContext(w, p, seqRng([0])).id).toBe(w.contexts[1].id);
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
  it('computes mastery percentage from unique words', () => {
    const p = { ...newProgress(sig.id), status: 'mastered' as const, attempts: 2, correct: 2 };
    const st = computeStats([sig, makeWord('river', ['The river was wide and slow.', 'We walked along the river at dawn.'])], [p], [], { now: Date.now(), retentionReviews: true });
    expect(st.masteryPct).toBe(50);
    expect(st.totalWords).toBe(2);
  });
});
