/**
 * Loads and validates the Interactive Reading sets in data/authored/interactive.
 *
 * Each set is built on a real, openly licensed passage (from data/collected/texts.json):
 * the passage text must be copied unchanged from its source. The question parts
 * follow the DET design (Duolingo Research Report DRR-22-02; Attali et al., 2022):
 * 3–10 whole-word blanks with 5 options in the first part, one missing sentence
 * of 8–30 words (not one of the first two or the last) with 3 wrong sentences,
 * two wh-questions whose answers are passage spans of 3+ words, one idea with 3
 * wrong ideas, and the title with 3–4 wrong titles.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Difficulty, InteractiveSet } from '../../src/engine/types';
import { splitSentences, words, type CollectedText } from './collected';

export interface AuthoredInteractive {
  id: string;
  sourceId: string;
  /** Used when the source is not in texts.json (e.g. the Duolingo research appendix). */
  source?: { title: string; author?: string; url?: string; license: string; credit: string };
  genre: 'narrative' | 'expository';
  topic: string;
  difficulty: Difficulty;
  title: string;
  passage: string;
  sentencesPartEndsAfter: string;
  blanks: { answer: string; occurrence?: number; distractors: string[]; why?: string }[];
  missingSentence: string;
  missingDistractors: string[];
  missingWhy?: string;
  highlights: { question: string; answer: string }[];
  idea: { answer: string; distractors: string[]; why?: string };
  titleDistractors: string[];
  titleWhy?: string;
}

const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

function wordAt(text: string, word: string, occurrence: number, from: number, to: number): { start: number; end: number } | undefined {
  const re = new RegExp(`(?<![A-Za-z'’])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z'’])`, 'g');
  re.lastIndex = from;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < to) {
    n++;
    if (n === occurrence) return { start: m.index, end: m.index + word.length };
  }
  return undefined;
}

