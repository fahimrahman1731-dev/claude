/**
 * Word structure helpers: small grammar words, irregular forms, endings and
 * the spelling changes that happen when an ending is added.
 */

/** Closed-class words: articles, pronouns, prepositions, conjunctions, auxiliaries, grammar adverbs, numbers. */
export const FUNCTION_WORDS = new Set(
  `the a an this that these those my your his her its our their whose which what some any no every each either neither all both few many much more most less least several such other another own
i me you he him she it we us they them myself yourself himself herself itself ourselves themselves who whom whoever whatever whichever someone something somebody anyone anything anybody everyone everything everybody nothing nobody none mine yours hers ours theirs
of in on at by for with from to into onto upon about above across after against along among around as before behind below beneath beside besides between beyond but despite down during except inside near off out outside over past since than through throughout till toward towards under underneath unlike until up via within without versus per like including
and or nor so yet because although though while whereas whether if unless once when whenever where wherever why how
be is am are was were been being do does did have has had having can could may might must shall should will would
not also just very too then there here now still even only often ever never always sometimes almost quite rather already again however therefore moreover furthermore meanwhile thus instead together perhaps
one two three four five six seven eight nine ten first`
    .split(/\s+/)
    .filter(Boolean),
);

export function isFunctionWord(w: string): boolean {
  return FUNCTION_WORDS.has(w.toLowerCase());
}

/** Irregular forms → base. Used for word families and for hints in the Word Endings mode. */
export const IRREGULAR: Record<string, string> = Object.fromEntries(
  `began:begin begun:begin became:become came:come built:build fought:fight led:lead sent:send spent:spend took:take taken:take won:win made:make felt:feel held:hold said:say ran:run sat:sit
overthrew:overthrow gone:go went:go driven:drive drove:drive broken:break broke:break frozen:freeze froze:freeze known:know knew:know born:bear grew:grow grown:grow wrote:write written:write
brought:bring thought:think caught:catch taught:teach found:find left:leave kept:keep paid:pay sold:sell told:tell stood:stand understood:understand chose:choose chosen:choose rose:rise risen:rise
fell:fall fallen:fall drew:draw drawn:draw flew:fly flown:fly saw:see seen:see gave:give given:give got:get gotten:get met:meet did:do done:do had:have has:have was:be were:be been:be is:be are:be am:be
does:do ate:eat eaten:eat swam:swim stole:steal stolen:steal spoke:speak spoken:speak woke:wake woken:wake wore:wear worn:wear struck:strike shot:shoot shook:shake shaken:shake sang:sing sung:sing rang:ring
hid:hide hidden:hide lay:lie laid:lay lost:lose meant:mean heard:hear bought:buy slept:sleep sought:seek threw:throw thrown:throw shown:show ridden:ride rode:ride forgot:forget forgotten:forget
forgave:forgive forgiven:forgive undergone:undergo underwent:undergo overcame:overcome withdrew:withdraw smelt:smell dealt:deal dug:dig fed:feed fled:flee hung:hang lit:light slid:slide spun:spin
stuck:stick swept:sweep swung:swing tore:tear torn:tear wept:weep wound:wind bent:bend bit:bite bitten:bite blew:blow blown:blow bred:breed burnt:burn crept:creep fought:fight ground:grind
leapt:leap lent:lend meant:mean mistook:mistake shone:shine shrank:shrink sank:sink sunk:sink sped:speed spread:spread strove:strive thrived:thrive arose:arise arisen:arise beat:beat beaten:beat
children:child men:man women:woman feet:foot teeth:tooth mice:mouse lives:life wives:wife knives:knife shelves:shelf wolves:wolf halves:half leaves:leaf phenomena:phenomenon criteria:criterion people:person`
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.split(':') as [string, string]),
);

