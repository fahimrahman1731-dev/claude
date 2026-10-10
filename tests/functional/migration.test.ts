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
import { makeEnv } from './env';

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
});