export function validateInteractive(a: AuthoredInteractive, sourceText: string | undefined): { set?: InteractiveSet; problems: string[] } {
  const p: string[] = [];
  const text = a.passage.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
  if (!['narrative', 'expository'].includes(a.genre)) p.push('genre must be narrative or expository');
  if (!['easy', 'intermediate', 'advanced'].includes(a.difficulty)) p.push('difficulty must be easy, intermediate or advanced');
  const n = words(text).length;
  if (n < 90 || n > 230) p.push(`passage has ${n} words (expected about 100–210)`);
  const sents = splitSentences(text);
  if (sents.length < 5) p.push(`passage has only ${sents.length} sentences`);
  if (sourceText !== undefined) {
    const src = norm(sourceText);
    for (const s of sents) {
      const t = norm(text.slice(s.start, s.end));
      if (!src.includes(t)) p.push(`sentence not found unchanged in the source: “${t.slice(0, 80)}”`);
    }
  }
  // Complete the Sentences part
  const cutIdx = text.indexOf(a.sentencesPartEndsAfter.trim());
  const csEnd = cutIdx < 0 ? -1 : cutIdx + a.sentencesPartEndsAfter.trim().length;
  if (csEnd < 0) p.push('sentencesPartEndsAfter is not a sentence of the passage');
  const csWords = csEnd > 0 ? words(text.slice(0, csEnd)).length : 0;
  if (csEnd > 0 && (csWords < n * 0.3 || csWords > n * 0.75)) p.push(`the Complete the Sentences part has ${csWords} of ${n} words (expected about half)`);
  if (a.blanks.length < 3 || a.blanks.length > 10) p.push(`${a.blanks.length} blanks (expected 3–10)`);
  const blanks: InteractiveSet['blanks'] = [];
  for (const b of a.blanks) {
    const at = csEnd > 0 ? wordAt(text, b.answer, b.occurrence ?? 1, 0, csEnd) : undefined;
    if (!at) {
      p.push(`blank “${b.answer}” (occurrence ${b.occurrence ?? 1}) is not a word in the first part`);
      continue;
    }
    if (blanks.some((x) => x.start === at.start)) p.push(`blank “${b.answer}” is used twice`);
    const ds = b.distractors.map((d) => d.trim());
    if (ds.length !== 4) p.push(`blank “${b.answer}” has ${ds.length} wrong options (expected 4)`);
    if (new Set(ds.map((d) => d.toLowerCase())).size !== ds.length) p.push(`blank “${b.answer}” repeats a wrong option`);
    if (ds.some((d) => d.toLowerCase() === b.answer.toLowerCase())) p.push(`blank “${b.answer}” lists the answer as a wrong option`);
    if (ds.some((d) => !/^[A-Za-z][A-Za-z'’-]*$/.test(d))) p.push(`blank “${b.answer}” has a wrong option that is not one word`);
    blanks.push({ start: at.start, end: at.end, answer: text.slice(at.start, at.end), distractors: ds, ...(b.why ? { why: b.why } : {}) });
  }
  blanks.sort((x, y) => x.start - y.start);
  for (let i = 1; i < blanks.length; i++) {
    if (words(text.slice(blanks[i - 1].end, blanks[i].start)).length < 2) p.push(`blanks “${blanks[i - 1].answer}” and “${blanks[i].answer}” are too close`);
  }
  // Complete the Passage
  const ms = a.missingSentence.trim();
  const mStart = text.indexOf(ms);
  const mIdx = sents.findIndex((s) => s.start === mStart);
  if (mStart < 0 || mIdx < 0) p.push('missingSentence is not a whole sentence of the passage');
  else {
    if (mIdx < 2 || mIdx === sents.length - 1) p.push('missingSentence may not be one of the first two sentences or the last one');
    if (csEnd > 0 && mStart < csEnd) p.push('missingSentence must come after the Complete the Sentences part');
  }
  const mw = words(ms).length;
  if (mw < 8 || mw > 30) p.push(`missingSentence has ${mw} words (expected 8–30)`);
  if (a.missingDistractors.length !== 3) p.push(`${a.missingDistractors.length} wrong sentences (expected 3)`);
  for (const d of a.missingDistractors) {
    const dw = words(d).length;
    if (dw < 6 || dw > 34) p.push(`wrong sentence has ${dw} words: “${d.slice(0, 60)}”`);
    if (norm(text).includes(norm(d))) p.push(`wrong sentence is part of the passage: “${d.slice(0, 60)}”`);
  }
  // Highlight the Answer
  if (a.highlights.length !== 2) p.push(`${a.highlights.length} highlight questions (expected 2)`);
  const highlights: InteractiveSet['highlights'] = [];
  for (const h of a.highlights) {
    const q = h.question.trim();
    if (!q.endsWith('?')) p.push(`highlight question must end with “?”: ${q}`);
    if (words(q).length > 25) p.push(`highlight question is longer than 25 words: ${q}`);
    const ans = h.answer.trim();
    const at = text.indexOf(ans);
    if (at < 0) p.push(`highlight answer is not in the passage: “${ans}”`);
    else if (text.indexOf(ans, at + 1) >= 0) p.push(`highlight answer appears twice in the passage: “${ans}”`);
    if (words(ans).length < 3) p.push(`highlight answer is shorter than 3 words: “${ans}”`);
    if (at >= 0) highlights.push({ question: q, start: at, end: at + ans.length });
  }
  // Identify the Idea and Title the Passage
  if (a.idea.distractors.length !== 3) p.push(`${a.idea.distractors.length} wrong ideas (expected 3)`);
  if (a.titleDistractors.length < 3 || a.titleDistractors.length > 4) p.push(`${a.titleDistractors.length} wrong titles (expected 3–4)`);
  const titles = [a.title, ...a.titleDistractors].map((t) => t.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) p.push('the titles are not all different');
  const ideas = [a.idea.answer, ...a.idea.distractors].map((t) => t.trim().toLowerCase());
  if (new Set(ideas).size !== ideas.length) p.push('the ideas are not all different');
  if (p.length) return { problems: p };
  return {
    problems: [],
    set: {
      id: a.id,
      title: a.title.trim(),
      topic: a.topic,
      genre: a.genre,
      difficulty: a.difficulty,
      text,
      sentencesPartEnd: csEnd,
      blanks,
      missing: { start: mStart, end: mStart + ms.length, distractors: a.missingDistractors.map((d) => d.trim()), ...(a.missingWhy ? { why: a.missingWhy } : {}) },
      highlights,
      idea: { answer: a.idea.answer.trim(), distractors: a.idea.distractors.map((d) => d.trim()), ...(a.idea.why ? { why: a.idea.why } : {}) },
      titles: { answer: a.title.trim(), distractors: a.titleDistractors.map((d) => d.trim()), ...(a.titleWhy ? { why: a.titleWhy } : {}) },
      source: { id: a.sourceId, title: '', license: '' },
    },
  };
}

export function loadInteractive(dir: string, texts: CollectedText[]): { sets: InteractiveSet[]; issues: string[] } {
  const sets: InteractiveSet[] = [];
  const issues: string[] = [];
  if (!existsSync(dir)) return { sets, issues };
  const byId = new Map(texts.map((t) => [t.id, t]));
  const seen = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let items: AuthoredInteractive[];
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      items = Array.isArray(raw) ? raw : [raw];
    } catch (e) {
      issues.push(`${f}: not valid JSON (${e instanceof Error ? e.message : e})`);
      continue;
    }
    for (const a of items) {
      if (seen.has(a.id)) {
        issues.push(`${f} ${a.id}: duplicate id`);
        continue;
      }
      seen.add(a.id);
      const src = byId.get(a.sourceId);
      if (!src && !a.source) {
        issues.push(`${f} ${a.id}: unknown source ${a.sourceId}`);
        continue;
      }
      const r = validateInteractive(a, src?.text);
      if (!r.set) {
        issues.push(`${f} ${a.id}: ${r.problems.join('; ')}`);
        continue;
      }
      r.set.source = src
        ? { id: src.id, title: src.title, ...(src.author ? { author: src.author } : {}), ...(src.url ? { url: src.url } : {}), license: src.license, note: src.credit }
        : { id: a.sourceId, title: a.source!.title, ...(a.source!.author ? { author: a.source!.author } : {}), ...(a.source!.url ? { url: a.source!.url } : {}), license: a.source!.license, note: a.source!.credit };
      sets.push(r.set);
    }
  }
  return { sets, issues };
}