/** Endings the app teaches, longest first. `pattern` helps explain what the ending does. */
export const ENDINGS: { suffix: string; label: string; makes: string }[] = [
  { suffix: 'ically', label: '-ically', makes: 'adverb from an -ic adjective' },
  { suffix: 'ation', label: '-ation', makes: 'noun' },
  { suffix: 'ition', label: '-ition', makes: 'noun' },
  { suffix: 'ology', label: '-ology', makes: 'noun (a subject of study)' },
  { suffix: 'graphy', label: '-graphy', makes: 'noun' },
  { suffix: 'tion', label: '-tion', makes: 'noun' },
  { suffix: 'sion', label: '-sion', makes: 'noun' },
  { suffix: 'ment', label: '-ment', makes: 'noun' },
  { suffix: 'ness', label: '-ness', makes: 'noun' },
  { suffix: 'ship', label: '-ship', makes: 'noun' },
  { suffix: 'hood', label: '-hood', makes: 'noun' },
  { suffix: 'ance', label: '-ance', makes: 'noun' },
  { suffix: 'ence', label: '-ence', makes: 'noun' },
  { suffix: 'ancy', label: '-ancy', makes: 'noun' },
  { suffix: 'ency', label: '-ency', makes: 'noun' },
  { suffix: 'able', label: '-able', makes: 'adjective' },
  { suffix: 'ible', label: '-ible', makes: 'adjective' },
  { suffix: 'less', label: '-less', makes: 'adjective (without)' },
  { suffix: 'ward', label: '-ward', makes: 'adverb/adjective (direction)' },
  { suffix: 'ical', label: '-ical', makes: 'adjective' },
  { suffix: 'ally', label: '-ally', makes: 'adverb' },
  { suffix: 'ious', label: '-ious', makes: 'adjective' },
  { suffix: 'eous', label: '-eous', makes: 'adjective' },
  { suffix: 'logy', label: '-logy', makes: 'noun' },
  { suffix: 'ful', label: '-ful', makes: 'adjective (full of)' },
  { suffix: 'ous', label: '-ous', makes: 'adjective' },
  { suffix: 'ive', label: '-ive', makes: 'adjective' },
  { suffix: 'ity', label: '-ity', makes: 'noun' },
  { suffix: 'ism', label: '-ism', makes: 'noun (an idea)' },
  { suffix: 'ist', label: '-ist', makes: 'noun (a person)' },
  { suffix: 'ize', label: '-ize', makes: 'verb' },
  { suffix: 'ify', label: '-ify', makes: 'verb' },
  { suffix: 'ate', label: '-ate', makes: 'verb or adjective' },
  { suffix: 'ure', label: '-ure', makes: 'noun' },
  { suffix: 'age', label: '-age', makes: 'noun' },
  { suffix: 'ary', label: '-ary', makes: 'adjective or noun' },
  { suffix: 'ory', label: '-ory', makes: 'adjective or noun' },
  { suffix: 'ant', label: '-ant', makes: 'adjective or noun' },
  { suffix: 'ent', label: '-ent', makes: 'adjective or noun' },
  { suffix: 'ial', label: '-ial', makes: 'adjective' },
  { suffix: 'phy', label: '-phy', makes: 'noun' },
  { suffix: 'ing', label: '-ing', makes: 'verb form (-ing) or noun' },
  { suffix: 'ied', label: '-ied', makes: 'past tense (y → i)' },
  { suffix: 'ies', label: '-ies', makes: 'plural or verb (y → i)' },
  { suffix: 'ily', label: '-ily', makes: 'adverb (y → i)' },
  { suffix: 'ier', label: '-ier', makes: 'comparative (y → i)' },
  { suffix: 'est', label: '-est', makes: 'superlative' },
  { suffix: 'ic', label: '-ic', makes: 'adjective' },
  { suffix: 'al', label: '-al', makes: 'adjective' },
  { suffix: 'ly', label: '-ly', makes: 'adverb' },
  { suffix: 'ed', label: '-ed', makes: 'past tense / past participle' },
  { suffix: 'er', label: '-er', makes: 'person/thing, or comparative' },
  { suffix: 'or', label: '-or', makes: 'person' },
  { suffix: 'en', label: '-en', makes: 'verb (make …)' },
  { suffix: 'th', label: '-th', makes: 'noun' },
  { suffix: 'es', label: '-es', makes: 'plural or verb' },
  { suffix: 's', label: '-s', makes: 'plural or verb' },
  { suffix: 'd', label: '-d', makes: 'past tense' },
];

const ENDING_BY_SUFFIX = new Map(ENDINGS.map((e) => [e.suffix, e]));
export function endingInfo(suffix: string) {
  return ENDING_BY_SUFFIX.get(suffix);
}

/** Suffixes accepted without a known base word (they are unambiguous enough). */
const SAFE_WITHOUT_BASE = ['ically', 'ation', 'ition', 'tion', 'sion', 'ment', 'ness', 'ship', 'ance', 'ence', 'able', 'ible', 'less', 'ical', 'ious', 'ful', 'ous', 'ity', 'ize', 'ify', 'ology', 'logy', 'graphy', 'ism', 'ist'];

export type SpellingChange = 'none' | 'drop-e' | 'y-to-i' | 'double' | 'le-to-ly' | 'ic-to-ically';

export interface Derivation {
  stem: string;
  suffix: string;
  change: SpellingChange;
}

const VOWEL_SUFFIX = /^[aeiou]/;

/** Ending combinations (develop → developments, nation → nationally) accepted by `derive`. */
const COMPOUND_SUFFIXES = new Set(
  'ion ions ian ians ation ations ers ings ments ities ists ants ents ors ances ences ingly edly nesses ality ative atively ization izations fully lessly ively ously ably ibly ational ives ers ests ities ologies ologist ologists ically ers ful fulness ness ships'.split(' '),
);

/**
 * How `word` is built from `base` with one ending, following the spelling
 * rules in the guide (drop silent e, y → i, double the last consonant).
 * Returns undefined when `word` is not base + a known ending.
 */
