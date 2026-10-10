/**
 * The twelve functional scenarios from the specification, run against the
 * real imported vocabulary and the real database code (IndexedDB in memory),
 * under the app's learning rule: one sentence per word, one correct answer masters
 * it, a mistake goes to the Mistake Bank and never comes back by itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractAll, type SourceManifestEntry } from '../../scripts/lib/extract-lib';
import { buildVocab } from '../../scripts/lib/build-lib';
import type { SessionRecord } from '../../src/db/db';
import { livePriorityScore } from '../../src/engine/priority';
import { applyResult, inMistakeBank, mistakes, newProgress } from '../../src/engine/progress';
import { inModePool } from '../../src/engine/questions';
import { searchWords } from '../../src/engine/search';
import { computeStats } from '../../src/engine/stats';
import type { InteractiveAnswers, InteractiveQuestion, ParagraphQuestion, ResultKind, SentenceQuestion, WordProgress } from '../../src/engine/types';
import type { PracticeService } from '../../src/services/practice';
import { importWordList, makeCustomWord } from '../../src/services/words';
import { answersFor, makeEnv, root, vocab } from './env';

const srcDir = join(root, 'data/sources');
const manifest: SourceManifestEntry[] = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));

/** Answers every question left in a sentence session and returns the words asked, in order, and the ended session. */
async function playOut(service: PracticeService, s: SessionRecord, correct: (q: SentenceQuestion, i: number) => boolean) {
  const asked: string[] = [];
  while (s.current) {
    const q = s.current.question as SentenceQuestion;
    await service.submit(s.id, { questionId: q.id, answers: answersFor(q, correct(q, asked.length)), kind: 'submit' });
    asked.push(q.wordId);
    s = await service.advance(s.id);
  }
  return { asked, session: s };
}

describe('TEST 1 — a wrong answer is saved, corrected and sent to the Mistake Bank', () => {
  it('records the mistake with the correct spelling; the word never comes back by itself, only in Practice My Mistakes', async () => {
    const { service, db, store, clock } = makeEnv();
    // Fixed level, so every later question is drawn from the missed word's own level: if missed
    // words could come back, this one (now high priority) would be among the first candidates.
    await service.saveSettings({ timerMode: 'untimed', questionsPerSession: 20, adaptive: false, difficulty: 'easy' });
    let s = await service.startSession({ mode: 'fill-blanks' });
    const q = s.current!.question as SentenceQuestion;
    expect(store.byId.get(q.wordId)!.difficulty).toBe('easy');
    clock.t += 4000;
    const r = await service.submit(s.id, { questionId: q.id, answers: ['qqq'], kind: 'submit' });

    const g = r.outcome.gaps[0];
    expect(g.result).toBe('incorrect');
    expect(g.correctAnswer.toLowerCase()).toBe(store.byId.get(q.wordId)!.word);
    expect(g.schedule).toMatch(/Mistake Bank/);
    expect(g.schedule).toMatch(/will not come back by itself/);
    expect(g.schedule).not.toMatch(/review|due|interval|retention/i);

    const saved = await db.mistakes.where('wordId').equals(q.wordId).toArray();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ answer: (q.gap.visible + 'qqq').toLowerCase(), correctAnswer: q.gap.answer, sentence: q.sentence, contextId: q.contextId, previousMistakes: 0 });
    expect(saved[0].responseMs).toBe(4000);

    const p = (await db.progress.get(q.wordId))!;
    expect(p.status).toBe('learning');
    expect(p.dueSeq).toBeUndefined();
    expect(p.nextReviewAt).toBeUndefined();

    // The rest of this session, a second Fill in the Blanks session and a Word Spelling session:
    // 59 more questions, and the missed word is never asked again.
    const rest = await playOut(service, await service.advance(s.id), () => true);
    expect(rest.session.endReason).toBe('Session complete.');
    // Days later (when an old review schedule would have brought it back), it still does not come back.
    clock.t += 24 * 3600_000;
    const second = await playOut(service, await service.startSession({ mode: 'fill-blanks' }), () => true);
    clock.t += 30 * 24 * 3600_000;
    const spelling = await playOut(service, await service.startSession({ mode: 'spelling' }), () => true);
    const asked = [...rest.asked, ...second.asked, ...spelling.asked];
    expect(asked).toHaveLength(59);
    expect(asked).not.toContain(q.wordId);
    expect(new Set(asked).size).toBe(asked.length);
    expect((await db.progress.get(q.wordId))!.status).toBe('learning');

    // Practice My Mistakes serves it, in the same sentence.
    s = await service.startSession({ mode: 'fill-blanks', focus: 'mistakes' });
    const fix = s.current!.question as SentenceQuestion;
    expect(fix.wordId).toBe(q.wordId);
    expect(fix.contextId).toBe(q.contextId);
    expect(s.current!.reason).toBe('mistake-focus');
  });
});

