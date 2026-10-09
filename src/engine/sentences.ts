/** Splitting real texts into sentences (used by the data pipeline and by the app). */

export interface Span {
  start: number;
  end: number;
  /** The piece does not end with . ! or ? (a heading, a list item or a cut-off line). */
  open?: boolean;
}

const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|Jr|Sr|vs|etc|e\.g|i\.e|U\.S|U\.K|a\.m|p\.m|No|approx|Inc|Ltd|Co|Fig|al)\.$/i;

/**
 * Sentence spans of `text`. Handles common abbreviations, initials, decimals and
 * closing quotes. A paragraph break always ends a sentence, so a heading or a
 * list item never runs into the sentence after it; such pieces are marked `open`.
 */
export function splitSentences(text: string): Span[] {
  const out: Span[] = [];
  const paras = /\n\s*\n/g;
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = paras.exec(text))) {
    splitParagraph(text, from, m.index, out);
    from = m.index + m[0].length;
  }
  splitParagraph(text, from, text.length, out);
  return out;
}

function splitParagraph(text: string, from: number, to: number, out: Span[]): void {
  const para = text.slice(from, to);
  let start = 0;
  const re = /[.!?]+["”’)\]]*(?=\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(para))) {
    const end = m.index + m[0].length;
    const piece = para.slice(start, end);
    if (m[0].startsWith('.') && ABBREV.test(piece.trimEnd())) continue;
    // "3.5" never reaches here (no whitespace after the dot); a lone initial like "J." is not an end either.
    if (/\b[A-Z]\.$/.test(piece.trimEnd()) && piece.trim().length > 2) continue;
    const lead = piece.length - piece.trimStart().length;
    if (piece.trim()) out.push({ start: from + start + lead, end: from + end });
    start = end;
  }
  const rest = para.slice(start);
  if (rest.trim()) {
    const lead = rest.length - rest.trimStart().length;
    out.push({ start: from + start + lead, end: from + start + rest.trimEnd().length, open: true });
  }
}

/**
 * The sentence(s) of `text` around the span [start, end), with runs of white space
 * made single, and where the span begins inside that sentence.
 */
export function sentenceAt(text: string, start: number, end: number): { sentence: string; at: number } {
  const spans = splitSentences(text);
  const first = spans.find((s) => s.end > start);
  const last = [...spans].reverse().find((s) => s.start < end);
  const from = Math.min(first?.start ?? start, start);
  const to = Math.max(last?.end ?? end, end);
  const clean = (x: string) => x.replace(/\s+/g, ' ');
  const before = clean(text.slice(from, start)).replace(/^ /, '');
  return { sentence: (before + clean(text.slice(start, to))).trimEnd(), at: before.length };
}