export function derive(word: string, base: string): Derivation | undefined {
  if (!base || word === base || word.length <= base.length - 2) return undefined;
  const known = (s: string) => ENDING_BY_SUFFIX.has(s) || COMPOUND_SUFFIXES.has(s);
  // plain: walk → walked, develop → development
  if (word.startsWith(base)) {
    const rest = word.slice(base.length);
    if (known(rest)) return { stem: base, suffix: rest, change: 'none' };
    // doubling: stop → stopped, begin → beginning
    const last = base[base.length - 1];
    if (rest[0] === last && /[bcdfgklmnprstvz]/.test(last)) {
      const r2 = rest.slice(1);
      if (/^(ed|ing|er|est|ers|en)$/.test(r2)) return { stem: base + last, suffix: r2, change: 'double' };
    }
  }
  // drop silent e: make → making, create → creation
  if (base.endsWith('e')) {
    const stem = base.slice(0, -1);
    if (word.startsWith(stem)) {
      const rest = word.slice(stem.length);
      if (rest !== 'e' && VOWEL_SUFFIX.test(rest) && known(rest)) return { stem, suffix: rest, change: 'drop-e' };
    }
  }
  // y → i: century → centuries, easy → easily
  if (/[^aeiou]y$/.test(base)) {
    const stem = base.slice(0, -1) + 'i';
    if (word.startsWith(stem)) {
      const rest = word.slice(stem.length);
      if (/^(es|ed|er|est|ly|ness|ful|ment|ers|al|ty|cal)$/.test(rest)) return { stem: base.slice(0, -1), suffix: 'i' + rest, change: 'y-to-i' };
    }
  }
  // gentle → gently, simple → simply
  if (base.endsWith('le') && word === base.slice(0, -1) + 'y') return { stem: base.slice(0, -1), suffix: 'y', change: 'le-to-ly' };
  return undefined;
}

export interface EndingSplit {
  visible: string;
  hidden: string;
  label: string;
  change: SpellingChange;
  irregular?: boolean;
}

/**
 * Chooses which part of a word the Word Endings mode hides:
 * 1. the ending added to a known base (development → develop + ment),
 * 2. an ending named in the guide's Bank 2 table for this word,
 * 3. an unambiguous ending such as -tion or -ness.
 * Irregular forms return undefined here; they are drilled with a base-word hint instead.
 */
export function endingSplit(word: string, base: string | undefined, endingTags: string[] = []): EndingSplit | undefined {
  if (base) {
    const d = derive(word, base);
    if (d && d.suffix.length >= 1 && d.stem.length >= 2) {
      // Show the whole stem; the hidden part is the ending (plus the doubled letter / i, which is the spelling point).
      let visible = d.stem;
      let hidden = word.slice(d.stem.length);
      if (d.change === 'double') {
        visible = d.stem.slice(0, -1);
        hidden = word.slice(visible.length);
      }
      if (hidden.length === 0) return undefined;
      return { visible, hidden, label: '-' + d.suffix.replace(/^i(?=es|ed|er|est|ly)/, 'i'), change: d.change };
    }
  }
  const tagged = endingTags
    .map((t) => t.replace(/^ending:-/, ''))
    .filter((s) => /^[a-z]+$/.test(s))
    .sort((a, b) => b.length - a.length);
  for (const s of tagged) {
    if (word.endsWith(s) && word.length - s.length >= 2) {
      return { visible: word.slice(0, -s.length), hidden: s, label: '-' + s, change: 'none' };
    }
    // -ically words are tagged "-ically"; -ly adverbs like "quickly" are tagged "-ly"
  }
  if (word.length >= 6) {
    for (const s of SAFE_WITHOUT_BASE.slice().sort((a, b) => b.length - a.length)) {
      if (word.endsWith(s) && word.length - s.length >= 3) return { visible: word.slice(0, -s.length), hidden: s, label: '-' + s, change: 'none' };
    }
  }
  return undefined;
}

/** Common inflections of a base, used to recognize "right word, wrong form" answers. */
export function inflections(base: string): string[] {
  const out = new Set<string>([base, base + 's', base + 'es', base + 'ed', base + 'ing', base + 'ly', base + 'er', base + 'd']);
  if (base.endsWith('e')) {
    out.add(base.slice(0, -1) + 'ing');
    out.add(base + 'd');
  }
  if (/[^aeiou]y$/.test(base)) {
    const s = base.slice(0, -1);
    out.add(s + 'ies');
    out.add(s + 'ied');
    out.add(s + 'ily');
  }
  return [...out];
}

export const SPELLING_CHANGE_TEXT: Record<SpellingChange, string> = {
  none: '',
  'drop-e': 'Drop the silent -e before an ending that starts with a vowel (make → making, create → creation).',
  'y-to-i': 'After a consonant, final -y becomes -i before the ending (century → centuries, easy → easily).',
  double: 'Double the last consonant after a short, stressed vowel (stop → stopped, begin → beginning).',
  'le-to-ly': 'Adjectives ending in -le change -le to -ly (gentle → gently, simple → simply).',
  'ic-to-ically': 'Adjectives in -ic take -ally (geometric → geometrically).',
};
