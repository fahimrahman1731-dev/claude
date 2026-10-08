/**
 * The twelve functional scenarios from the specification, run against the
 * real imported vocabulary and the real database code (IndexedDB in memory).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractAll, type SourceManifestEntry } from '../../scripts/lib/extract-lib';
import { buildVocab } from '../../scripts/lib/build-lib';
import { MASTERY } from '../../src/engine/config';
import { livePriorityScore } from '../../src/engine/priority';
import { applyResult, newProgress } from '../../src/engine/progress';
import { searchWords } from '../../src/engine/search';
import { computeStats } from '../../src/engine/stats';
import type { SentenceQuestion, WordProgress } from '../../src/engine/types';
import { importWordList, makeCustomWord } from '../../src/services/words';
import { answersFor, makeEnv, root, vocab } from './env';

const srcDir = join(root, 'data/sources');
const manifest: SourceManifestEntry[] = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));

describe('TEST 1 — a wrong answer is saved, corrected and scheduled', () => {
  it('records the mistake, returns the correct spelling and schedules a review 3–5 questions later', async () => {
    const { service, db, store, clock } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const s = await service.startSession({ mode: 'fill-blanks' });
    const q = s.current!.question as SentenceQuestion;
    clock.t += 4000;
    const r = await service.submit(s.id, { questionId: q.id, answers: ['qqq'], kind: 'submit' });

    const g = r.outcome.gaps[0];
    expect(g.result).toBe('incorrect');
    expect(g.correctAnswer.toLowerCase()).toBe(store.byId.get(q.wordId)!.word);

    const saved = await db.mistakes.where('wordId').equals(q.wordId).toArray();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ answer: (q.gap.visible + 'qqq').toLowerCase(), sentence: q.sentence, contextId: q.contextId, previousMistakes: 0 });
    expect(saved[0].responseMs).toBe(4000);

    const p = (await db.progress.get(q.wordId))!;
    expect(p.status).toBe('learning');
    const gap = p.dueSeq! - p.lastSeq! - 1;
    expect(gap).toBeGreaterThanOrEqual(3);
    expect(gap).toBeLessThanOrEqual(5);
    expect(g.schedule).toMatch(/1st mistake in a row/);
  });
});

describe('TEST 2 — repeated misses raise priority and shorten the interval', () => {
  it('goes 3–5 → 1–2 → 1 other questions and the live priority rises each time', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const w = store.byWord.get('accommodate')!;
    let s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: 3 });
    const gaps: number[] = [];
    const scores: number[] = [livePriorityScore(w)];
    const contexts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const q = s.current!.question as SentenceQuestion;
      contexts.push(q.contextId);
      await service.submit(s.id, { questionId: q.id, answers: ['qqq'], kind: 'submit' });
      const p = (await db.progress.get(w.id))!;
      gaps.push(p.dueSeq! - p.lastSeq! - 1);
      scores.push(livePriorityScore(w, p));
      s = await service.advance(s.id);
    }
    expect(gaps[0]).toBeGreaterThanOrEqual(3);
    expect(gaps[0]).toBeLessThanOrEqual(5);
    expect(gaps[1]).toBeGreaterThanOrEqual(1);
    expect(gaps[1]).toBeLessThanOrEqual(2);
    expect(gaps[2]).toBe(1);
    expect(scores[1]).toBeGreaterThan(scores[0]);
    expect(scores[2]).toBeGreaterThan(scores[1]);
    expect(scores[3]).toBeGreaterThan(scores[2]);
    // a different sentence after each mistake
    expect(contexts[1]).not.toBe(contexts[0]);
    expect(contexts[2]).not.toBe(contexts[1]);
    expect((await db.mistakes.where('wordId').equals(w.id).count())).toBe(3);
  });
});

describe('TEST 3 — correct in two different contexts → mastered', () => {
  it('masters the word after two correct answers in different sentences', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const w = store.byWord.get('significant')!;
    let s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: 2 });
    const q1 = s.current!.question as SentenceQuestion;
    const r1 = await service.submit(s.id, { questionId: q1.id, answers: answersFor(q1, true), kind: 'submit' });
    expect(r1.outcome.gaps[0].becameMastered).toBe(false);
    s = await service.advance(s.id);
    const q2 = s.current!.question as SentenceQuestion;
    expect(q2.contextId).not.toBe(q1.contextId);
    const r2 = await service.submit(s.id, { questionId: q2.id, answers: answersFor(q2, true), kind: 'submit' });
    expect(r2.outcome.gaps[0].becameMastered).toBe(true);
    const p = (await db.progress.get(w.id))!;
    expect(p.status).toBe('mastered');
    expect(p.streakContextIds).toHaveLength(MASTERY.requiredDistinctContexts);
  });

  it('an intervening mistake resets the requirement', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const w = store.byWord.get('environment')!;
    let s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: 3 });
    for (const correct of [true, false, true]) {
      const q = s.current!.question as SentenceQuestion;
      await service.submit(s.id, { questionId: q.id, answers: answersFor(q, correct), kind: 'submit' });
      s = await service.advance(s.id);
    }
    const p = (await db.progress.get(w.id))!;
    expect(p.status).toBe('learning');
    expect(p.correct).toBe(2);
    expect(p.streakContextIds).toHaveLength(1);
  });
});

describe('TEST 4 — the same sentence twice is not two contexts', () => {
  it('a word with only one sentence cannot be mastered by repeating it', async () => {
    const base = makeEnv();
    const custom = makeCustomWord({ word: 'zephyrs', definition: 'gentle winds', sentences: ['Warm zephyrs moved across the quiet lake at dawn.'] }, base.store);
    expect(custom.word).toBeDefined();
    expect(custom.practiceReady).toBe(false);
    const { service, db } = makeEnv({ custom: [custom.word!] });
    await service.saveSettings({ timerMode: 'untimed' });
    let s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [custom.word!.id], target: 2 });
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      const q = s.current!.question as SentenceQuestion;
      seen.push(q.contextId);
      await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
      s = await service.advance(s.id);
    }
    expect(seen[0]).toBe(seen[1]);
    const p = (await db.progress.get(custom.word!.id))!;
    expect(p.correct).toBe(2);
    expect(p.correctContextIds).toHaveLength(1);
    expect(p.status).toBe('learning');
  });

  it('the scheduler counts a repeated context id only once', () => {
    let p = newProgress('w:test');
    for (let i = 1; i <= 3; i++) p = applyResult(p, { result: 'correct', contextId: 'same', responseMs: 1000, at: i, seq: i * 10, sessionId: 's' }).progress;
    expect(p.status).toBe('learning');
    expect(p.streakContextIds).toEqual(['same']);
  });
});

describe('TEST 5 — a mastered word moves from the Active Practice List to the Completed Checklist', () => {
  it('appears only in the completed list, with its history kept', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const w = store.byWord.get('beautiful')!;
    let s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: 2 });
    for (let i = 0; i < 2; i++) {
      const q = s.current!.question as SentenceQuestion;
      await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
      s = await service.advance(s.id);
    }
    const progress = await service.progressMap();
    const active = service.activeWords(progress);
    expect(active.some((x) => x.id === w.id)).toBe(false);
    expect(active).toHaveLength(store.words.length - 1);
    const completed = store.words.filter((x) => progress.get(x.id)?.status === 'mastered');
    expect(completed.map((x) => x.id)).toEqual([w.id]);
    expect(await db.attempts.where('wordId').equals(w.id).count()).toBe(2);

    // Reopening returns it to active practice without deleting its history.
    await service.reopenWord(w.id);
    const after = (await db.progress.get(w.id))!;
    expect(after.status).toBe('learning');
    expect(after.correct).toBe(2);
    expect(after.history.map((h) => h.event)).toEqual(['mastered', 'reopened']);
  });
});

describe('TEST 6 — progress survives a browser refresh', () => {
  it('reopening the database restores progress, mistakes, mastery and the open question; a repeated submit is ignored', async () => {
    const first = makeEnv();
    await first.service.saveSettings({ timerMode: 'untimed', questionsPerSession: 6 });
    const mastered = first.store.byWord.get('knowledge')!;
    let s = await first.service.startSession({ mode: 'spelling', focus: 'words', wordIds: [mastered.id], target: 2 });
    for (let i = 0; i < 2; i++) {
      const q = s.current!.question as SentenceQuestion;
      await first.service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
      s = await first.service.advance(s.id);
    }
    s = await first.service.startSession({ mode: 'fill-blanks' });
    const missed = s.current!.question as SentenceQuestion;
    await first.service.submit(s.id, { questionId: missed.id, answers: ['qqq'], kind: 'submit' });
    s = await first.service.advance(s.id);
    const open = s.current!.question.id;
    first.db.close();

    // "Refresh": a new app instance on the same database.
    const second = makeEnv({ dbName: first.dbName });
    const resumed = (await second.service.activeSession())!;
    expect(resumed.id).toBe(s.id);
    expect(resumed.current!.question.id).toBe(open);
    expect((await second.db.progress.get(mastered.id))!.status).toBe('mastered');
    expect((await second.db.progress.get(missed.wordId))!.incorrect).toBe(1);
    expect(await second.db.mistakes.count()).toBe(1);
    expect((await second.service.getSettings()).questionsPerSession).toBe(6);

    // The answer submitted before the refresh cannot be recorded again.
    const before = await second.db.attempts.count();
    const dup = await second.service.submit(s.id, { questionId: missed.id, answers: ['qqq'], kind: 'submit' }).catch((e) => e);
    expect(dup).toBeInstanceOf(Error);
    expect(await second.db.attempts.count()).toBe(before);

    // Double-clicking Submit records the answer once.
    const q = resumed.current!.question as SentenceQuestion;
    const [a, b] = await Promise.all([
      second.service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' }),
      second.service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' }),
    ]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(await second.db.attempts.count()).toBe(before + 1);
  });
});

describe('TEST 7 — the countdown expires', () => {
  it('closes the question, records a timeout, shows the answer and schedules a review', async () => {
    const { service, db, clock } = makeEnv();
    await service.saveSettings({ timerMode: 'timed' });
    const s = await service.startSession({ mode: 'fill-blanks' });
    const cur = s.current!;
    expect(cur.limitMs).toBeGreaterThanOrEqual(20_000);
    const q = cur.question as SentenceQuestion;
    clock.t += cur.limitMs! + 5000; // the timer ran out (time keeps passing in the background)
    const r = await service.submit(s.id, { questionId: q.id, answers: [''], kind: 'timeout' });
    expect(r.outcome.timedOut).toBe(true);
    expect(r.outcome.gaps[0].result).toBe('timeout');
    expect(r.outcome.gaps[0].correctAnswer).toBe(q.gap.answer);
    expect(r.outcome.responseMs).toBe(cur.limitMs); // never more than the limit, never negative
    expect(r.session.current).toBeUndefined();
    const m = await db.mistakes.where('wordId').equals(q.wordId).first();
    expect(m?.result).toBe('timeout');
    expect((await db.progress.get(q.wordId))!.timeouts).toBe(1);
  });

  it('what was typed before the timer ended is still checked', async () => {
    const { service, clock } = makeEnv();
    const s = await service.startSession({ mode: 'fill-blanks' });
    const q = s.current!.question as SentenceQuestion;
    clock.t += s.current!.limitMs! + 1;
    const r = await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'timeout' });
    expect(r.outcome.gaps[0].result).toBe('correct');
  });
});

describe('TEST 8 — untimed mode', () => {
  it('has no countdown and accepts an answer after any delay', async () => {
    const { service, clock } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    for (const mode of ['fill-blanks', 'read-complete', 'small-words'] as const) {
      const s = await service.startSession({ mode });
      expect(s.current!.limitMs).toBeNull();
      clock.t += 10 * 60_000;
      const q = s.current!.question;
      const r = await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
      expect(r.outcome.gaps.every((g) => g.result === 'correct')).toBe(true);
      expect(r.outcome.responseMs).toBe(10 * 60_000);
    }
  });
});

describe('TEST 9 — Practice My Mistakes', () => {
  it('serves only previously missed words, most-missed first', async () => {
    const { service, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const plan: [string, number][] = [
      ['necessary', 3],
      ['receive', 1],
      ['separate', 2],
    ];
    for (const [word, misses] of plan) {
      const w = store.byWord.get(word)!;
      let s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: misses });
      for (let i = 0; i < misses; i++) {
        const q = s.current!.question as SentenceQuestion;
        await service.submit(s.id, { questionId: q.id, answers: ['qqq'], kind: 'submit' });
        s = await service.advance(s.id);
      }
    }
    let s = await service.startSession({ mode: 'spelling', focus: 'mistakes' });
    const missedIds = new Set(plan.map(([w]) => store.byWord.get(w)!.id));
    const served: string[] = [];
    for (let i = 0; i < 6 && s.current; i++) {
      const q = s.current.question as SentenceQuestion;
      served.push(store.byId.get(q.wordId)!.word);
      expect(missedIds.has(q.wordId)).toBe(true);
      await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
      s = await service.advance(s.id);
    }
    expect(served[0]).toBe('necessary');
    expect(new Set(served)).toEqual(new Set(['necessary', 'receive', 'separate']));
  });
});

describe('TEST 10 — searching the library', () => {
  it('finds the entry by English, Bengali, prefix or suffix, and its history is available', async () => {
    const { service, db, store } = makeEnv();
    const hit = searchWords(store.words, 'Significant', 'word');
    expect(hit[0].word).toBe('significant');
    expect(hit[0].definition).toBeTruthy();
    expect(hit[0].contexts.length).toBeGreaterThanOrEqual(2);
    expect(searchWords(store.words, hit[0].bengali!, 'bengali').map((w) => w.word)).toContain('significant');
    const tion = searchWords(store.words, '-tion', 'suffix');
    expect(tion.length).toBeGreaterThan(50);
    expect(tion.every((w) => w.word.endsWith('tion'))).toBe(true);
    expect(searchWords(store.words, 'un', 'prefix').every((w) => w.word.startsWith('un'))).toBe(true);

    await service.saveSettings({ timerMode: 'untimed' });
    const s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [hit[0].id], target: 1 });
    const q = s.current!.question as SentenceQuestion;
    await service.submit(s.id, { questionId: q.id, answers: ['qqq'], kind: 'submit' });
    const history = await db.attempts.where('wordId').equals(hit[0].id).toArray();
    expect(history).toHaveLength(1);
    expect(history[0].result).toBe('incorrect');
  });
});

describe('TEST 11 — completing every imported word', () => {
  it('reports 100% mastery over exactly the imported words, with nothing invented', async () => {
    const extraction = extractAll(manifest, (f) => readFileSync(join(srcDir, f), 'utf8'));
    const extractedSet = new Set(extraction.words.map((w) => w.word));
    // Every word in the app's database comes from the study materials, and every usable word was imported.
    expect(vocab.words.length).toBe(extraction.words.length);
    expect(vocab.words.every((w) => extractedSet.has(w.word))).toBe(true);

    const { db, store } = makeEnv();
    const progress: WordProgress[] = [];
    let seq = 0;
    for (const w of store.words) {
      expect(w.contexts.length).toBeGreaterThanOrEqual(2);
      let p = newProgress(w.id);
      for (const c of w.contexts.slice(0, 2)) p = applyResult(p, { result: 'correct', contextId: c.id, responseMs: 2000, at: 1000 + seq, seq: ++seq, sessionId: 's' }).progress;
      expect(p.status).toBe('mastered');
      progress.push(p);
    }
    await db.progress.bulkPut(progress);
    const stats = computeStats(store.words, await db.progress.toArray(), [], { now: Date.now(), retentionReviews: false });
    expect(stats.totalWords).toBe(extraction.words.length);
    expect(stats.masteredWords).toBe(stats.totalWords);
    expect(stats.masteryPct).toBe(100);
    expect(stats.remainingWords).toBe(0);

    // Half mastered → 50%.
    const half = progress.map((p, i) => (i % 2 === 0 ? p : newProgress(p.wordId)));
    const s2 = computeStats(store.words, half, [], { now: Date.now(), retentionReviews: false });
    expect(s2.masteryPct).toBeCloseTo((Math.ceil(store.words.length / 2) / store.words.length) * 100, 6);
  });
});

describe('TEST 12 — a source that fails to import is reported', () => {
  it('a missing file is reported as failed while the other source still imports', () => {
    const broken = [manifest[0], { ...manifest[1], file: 'missing-file.md' }];
    const r = extractAll(broken, (f) => readFileSync(join(srcDir, f), 'utf8'));
    const failed = r.sources.find((s) => s.file === 'missing-file.md')!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/Could not read missing-file\.md/);
    expect(r.sources[0].status).toBe('ok');
    const { report } = buildVocab(r, [], [], []);
    expect(report.totals.failedSources).toBe(1);
    expect(report.totals.uniqueSpellingTargets).toBeLessThan(vocab.words.length);
  });

  it('a section whose layout cannot be read is reported, not skipped silently', () => {
    const r = extractAll(manifest, (f) => {
      const text = readFileSync(join(srcDir, f), 'utf8');
      return f.includes('strategy-guide') ? text.replace('### Level 3: harder words (114)', '### (heading removed)') : text;
    });
    const guide = r.sources.find((s) => s.id === 'guide')!;
    expect(guide.status).toBe('partial');
    const sec = guide.sections.find((x) => x.id === 'guide.bank3.level3')!;
    expect(sec.status).toBe('failed');
    expect(sec.error).toMatch(/Level 3/);
  });

  it('an unreadable word list uploaded in the app is reported as failed', () => {
    const { store } = makeEnv();
    const bad = importWordList('list.json', '{ not valid json', store);
    expect(bad.report.status).toBe('failed');
    expect(bad.report.error).toBeTruthy();
    expect(bad.words).toHaveLength(0);
    const noHeader = importWordList('list.csv', 'apple,banana\ncherry,date', store);
    expect(noHeader.report.status).toBe('failed');
    expect(noHeader.report.error).toMatch(/"word" column/);
  });
});
