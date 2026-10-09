/** Letters that join a word: an apostrophe or hyphen next to a match means it is part of a bigger word. */
const WORD_CHAR = "A-Za-z'’-";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All whole-word, case-insensitive occurrences of `word` in `text`. */
export function findOccurrences(text: string, word: string): { start: number; end: number }[] {
  const re = new RegExp(`(?<![${WORD_CHAR}])${escapeRegExp(word)}(?![${WORD_CHAR}])`, 'gi');
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

export interface TargetLocation {
  sentence: string;
  start: number;
  end: number;
}

/**
 * Locates the target word in an authored sentence. A sentence may mark the
 * intended occurrence with [brackets] when the word appears more than once
 * ("She put [the] cup on the table."). Returns an error message instead of
 * guessing when the target is missing or ambiguous.
 */
export function locateTarget(raw: string, word: string): TargetLocation | { error: string } {
  const opens = (raw.match(/\[/g) ?? []).length;
  const closes = (raw.match(/\]/g) ?? []).length;
  if (opens || closes) {
    if (opens !== 1 || closes !== 1) return { error: 'use exactly one [bracketed] target' };
    const m = /\[([^\]]+)\]/.exec(raw)!;
    if (m[1].toLowerCase() !== word.toLowerCase()) return { error: `bracketed "${m[1]}" is not "${word}"` };
    const sentence = raw.slice(0, m.index) + m[1] + raw.slice(m.index + m[0].length);
    const start = m.index;
    const before = sentence[start - 1];
    const after = sentence[start + m[1].length];
    if ((before && /[A-Za-z'’-]/.test(before)) || (after && /[A-Za-z'’-]/.test(after))) {
      return { error: 'bracketed target is part of a longer word' };
    }
    return { sentence, start, end: start + m[1].length };
  }
  const occ = findOccurrences(raw, word);
  if (occ.length === 0) return { error: `"${word}" does not appear as a whole word` };
  if (occ.length > 1) return { error: `"${word}" appears ${occ.length} times; bracket the target` };
  return { sentence: raw, start: occ[0].start, end: occ[0].end };
}

/**
 * DET-style split: the hidden part is as long as the visible part, or one
 * letter longer ("the" → "t" + 2 hidden, "significant" → "signi" + 6 hidden).
 */
export function halfSplit(word: string): { visible: string; hiddenLength: number } {
  const visibleLength = Math.floor(word.length / 2);
  return { visible: word.slice(0, visibleLength), hiddenLength: word.length - visibleLength };
}

/**
 * How many letters are given as the clue.
 * - "max3" (default): half the word, but never more than 3 letters (1–3), so long
 *   words like "confusing" show "con", not "conf".
 * - "half": the DET Read and Complete rule, the first half rounded down.
 * At least one letter is always given and at least one is always hidden.
 */
export type ClueRule = 'max3' | 'half';

export function clueSplit(word: string, rule: ClueRule = 'max3'): { visible: string; hiddenLength: number } {
  const half = Math.floor(word.length / 2);
  const n = Math.max(1, Math.min(rule === 'max3' ? Math.min(half, 3) : half, word.length - 1));
  return { visible: word.slice(0, n), hiddenLength: word.length - n };
}

/** Small, stable FNV-1a hash used for context ids. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function contextId(wordId: string, sentence: string): string {
  return `${wordId}#${hash(sentence.toLowerCase())}`;
}

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) ?? []).filter(Boolean);
}

/**
 * Overlap between two sentences, ignoring the target and very common words.
 * Used to reject "contexts" that only swap a name or one noun.
 */
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'is', 'was', 'it', 'for', 'with', 'at', 'by', 'that', 'this', 'his', 'her', 'their', 'they', 'he', 'she', 'we', 'i', 'you', 'be', 'are', 'were', 'as', 'from', 'or', 'but']);
export function contextSimilarity(a: string, b: string, target: string): number {
  const t = target.toLowerCase();
  const sa = new Set(words(a).filter((w) => w !== t && !STOP.has(w)));
  const sb = new Set(words(b).filter((w) => w !== t && !STOP.has(w)));
  if (sa.size === 0 || sb.size === 0) {
    // Only grammar words besides the target: compare full token lists instead.
    const fa = words(a).filter((w) => w !== t).join(' ');
    const fb = words(b).filter((w) => w !== t).join(' ');
    return fa === fb ? 1 : 0;
  }
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Replaces the matched letters while keeping the case of the visible part ("The" stays "T…"). */
export function matchCase(sample: string, word: string): string {
  if (sample && sample[0] === sample[0].toUpperCase() && sample[0] !== sample[0].toLowerCase()) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

export function wordCount(s: string): number {
  return words(s).length;
}
