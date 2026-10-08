import { endingInfo, inflections, IRREGULAR, SPELLING_CHANGE_TEXT, type EndingSplit } from './morphology';
import type { ErrorType, VocabWord } from './types';

/** A short explanation in English with an optional Bengali version. */
export interface Explanation {
  en: string;
  bn?: string;
}

/** i = index in the correct word, j = index in the typed word. */
type Op = { kind: 'match' | 'sub' | 'del' | 'ins' | 'swap'; a: string; b: string; i: number; j: number };

/**
 * Optimal-string-alignment distance with the list of edits that turns the
 * correct word (`target`) into what the student typed (`typed`).
 * del = a letter of the correct word is missing; ins = an extra typed letter.
 */
export function alignment(target: string, typed: string): { distance: number; ops: Op[] } {
  const n = target.length;
  const m = typed.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = target[i - 1] === typed[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && target[i - 1] === typed[j - 2] && target[i - 2] === typed[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && target[i - 1] === typed[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      ops.push({ kind: 'match', a: target[i - 1], b: typed[j - 1], i: i - 1, j: j - 1 });
      i--;
      j--;
    } else if (i > 1 && j > 1 && target[i - 1] === typed[j - 2] && target[i - 2] === typed[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
      ops.push({ kind: 'swap', a: target.slice(i - 2, i), b: typed.slice(j - 2, j), i: i - 2, j: j - 2 });
      i -= 2;
      j -= 2;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ kind: 'sub', a: target[i - 1], b: typed[j - 1], i: i - 1, j: j - 1 });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ kind: 'del', a: target[i - 1], b: '', i: i - 1, j });
      i--;
    } else {
      ops.push({ kind: 'ins', a: '', b: typed[j - 1], i, j: j - 1 });
      j--;
    }
  }
  ops.reverse();
  return { distance: d[n][m], ops };
}

export interface ErrorAnalysis {
  types: ErrorType[];
  /** Plain description of what went wrong. */
  messages: Explanation[];
}

/**
 * Classifies a wrong answer. `familyForms` are other spellings in the same
 * word family (develop, developed, development …) so "right word, wrong
 * form" can be recognized.
 */
