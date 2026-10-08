import { contextId, contextSimilarity, locateTarget, wordCount } from './text';
import type { Context, ContextOrigin } from './types';

export interface ContextCheck {
  context?: Context;
  errors: string[];
  warnings: string[];
}

export const MAX_SIMILARITY = 0.6;
export const MAX_WORDS = 24;

/**
 * Checks one practice sentence before it can be used: the exact target
 * spelling must appear once (or be [bracketed]), and the sentence must look
 * like a complete sentence. Used for authored, custom and AI sentences alike.
 */
export function checkContext(raw: string, word: string, wordId: string, origin: ContextOrigin): ContextCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = raw.trim().replace(/\s+/g, ' ');
  const loc = locateTarget(text, word);
  if ('error' in loc) return { errors: [loc.error], warnings };
  const s = loc.sentence;
  if (!/^["“'‘(]?[A-Z0-9]/.test(s)) errors.push('should start with a capital letter');
  if (!/[.!?]["”'’)]?$/.test(s)) errors.push('should end with . ! or ?');
  const n = wordCount(s);
  if (n < 4) errors.push('too short to give context');
  if (n > MAX_WORDS) warnings.push(`long sentence (${n} words)`);
  const occurrence = s.slice(loc.start, loc.end);
  if (occurrence.toLowerCase() !== word.toLowerCase()) errors.push('target spelling does not match');
  if (errors.length) return { errors, warnings };
  return {
    context: { id: contextId(wordId, s), wordId, sentence: s, start: loc.start, end: loc.end, origin },
    errors,
    warnings,
  };
}

/**
 * Checks a word's set of sentences: duplicates and near-duplicates (a swapped
 * name or noun) are rejected so the two required contexts really differ.
 */
export function checkContextSet(contexts: Context[], word: string): { kept: Context[]; rejected: { sentence: string; reason: string }[] } {
  const kept: Context[] = [];
  const rejected: { sentence: string; reason: string }[] = [];
  for (const c of contexts) {
    const dup = kept.find((k) => k.id === c.id || k.sentence.toLowerCase() === c.sentence.toLowerCase());
    if (dup) {
      rejected.push({ sentence: c.sentence, reason: 'duplicate sentence' });
      continue;
    }
    const near = kept.find((k) => contextSimilarity(k.sentence, c.sentence, word) >= MAX_SIMILARITY);
    if (near) {
      rejected.push({ sentence: c.sentence, reason: `too similar to “${near.sentence}”` });
      continue;
    }
    kept.push(c);
  }
  return { kept, rejected };
}
