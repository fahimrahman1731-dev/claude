import { IRREGULAR } from './morphology';
import { halfSplit } from './text';
import type { Context, Gap, Mode, Paragraph, ParagraphQuestion, SentenceQuestion, VocabWord } from './types';

/** Which words each mode practices. Kept separate so DET task rules are never mixed. */
export function inModePool(w: VocabWord, mode: Mode): boolean {
  if (w.contexts.length === 0) return false;
  switch (mode) {
    case 'fill-blanks':
      // Only nouns, verbs, adjectives and adverbs; never small words like "the" or "of".
      return !w.isSmallWord && w.pos.some((p) => ['n', 'v', 'adj', 'adv'].includes(p)) && !w.tags.includes('british-word');
    case 'spelling':
      return !w.isSmallWord;
    case 'small-words':
      return w.isSmallWord;
    case 'endings':
      return !!w.ending || isIrregular(w);
    case 'read-complete':
      return false; // paragraphs are chosen separately
  }
}

export function isIrregular(w: VocabWord): boolean {
  return !!IRREGULAR[w.word] && !w.isSmallWord;
}

function gapFor(w: VocabWord, occurrence: string, mode: Mode): Gap {
  let visibleLength: number;
  if (mode === 'endings' && w.ending) visibleLength = w.ending.visible.length;
  else visibleLength = halfSplit(w.word).visible.length;
  return {
    wordId: w.id,
    contextId: '',
    answer: occurrence,
    visible: occurrence.slice(0, visibleLength),
    hiddenLength: occurrence.length - visibleLength,
    ukVariants: w.ukVariants,
  };
}

export function sentenceQuestion(w: VocabWord, ctx: Context, mode: Exclude<Mode, 'read-complete'>): SentenceQuestion {
  const occurrence = ctx.sentence.slice(ctx.start, ctx.end);
  const gap = { ...gapFor(w, occurrence, mode), contextId: ctx.id };
  const q: SentenceQuestion = {
    kind: 'sentence',
    id: `${mode}|${ctx.id}`,
    mode,
    wordId: w.id,
    contextId: ctx.id,
    sentence: ctx.sentence,
    before: ctx.sentence.slice(0, ctx.start),
    after: ctx.sentence.slice(ctx.end),
    gap,
    difficulty: w.difficulty,
    origin: ctx.origin,
  };
  if (mode === 'endings' && !w.ending && isIrregular(w)) q.baseHint = IRREGULAR[w.word];
  return q;
}

export function paragraphQuestion(p: Paragraph, byId: Map<string, VocabWord>): ParagraphQuestion {
  const segments: string[] = [];
  const gaps: Gap[] = [];
  let pos = 0;
  for (const g of p.gaps) {
    const w = byId.get(g.wordId);
    if (!w) continue;
    segments.push(p.text.slice(pos, g.start));
    const occurrence = p.text.slice(g.start, g.end);
    const { visible } = halfSplit(occurrence);
    gaps.push({
      wordId: g.wordId,
      contextId: g.contextId,
      answer: occurrence,
      visible,
      hiddenLength: occurrence.length - visible.length,
      // Read and Complete accepts American spelling only, so British variants are kept only for feedback.
      ukVariants: w.ukVariants,
    });
    pos = g.end;
  }
  segments.push(p.text.slice(pos));
  return {
    kind: 'paragraph',
    id: `read-complete|${p.id}`,
    mode: 'read-complete',
    paragraphId: p.id,
    title: p.title,
    text: p.text,
    segments,
    gaps,
    difficulty: p.difficulty,
    origin: 'paragraph',
  };
}

/** Validates that a built question reproduces the expected spelling exactly. */
export function validateQuestion(q: SentenceQuestion, w: VocabWord): string | undefined {
  const rebuilt = q.before + q.gap.answer + q.after;
  if (rebuilt !== q.sentence) return 'sentence does not rebuild from its parts';
  if (q.gap.answer.toLowerCase() !== w.word) return `answer "${q.gap.answer}" does not match "${w.word}"`;
  if (!q.gap.answer.startsWith(q.gap.visible)) return 'visible letters are not the start of the answer';
  if (q.gap.hiddenLength < 1) return 'nothing is hidden';
  return undefined;
}