export function analyzeError(
  typedRaw: string,
  answerRaw: string,
  opts: { ukVariants?: string[]; familyForms?: string[]; base?: string; ending?: EndingSplit } = {},
): ErrorAnalysis {
  const typed = typedRaw.trim().toLowerCase();
  const answer = answerRaw.toLowerCase();
  const types = new Set<ErrorType>();
  const messages: Explanation[] = [];
  if (!typed) {
    return {
      types: ['empty'],
      messages: [{ en: 'Nothing was typed. An empty gap can never score, so always type your best guess.', bn: 'কিছু লেখা হয়নি। খালি ঘর কখনও নম্বর পায় না, তাই সবসময় একটা অনুমান লিখুন।' }],
    };
  }
  if (opts.ukVariants?.includes(typed)) {
    types.add('uk-spelling');
    messages.push({
      en: `“${typed}” is the British spelling. Read and Complete accepts American spelling only: “${answer}”.`,
      bn: `“${typed}” ব্রিটিশ বানান। Read and Complete-এ শুধু আমেরিকান বানান চলে: “${answer}”।`,
    });
    return { types: [...types], messages };
  }
  const forms = new Set([...(opts.familyForms ?? []), ...(opts.base ? inflections(opts.base) : []), ...inflections(answer)]);
  forms.delete(answer);
  if (forms.has(typed) || IRREGULAR[typed] === IRREGULAR[answer] && IRREGULAR[answer]) {
    types.add('wrong-form');
    messages.push({
      en: `“${typed}” is a real form of this word, but the sentence needs “${answer}”. Check tense, number (singular/plural) and word class.`,
      bn: `“${typed}” এই শব্দেরই আরেকটি রূপ, কিন্তু বাক্যে দরকার “${answer}”। কাল (tense), একবচন/বহুবচন আর শব্দের ধরন মিলিয়ে দেখুন।`,
    });
  }
  const { distance, ops } = alignment(answer, typed);
  if (distance > Math.max(3, Math.ceil(answer.length * 0.5)) && !types.has('wrong-form')) {
    types.add('different-word');
    messages.push({
      en: `“${typed}” is a different word. The sentence needs “${answer}”.`,
      bn: `“${typed}” একটি ভিন্ন শব্দ। বাক্যে দরকার “${answer}”।`,
    });
    return { types: [...types], messages };
  }
  const missing: string[] = [];
  const extra: string[] = [];
  const wrong: string[] = [];
  for (const op of ops) {
    if (op.kind === 'swap') {
      if (/^(ie|ei)$/.test(op.a)) {
        types.add('ie-ei');
        messages.push({
          en: `You swapped “${op.a}” to “${op.b}”. Remember: i before e, except after c (believe, receive) — and learn the exceptions (height, weight, foreign).`,
          bn: `আপনি “${op.a}” উল্টে “${op.b}” লিখেছেন। মনে রাখুন: সাধারণত e-এর আগে i, কিন্তু c-এর পরে ei (believe, receive); ব্যতিক্রমগুলো আলাদা করে মুখস্থ করুন (height, weight, foreign)।`,
        });
      } else {
        types.add('transposition');
        messages.push({ en: `Two letters are in the wrong order: “${op.b}” should be “${op.a}”.`, bn: `দুটি অক্ষর উল্টো ক্রমে আছে: “${op.b}” হবে “${op.a}”।` });
      }
    } else if (op.kind === 'del') {
      const prev = answer[op.i - 1];
      const next = answer[op.i + 1];
      if (op.a === prev || op.a === next) {
        types.add('double-letter');
        messages.push({ en: `Double letter needed: “${op.a}${op.a}”.`, bn: `এখানে দ্বিত্ব অক্ষর লাগবে: “${op.a}${op.a}”।` });
      } else missing.push(op.a);
    } else if (op.kind === 'ins') {
      if (op.b === typed[op.j - 1] || op.b === typed[op.j + 1]) {
        types.add('double-letter');
        messages.push({ en: `Only one “${op.b}” here, not two.`, bn: `এখানে একটাই “${op.b}”, দুটো নয়।` });
      } else extra.push(op.b);
    } else if (op.kind === 'sub') wrong.push(`${op.b}→${op.a}`);
  }
  if (missing.length) {
    types.add('missing-letters');
    messages.push({ en: `Missing letter${missing.length > 1 ? 's' : ''}: ${missing.map((x) => `“${x}”`).join(', ')}.`, bn: `বাদ পড়া অক্ষর: ${missing.map((x) => `“${x}”`).join(', ')}।` });
  }
  if (extra.length) {
    types.add('extra-letters');
    messages.push({ en: `Extra letter${extra.length > 1 ? 's' : ''}: ${extra.map((x) => `“${x}”`).join(', ')}.`, bn: `অতিরিক্ত অক্ষর: ${extra.map((x) => `“${x}”`).join(', ')}।` });
  }
  if (wrong.length) {
    types.add('wrong-letters');
    messages.push({
      en: `Wrong letter${wrong.length > 1 ? 's' : ''}: ${wrong.map((w) => `“${w.split('→')[0]}” should be “${w.split('→')[1]}”`).join('; ')}.`,
      bn: `ভুল অক্ষর: ${wrong.map((w) => `“${w.split('→')[0]}”-এর জায়গায় “${w.split('→')[1]}”`).join('; ')}।`,
    });
  }
  // Wrong ending: every edit falls inside the last part of the word.
  const firstEdit = ops.findIndex((o) => o.kind !== 'match');
  if (firstEdit >= 0) {
    const editStart = ops[firstEdit].i;
    const endingStart = opts.ending ? answer.length - opts.ending.hidden.length : Math.max(answer.length - 4, Math.ceil(answer.length / 2));
    if (editStart >= endingStart && editStart >= 2) {
      types.add('wrong-ending');
      const label = opts.ending?.label ?? answer.slice(endingStart);
      messages.unshift({
        en: `The start is right; the ending is wrong. The word ends in “${answer.slice(endingStart)}”${opts.ending ? ` (${label})` : ''}.`,
        bn: `শুরুটা ঠিক আছে, শেষ অংশ ভুল। শব্দটির শেষে “${answer.slice(endingStart)}”।`,
      });
    }
  }
  if (types.size === 0) types.add('wrong-letters');
  return { types: [...types], messages };
}

const SILENT: [RegExp, string, string][] = [
  [/^kn/, 'silent k (k-n…)', 'k উচ্চারিত হয় না'],
  [/mb($|er|ed|ing|s)/, 'silent b after m (climb)', 'm-এর পরে b উচ্চারিত হয় না'],
  [/bt/, 'silent b before t (doubt)', 't-এর আগে b উচ্চারিত হয় না'],
  [/gn/, 'silent g before n (sign, design)', 'n-এর আগে g উচ্চারিত হয় না'],
  [/^wr/, 'silent w before r (write)', 'r-এর আগে w উচ্চারিত হয় না'],
  [/^ps/, 'silent p (psychology)', 'p উচ্চারিত হয় না'],
  [/mn$/, 'silent n after m (autumn)', 'm-এর পরে n উচ্চারিত হয় না'],
  [/stle|sten/, 'silent t (castle, listen)', 't উচ্চারিত হয় না'],
  [/^isl/, 'silent s (island)', 's উচ্চারিত হয় না'],
  [/gu[aeiy]/, 'silent u after g (guess, guide)', 'g-এর পরে u উচ্চারিত হয় না'],
  [/sc[ie]/, 'silent c after s (scene, muscle)', 's-এর পরে c উচ্চারিত হয় না'],
  [/scle/, 'silent c (muscle)', 'c উচ্চারিত হয় না'],
  [/rh/, 'silent h after r (rhythm)', 'r-এর পরে h উচ্চারিত হয় না'],
  [/eipt/, 'silent p (receipt)', 'p উচ্চারিত হয় না'],
  [/uild/, 'silent u (building)', 'u উচ্চারিত হয় না'],
  [/wer$/, 'silent w (answer)', 'w উচ্চারিত হয় না'],
];

