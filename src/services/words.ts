import { LEVELS } from '../engine/adaptive';
import { derive, endingSplit, isFunctionWord } from '../engine/morphology';
import { levelFor } from '../engine/priority';
import type { Context, Difficulty, VocabWord } from '../engine/types';
import { checkContext, checkContextSet } from '../engine/validate';
import type { VocabStore } from '../data/vocabStore';

export interface CustomWordInput {
  word: string;
  pos?: string;
  definition?: string;
  bengali?: string;
  difficulty?: Difficulty;
  sentences: string[];
  base?: string;
}

export interface CustomWordResult {
  word?: VocabWord;
  errors: string[];
  sentenceIssues: { sentence: string; reason: string }[];
  practiceReady: boolean;
}

const CUSTOM_EVIDENCE = 5;

export function normalizeWord(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Builds a custom word from the student's input. Sentences go through the
 * same checks as the imported dataset. A word with fewer than two valid,
 * different sentences is saved but cannot be practiced until more are added.
 */
export function makeCustomWord(input: CustomWordInput, store: VocabStore, source = 'custom'): CustomWordResult {
  const errors: string[] = [];
  const w = normalizeWord(input.word);
  if (!/^[a-z]+$/.test(w)) errors.push('A spelling target must be one word with letters only (no spaces, hyphens or apostrophes).');
  else if (w.length < 2) errors.push('Single letters are never DET gaps.');
  if (store.byWord.has(w)) errors.push(`“${w}” is already in the vocabulary library.`);
  if (errors.length) return { errors, sentenceIssues: [], practiceReady: false };

  const id = `c:${w}`;
  const issues: { sentence: string; reason: string }[] = [];
  const contexts: Context[] = [];
  for (const raw of input.sentences.map((x) => x.trim()).filter(Boolean)) {
    const c = checkContext(raw, w, id, 'custom');
    if (c.context) contexts.push(c.context);
    else issues.push({ sentence: raw, reason: c.errors.join('; ') });
  }
  const set = checkContextSet(contexts, w);
  issues.push(...set.rejected);

  const base = input.base ? normalizeWord(input.base) : findBase(w, store);
  const baseWord = base ? store.byWord.get(base) : undefined;
  const pos = (input.pos ?? '').split(/[\s/,]+/).filter(Boolean);
  const difficulty: Difficulty = input.difficulty && LEVELS.includes(input.difficulty) ? input.difficulty : w.length <= 5 ? 'easy' : w.length <= 9 ? 'intermediate' : 'advanced';
  const ending = endingSplit(w, base, []);
  const word: VocabWord = {
    id,
    word: w,
    pos: pos.length ? pos : ['n'],
    definition: input.definition?.trim() || '',
    definitionOrigin: 'custom',
    sourceDefinitions: [],
    bengali: input.bengali?.trim() || undefined,
    bengaliOrigin: input.bengali?.trim() ? 'custom' : undefined,
    base: base || undefined,
    family: baseWord?.family ?? w,
    ending: ending ?? undefined,
    difficulty,
    basePriority: levelFor(CUSTOM_EVIDENCE),
    evidenceScore: CUSTOM_EVIDENCE,
    evidence: ['custom'],
    sources: [source],
    sections: [source],
    tags: ['custom'],
    collocations: [],
    ukVariants: [],
    notes: [],
    isSmallWord: isFunctionWord(w),
    isCustom: true,
    contexts: set.kept,
  };
  return { word, errors, sentenceIssues: issues, practiceReady: set.kept.length >= 2 };
}

/** Links a custom word to an existing family when it is that word plus an ending. */
function findBase(w: string, store: VocabStore): string | undefined {
  let best: string | undefined;
  for (const cand of store.byWord.keys()) {
    if (cand.length >= 3 && cand.length < w.length && derive(w, cand) && (!best || cand.length > best.length)) best = cand;
  }
  return best;
}

// ------------------------------------------------------------------ file import

export interface ImportReport {
  fileName: string;
  status: 'ok' | 'partial' | 'failed';
  error?: string;
  rowsDetected: number;
  imported: string[];
  practiceReady: number;
  alreadyInLibrary: string[];
  duplicatesInFile: string[];
  missingDefinitions: string[];
  needSentences: string[];
  failedRows: { row: number; text: string; reason: string }[];
  contextsAdded: number;
}

/** Minimal CSV reader that understands quoted fields ("a, b"). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function rowsFromFile(fileName: string, text: string): CustomWordInput[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data?.words;
    if (!Array.isArray(list)) throw new Error('JSON must be an array of words or an object with a "words" array.');
    return list.map((x: Record<string, unknown>) => ({
      word: String(x.word ?? ''),
      pos: x.pos ? String(x.pos) : undefined,
      definition: x.definition ? String(x.definition) : undefined,
      bengali: x.bengali ? String(x.bengali) : undefined,
      difficulty: x.difficulty as Difficulty | undefined,
      sentences: Array.isArray(x.sentences) ? x.sentences.map(String) : [],
    }));
  }
  if (lower.endsWith('.csv')) {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error('The CSV file is empty.');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const wi = head.indexOf('word');
    if (wi === -1) throw new Error('The CSV needs a header row with a "word" column.');
    const col = (name: string) => head.indexOf(name);
    const sentenceCols = head.map((h, i) => (/^(sentence|context|example)/.test(h) ? i : -1)).filter((i) => i >= 0);
    return rows.slice(1).map((r) => ({
      word: r[wi] ?? '',
      pos: col('pos') >= 0 ? r[col('pos')] : undefined,
      definition: col('definition') >= 0 ? r[col('definition')] : col('meaning') >= 0 ? r[col('meaning')] : undefined,
      bengali: col('bengali') >= 0 ? r[col('bengali')] : undefined,
      difficulty: (col('difficulty') >= 0 ? r[col('difficulty')]?.trim().toLowerCase() : undefined) as Difficulty | undefined,
      sentences: sentenceCols.map((i) => r[i] ?? '').filter((x) => x.trim()),
    }));
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    // One word per line, optionally "word - meaning" or "word: meaning".
    return text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim())
      .filter(Boolean)
      .map((l) => {
        const m = /^([A-Za-z]+)\s*(?:[-–:|]\s*(.*))?$/.exec(l);
        return m ? { word: m[1], definition: m[2], sentences: [] } : { word: l, sentences: [] };
      });
  }
  throw new Error('Unsupported file type. Use .csv, .json or .txt.');
}

/**
 * Imports a word list file. Every row is accounted for in the report:
 * imported, already in the library, duplicated in the file, or failed with a
 * reason. A file that cannot be read at all is reported as failed.
 */
export function importWordList(fileName: string, text: string, store: VocabStore): { words: VocabWord[]; report: ImportReport } {
  const report: ImportReport = {
    fileName,
    status: 'ok',
    rowsDetected: 0,
    imported: [],
    practiceReady: 0,
    alreadyInLibrary: [],
    duplicatesInFile: [],
    missingDefinitions: [],
    needSentences: [],
    failedRows: [],
    contextsAdded: 0,
  };
  let rows: CustomWordInput[];
  try {
    if (!text.trim()) throw new Error('The file is empty.');
    rows = rowsFromFile(fileName, text);
  } catch (e) {
    report.status = 'failed';
    report.error = e instanceof Error ? e.message : String(e);
    return { words: [], report };
  }
  report.rowsDetected = rows.length;
  const seen = new Set<string>();
  const words: VocabWord[] = [];
  rows.forEach((r, i) => {
    const w = normalizeWord(r.word);
    if (!w) {
      report.failedRows.push({ row: i + 1, text: JSON.stringify(r).slice(0, 80), reason: 'no word' });
      return;
    }
    if (seen.has(w)) {
      report.duplicatesInFile.push(w);
      return;
    }
    seen.add(w);
    if (store.byWord.has(w)) {
      report.alreadyInLibrary.push(w);
      return;
    }
    const res = makeCustomWord(r, store, `import:${fileName}`);
    if (!res.word) {
      report.failedRows.push({ row: i + 1, text: r.word, reason: res.errors.join(' ') });
      return;
    }
    words.push(res.word);
    report.imported.push(w);
    report.contextsAdded += res.word.contexts.length;
    if (!res.word.definition) report.missingDefinitions.push(w);
    if (res.practiceReady) report.practiceReady++;
    else report.needSentences.push(w);
  });
  if (report.rowsDetected === 0) {
    report.status = 'failed';
    report.error = 'No words were found in the file.';
  } else if (report.failedRows.length) report.status = report.imported.length ? 'partial' : 'failed';
  return { words, report };
}
