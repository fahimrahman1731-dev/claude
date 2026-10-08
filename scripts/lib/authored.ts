import type { Difficulty } from '../../src/engine/types';

/**
 * Authored enrichment, one word per line:
 *   word|pos|level|definition|bengali|sentence 1|sentence 2[|sentence 3 …]
 * - pos: n, v, adj, adv, prep, conj, pron, det, aux, num, interj (several joined with /)
 * - level: E, I or A
 * - definition may start with {base} for a form of a simpler word: "{walk} moved on foot"
 * - a sentence may [bracket] the target when the word appears more than once
 * Lines starting with # are comments.
 */
export interface AuthoredWord {
  word: string;
  pos: string[];
  level?: Difficulty;
  definition: string;
  base?: string;
  bengali?: string;
  sentences: string[];
  file: string;
  line: number;
}

export interface AuthoredParagraph {
  id: string;
  title: string;
  topic: string;
  level: Difficulty;
  text: string;
  file: string;
  line: number;
}

const LEVEL: Record<string, Difficulty> = { E: 'easy', I: 'intermediate', A: 'advanced' };

export function parseAuthoredWords(text: string, file: string): { words: AuthoredWord[]; errors: string[] } {
  const words: AuthoredWord[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const f = line.split('|').map((x) => x.trim());
    if (f.length < 6) {
      errors.push(`${file}:${i + 1}: expected at least 6 fields, got ${f.length}`);
      return;
    }
    const [word, pos, lvl, defRaw, bn, ...sentences] = f;
    const m = /^\{([a-z]+)\}\s*(.*)$/.exec(defRaw);
    words.push({
      word: word.toLowerCase(),
      pos: pos.split('/').filter(Boolean),
      level: LEVEL[lvl],
      definition: m ? m[2] : defRaw,
      base: m ? m[1] : undefined,
      bengali: bn || undefined,
      sentences: sentences.filter(Boolean),
      file,
      line: i + 1,
    });
    if (lvl && !LEVEL[lvl]) errors.push(`${file}:${i + 1}: unknown level "${lvl}"`);
  });
  return { words, errors };
}

export function parseAuthoredParagraphs(text: string, file: string): { paragraphs: AuthoredParagraph[]; errors: string[] } {
  const paragraphs: AuthoredParagraph[] = [];
  const errors: string[] = [];
  let cur: AuthoredParagraph | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const head = /^===\s*(\S+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([EIA])\s*$/.exec(raw);
    if (head) {
      if (cur) paragraphs.push(cur);
      cur = { id: head[1], title: head[2], topic: head[3], level: LEVEL[head[4]], text: '', file, line: i + 1 };
      return;
    }
    if (raw.startsWith('#')) return;
    if (raw.trim()) {
      if (!cur) errors.push(`${file}:${i + 1}: text outside a paragraph`);
      else cur.text = (cur.text + ' ' + raw.trim()).trim();
    }
  });
  if (cur) paragraphs.push(cur);
  return { paragraphs, errors };
}
