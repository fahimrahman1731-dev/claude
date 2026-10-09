/**
 * Uses the collected real material (data/collected) to decide which words are
 * realistic DET words, to add trusted-list words, and to give every word real
 * sentences, dictionary definitions and Read and Complete texts.
 */
import { isFunctionWord } from '../../src/engine/morphology';
import { contextSimilarity } from '../../src/engine/text';
import type { Context, Paragraph, VocabWord } from '../../src/engine/types';
import { checkContext } from '../../src/engine/validate';
import { checkFibSentence, flatten, isSensitive, paragraphWindows, splitSentences, words as wordsOf, type CollectedText } from './collected';

export interface LexEntry {
  /** wordfreq Zipf frequency (about 3 = once per million words). */
  z?: number;
  pos?: string[];
  /** WordNet definition of the most common sense, per part of speech. */
  def?: Record<string, string>;
  /** Up to 4 WordNet senses per part of speech, with signature words (for choosing the sense used in the sentences). */
  senses?: { p: string; g: string; sig: string[] }[];
  /** WordNet example sentences that contain the exact word. */
  ex?: string[];
  lemmas?: string[];
  /** CEFR-J (A1–B2) or Octanove (C1–C2) level. */
  cefr?: string;
  cefrPos?: string;
  /** 'ngsl' and/or 'nawl'. */
  lists?: string[];
  /** Apertium English–Bengali dictionary equivalents, per part of speech. */
  bn?: Record<string, string[]>;
  bnVia?: string;
}
export type Lexicon = Record<string, LexEntry>;

const TRUSTED_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1']);

/** Word lists and CEFR level found for the word itself or its dictionary base form. */
export function listInfo(lex: Lexicon, word: string): { lists: string[]; cefr?: string } {
  const forms = [word, ...(lex[word]?.lemmas ?? [])];
  const lists = new Set<string>();
  let cefr: string | undefined;
  for (const f of forms) {
    const e = lex[f];
    if (!e) continue;
    for (const l of e.lists ?? []) lists.add(l);
    if (e.cefr && (!cefr || e.cefr < cefr)) cefr = e.cefr;
  }
  return { lists: [...lists].sort(), cefr };
}

/** In NGSL, NAWL, CEFR-J (A1–B2) or Octanove C1: the general and academic words the DET draws on. */
export function inTrustedLists(lex: Lexicon, word: string): boolean {
  const { lists, cefr } = listInfo(lex, word);
  return lists.length > 0 || (!!cefr && TRUSTED_LEVELS.has(cefr));
}


export interface DeletionInput {
  word: string;
  evidence: string[];
  tags: string[];
}

/**
 * Why a word should be deleted as an unrealistic DET target, or undefined to keep it.
 * Words that official DET material uses as answers are always kept, however rare.
 */
export function deletionReason(m: DeletionInput, lex: Lexicon, british: Record<string, string>): string | undefined {
  if (isFunctionWord(m.word)) return undefined;
  // Spelling traps the materials teach on purpose (e.g. minuscule, not "miniscule") stay.
  if (m.tags.some((t) => t.startsWith('spelling-trap') || t === 'us-spelling')) return undefined;
  if (british[m.word]) return `British-only word (${british[m.word]}). The DET asks for American spelling wherever you type.`;
  const z = lex[m.word]?.z ?? 0;
  const trusted = inTrustedLists(lex, m.word);
  const ev = new Set(m.evidence);
  if (ev.has('distractor') && z < 3 && !trusted)
    return `Rare word (frequency ${z.toFixed(1)}) that appeared in official material only as a wrong option. In the official sets the rare “impressive” option was never the answer.`;
  if (ev.has('official')) return undefined;
  const { lists, cefr } = listInfo(lex, m.word);
  if (!lists.length && cefr === 'C2' && z < 3)
    return `Not an official DET word and only in the C2 list (frequency ${z.toFixed(1)}): too rare for the DET’s mostly B1–B2 vocabulary.`;
  if (!trusted && z < 2.5) return `Not an official DET word, in no trusted word list, and very rare (frequency ${z.toFixed(1)}).`;
  return undefined;
}

// ---------------------------------------------------------------- sentences

export interface SentenceRec {
  text: string;
  textId: string;
  score: number;
}

const PRONOUN_START = /^(?:he|she|it|they|we|i|you|his|her|its|their|our|my|your|there)\b/i;

/** Higher is better: about 12–18 words, a noun-phrase subject, few names, learner-friendly sources first. */
function sentenceScore(s: string, t: Pick<CollectedText, 'corpus'>): number {
  const n = wordsOf(s).length;
  let score = 10 - Math.abs(15 - n) * 0.4;
  if (PRONOUN_START.test(s)) score -= 1.5;
  const names = wordsOf(s)
    .slice(1)
    .filter((w) => /^[A-Z]/.test(w)).length;
  score -= names * 0.7;
  if (/\d/.test(s)) score -= 0.5;
  // Sentences written for learners (CEFR-SP SCoRE) and learner news (OneStopEnglish) read most like DET items.
  if (t.corpus === 'cefrsp-score') score += 1.5;
  else if (t.corpus === 'ose') score += 0.5;
  else if (t.corpus === 'asset') score += 0.3;
  return score;
}

