/**
 * Turning collected real texts into DET-style practice material:
 * sentence splitting, the filters a Fill in the Blanks sentence must pass, and
 * the windows used as Read and Complete texts.
 */

export interface CollectedText {
  id: string;
  /** 'clear' (CommonLit CLEAR corpus), 'ose' (OneStopEnglish corpus) or 'attali' (Duolingo research appendix). */
  corpus: string;
  title: string;
  author?: string;
  url?: string;
  license: string;
  /** Short attribution line shown in the app. */
  credit: string;
  genre: 'narrative' | 'expository';
  topic: string;
  difficulty: 'easy' | 'intermediate' | 'advanced';
  /** Paragraphs separated by a blank line. */
  text: string;
}

export interface Span {
  start: number;
  end: number;
}

const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|Jr|Sr|vs|etc|e\.g|i\.e|U\.S|U\.K|a\.m|p\.m|No|approx|Inc|Ltd|Co|Fig|al)\.$/i;

/** Sentence spans of `text` (handles common abbreviations, decimals and closing quotes). */
export function splitSentences(text: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  const re = /[.!?]+["”’)\]]*(?=\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const piece = text.slice(start, end);
    if (m[0].startsWith('.') && ABBREV.test(piece.trimEnd())) continue;
    // "3.5" never reaches here (no whitespace after the dot); a lone initial like "J." is not an end either.
    if (/\b[A-Z]\.$/.test(piece.trimEnd()) && piece.trim().length > 2) continue;
    const s = text.slice(start, end);
    const lead = s.length - s.trimStart().length;
    if (s.trim()) out.push({ start: start + lead, end });
    start = end;
  }
  const rest = text.slice(start);
  if (rest.trim()) {
    const lead = rest.length - rest.trimStart().length;
    out.push({ start: start + lead, end: start + rest.trimEnd().length });
  }
  return out;
}

export function words(s: string): string[] {
  return s.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? [];
}

/**
 * Topics the DET's fairness review keeps out of test content (violence, crime,
 * drugs and alcohol, sex, politics, religion, death and disease in detail). Any
 * sentence or text containing one of these words is not used.
 */
const SENSITIVE =
  /\b(kill(s|ed|ing|er|ers)?|murder\w*|war|wars|warfare|wartime|battles?|battlefield|invad\w*|invasion\w*|troops|enemy|enemies|attack\w*|fought|captured|conquer\w*|convoys?|emperor|weapon\w*|guns?|bomb\w*|terror\w*|shoot\w*|shot|stab\w*|violen\w*|assault\w*|rape\w*|abuse\w*|drugs?|cocaine|heroin|alcohol\w*|beer|wine|drunk\w*|cigarette\w*|tobacco|smok(e|ing|ers?)|sex\w*|naked|suicid\w*|corpse\w*|slaves?|slavery|nazi\w*|genocide|prison\w*|jail\w*|criminal\w*|crimes?|police|army|soldiers?|military|president|presidents|politic\w*|elections?|parliament|religio\w*|church\w*|mosque\w*|temple\w*|god|gods|bible|quran|islam\w*|christian\w*|jew\w*|hindu\w*|muslim\w*|gambl\w*|lotter(y|ies)|casino\w*|mafia|smuggl\w*|traffick\w*|corrupt\w*|brib\w*|scandal\w*|conservatism|liberalism|communis\w*|socialis\w*|fascis\w*|dictator\w*|protest\w*|riot\w*|modi|obama|trump|putin|clinton|merkel|thatcher|cameron|hitler|stalin|cancer|ebola|aids|hiv|dying|died|dead|death|deaths|funeral\w*|blood(y|shed))\b/i;

export function isSensitive(s: string): boolean {
  return SENSITIVE.test(s);
}

/**
 * Words a stand-alone sentence should not start with, because they point back to
 * an earlier sentence. (A plain subject pronoun such as "She" or "They" is fine:
 * DET sentences come from stories and personal writing too.)
 */
const DEPENDENT_START = /^(?:this|these|those|that|such|also|but|and|or|so|then|however|therefore|thus|still|yet|instead|here|both|another|other|others|later|meanwhile|finally|furthermore|moreover|besides|otherwise|each|neither|either|first|second|third|next|now|again|which|who|whose|similarly|likewise|nevertheless|nonetheless|consequently|hence|additionally|afterwards|instead)\b/i;

export interface SentenceCheck {
  ok: boolean;
  reason?: string;
}

/**
 * A Fill in the Blanks sentence: one complete, stand-alone sentence of 8 to 22
 * words (the DET uses sentences of up to about 20 words), plain punctuation, no
 * quotations or lists, no sensitive topics, and not more than two names.
 */
export function checkFibSentence(s: string): SentenceCheck {
  const t = s.trim();
  const n = words(t).length;
  if (n < 8) return { ok: false, reason: 'too short' };
  if (n > 22) return { ok: false, reason: 'too long' };
  if (!/^[A-Z]/.test(t)) return { ok: false, reason: 'does not start with a capital letter' };
  if (!/[.!?]$/.test(t)) return { ok: false, reason: 'no final punctuation' };
  if (/["“”‘]|[’'](?=\s|$)|(?:^|\s)['’]/.test(t)) return { ok: false, reason: 'quotation' };
  if (/[()[\]{}<>|/\\_*#@=+~^]|https?:|www\./.test(t)) return { ok: false, reason: 'brackets, symbols or links' };
  if (/\d/.test(t) && (t.match(/\d+/g) ?? []).length > 1) return { ok: false, reason: 'too many numbers' };
  if (/[;:]\s/.test(t) && n > 18) return { ok: false, reason: 'list-like' };
  if (/[–—-]{2}|\s[–—]\s/.test(t)) return { ok: false, reason: 'dash aside' };
  if (DEPENDENT_START.test(t)) return { ok: false, reason: 'depends on the previous sentence' };
  if (isSensitive(t)) return { ok: false, reason: 'sensitive topic' };
  if (/[^\x20-\x7E’]/.test(t.replace(/[éèáàíóúñüöäçâêîôûë]/gi, ''))) return { ok: false, reason: 'unusual characters' };
  const names = words(t)
    .slice(1)
    .filter((w) => /^[A-Z]/.test(w) && w !== 'I').length;
  if (names > 2) return { ok: false, reason: 'too many names' };
  if (/\b[A-Z]{2,}\b/.test(t)) return { ok: false, reason: 'acronym' };
  return { ok: true };
}

/**
 * Read and Complete texts: windows of whole sentences, 4 to 8 sentences and
 * 60 to 120 words, taken from one paragraph or a run of paragraphs.
 */
export function paragraphWindows(text: string, opts = { minWords: 60, maxWords: 120, minSentences: 4, maxSentences: 8 }): Span[] {
  const out: Span[] = [];
  const sents = splitSentences(text.replace(/\n\s*\n/g, '\n\n'));
  let i = 0;
  while (i < sents.length) {
    let j = i;
    let count = 0;
    while (j < sents.length && j - i < opts.maxSentences) {
      count += words(text.slice(sents[j].start, sents[j].end)).length;
      j++;
      if (count >= opts.minWords && j - i >= opts.minSentences) break;
    }
    if (count >= opts.minWords && count <= opts.maxWords && j - i >= opts.minSentences) {
      out.push({ start: sents[i].start, end: sents[j - 1].end });
      i = j;
    } else i++;
  }
  return out;
}

/** Joins paragraph breaks inside a window into single spaces (Read and Complete shows one paragraph). */
export function flatten(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
