/**
 * Progress saved under the old rules (two sentences for mastery, scheduled reviews)
 * is converted once to the current rule: when the database is upgraded to version 3,
 * and when a backup made before version 3 is restored.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { AppDB } from '../../src/db/db';
import { newProgress } from '../../src/engine/progress';
import type { WordProgress } from '../../src/engine/types';
import { BACKUP_FORMAT, BACKUP_VERSION, exportBackup, restoreBackup } from '../../src/services/backup';
import { makeEnv, vocab } from './env';

let counter = 0;
const dbName = (what: string) => `migration-${what}-${process.pid}-${counter++}`;

/** Progress rows as the old version of the app saved them. */
function oldRows(): WordProgress[] {
  const p = (wordId: string, over: Partial<WordProgress>): WordProgress => ({ ...newProgress(wordId), firstPracticedAt: 100, lastPracticedAt: 500, ...over });
  return [
    // Typed correctly once since its last mistake: one correct answer now masters it.
    p('w:typed', { status: 'learning', attempts: 2, correct: 1, incorrect: 1, consecutiveCorrect: 1, streakContextIds: ['w:typed#a'], dueSeq: 30 }),
    // Latest answer was a mistake: in the Mistake Bank.
    p('w:missed', { status: 'learning', attempts: 1, incorrect: 1, consecutiveIncorrect: 1, dueSeq: 12, nextReviewAt: 900 }),
    // Reopened by the student under the old rules (which made it "learning").
    p('w:reopened', { status: 'learning', attempts: 2, correct: 2, history: [{ at: 200, event: 'mastered' }, { at: 300, event: 'reopened' }] }),
    // Mastered with a retention review pending.
    p('w:mastered', { status: 'mastered', attempts: 2, correct: 2, masteredAt: 400, intervalIndex: 1, nextReviewAt: 99_999, streakContextIds: ['a', 'b'], history: [{ at: 400, event: 'mastered' }] }),
    // Only skipped.
    p('w:skipped', { status: 'new', skips: 1, dueSeq: 4 }),
  ];
}

function expectConverted(rows: WordProgress[]) {
  const by = new Map(rows.map((r) => [r.wordId, r]));
  expect(rows).toHaveLength(5);
  expect(by.get('w:typed')).toMatchObject({ status: 'mastered', masteredAt: 500 });
  expect(by.get('w:typed')!.history.map((h) => h.event)).toEqual(['mastered']);
  expect(by.get('w:missed')!.status).toBe('learning');
  expect(by.get('w:reopened')!.status).toBe('new');
  expect(by.get('w:mastered')).toMatchObject({ status: 'mastered', masteredAt: 400 });
  expect(by.get('w:skipped')).toMatchObject({ status: 'new', skips: 1 });
  for (const r of rows) {
    expect(r.dueSeq, r.wordId).toBeUndefined();
    expect(r.nextReviewAt, r.wordId).toBeUndefined();
    expect(r.streakContextIds, r.wordId).toEqual([]);
  }
}

describe('restoring an older backup', () => {
  const backup = (version: number) => ({
    format: BACKUP_FORMAT,
    version,
    exportedAt: '2026-09-01T10:00:00.000Z',
    tables: { progress: oldRows(), attempts: [], mistakes: [], sessions: [], kv: [{ key: 'settings', value: { dailyGoal: 55, reviewFrequency: 'often' } }], customWords: [], aiContexts: [], imports: [] },
  });

  it('converts progress from a version 2 backup to the one-answer rule', async () => {
    const db = new AppDB(dbName('restore-v2'));
    const r = await restoreBackup(db, JSON.parse(JSON.stringify(backup(2))));
    expect(r.counts.progress).toBe(5);
    expect(r.counts.irResults).toBe(0);
    expectConverted(await db.progress.toArray());
    expect((await db.kv.get('settings'))?.value).toMatchObject({ dailyGoal: 55 });
    db.close();
  });

  it('converts a version 1 backup too', async () => {
    const db = new AppDB(dbName('restore-v1'));
    await restoreBackup(db, JSON.parse(JSON.stringify(backup(1))));
    expectConverted(await db.progress.toArray());
    db.close();
  });

  it('leaves progress from a current backup as it is', async () => {
    const db = new AppDB(dbName('restore-v3'));
    const rows = [{ ...newProgress('w:x'), status: 'learning' as const, attempts: 1, incorrect: 1, consecutiveIncorrect: 1 }];
    await restoreBackup(db, { ...backup(BACKUP_VERSION), tables: { ...backup(BACKUP_VERSION).tables, progress: rows } });
    expect(await db.progress.toArray()).toEqual(rows);
    db.close();
  });

  it('exports at the current version, so a round trip changes nothing', async () => {
    expect(BACKUP_VERSION).toBe(3);
    const a = new AppDB(dbName('export'));
    await restoreBackup(a, backup(2));
    const exported = JSON.parse(JSON.stringify(await exportBackup(a)));
    expect(exported.version).toBe(3);
    const b = new AppDB(dbName('export-b'));
    await restoreBackup(b, exported);
    expect(await b.progress.orderBy('wordId').toArray()).toEqual(await a.progress.orderBy('wordId').toArray());
    a.close();
    b.close();
  });

  it('refuses a backup from a newer version of the app', async () => {
    const db = new AppDB(dbName('restore-newer'));
    await expect(restoreBackup(db, backup(BACKUP_VERSION + 1))).rejects.toThrow(/newer version/);
    db.close();
  });
});

