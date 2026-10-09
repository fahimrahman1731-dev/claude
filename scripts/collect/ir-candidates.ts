/**
 * Picks real passages for Interactive Reading and finds "sibling" passages on
 * the same topic for each. Duolingo builds the wrong options of Complete the
 * Passage, Identify the Idea and Title the Passage from alternative passages on
 * the same topic (Attali et al., 2022); the siblings' sentences and titles play
 * that role here.
 *
 *   npx tsx scripts/collect/ir-candidates.ts > /tmp/ir-candidates.json
 *
 * The output is a working file for the people (or agents) who write the
 * question parts; only the finished sets in data/authored/interactive are kept.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSensitive, splitSentences, words, type CollectedText } from '../lib/collected';

const root = join(import.meta.dirname, '../..');
const texts: CollectedText[] = JSON.parse(readFileSync(join(root, 'data/collected/texts.json'), 'utf8')).filter((t: CollectedText) => t.text);

const STOP = new Set('the a an and or but of to in on at for with by from as is are was were be been it its this that these those they them their he she his her we our you your i which who what when where how than then there here not no so can could will would may might also more most other some such into about over after before up out very just all any each many much one two'.split(' '));

/** First whole sentences of a text adding up to 120–200 words (and 6–14 sentences). */
function passageOf(t: CollectedText): string | undefined {
  const paras = t.text.split(/\n\n/);
  const out: string[] = [];
  let n = 0;
  let sentences = 0;
  for (const p of paras) {
    const sp = splitSentences(p);
    const keep: string[] = [];
    for (const s of sp) {
      const piece = p.slice(s.start, s.end);
      const w = words(piece).length;
      if (n + w > 200) break;
      keep.push(piece);
      n += w;
      sentences++;
    }
    if (keep.length) out.push(keep.join(' '));
    if (n >= 150 || keep.length < sp.length) break;
  }
  if (n < 120 || sentences < 6 || sentences > 14) return undefined;
  const text = out.join('\n\n');
  if (isSensitive(text)) return undefined;
  if ((text.match(/\d+(?:[.,]\d+)*/g) ?? []).length > 2) return undefined;
  if (/[()[\]/%&@#]/.test(text)) return undefined;
  const quotes = (text.match(/["“”]/g) ?? []).length;
  if (t.genre === 'expository' ? quotes > 0 : quotes > 6) return undefined;
  return text;
}

function bag(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of s.toLowerCase().match(/[a-z]+/g) ?? []) if (w.length > 3 && !STOP.has(w)) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

const pool = texts.filter((t) => !['asset', 'cefrsp-score', 'cefrsp-wiki'].includes(t.id));
const df = new Map<string, number>();
const bags = new Map<string, Map<string, number>>();
for (const t of pool) {
  const b = bag(t.title + ' ' + t.text.slice(0, 2500));
  bags.set(t.id, b);
  for (const w of b.keys()) df.set(w, (df.get(w) ?? 0) + 1);
}
const N = pool.length;
function vec(id: string): Map<string, number> {
  const v = new Map<string, number>();
  for (const [w, c] of bags.get(id)!) v.set(w, (1 + Math.log(c)) * Math.log(N / (df.get(w) ?? 1)));
  return v;
}
const vecs = new Map(pool.map((t) => [t.id, vec(t.id)]));
const norms = new Map([...vecs].map(([id, v]) => [id, Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0))]));
function cos(a: string, b: string): number {
  const va = vecs.get(a)!;
  const vb = vecs.get(b)!;
  let s = 0;
  for (const [w, x] of va) {
    const y = vb.get(w);
    if (y) s += x * y;
  }
  return s / ((norms.get(a) || 1) * (norms.get(b) || 1));
}

type Cand = { id: string; text: CollectedText; passage: string };
const cands: Cand[] = [];
/** Titles that are not real titles of the passage (section labels, school grades) or touch topics the DET avoids. */
const POOR_TITLE = /section summary|key concepts|learning (objectives|outcomes)|thinking ahead|introduction$|^grade\b|grade \d|natural sciences|apprenticeship|\s-\s\d|\s$|witch|rights|controvers|religio|slave|war\b|crime|ogre|death|funeral|^why we should/i;
for (const t of pool) {
  if (POOR_TITLE.test(t.title) || t.title.length > 80) continue;
  const p = passageOf(t);
  if (p) cands.push({ id: t.id, text: t, passage: p });
}

/** Spread picks over sources, topics and difficulty, deterministically. */
function pick(filter: (c: Cand) => boolean, count: number, key: (c: Cand) => string): Cand[] {
  const groups = new Map<string, Cand[]>();
  for (const c of cands.filter(filter).sort((a, b) => a.id.localeCompare(b.id))) groups.set(key(c), [...(groups.get(key(c)) ?? []), c]);
  const out: Cand[] = [];
  const qs = [...groups.values()];
  let i = 0;
  while (out.length < count && qs.some((q) => q.length)) {
    const q = qs[i++ % qs.length];
    // take every 7th item to avoid neighbouring excerpts of the same source
    if (q.length) out.push(q.splice((out.length * 7) % q.length, 1)[0]);
  }
  return out;
}

const host = (c: Cand) => (c.text.url ?? '').replace(/^https?:\/\/(www\.)?([^/]+).*$/, '$2');
const seenTitles = new Set<string>();
const chosenRaw = [
  ...pick((c) => c.text.corpus === 'clear' && c.text.genre === 'expository', 36, (c) => `${host(c)}:${c.text.difficulty}`),
  ...pick((c) => c.text.corpus === 'clear' && c.text.genre === 'narrative', 32, (c) => `${host(c)}:${c.text.difficulty}`),
  ...pick((c) => c.text.corpus === 'openstax', 28, (c) => c.text.topic),
  ...pick((c) => c.text.corpus === 'ose', 10, (c) => c.text.difficulty),
];
// one passage per title (OneStopEnglish has two levels of each text; some stories exist twice)
const chosen = chosenRaw.filter((c) => {
  const key = c.text.title.toLowerCase().replace(/[^a-z]/g, '');
  if (seenTitles.has(key)) return false;
  seenTitles.add(key);
  return true;
});

const out = chosen.map((c, k) => {
  const sims = pool
    .filter((t) => t.id !== c.id && t.genre === c.text.genre && t.title !== c.text.title && !POOR_TITLE.test(t.title) && t.title.length <= 80)
    .map((t) => ({ t, s: cos(c.id, t.id) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  const siblingSentences: string[] = [];
  for (const { t } of sims) {
    const sp = splitSentences(t.text.replace(/\n\n/g, ' '));
    for (const [i, s] of sp.entries()) {
      const x = t.text.replace(/\n\n/g, ' ').slice(s.start, s.end).trim();
      const n = words(x).length;
      if (i >= 2 && i < sp.length - 1 && n >= 8 && n <= 30 && !isSensitive(x) && !/["“”()]/.test(x)) siblingSentences.push(x);
      if (siblingSentences.length >= 4 * (sims.indexOf(sims.find((z) => z.t === t)!) + 1)) break;
    }
  }
  return {
    n: k + 1,
    sourceId: c.id,
    genre: c.text.genre,
    topic: c.text.topic,
    difficulty: c.text.difficulty,
    originalTitle: c.text.title,
    credit: c.text.credit,
    passage: c.passage,
    words: words(c.passage).length,
    siblingTitles: sims.map((x) => x.t.title),
    siblingOpenings: sims.map((x) => splitSentences(x.t.text).slice(0, 2).map((s) => x.t.text.slice(s.start, s.end)).join(' ')),
    siblingSentences: siblingSentences.slice(0, 16),
  };
});
console.log(JSON.stringify(out, null, 1));
console.error(`${out.length} passages (from ${cands.length} candidates)`);
