import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDB } from '../../src/db/db';
import { VocabStore } from '../../src/data/vocabStore';
import type { Question, VocabData, VocabWord } from '../../src/engine/types';
import { PracticeService } from '../../src/services/practice';

export const root = join(import.meta.dirname, '../..');
export const vocab: VocabData = JSON.parse(readFileSync(join(root, 'public/data/vocab.json'), 'utf8'));

let counter = 0;

/** A fresh app instance: its own IndexedDB database, a controllable clock and a seeded random generator. */
export function makeEnv(opts: { dbName?: string; custom?: VocabWord[]; start?: number } = {}) {
  const dbName = opts.dbName ?? `functional-${process.pid}-${counter++}`;
  const clock = { t: opts.start ?? new Date(2026, 9, 8, 9, 0, 0).getTime() };
  let seed = 12345;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const db = new AppDB(dbName);
  const store = new VocabStore(vocab, opts.custom ?? []);
  const service = new PracticeService({ db, store, now: () => clock.t, rng });
  return { db, store, service, clock, dbName };
}

/** Answers that are right (the missing letters) or wrong for every gap of a question. */
export function answersFor(q: Question, correct: boolean): string[] {
  if (q.kind === 'interactive') return [];
  const gaps = q.kind === 'sentence' ? [q.gap] : q.gaps;
  return gaps.map((g) => (correct ? g.answer.slice(g.visible.length) : 'qqq'));
}