describe('TEST 2 — repeated misses raise the mistake count and priority', () => {
  it('each miss in Practice My Mistakes adds a mistake and raises the live priority; the word stays in the Mistake Bank until one correct answer', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const w = store.byWord.get('accommodate')!;
    let s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: 1 });
    let q = s.current!.question as SentenceQuestion;
    await service.submit(s.id, { questionId: q.id, answers: ['qqq'], kind: 'submit' });
    let p = (await db.progress.get(w.id))!;
    const counts = [mistakes(p)];
    const scores = [livePriorityScore(w), livePriorityScore(w, p)];

    for (let i = 0; i < 3; i++) {
      s = await service.startSession({ mode: 'spelling', focus: 'mistakes' });
      q = s.current!.question as SentenceQuestion;
      expect(q.wordId).toBe(w.id);
      expect(q.contextId).toBe(w.contexts[0].id);
      expect(s.current!.reason).toBe('mistake-focus');
      const r = await service.submit(s.id, { questionId: q.id, answers: ['qqq'], kind: 'submit' });
      expect(r.outcome.gaps[0].previousMistakes).toBe(i + 1);
      expect(r.outcome.gaps[0].schedule).toMatch(/stays in your Mistake Bank/);
      p = (await db.progress.get(w.id))!;
      expect(p.status).toBe('learning');
      counts.push(mistakes(p));
      scores.push(livePriorityScore(w, p));
      // Asked once per session: the session ends instead of asking it again.
      s = await service.advance(s.id);
      expect(s.status).toBe('completed');
      expect(s.endReason).toMatch(/tried every word in your Mistake Bank once in this session\. 1 still needs a correct answer/);
    }
    expect(counts).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    expect(await db.mistakes.where('wordId').equals(w.id).count()).toBe(4);

    // One correct answer masters it and empties the Mistake Bank.
    s = await service.startSession({ mode: 'spelling', focus: 'mistakes' });
    q = s.current!.question as SentenceQuestion;
    const r = await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
    expect(r.outcome.gaps[0].becameMastered).toBe(true);
    expect(r.outcome.gaps[0].schedule).toMatch(/left your Mistake Bank/);
    expect((await db.progress.get(w.id))!.status).toBe('mastered');
    s = await service.advance(s.id);
    expect(s.endReason).toMatch(/Mistake Bank is empty/);
  });
});

describe('TEST 3 — one correct answer → mastered', () => {
  it('masters a new word with one correct answer: no second sentence is needed', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const w = store.byWord.get('significant')!;
    let s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: 2 });
    const q = s.current!.question as SentenceQuestion;
    const r = await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
    expect(r.outcome.gaps[0].becameMastered).toBe(true);
    expect(r.outcome.gaps[0].schedule).toMatch(/Completed Checklist/);
    const p = (await db.progress.get(w.id))!;
    expect(p).toMatchObject({ status: 'mastered', attempts: 1, correct: 1 });
    expect(p.history.map((h) => h.event)).toEqual(['mastered']);
    // The word is not asked a second time.
    s = await service.advance(s.id);
    expect(s.status).toBe('completed');
    expect(s.current).toBeUndefined();
    expect(await db.attempts.where('wordId').equals(w.id).count()).toBe(1);
  });

  it('the same holds in normal practice: each correct answer masters a new word', async () => {
    const { service, db } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed', questionsPerSession: 5 });
    const { asked, session } = await playOut(service, await service.startSession({ mode: 'fill-blanks' }), () => true);
    expect(asked).toHaveLength(5);
    expect(session.tally.correct).toBe(5);
    for (const id of asked) expect((await db.progress.get(id))!.status).toBe('mastered');
  });
});

