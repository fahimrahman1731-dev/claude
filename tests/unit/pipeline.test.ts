import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractAll, type SourceManifestEntry } from '../../scripts/lib/extract-lib';
import { selectGaps } from '../../scripts/lib/build-lib';
import { parseItem } from '../../scripts/lib/normalize';
import { AppDB } from '../../src/db/db';
import { VocabStore } from '../../src/data/vocabStore';
import { exportBackup, restoreBackup } from '../../src/services/backup';
import { importWordList, parseCsv } from '../../src/services/words';
import { root, vocab } from '../functional/env';

const srcDir = join(root, 'data/sources');
const manifest: SourceManifestEntry[] = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));
const extraction = extractAll(manifest, (f) => readFileSync(join(srcDir, f), 'utf8'));
const section = (id: string) => extraction.sources.flatMap((s) => s.sections).find((s) => s.id === id)!;

describe('extraction from the study documents', () => {
  it('reads every section of both documents', () => {
    for (const s of extraction.sources) {
      expect(s.status).toBe('ok');
      for (const sec of s.sections) expect(sec.status, sec.label).toBe('ok');
    }
  });
  it('matches the sizes stated in the documents', () => {
    expect(section('guide.bank3.level1').accepted).toBe(339);
    expect(section('guide.bank3.level2').accepted).toBe(207);
    expect(section('guide.bank3.level3').accepted).toBe(114);
    expect(section('guide.bank5.harder').accepted).toBe(48);
    expect(section('guide.bank5.more').accepted).toBe(120);
    expect(section('guide.bank5.easy').accepted).toBe(55);
    expect(section('harvest.1a').accepted).toBe(45);
  });
  it('keeps gap counts, definitions and British variants', () => {
    const the = extraction.words.find((w) => w.word === 'the')!;
    expect(the.gapCount).toBe(81);
    const valves = extraction.words.find((w) => w.word === 'valves')!;
    expect(valves.definitions[0].text).toBe('flaps that open and close');
    expect(extraction.words.find((w) => w.word === 'organize')!.ukVariants).toContain('organise');
    expect(extraction.words.find((w) => w.word === 'centre')).toBeUndefined();
  });
  it('records a reason for every rejected item', () => {
    expect(extraction.rejected.length).toBeGreaterThan(0);
    for (const r of extraction.rejected) expect(r.reason).toBeTruthy();
    expect(extraction.rejected.map((r) => r.raw)).toEqual(expect.arrayContaining(['zero-gravity (hyphenated, so it would never be a real Read and Complete gap)', "today's"]));
    expect(extraction.sources[0].notes.join(' ')).toMatch(/37 more small words/);
  });
  it('normalizes list items', () => {
    expect(parseItem('artifacts (UK: artefacts)')).toMatchObject({ word: 'artifacts', ukVariant: 'artefacts' });
    expect(parseItem('apartment (UK: flat)')).toMatchObject({ word: 'apartment', note: 'UK word: flat' });
    expect(parseItem('inhospitable ★(too harsh to live in)')).toMatchObject({ word: 'inhospitable', definition: 'too harsh to live in' });
    expect(parseItem('dressing gown').reject).toMatch(/multi-word/);
  });
});

describe('Read and Complete gaps', () => {
  it('never puts two gaps side by side and keeps the first and last sentences whole', () => {
    const byWord = new Map(vocab.words.map((w) => [w.word, w]));
    for (const p of vocab.paragraphs) {
      const firstEnd = p.text.indexOf('. ') + 1;
      const lastStart = p.text.lastIndexOf('. ') + 1;
      expect(p.gaps.length).toBeGreaterThanOrEqual(8);
      expect(p.gaps.length).toBeLessThanOrEqual(20);
      p.gaps.forEach((g, i) => {
        expect(g.start).toBeGreaterThanOrEqual(firstEnd);
        expect(g.end).toBeLessThanOrEqual(lastStart);
        expect(p.text.slice(g.start, g.end).toLowerCase()).toBe(byWord.get(p.text.slice(g.start, g.end).toLowerCase())!.word);
        if (i > 0) expect(/[A-Za-z]/.test(p.text.slice(p.gaps[i - 1].end, g.start))).toBe(true);
      });
    }
    const again = selectGaps(vocab.paragraphs[0].text, byWord);
    expect(again.map((g) => g.start)).toEqual(vocab.paragraphs[0].gaps.map((g) => g.start));
  });
});

describe('word list import', () => {
  const store = new VocabStore(vocab);
  it('imports a CSV with quoted fields and reports every row', () => {
    const csv = [
      'word,pos,definition,bengali,sentence1,sentence2',
      'zephyr,n,"a soft, gentle wind",মৃদু বাতাস,"A cool zephyr moved the curtains.","The sailors hoped for a zephyr, not a storm."',
      'water,n,already there,,,',
      'zephyr,n,duplicate,,,',
      'two words,n,bad,,,',
      'quixotic,adj,unrealistically idealistic,,,',
    ].join('\n');
    expect(parseCsv('a,"b, c",d')[0]).toEqual(['a', 'b, c', 'd']);
    const { words, report } = importWordList('mine.csv', csv, store);
    expect(report.rowsDetected).toBe(5);
    expect(report.imported).toEqual(['zephyr', 'quixotic']);
    expect(report.alreadyInLibrary).toEqual(['water']);
    expect(report.duplicatesInFile).toEqual(['zephyr']);
    expect(report.failedRows).toHaveLength(1);
    expect(report.needSentences).toEqual(['quixotic']);
    expect(report.status).toBe('partial');
    expect(words[0].isCustom).toBe(true);
    expect(words[0].contexts).toHaveLength(2);
  });
});

describe('backup', () => {
  it('round-trips all saved data', async () => {
    const a = new AppDB(`backup-a-${process.pid}`);
    await a.kv.put({ key: 'settings', value: { dailyGoal: 77 } });
    await a.progress.put({ ...{ wordId: 'w:the', status: 'learning' }, attempts: 1 } as never);
    const backup = JSON.parse(JSON.stringify(await exportBackup(a)));
    const b = new AppDB(`backup-b-${process.pid}`);
    const r = await restoreBackup(b, backup);
    expect(r.counts.progress).toBe(1);
    expect((await b.kv.get('settings'))?.value).toEqual({ dailyGoal: 77 });
    await expect(restoreBackup(b, { hello: 1 })).rejects.toThrow(/not a DET Vocab Trainer backup/);
    expect(await b.progress.count()).toBe(1);
  });
});