export interface SingleSentence {
  s: string;
  src: string;
  cefr?: string;
}

/** All usable Fill in the Blanks sentences, indexed by the lowercase words that occur exactly once in them (never the first word). */
export function sentenceIndex(texts: CollectedText[], singles: SingleSentence[] = []): { sentences: SentenceRec[]; byWord: Map<string, number[]> } {
  const sentences: SentenceRec[] = [];
  const byWord = new Map<string, number[]>();
  const seen = new Set<string>();
  const all: { s: string; textId: string; corpus: string }[] = [];
  for (const t of texts) for (const sp of splitSentences(t.text)) all.push({ s: t.text.slice(sp.start, sp.end).replace(/\s+/g, ' ').trim(), textId: t.id, corpus: t.corpus });
  for (const x of singles) all.push({ s: x.s, textId: x.src, corpus: x.src });
  for (const { s, textId, corpus } of all) {
    {
      if (seen.has(s) || !checkFibSentence(s).ok) continue;
      seen.add(s);
      const id = sentences.length;
      sentences.push({ text: s, textId, score: sentenceScore(s, { corpus }) });
      const counts = new Map<string, number>();
      const ws = [...s.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)];
      for (const m of ws) counts.set(m[0].toLowerCase(), (counts.get(m[0].toLowerCase()) ?? 0) + 1);
      for (const m of ws) {
        const w = m[0];
        if (m.index === 0 || w !== w.toLowerCase() || counts.get(w)! > 1 || /['’]/.test(w)) continue;
        const list = byWord.get(w) ?? [];
        list.push(id);
        byWord.set(w, list);
      }
    }
  }
  for (const list of byWord.values()) list.sort((a, b) => sentences[b].score - sentences[a].score);
  return { sentences, byWord };
}

export interface ContextPick {
  contexts: Context[];
  collected: number;
  dictionary: number;
  authored: number;
  /** More real sentences with the word (used to choose the dictionary sense). */
  evidence: string[];
}

/**
 * Real sentences first (up to `max`, from different texts and not too similar),
 * then WordNet example sentences, then the app's own sentences only if a word
 * still has fewer than two.
 */
export function pickContexts(
  word: string,
  id: string,
  index: ReturnType<typeof sentenceIndex>,
  lex: Lexicon,
  authored: string[],
  max = 4,
): ContextPick {
  const out: Context[] = [];
  const usedTexts = new Set<string>();
  let collected = 0;
  let dictionary = 0;
  let authoredUsed = 0;
  const fits = (c: Context) => out.every((o) => contextSimilarity(o.sentence, c.sentence, word) < 0.6);
  for (const sid of index.byWord.get(word) ?? []) {
    if (collected >= max) break;
    const rec = index.sentences[sid];
    const single = rec.textId === 'asset' || rec.textId.startsWith('cefrsp');
    if (!single && usedTexts.has(rec.textId)) continue;
    const c = checkContext(rec.text, word, id, 'collected');
    if (!c.context || c.warnings.some((w) => w.startsWith('giveaway')) || !fits(c.context)) continue;
    out.push({ ...c.context, src: rec.textId });
    usedTexts.add(rec.textId);
    collected++;
  }
  if (out.length < 2) {
    for (const raw of lex[word]?.ex ?? []) {
      if (out.length >= 2) break;
      let s = raw.trim();
      s = s[0].toUpperCase() + s.slice(1);
      if (!/[.!?]$/.test(s)) s += '.';
      if (wordsOf(s).length < 5 || isSensitive(s)) continue;
      const c = checkContext(s, word, id, 'collected');
      if (!c.context || c.warnings.some((w) => w.startsWith('giveaway')) || !fits(c.context)) continue;
      out.push({ ...c.context, src: 'wordnet' });
      dictionary++;
    }
  }
  if (out.length < 2) {
    for (const s of authored) {
      if (out.length >= 2) break;
      const c = checkContext(s, word, id, 'authored');
      if (!c.context || c.warnings.some((w) => w.startsWith('giveaway')) || !fits(c.context)) continue;
      out.push(c.context);
      authoredUsed++;
    }
  }
  const evidence = (index.byWord.get(word) ?? []).slice(0, 12).map((sid) => index.sentences[sid].text);
  return { contexts: out, collected, dictionary, authored: authoredUsed, evidence };
}

// ---------------------------------------------------------------- Read and Complete texts

export interface ParagraphCandidate {
  text: string;
  source: CollectedText;
}

/** Read and Complete windows from the collected texts (DET-safe, 50–100 words, 4–7 whole sentences, like the official 57-word example). */
export function paragraphCandidates(texts: CollectedText[], perText = 2, isBritish: (w: string) => boolean = () => false): ParagraphCandidate[] {
  const out: ParagraphCandidate[] = [];
  for (const t of texts) {
    let n = 0;
    for (const w of paragraphWindows(t.text, { minWords: 50, maxWords: 100, minSentences: 4, maxSentences: 7 })) {
      if (n >= perText) break;
      const text = flatten(t.text.slice(w.start, w.end));
      if (isSensitive(text) || /["“”]/.test(text) || /[()[\]/%&+=@#]/.test(text)) continue;
      // Read and Complete texts are plain prose: few numbers, no units or symbols.
      if ((text.match(/\d+(?:[.,]\d+)*/g) ?? []).length > 2) continue;
      // The DET asks for American spelling in Read and Complete, so texts with British spellings are left out.
      if ((text.toLowerCase().match(/[a-z]+/g) ?? []).some(isBritish)) continue;
      const first = text.slice(0, splitSentences(text)[0]?.end ?? 0);
      if (/^(?:this|these|those|that|such|also|but|and|so|then|however|therefore|it|they|he|she)\b/i.test(first)) continue;
      out.push({ text, source: t });
      n++;
    }
  }
  return out;
}

/** Keeps a spread of texts: best gap counts first, then round-robin over corpora and difficulty. */
export function chooseParagraphs(items: (Paragraph & { corpus: string })[], limit: number): Paragraph[] {
  const groups = new Map<string, (Paragraph & { corpus: string })[]>();
  for (const p of items.sort((a, b) => Math.abs(12 - a.gaps.length) - Math.abs(12 - b.gaps.length))) {
    const key = `${p.corpus}:${p.difficulty}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out: Paragraph[] = [];
  const queues = [...groups.values()];
  while (out.length < limit && queues.some((q) => q.length)) {
    for (const q of queues) {
      const p = q.shift();
      if (p && out.length < limit) {
        const { corpus: _c, ...rest } = p;
        out.push(rest);
      }
    }
  }
  return out;
}

/** True for British spellings that have an American form in the lexicon (never added as targets). */
export function isBritishSpelling(word: string, lex: Lexicon, usUk: Record<string, string>): boolean {
  const uk = new Set(Object.values(usUk));
  if (uk.has(word) || (word.endsWith('s') && uk.has(word.slice(0, -1)))) return true;
  const swaps: [RegExp, string][] = [
    [/our(s|ed|ing|ful|ite|ites|able|er)?$/, 'or$1'],
    [/is(e|es|ed|ing|ation|ations)$/, 'iz$1'],
    [/ys(e|es|ed|ing)$/, 'yz$1'],
    [/tre(s)?$/, 'ter$1'],
    [/ogue(s)?$/, 'og$1'],
    [/ence$/, 'ense'],
    [/lled$/, 'led'],
    [/lling$/, 'ling'],
    [/ller(s)?$/, 'ler$1'],
  ];
  for (const [re, rep] of swaps) {
    if (!re.test(word)) continue;
    const us = word.replace(re, rep);
    if (us !== word && lex[us] && (lex[us].z ?? 0) >= (lex[word]?.z ?? 0) - 0.3) return true;
  }
  return ['aeroplane', 'programme', 'programmes', 'cheque', 'cheques', 'tyre', 'tyres', 'pyjamas', 'aluminium', 'mum', 'mums', 'grey', 'kerb', 'pram', 'jewellery', 'practise', 'licence', 'storey', 'plough', 'mould', 'moustache', 'manoeuvre', 'cosy', 'sceptical'].includes(word);
}

export { isFunctionWord };
export type { VocabWord };

const STOP = new Set(
  'a an the of to in on at for and or but with by from as is are was were be been being it its this that these those which who whom whose what when where why how not no can could may might must shall should will would do does did has have had he she they we you i his her their our your my me him them us so than then there here such some any all each every one two more most other into about over after before under up down out off very just also only same both few many much own'.split(' '),
);

/**
 * Simplified Lesk: of the word's WordNet senses (for its parts of speech), the
 * one whose definition, examples and related words share most words with the
 * real sentences the student will see. Ties keep WordNet's frequency order.
 */
export function senseForContexts(entry: LexEntry | undefined, pos: string[], sentences: string[], word: string): string | undefined {
  const senses = (entry?.senses ?? []).filter((s) => !pos.length || pos.includes(s.p));
  if (!senses.length) return entry?.def ? (pos.map((p) => entry.def![p]).find(Boolean) ?? Object.values(entry.def)[0]) : undefined;
  const bag = new Set<string>();
  for (const s of sentences)
    for (const t of s.toLowerCase().match(/[a-z]+/g) ?? []) if (t.length > 2 && !STOP.has(t) && t !== word) {
      bag.add(t);
      // crude stemming so "ecosystems" meets "ecosystem"
      bag.add(t.replace(/(ies|es|s|ed|ing|ly)$/, ''));
    }
  let best = senses[0];
  let bestScore = -1;
  for (const s of senses) {
    const score = s.sig.filter((t) => bag.has(t) || bag.has(t.replace(/(ies|es|s|ed|ing|ly)$/, ''))).length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best.g;
}