describe('TEST 4 — one sentence per word', () => {
  it('every shipped word has exactly one practice sentence, and a correct answer in it masters the word', async () => {
    expect(vocab.words.length).toBeGreaterThan(1000);
    expect(vocab.words.filter((w) => w.contexts.length !== 1).map((w) => w.word)).toEqual([]);
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    for (const word of ['environment', 'knowledge']) {
      const w = store.byWord.get(word)!;
      const s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: 1 });
      const q = s.current!.question as SentenceQuestion;
      expect(q.contextId).toBe(w.contexts[0].id);
      expect(q.sentence).toBe(w.contexts[0].sentence);
      const r = await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
      expect(r.outcome.gaps[0].becameMastered).toBe(true);
      expect((await db.progress.get(w.id))!.status).toBe('mastered');
    }
  });

  it('a custom word keeps only its first valid sentence and is mastered by one correct answer in it', async () => {
    const base = makeEnv();
    const first = 'Warm zephyrs moved across the quiet lake at dawn.';
    const custom = makeCustomWord({ word: 'zephyrs', definition: 'gentle winds', sentences: ['There is no target word here at all.', first, 'The sailors waited all week for gentle zephyrs to fill the sails.'] }, base.store);
    expect(custom.practiceReady).toBe(true);
    expect(custom.sentenceIssues).toHaveLength(1);
    expect(custom.word!.contexts.map((c) => c.sentence)).toEqual([first]);
    expect(makeCustomWord({ word: 'zephyrs', sentences: [first] }, base.store).practiceReady).toBe(true);
    const none = makeCustomWord({ word: 'zephyrs', sentences: [] }, base.store);
    expect(none.practiceReady).toBe(false);
    expect(none.word!.contexts).toEqual([]);

    const { service, db } = makeEnv({ custom: [custom.word!] });
    await service.saveSettings({ timerMode: 'untimed' });
    const s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [custom.word!.id], target: 1 });
    const q = s.current!.question as SentenceQuestion;
    expect(q.sentence).toBe(first);
    await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
    expect((await db.progress.get(custom.word!.id))!.status).toBe('mastered');
  });
});

describe('TEST 5 — a mastered word moves from the Active Practice List to the Completed Checklist', () => {
  it('appears only in the completed list, with its history kept; reopening makes it new again', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const w = store.byWord.get('beautiful')!;
    const s = await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [w.id], target: 1 });
    const q = s.current!.question as SentenceQuestion;
    await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
    let progress = await service.progressMap();
    const active = service.activeWords(progress);
    expect(active.some((x) => x.id === w.id)).toBe(false);
    expect(active).toHaveLength(store.words.length - 1);
    const completed = store.words.filter((x) => progress.get(x.id)?.status === 'mastered');
    expect(completed.map((x) => x.id)).toEqual([w.id]);
    expect(await db.attempts.where('wordId').equals(w.id).count()).toBe(1);

    // Reopening returns it to active practice as a new word, without deleting its history.
    await service.reopenWord(w.id);
    const after = (await db.progress.get(w.id))!;
    expect(after.status).toBe('new');
    expect(after.correct).toBe(1);
    expect(after.history.map((h) => h.event)).toEqual(['mastered', 'reopened']);
    progress = await service.progressMap();
    expect(service.activeWords(progress).some((x) => x.id === w.id)).toBe(true);
  });
});

