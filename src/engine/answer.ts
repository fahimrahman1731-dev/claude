import { alignment, analyzeError, type ErrorAnalysis } from './spelling';
import type { EndingSplit } from './morphology';
import type { Gap } from './types';

export interface CheckOptions {
  /** Fill in the Blanks accepts British spellings; Read and Complete does not. */
  acceptUk: boolean;
  familyForms?: string[];
  base?: string;
  ending?: EndingSplit;
}

export interface CheckResult {
  correct: boolean;
  empty: boolean;
  /** The full word the student produced (visible letters + typed letters, or the whole typed word). */
  full: string;
  usedUkVariant: boolean;
  analysis?: ErrorAnalysis;
}

export function cleanTyped(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, '');
}

/**
 * Checks one gap. The student may type only the missing letters (as on the
 * DET) or the whole word; both are accepted. Spelling must be exact. Case is
 * ignored because the visible letters already fix capitalization.
 */
export function checkGap(gap: Gap, typedRaw: string, opts: CheckOptions): CheckResult {
  const typed = cleanTyped(typedRaw);
  const answer = gap.answer.toLowerCase();
  const visible = gap.visible.toLowerCase();
  if (!typed) {
    return { correct: false, empty: true, full: '', usedUkVariant: false, analysis: analyzeError('', answer) };
  }
  const asSuffix = visible + typed;
  const candidates = [asSuffix, typed];
  if (candidates.includes(answer)) return { correct: true, empty: false, full: answer, usedUkVariant: false };
  const uk = gap.ukVariants.map((u) => u.toLowerCase());
  const ukHit = candidates.find((c) => uk.includes(c));
  if (ukHit && opts.acceptUk) return { correct: true, empty: false, full: ukHit, usedUkVariant: true };
  // Interpret the input the way that is closest to the answer.
  const full =
    ukHit ??
    (typed.startsWith(visible) && alignment(answer, typed).distance <= alignment(answer, asSuffix).distance ? typed : asSuffix);
  return {
    correct: false,
    empty: false,
    full,
    usedUkVariant: false,
    analysis: analyzeError(full, answer, { ukVariants: uk, familyForms: opts.familyForms, base: opts.base, ending: opts.ending }),
  };
}