function doubles(word: string): string[] {
  return [...new Set(word.match(/([a-z])\1/g) ?? [])];
}

/**
 * The spelling points worth teaching for one word, in English and Bengali.
 * Built from the guide's spelling-trap categories, the word's ending and the
 * spelling change from its base word.
 */
export function spellingRules(word: VocabWord): Explanation[] {
  const w = word.word;
  const out: Explanation[] = [];
  const tags = word.tags;
  const has = (prefix: string) => tags.some((t) => t.startsWith(prefix));

  if (has('spelling-trap:double-letters')) {
    const d = doubles(w);
    out.push({
      en: `Double letters: “${w}” has ${d.map((x) => `“${x}”`).join(' and ')}. Say each double letter as you type it.`,
      bn: `দ্বিত্ব অক্ষর: “${w}”-এ আছে ${d.map((x) => `“${x}”`).join(' ও ')}। টাইপ করার সময় দ্বিত্ব অক্ষরগুলো মনে মনে বলুন।`,
    });
  }
  if (has('spelling-trap:single-letters')) {
    out.push({
      en: `Single letters: “${w}” has no double letter where people often add one (until, always, welcome, careful).`,
      bn: `একক অক্ষর: “${w}”-এ যেখানে অনেকে দ্বিত্ব অক্ষর লেখে, সেখানে একটাই অক্ষর (until, always, welcome, careful)।`,
    });
  }
  if (has('spelling-trap:ie-and-ei')) {
    out.push({
      en: `ie or ei: “${w}” is spelled with “${/ei/.test(w) ? 'ei' : 'ie'}”. Rule of thumb: i before e, except after c — with exceptions such as height, weight, foreign, science.`,
      bn: `ie না ei: “${w}” বানানে আছে “${/ei/.test(w) ? 'ei' : 'ie'}”। সাধারণ নিয়ম: e-এর আগে i, কিন্তু c-এর পরে ei; ব্যতিক্রম: height, weight, foreign, science।`,
    });
  }
  if (has('spelling-trap:silent-letters')) {
    const hit = SILENT.find(([re]) => re.test(w));
    out.push({
      en: `Silent letter${hit ? `: ${hit[1]}` : ''}. Spell it the way it is written, not the way it sounds.`,
      bn: `নীরব অক্ষর${hit ? `: ${hit[2]}` : ''}। উচ্চারণ নয়, লেখার বানান মনে রাখুন।`,
    });
  }
  if (has('spelling-trap:hidden-vowels')) {
    out.push({
      en: `Hidden vowel: some vowels in “${w}” are hard to hear. Break it into parts: ${syllableHint(w)}.`,
      bn: `লুকানো স্বরবর্ণ: “${w}”-এর কিছু স্বরবর্ণ শুনতে পাওয়া কঠিন। ভাগ করে মনে রাখুন: ${syllableHint(w)}।`,
    });
  }
  if (has('spelling-trap:-ough')) {
    out.push({
      en: `-ough / -augh: these letters can sound many ways (though, through, tough). Learn “${w}” as a whole shape.`,
      bn: `-ough / -augh: এই অক্ষরগুলোর উচ্চারণ নানা রকম (though, through, tough)। “${w}” পুরো বানানটা একসাথে মনে রাখুন।`,
    });
  }
  const pair = (tag: string, a: string, b: string) => {
    if (!has(tag)) return;
    const end = w.endsWith(a) ? a : w.endsWith(b) ? b : w.includes(a) ? a : b;
    out.push({
      en: `-${a} or -${b}: “${w}” uses -${end}. These endings sound the same, so learn which one each word takes.`,
      bn: `-${a} না -${b}: “${w}”-এ -${end}। দুটোর উচ্চারণ একই রকম, তাই কোন শব্দে কোনটা বসে তা আলাদা করে মনে রাখুন।`,
    });
  };
  pair('spelling-trap:-able-or--ible', 'able', 'ible');
  pair('spelling-trap:-ant-or--ent', 'ant', 'ent');
  pair('spelling-trap:-ance-or--ence', 'ance', 'ence');
  if (has('spelling-trap:-ary,')) {
    const end = /ary$/.test(w) ? 'ary' : /ery$/.test(w) ? 'ery' : 'ory';
    out.push({ en: `-ary, -ery or -ory: “${w}” ends in -${end}.`, bn: `-ary, -ery না -ory: “${w}”-এর শেষে -${end}।` });
  }
  if (has('spelling-trap:-ous')) {
    out.push({ en: `-ous adjective: “${w}” ends in -ous (never -us).`, bn: `-ous বিশেষণ: “${w}”-এর শেষে -ous (কখনও -us নয়)।` });
  }
  if (has('us-spelling') || word.ukVariants.length) {
    const uk = word.ukVariants[0];
    out.push({
      en: `American spelling: type “${w}”${uk ? `, not “${uk}”` : ''}. Read and Complete accepts US spelling only (Fill in the Blanks accepts both).`,
      bn: `আমেরিকান বানান: “${w}” লিখুন${uk ? `, “${uk}” নয়` : ''}। Read and Complete-এ শুধু আমেরিকান বানান চলে (Fill in the Blanks-এ দুটোই চলে)।`,
    });
  }
  const irregularBase = IRREGULAR[w];
  if (has('irregular-form') || irregularBase) {
    const base = irregularBase ?? word.base;
    out.push({
      en: `Irregular form${base ? ` of “${base}”` : ''}: it does not follow the -ed / -s rule, so learn it by heart.`,
      bn: `অনিয়মিত রূপ${base ? ` (“${base}” থেকে)` : ''}: এটি -ed / -s নিয়ম মানে না, তাই আলাদা করে মুখস্থ করুন।`,
    });
  }
  if (word.ending) {
    const info = endingInfo(word.ending.label.replace(/^-/, ''));
    if (word.ending.change !== 'none') {
      out.push({ en: SPELLING_CHANGE_TEXT[word.ending.change], bn: CHANGE_BN[word.ending.change] });
    }
    if (info) {
      out.push({
        en: `Ending ${word.ending.label}: makes ${info.makes}. Decide the word type from the sentence, then choose the ending.`,
        bn: `শেষাংশ ${word.ending.label}: এটি ${MAKES_BN[info.makes] ?? info.makes} তৈরি করে। আগে বাক্য দেখে শব্দের ধরন ঠিক করুন, তারপর শেষাংশ বেছে নিন।`,
      });
    }
  }
  for (const t of tags.filter((x) => x.startsWith('confusable-with:'))) {
    const other = t.slice('confusable-with:'.length);
    out.push({
      en: `Do not confuse “${w}” with “${other}”. Check the grammar of the sentence before you type.`,
      bn: `“${w}” আর “${other}” গুলিয়ে ফেলবেন না। লেখার আগে বাক্যের ব্যাকরণ দেখে নিন।`,
    });
  }
  return out;
}