describe('TEST 6 — progress survives a browser refresh', () => {
  it('reopening the database restores progress, mistakes, mastery and the open question; a repeated submit is ignored', async () => {
    const first = makeEnv();
    await first.service.saveSettings({ timerMode: 'untimed', questionsPerSession: 6 });
    const mastered = first.store.byWord.get('knowledge')!;
    let s = await first.service.startSession({ mode: 'spelling', focus: 'words', wordIds: [mastered.id], target: 1 });
    const q0 = s.current!.question as SentenceQuestion;
    await first.service.submit(s.id, { questionId: q0.id, answers: answersFor(q0, true), kind: 'submit' });
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
    const missedP = (await second.db.progress.get(missed.wordId))!;
    expect(missedP.incorrect).toBe(1);
    expect(missedP.status).toBe('learning');
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
  it('closes the question, records a timeout, shows the answer and puts the word in the Mistake Bank (nothing is scheduled)', async () => {
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
    expect(r.outcome.gaps[0].schedule).toMatch(/Mistake Bank/);
    expect(r.outcome.responseMs).toBe(cur.limitMs); // never more than the limit, never negative
    expect(r.session.current).toBeUndefined();
    const m = await db.mistakes.where('wordId').equals(q.wordId).first();
    expect(m?.result).toBe('timeout');
    const p = (await db.progress.get(q.wordId))!;
    expect(p.timeouts).toBe(1);
    expect(p.status).toBe('learning');
    expect(p.dueSeq).toBeUndefined();
    expect(p.nextReviewAt).toBeUndefined();
    // The next question is another word: the timed-out word waits in the Mistake Bank.
    const next = await service.advance(s.id);
    expect((next.current!.question as SentenceQuestion).wordId).not.toBe(q.wordId);
  });

  it('what was typed before the timer ended is still checked (and a correct answer masters the word)', async () => {
    const { service, db, clock } = makeEnv();
    const s = await service.startSession({ mode: 'fill-blanks' });
    const q = s.current!.question as SentenceQuestion;
    clock.t += s.current!.limitMs! + 1;
    const r = await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'timeout' });
    expect(r.outcome.gaps[0].result).toBe('correct');
    expect((await db.progress.get(q.wordId))!.status).toBe('mastered');
  });
});

describe('TEST 8 — untimed mode', () => {
  it('has no countdown and accepts an answer after any delay', async () => {
    const { service, db, clock } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    for (const mode of ['fill-blanks', 'read-complete', 'small-words'] as const) {
      const s = await service.startSession({ mode });
      expect(s.current!.limitMs).toBeNull();
      clock.t += 10 * 60_000;
      const q = s.current!.question;
      const r = await service.submit(s.id, { questionId: q.id, answers: answersFor(q, true), kind: 'submit' });
      expect(r.outcome.gaps.every((g) => g.result === 'correct')).toBe(true);
      expect(r.outcome.responseMs).toBe(10 * 60_000);
      for (const g of r.outcome.gaps) expect((await db.progress.get(g.wordId))!.status).toBe('mastered');
    }
  });
});