describe('upgrading the saved database to version 3', () => {
  /** The database exactly as the previous version of the app declared it. */
  function version2DB(name: string): Dexie {
    const db = new Dexie(name);
    db.version(1).stores({
      progress: 'wordId, status, nextReviewAt, lastPracticedAt',
      attempts: 'id, wordId, sessionId, at, result, mode',
      mistakes: 'id, wordId, at, result',
      sessions: 'id, startedAt, status',
      kv: 'key',
      customWords: 'id, word',
      aiContexts: 'id, wordId',
      imports: 'id, at',
    });
    db.version(2).stores({ irResults: 'id, sessionId, setId, part, at' });
    return db;
  }

  it('converts old progress once when the app opens the database, and keeps everything else', async () => {
    const name = dbName('upgrade');
    const old = version2DB(name);
    await old.table('progress').bulkPut(oldRows());
    await old.table('mistakes').put({ id: 'm1', wordId: 'w:missed', at: 450, result: 'incorrect' });
    await old.table('kv').put({ key: 'settings', value: { dailyGoal: 33 } });
    expect(old.verno).toBe(2);
    old.close();

    const db = new AppDB(name);
    await db.open();
    expect(db.verno).toBe(3);
    expectConverted(await db.progress.toArray());
    expect(await db.mistakes.count()).toBe(1);
    expect((await db.kv.get('settings'))?.value).toEqual({ dailyGoal: 33 });
    db.close();

    // Opening it again does not convert anything a second time.
    const again = new AppDB(name);
    await again.progress.put({ ...newProgress('w:later'), status: 'learning', attempts: 1, correct: 1, streakContextIds: [] });
    again.close();
    const third = new AppDB(name);
    expect((await third.progress.get('w:later'))!.status).toBe('learning');
    third.close();
  });

  it('the practice service works on an upgraded database', async () => {
    const name = dbName('upgrade-service');
    const old = version2DB(name);
    await old.table('progress').bulkPut(oldRows());
    old.close();
    const { service } = makeEnv({ dbName: name });
    const progress = await service.progressMap();
    expect(progress.get('w:missed')!.status).toBe('learning');
    expect(progress.get('w:typed')!.status).toBe('mastered');
    await service.saveSettings({ timerMode: 'untimed' });
    const s = await service.startSession({ mode: 'fill-blanks' });
    expect(s.current?.reason).toBe('new');
  });

  it('a reopened word missed again after the reopen stays in the Mistake Bank (the attempts log decides)', async () => {
    const name = dbName('upgrade-reopened-missed');
    const old = version2DB(name);
    // Old rules: mastered, reopened, missed when typed, then chosen correctly in Interactive Reading
    // (which reset the old mistake streak and added no history).
    const row: WordProgress = {
      ...newProgress('w:abandon'),
      status: 'learning',
      attempts: 4,
      correct: 3,
      incorrect: 1,
      consecutiveCorrect: 1,
      lastPracticedAt: 700,
      history: [
        { at: 200, event: 'mastered' },
        { at: 300, event: 'reopened' },
      ],
    };
    await old.table('progress').bulkPut([row, { ...row, wordId: 'w:abandoned' }]);
    // w:abandon was missed after the reopen; w:abandoned only before it.
    await old.table('attempts').bulkPut([
      { id: 'a1', wordId: 'w:abandon', sessionId: 'old', at: 600, result: 'incorrect', mode: 'spelling' },
      { id: 'a2', wordId: 'w:abandoned', sessionId: 'old', at: 150, result: 'incorrect', mode: 'spelling' },
    ]);
    old.close();
    const db = new AppDB(name);
    expect((await db.progress.get('w:abandon'))!.status).toBe('learning');
    expect((await db.progress.get('w:abandoned'))!.status).toBe('new');
    db.close();
  });

  it('an unfinished session from the old rules does not ask its old review question', async () => {
    const name = dbName('upgrade-open-session');
    const old = version2DB(name);
    const w = vocab.words.find((x) => x.word === 'abandonment')!;
    const ctx = w.contexts[0];
    await old.table('progress').put({ ...newProgress(w.id), status: 'learning', attempts: 1, incorrect: 1, consecutiveIncorrect: 1, lastPracticedAt: 500 });
    const before = ctx.sentence.slice(0, ctx.start);
    const question = {
      kind: 'sentence',
      id: `fill-blanks|${w.id}|${ctx.id}`,
      mode: 'fill-blanks',
      wordId: w.id,
      contextId: ctx.id,
      sentence: ctx.sentence,
      before,
      after: ctx.sentence.slice(ctx.end),
      gap: { wordId: w.id, contextId: ctx.id, answer: ctx.sentence.slice(ctx.start, ctx.end), visible: 'aba', hiddenLength: ctx.end - ctx.start - 3, ukVariants: [] },
      difficulty: w.difficulty,
      origin: ctx.origin,
    };
    await old.table('sessions').put({
      id: 's-old',
      mode: 'fill-blanks',
      focus: 'normal',
      status: 'active',
      startedAt: 400,
      target: 20,
      newQuota: 8,
      reviewQuota: 12,
      index: 3,
      newIntroduced: 2,
      reviewsServed: 1,
      paragraphIds: [],
      tally: { correct: 3, incorrect: 0, timeout: 0, unanswered: 0, skipped: 0 },
      streak: 3,
      bestStreak: 3,
      current: { question, reason: 'mistake-review', startedAt: 600, limitMs: null },
    });
    old.close();
    const { service } = makeEnv({ dbName: name });
    const s = (await service.activeSession())!;
    expect(s.id).toBe('s-old');
    expect(s.current).toBeDefined();
    expect((s.current!.question as { wordId: string }).wordId).not.toBe(w.id);
    expect(s.current!.reason).toBe('new');
    expect(s.index).toBe(3);
  });
});