function syllableHint(w: string): string {
  // Split before consonant+vowel groups: "separate" → sep-a-rate (approximate, for memory only).
  return w.replace(/([aeiouy]+)(?=[^aeiouy][aeiouy])/g, '$1-');
}

const CHANGE_BN: Record<string, string> = {
  'drop-e': 'স্বরবর্ণ দিয়ে শুরু হওয়া শেষাংশের আগে নীরব -e বাদ দিন (make → making, create → creation)।',
  'y-to-i': 'ব্যঞ্জনবর্ণের পরের -y শেষাংশ যোগ করার সময় -i হয়ে যায় (century → centuries, easy → easily)।',
  double: 'ছোট, জোর দেওয়া স্বরবর্ণের পরে শেষ ব্যঞ্জনবর্ণটি দ্বিত্ব হয় (stop → stopped, begin → beginning)।',
  'le-to-ly': '-le দিয়ে শেষ হওয়া বিশেষণে -le বদলে -ly হয় (gentle → gently)।',
  'ic-to-ically': '-ic বিশেষণে -ally যোগ হয় (geometric → geometrically)।',
};

const MAKES_BN: Record<string, string> = {
  noun: 'বিশেষ্য (noun)',
  adjective: 'বিশেষণ (adjective)',
  adverb: 'ক্রিয়াবিশেষণ (adverb)',
  verb: 'ক্রিয়া (verb)',
  'adjective (full of)': 'বিশেষণ (“পূর্ণ” অর্থে)',
  'adjective (without)': 'বিশেষণ (“ছাড়া” অর্থে)',
  'noun (a person)': 'ব্যক্তিবাচক বিশেষ্য',
  'noun (an idea)': 'ভাববাচক বিশেষ্য',
  'past tense / past participle': 'অতীত কাল / past participle',
  'verb form (-ing) or noun': 'ক্রিয়ার -ing রূপ বা বিশেষ্য',
  'plural or verb': 'বহুবচন বা ক্রিয়ার রূপ',
  'adverb from an -ic adjective': '-ic বিশেষণ থেকে ক্রিয়াবিশেষণ',
};