describe('TEST 9 — Practice My Mistakes', () => {
  it('serves only open mistakes, most-missed first, each once per session; a correct answer removes a word from the open list', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const id = (w: string) => store.byWord.get(w)!.id;
    // Build the Mistake Bank: each word is asked once per session, so "necessary" is missed in three sessions.
    for (const words of [['necessary', 'separate', 'receive', 'knowledge'], ['necessary', 'separate'], ['necessary']]) {
      const { asked } = await playOut(service, await service.startSession({ mode: 'spelling', focus: 'words', wordIds: words.map(id), target: words.length }), () => false);
      expect(asked).toHaveLength(words.length);
    }
    // "knowledge" was then fixed and "beautiful" was mastered at once: neither is an open mistake.
    await playOut(service, await service.startSession({ mode: 'spelling', focus: 'words', wordIds: [id('knowledge'), id('beautiful')], target: 2 }), () => true);

    let s = await service.startSession({ mode: 'spelling', focus: 'mistakes' });
    const plan: Record<string, boolean> = { necessary: true, separate: false, receive: true };
    const served: string[] = [];
    while (s.current) {
      const q = s.current.question as SentenceQuestion;
      const word = store.byId.get(q.wordId)!.word;
      served.push(word);
      expect(s.current.reason).toBe('mistake-focus');
      await service.submit(s.id, { questionId: q.id, answers: answersFor(q, plan[word]), kind: 'submit' });
      s = await service.advance(s.id);
    }
    expect(served).toEqual(['necessary', 'separate', 'receive']);
    expect(s.status).toBe('completed');
    expect(s.endReason).toMatch(/tried every word in your Mistake Bank once in this session\. 1 still needs a correct answer/);

    const progress = await service.progressMap();
    expect(store.words.filter((w) => inMistakeBank(progress.get(w.id))).map((w) => w.word)).toEqual(['separate']);
    expect(progress.get(id('necessary'))!.status).toBe('mastered');
    expect(progress.get(id('receive'))!.status).toBe('mastered');
    // The mistakes themselves stay on record.
    expect(await db.mistakes.where('wordId').equals(id('necessary')).count()).toBe(3);

    // The next session serves only what is still open; fixing it empties the Mistake Bank.
    s = await service.startSession({ mode: 'spelling', focus: 'mistakes' });
    const { asked, session } = await playOut(service, s, () => true);
    expect(asked).toEqual([id('separate')]);
    expect(session.endReason).toMatch(/Mistake Bank is empty/);
    const empty = await service.startSession({ mode: 'spelling', focus: 'mistakes' });
    expect(empty.current).toBeUndefined();
    expect(empty.endReason).toMatch(/Mistake Bank is empty/);
  });
});

describe('TEST 10 — searching the library', () => {
  it('finds the entry by English, Bengali, prefix or suffix, and its history is available', async () => {
    const { service, db, store } = makeEnv();
    const hit = searchWords(store.words, 'Significant', 'word');
    expect(hit[0].word).toBe('significant');
    expect(hit[0].definition).toBeTruthy();
    expect(hit[0].contexts).toHaveLength(1);
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
    expect(await db.mistakes.where('wordId').equals(hit[0].id).count()).toBe(1);
  });
});

