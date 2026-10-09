import { stripFootnotes } from './markdown';

export type Evidence =
  | 'official' // answer words from Duolingo's own practice books
  | 'trusted-list' // not in the study materials; added from NGSL / NAWL / CEFR-J / Octanove C1
  | 'recurring' // listed as recurring across independent sources
  | 'author-selection' // chosen by the guide's author (not seen in a test item)
  | 'third-party' // prep-site answer words (lower trust)
  | 'best-estimate' // labeled "NOT harvested from any DET item"
  | 'strategy-example' // example words inside strategy prose
  | 'distractor'; // wrong options in Interactive Reading

export type Level = 'easy' | 'intermediate' | 'advanced';

export interface RawEntry {
  word: string;
  raw: string;
  sourceId: string;
  sectionId: string;
  sectionLabel: string;
  evidence: Evidence;
  definition?: string;
  collocation?: string;
  ukVariant?: string;
  note?: string;
  gapCount?: number;
  recurringSources?: number;
  level?: Level;
  tags: string[];
}

export interface Rejected {
  raw: string;
  sourceId: string;
  sectionId: string;
  reason: string;
}

export interface ParsedItem {
  word?: string;
  definition?: string;
  ukVariant?: string;
  note?: string;
  reject?: string;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** True when `uk` looks like a spelling variant of `us` rather than a different word (flat vs apartment). */
export function isSpellingVariant(us: string, uk: string): boolean {
  return us.slice(0, 2) === uk.slice(0, 2) && editDistance(us, uk) <= 3;
}

/**
 * Turns one list item from a source ("valves ★(flaps that open and close)",
 * "artifacts (UK: artefacts)", "today's") into a normalized word or a reason
 * for rejecting it. Nothing is dropped without a reason.
 */
export function parseItem(rawInput: string): ParsedItem {
  let s = stripFootnotes(rawInput).replace(/\*\*/g, '').replace(/\*/g, '').trim();
  const out: ParsedItem = {};
  const notes: string[] = [];

  const star = /★\s*\(([^()]*)\)/.exec(s);
  if (star) {
    out.definition = star[1].trim();
    s = s.replace(star[0], ' ');
  }
  s = s.replace(/★/g, ' ');

  // (UK: x) / (UK also: x) / (US: x) / (correct spelling: x) / ("phrase" ...) / other notes
  let m: RegExpExecArray | null;
  const paren = /\(([^()]*(?:\([^()]*\))?[^()]*)\)/g;
  const found: string[] = [];
  while ((m = paren.exec(s))) found.push(m[0]);
  for (const p of found) {
    const inner = p.slice(1, -1).trim();
    const uk = /^UK(?: also)?:\s*([A-Za-z]+)(.*)$/.exec(inner);
    const us = /^US:\s*(.+)$/.exec(inner);
    if (uk) out.ukVariant = uk[1].toLowerCase();
    else if (us) notes.push(`US: ${us[1].trim()}`);
    else notes.push(inner);
    s = s.replace(p, ' ');
  }
  s = s.replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '').trim();
  if (notes.length) out.note = notes.join('; ');

  const lower = s.toLowerCase();
  if (!lower) return { ...out, reject: 'empty item' };
  if (/\s/.test(lower)) return { ...out, reject: 'multi-word phrase (a gap is always a single word)' };
  if (lower.includes('-')) return { ...out, reject: 'hyphenated word (never a DET gap)' };
  if (/[’']/.test(lower)) return { ...out, reject: 'contraction or possessive (never a DET gap)' };
  if (!/^[a-z]+$/.test(lower)) return { ...out, reject: 'not a plain alphabetic word' };
  if (lower.length < 2) return { ...out, reject: 'single-letter word (never a DET gap)' };
  out.word = lower;
  if (out.ukVariant && !isSpellingVariant(lower, out.ukVariant)) {
    // "apartment (UK: flat)" is a different word, not a spelling variant
    out.note = [out.note, `UK word: ${out.ukVariant}`].filter(Boolean).join('; ');
    delete out.ukVariant;
  }
  return out;
}