describe('TEST 11 — completing every imported word', () => {
  it('reports 100% mastery over exactly the imported words after one correct answer each, with nothing invented', async () => {
    const extraction = extractAll(manifest, (f) => readFileSync(join(srcDir, f), 'utf8'));
    const extractedSet = new Set(extraction.words.map((w) => w.word));
    const report = JSON.parse(readFileSync(join(root, 'public/data/import-report.json'), 'utf8'));
    const deleted = new Map<string, string>(report.collected.deleted.map((d: { word: string; reason: string }) => [d.word, d.reason]));
    const inApp = new Set(vocab.words.map((w) => w.word));
    // Every word comes from the study materials or (labelled) from the trusted word lists — nothing invented.
    expect(vocab.words.every((w) => extractedSet.has(w.word) || (w.evidence.includes('trusted-list') && w.sources.includes('lists')))).toBe(true);
    // Every word from the study materials is in the app, or was deleted with a stated reason.
    for (const w of extraction.words) expect(inApp.has(w.word) || !!deleted.get(w.word)).toBe(true);
    expect(deleted.size).toBeLessThan(50);

    const { db, store } = makeEnv();
    const progress: WordProgress[] = [];
    let seq = 0;
    for (const w of store.words) {
      expect(w.contexts).toHaveLength(1);
      const r = applyResult(newProgress(w.id), { result: 'correct', contextId: w.contexts[0].id, responseMs: 2000, at: 1000 + seq, seq: ++seq, sessionId: 's' });
      expect(r.becameMastered).toBe(true);
      progress.push(r.progress);
    }
    await db.progress.bulkPut(progress);
    const stats = computeStats(store.words, await db.progress.toArray(), [], { now: Date.now() });
    expect(stats.totalWords).toBe(vocab.words.length);
    expect(stats.masteredWords).toBe(stats.totalWords);
    expect(stats.masteryPct).toBe(100);
    expect(stats.remainingWords).toBe(0);
    expect(stats.mistakeWords).toBe(0);
    expect(stats.newWords).toBe(0);

    // Half mastered → 50%.
    const half = progress.map((p, i) => (i % 2 === 0 ? p : newProgress(p.wordId)));
    const s2 = computeStats(store.words, half, [], { now: Date.now() });
    expect(s2.masteryPct).toBeCloseTo((Math.ceil(store.words.length / 2) / store.words.length) * 100, 6);
    expect(s2.newWords).toBe(Math.floor(store.words.length / 2));

    // A word in the Mistake Bank is not mastered and not new.
    const one = progress.map((p, i) => (i === 0 ? applyResult(p, { result: 'incorrect', contextId: p.lastContextId!, responseMs: 1000, at: 5, seq: ++seq, sessionId: 's2' }).progress : p));
    const s3 = computeStats(store.words, one, [], { now: Date.now() });
    expect(s3.masteredWords).toBe(store.words.length - 1);
    expect(s3.mistakeWords).toBe(1);
    expect(s3.newWords).toBe(0);
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

/** A small Fill in the Blanks library, so that a session can run out of new words. */
const smallPool = (n: number) => vocab.words.filter((w) => inModePool(w, 'fill-blanks') && w.difficulty === 'easy').slice(0, n);

describe('One pass — normal practice ends when every new word has been asked', () => {
  it('asks each new word once, never brings a missed word back, and points to the Mistake Bank', async () => {
    const pool = smallPool(5);
    const { service, db, clock } = makeEnv({ words: pool });
    await service.saveSettings({ timerMode: 'untimed', questionsPerSession: 20 });
    const { asked, session } = await playOut(service, await service.startSession({ mode: 'fill-blanks' }), (_, i) => i !== 0);
    expect(asked).toHaveLength(5);
    expect(new Set(asked)).toEqual(new Set(pool.map((w) => w.id)));
    expect(session.status).toBe('completed');
    expect(session.endReason).toMatch(/no new words left in Fill in the Blanks/);
    expect(session.endReason).toMatch(/1 missed word is waiting in your Mistake Bank/);
    expect((await db.progress.get(asked[0]))!.status).toBe('learning');

    // A new session, days later, has nothing to ask either: the missed word is not served by normal practice.
    clock.t += 7 * 24 * 3600_000;
    const again = await service.startSession({ mode: 'fill-blanks' });
    expect(again.current).toBeUndefined();
    expect(again.status).toBe('completed');
    expect(again.endReason).toMatch(/Mistake Bank/);

    // Practice My Mistakes serves it.
    const fix = await service.startSession({ mode: 'fill-blanks', focus: 'mistakes' });
    expect((fix.current!.question as SentenceQuestion).wordId).toBe(asked[0]);
  });
});

describe('One pass — a skipped word is not counted', () => {
  it('is not asked again in the same session, stays new, and comes back in a later session', async () => {
    const pool = smallPool(4);
    const { service, db } = makeEnv({ words: pool });
    await service.saveSettings({ timerMode: 'untimed', questionsPerSession: 20 });
    let s = await service.startSession({ mode: 'fill-blanks' });
    const first = s.current!.question as SentenceQuestion;
    const r = await service.submit(s.id, { questionId: first.id, answers: [''], kind: 'skip' });
    expect(r.outcome.gaps[0].result).toBe('skipped');
    expect(r.outcome.gaps[0].schedule).toMatch(/not counted/);
    const { asked, session } = await playOut(service, await service.advance(s.id), () => true);
    expect(asked).toHaveLength(3);
    expect(asked).not.toContain(first.wordId);
    // The end message does not claim the words are used up: the skipped one comes back next session.
    expect(session.endReason).toMatch(/1 skipped word will come up again next session/);
    expect(session.endReason).not.toMatch(/no new words left|Mistake Bank/);
    expect(session.tally).toMatchObject({ skipped: 1, correct: 3, incorrect: 0 });
    expect(await db.progress.get(first.wordId)).toMatchObject({ status: 'new', skips: 1, attempts: 0 });
    expect(await db.mistakes.count()).toBe(0);

    // A later session asks it as a new word.
    s = await service.startSession({ mode: 'fill-blanks' });
    expect((s.current!.question as SentenceQuestion).wordId).toBe(first.wordId);
    expect(s.current!.reason).toBe('new');
  });
});

describe('Read and Complete — typed gaps follow the same rule', () => {
  it('a correct gap masters its word, a wrong gap sends its word to the Mistake Bank', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const s = await service.startSession({ mode: 'read-complete' });
    const q = s.current!.question as ParagraphQuestion;
    const answers = q.gaps.map((g, i) => (i % 2 === 0 ? g.answer.slice(g.visible.length) : 'qqq'));
    const r = await service.submit(s.id, { questionId: q.id, answers, kind: 'submit' });
    expect(r.outcome.gaps.map((g) => g.result)).toEqual(q.gaps.map((_, i) => (i % 2 === 0 ? 'correct' : 'incorrect')));
    // A word can fill more than one gap: it gets one result for the text, and any miss counts.
    const last = new Map<string, ResultKind>();
    for (const g of r.outcome.gaps) if (last.get(g.wordId) !== 'incorrect') last.set(g.wordId, g.result);
    const missed = new Set<string>();
    for (const [wordId, result] of last) {
      const p = (await db.progress.get(wordId))!;
      expect(p.status, store.byId.get(wordId)!.word).toBe(result === 'correct' ? 'mastered' : 'learning');
      if (result !== 'correct') missed.add(wordId);
    }
    expect(missed.size).toBeGreaterThan(0);
    // Practice My Mistakes asks the missed words in their own sentence.
    const fix = await service.startSession({ mode: 'read-complete', focus: 'mistakes' });
    expect(fix.mode).toBe('spelling');
    const fq = fix.current!.question as SentenceQuestion;
    expect(fq.kind).toBe('sentence');
    expect(missed.has(fq.wordId)).toBe(true);
    expect(fq.contextId).toBe(store.byId.get(fq.wordId)!.contexts[0].id);
  });
});

/** The first Read and Complete text in which some word fills two gaps. */
function paragraphWithRepeat(): { id: string; wordId: string } {
  for (const p of vocab.paragraphs) {
    const seen = new Set<string>();
    for (const g of p.gaps) {
      if (seen.has(g.wordId)) return { id: p.id, wordId: g.wordId };
      seen.add(g.wordId);
    }
  }
  throw new Error('no paragraph repeats a word');
}

describe('Read and Complete — one result per word per text', () => {
  for (const order of ['miss first', 'miss second'] as const) {
    it(`a word in two gaps is never mastered and un-mastered in one answer (${order})`, async () => {
      const { id, wordId } = paragraphWithRepeat();
      const { service, db, store } = makeEnv();
      await service.saveSettings({ timerMode: 'untimed' });
      // Serve exactly that text: every other text was already served many times.
      const meta = await service.getMeta();
      for (const p of store.paragraphs) if (p.id !== id) meta.paragraphServed[p.id] = 50;
      await db.kv.put({ key: 'meta', value: meta });
      const s = await service.startSession({ mode: 'read-complete' });
      const q = s.current!.question as ParagraphQuestion;
      expect(q.paragraphId).toBe(id);
      const idx = q.gaps.map((g, i) => (g.wordId === wordId ? i : -1)).filter((i) => i >= 0);
      const wrong = order === 'miss first' ? idx[0] : idx[1];
      const answers = q.gaps.map((g, i) => (i === wrong ? 'qqq' : g.answer.slice(g.visible.length)));
      const r = await service.submit(s.id, { questionId: q.id, answers, kind: 'submit' });
      const p = (await db.progress.get(wordId))!;
      expect(p.status).toBe('learning');
      expect(p.history.map((h) => h.event)).toEqual([]);
      const flags = r.outcome.gaps.filter((g) => g.wordId === wordId);
      expect(flags.some((g) => g.becameMastered || g.lostMastery)).toBe(false);
      expect(await db.mistakes.where('wordId').equals(wordId).count()).toBe(1);
    });
  }
});

describe('Mistake Bank words are not tested outside Practice My Mistakes', () => {
  it('Read and Complete shows them whole, so they cannot be fixed or missed there', async () => {
    const { id, wordId } = paragraphWithRepeat();
    const { service, db, store } = makeEnv();
    await db.progress.put({ ...newProgress(wordId), status: 'learning', attempts: 1, incorrect: 1, consecutiveIncorrect: 1 });
    const meta = await service.getMeta();
    for (const p of store.paragraphs) if (p.id !== id) meta.paragraphServed[p.id] = 50;
    await db.kv.put({ key: 'meta', value: meta });
    const s = await service.startSession({ mode: 'read-complete' });
    const q = s.current!.question as ParagraphQuestion;
    expect(q.paragraphId).toBe(id);
    expect(q.gaps.some((g) => g.wordId === wordId)).toBe(false);
    // The text is still complete: the word is shown as it is.
    expect(q.segments.map((seg, k) => seg + (k < q.gaps.length ? q.gaps[k].answer : '')).join('')).toBe(q.text);
  });

  it('an Interactive Reading blank for a Mistake Bank word counts for the passage but leaves the word as it is', async () => {
    const { service, db, store } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    const s = await service.startSession({ mode: 'interactive-reading' });
    const q = s.current!.question as InteractiveQuestion;
    const set = store.interactive.find((x) => x.id === q.setId)!;
    const i = set.blanks.findIndex((b) => b.wordId);
    const wordId = set.blanks[i].wordId!;
    // Put the word in the Mistake Bank, then answer the passage with that blank wrong.
    const before = { ...newProgress(wordId), status: 'learning' as const, attempts: 1, incorrect: 1, consecutiveIncorrect: 1 };
    await db.progress.put(before);
    const answers: InteractiveAnswers = { step: 5, blanks: q.blanks.map((b, k) => (k === i ? (b.answer + 1) % b.options.length : b.answer)), missing: q.missing.answer, highlights: [null, null], idea: null, title: null };
    const r = await service.submit(s.id, { questionId: q.id, answers: [], kind: 'submit', interactive: answers });
    expect(r.outcome.gaps[i].result).toBe('incorrect');
    expect(await db.progress.get(wordId)).toEqual(before);
    expect(await db.mistakes.where('wordId').equals(wordId).count()).toBe(0);
  });
});

describe('An empty answer is a mistake', () => {
  it('an empty Fill in the Blanks answer and empty Read and Complete gaps send the words to the Mistake Bank', async () => {
    const { service, db } = makeEnv();
    await service.saveSettings({ timerMode: 'untimed' });
    let s = await service.startSession({ mode: 'fill-blanks' });
    const q = s.current!.question as SentenceQuestion;
    const r = await service.submit(s.id, { questionId: q.id, answers: [''], kind: 'submit' });
    expect(r.outcome.gaps[0].result).toBe('unanswered');
    expect((await db.progress.get(q.wordId))!.status).toBe('learning');
    expect(await db.mistakes.where('wordId').equals(q.wordId).count()).toBe(1);

    s = await service.startSession({ mode: 'read-complete' });
    const pq = s.current!.question as ParagraphQuestion;
    const rr = await service.submit(s.id, { questionId: pq.id, answers: pq.gaps.map(() => ''), kind: 'submit' });
    expect(rr.outcome.gaps.every((g) => g.result === 'unanswered')).toBe(true);
    for (const g of pq.gaps) expect((await db.progress.get(g.wordId))!.status).toBe('learning');

    const fix = await service.startSession({ mode: 'fill-blanks', focus: 'mistakes' });
    expect(fix.target).toBe(1 + new Set(pq.gaps.map((g) => g.wordId)).size);
  });
});

