import { endingSplit, IRREGULAR, isFunctionWord } from '../../src/engine/morphology';
import { levelFor } from '../../src/engine/priority';
import { sentenceQuestion, validateQuestion } from '../../src/engine/questions';
import { findOccurrences } from '../../src/engine/text';
import { splitSentences } from '../../src/engine/sentences';
import type { Context, Difficulty, InteractiveSet, Paragraph, ParagraphGap, TextSource, VocabData, VocabWord } from '../../src/engine/types';
import { checkContext, checkContextSet } from '../../src/engine/validate';
import type { AuthoredParagraph, AuthoredWord } from './authored';
import type { CollectedText } from './collected';
import { chooseParagraphs, deletionReason, inTrustedLists, isBritishSpelling, listInfo, paragraphCandidates, pickContexts, senseForContexts, sentenceIndex, type Lexicon, type SingleSentence } from './enrich';
import type { ExtractionResult, MergedWord } from './extract-lib';

/** American → British spellings, applied to words that are in the dataset (accepted in Fill in the Blanks only). */
export const US_UK: Record<string, string> = {
  color: 'colour', colors: 'colours', colorful: 'colourful', favorite: 'favourite', neighbor: 'neighbour', neighbors: 'neighbours',
  neighborhood: 'neighbourhood', behavior: 'behaviour', honor: 'honour', labor: 'labour', harbor: 'harbour', flavor: 'flavour',
  humor: 'humour', traveling: 'travelling', traveled: 'travelled', traveler: 'traveller', canceled: 'cancelled', modeling: 'modelling',
  labeled: 'labelled', jewelry: 'jewellery', program: 'programme', catalog: 'catalogue', judgment: 'judgement', fulfill: 'fulfil',
  enrollment: 'enrolment', skillful: 'skilful', aging: 'ageing', enroll: 'enrol', gray: 'grey', defense: 'defence', center: 'centre',
  theater: 'theatre', theaters: 'theatres', meter: 'metre', liter: 'litre', fiber: 'fibre', organize: 'organise', organizing: 'organising',
  organized: 'organised', organization: 'organisation', realize: 'realise', recognize: 'recognise', summarize: 'summarise',
  apologize: 'apologise', analyze: 'analyse', analyzed: 'analysed', emphasize: 'emphasise', prioritize: 'prioritise', prioritizes: 'prioritises',
  characterize: 'characterise', characterized: 'characterised', memorize: 'memorise', civilization: 'civilisation', colonization: 'colonisation',
  globalization: 'globalisation', personalized: 'personalised', license: 'licence', offense: 'offence', skeptical: 'sceptical',
  artifact: 'artefact', artifacts: 'artefacts', vapor: 'vapour', rumor: 'rumour', odor: 'odour', mold: 'mould', plow: 'plough',
  smelled: 'smelt', whiskey: 'whisky', criticize: 'criticise', scrutinize: 'scrutinise', specialize: 'specialise', mom: 'mum',
};

/** British-only words found in official material (not spelling targets for Read and Complete). */
export const BRITISH_WORDS: Record<string, string> = { kerb: 'US: curb', pram: 'US: stroller (baby carriage)' };

export interface BuildIssue {
  word: string;
  problem: string;
}

export interface BuildReport {
  generatedAt: string;
  sources: ExtractionResult['sources'];
  totals: {
    sourceEntriesDetected: number;
    sourceEntriesAccepted: number;
    rejectedEntries: number;
    uniqueSpellingTargets: number;
    duplicatesMerged: number;
    missingDefinitions: number;
    needingSentences: number;
    practiceReady: number;
    sentenceContexts: number;
    paragraphs: number;
    paragraphGaps: number;
    totalPracticeContexts: number;
    definitionsFromSources: number;
    definitionsWrittenForApp: number;
    bengaliGlosses: number;
    failedSources: number;
    failedSections: number;
  };
  byPriority: Record<string, number>;
  byDifficulty: Record<string, number>;
  smallWords: number;
  rejected: ExtractionResult['rejected'];
  missingDefinitions: string[];
  needingSentences: string[];
  invalidSentences: BuildIssue[];
  authoredNotInSources: string[];
  authoredDuplicates: string[];
  authoringErrors: string[];
  paragraphIssues: string[];
  notes: string[];
  /** Present when the build used the collected real material. */
  collected?: CollectedSummary;
}

export interface CollectedSummary {
  deleted: { word: string; reason: string }[];
  added: { count: number; byLevel: Record<string, number>; sample: string[] };
  contextOrigins: { collected: number; dictionary: number; authored: number };
  wordsWithOnlyCollected: number;
  definitionOrigins: Record<string, number>;
  bengaliOrigins: Record<string, number>;
  paragraphsByCorpus: Record<string, number>;
  paragraphCandidates: number;
  interactiveSets: number;
  interactiveIssues: string[];
  texts: number;
  licences: Record<string, number>;
}

export interface CollectedInput {
  texts: CollectedText[];
  lexicon: Lexicon;
  /** Single sentences without surrounding text (ASSET, CEFR-SP). */
  sentences?: SingleSentence[];
}

/** How many collected Read and Complete texts to keep. */
export const PARAGRAPH_LIMIT = 320;

/**
 * Evidence score from the study materials (configurable weights):
 * official answer words, how many sections list the word, small-word gap
 * counts, recurrence across independent sources and spelling-trap lists all
 * raise it; author-selected, third-party, best-estimate and distractor-only
 * words get less. The live priority adds the student's own mistakes.
 */
export const EVIDENCE_WEIGHTS = {
  official: 3.5,
  perExtraSection: 1,
  extraSectionCap: 4,
  gapCountCap: 4,
  smallWord: 2,
  recurringCap: 3,
  spellingTarget: 2,
  authorSelection: 1.5,
  thirdParty: 1,
  /** In NGSL / NAWL / CEFR-J / Octanove C1 but not in the study materials. */
  trustedList: 1,
  /** Extra for core everyday words (NGSL or CEFR A1–B1). */
  coreList: 1,
  weak: 0.5,
};

export function evidenceScore(m: MergedWord): number {
  const W = EVIDENCE_WEIGHTS;
  let s = 0;
  const ev = new Set(m.evidence);
  if (ev.has('official')) s += W.official;
  if (m.gapCount) s += Math.min(W.gapCountCap, Math.log2(m.gapCount + 1));
  if (m.tags.includes('small-word') && isFunctionWord(m.word)) s += W.smallWord;
  if (m.recurringSources) s += Math.min(W.recurringCap, m.recurringSources);
  if (m.tags.some((t) => t.startsWith('spelling-trap') || t === 'us-spelling' || t.startsWith('spelling-rule') || t === 'irregular-form')) s += W.spellingTarget;
  if (!ev.has('official')) {
    if (ev.has('author-selection')) s += W.authorSelection;
    else if (ev.has('third-party')) s += W.thirdParty;
    else if (ev.has('trusted-list')) s += W.trustedList + (m.tags.includes('core-list') ? W.coreList : 0);
    else s += W.weak; // best-estimate, strategy example or distractor only
  }
  s += W.perExtraSection * Math.min(W.extraSectionCap, m.sections.length - 1);
  return Math.round(s * 10) / 10;
}

const ORDER: Difficulty[] = ['easy', 'intermediate', 'advanced'];

function heuristicLevel(w: string): Difficulty {
  if (w.length <= 5) return 'easy';
  if (w.length <= 9) return 'intermediate';
  return 'advanced';
}

/**
 * Merges what was extracted from the study materials with the authored
 * enrichment. The extracted list decides which words exist: authored lines
 * for words that are not in any source are reported, not imported.
 */
export function buildVocab(
  extraction: ExtractionResult,
  authored: AuthoredWord[],
  authoredParagraphs: AuthoredParagraph[],
  authoringErrors: string[],
  collected?: CollectedInput,
  interactive: InteractiveSet[] = [],
  interactiveIssues: string[] = [],
): { data: VocabData; report: BuildReport } {
  const authoredMap = new Map<string, AuthoredWord>();
  const authoredDuplicates: string[] = [];
  for (const a of authored) {
    if (authoredMap.has(a.word)) authoredDuplicates.push(`${a.word} (${a.file}:${a.line})`);
    else authoredMap.set(a.word, a);
  }
  const extractedWords = new Set(extraction.words.map((w) => w.word));
  const authoredNotInSources = [...authoredMap.keys()].filter((w) => !extractedWords.has(w)).sort();

  const invalidSentences: BuildIssue[] = [];
  const missingDefinitions: string[] = [];
  const needingSentences: string[] = [];
  let fromSources = 0;
  let writtenForApp = 0;
  let bengali = 0;

  const lex = collected?.lexicon ?? {};
  const index = collected ? sentenceIndex(collected.texts, collected.sentences ?? []) : undefined;
  const deleted: { word: string; reason: string }[] = [];
  let merged: MergedWord[] = extraction.words;
  const added: MergedWord[] = [];
  if (collected && index) {
    merged = extraction.words.filter((m) => {
      const reason = deletionReason(m, lex, BRITISH_WORDS);
      if (reason) deleted.push({ word: m.word, reason });
      return !reason;
    });
    // Trusted-list words the study materials do not have: content words of
    // everyday or academic frequency that have at least two real sentences.
    const have = new Set(extraction.words.map((m) => m.word));
    for (const [w, e] of Object.entries(lex)) {
      if (have.has(w) || w.length < 3 || isFunctionWord(w) || !/^[a-z]+$/.test(w)) continue;
      if (!inTrustedLists(lex, w)) continue;
      if ((e.z ?? 0) < 3 || !e.pos?.some((p) => ['n', 'v', 'adj', 'adv'].includes(p))) continue;
      if (isBritishSpelling(w, lex, US_UK)) continue;
      if ((index.byWord.get(w)?.length ?? 0) < 2) continue;
      // Only words that really get two real (or dictionary) sentences are added.
      // Added only when real text uses the word in at least two good sentences (the app shows one).
      const trial = pickContexts(w, `w:${w}`, index, lex, [], 2);
      if (trial.contexts.length < 2) continue;
      const info = listInfo(lex, w);
      const core = info.lists.includes('ngsl') || ['A1', 'A2', 'B1'].includes(info.cefr ?? '');
      added.push({
        word: w,
        occurrences: 0,
        sources: ['lists'],
        sections: ['trusted-lists'],
        evidence: ['trusted-list'],
        definitions: [],
        collocations: [],
        ukVariants: [],
        notes: [],
        levels: [],
        tags: core ? ['core-list'] : [],
      } as unknown as MergedWord);
    }
  }
  const contextOrigins = { collected: 0, dictionary: 0, authored: 0 };
  let wordsWithOnlyCollected = 0;
  const definitionOrigins: Record<string, number> = { source: 0, dictionary: 0, app: 0, missing: 0 };
  const bengaliOrigins: Record<string, number> = { app: 0, dictionary: 0, none: 0 };
  const LEVEL_OF: Record<string, Difficulty> = { A1: 'easy', A2: 'easy', B1: 'intermediate', B2: 'advanced', C1: 'advanced', C2: 'advanced' };

  const words: VocabWord[] = [...merged, ...added].map((m) => {
    const a = authoredMap.get(m.word);
    const id = `w:${m.word}`;
    const base = a?.base ?? IRREGULAR[m.word];
    const contexts: Context[] = [];
    let set: { kept: Context[]; rejected: { sentence: string; reason: string }[] };
    let senseEvidence: string[] = [];
    if (index) {
      const pick = pickContexts(m.word, id, index, lex, a?.sentences ?? []);
      contextOrigins.collected += pick.collected;
      contextOrigins.dictionary += pick.dictionary;
      contextOrigins.authored += pick.authored;
      if (pick.authored === 0 && pick.contexts.length >= 1) wordsWithOnlyCollected++;
      set = { kept: pick.contexts, rejected: [] };
      senseEvidence = pick.evidence;
    } else {
      for (const s of a?.sentences ?? []) {
        const c = checkContext(s, m.word, id, 'authored');
        const giveaway = c.warnings.find((x) => x.startsWith('giveaway'));
        if (c.context && !giveaway) contexts.push(c.context);
        else invalidSentences.push({ word: m.word, problem: `${giveaway ?? c.errors.join('; ')} — “${s}”` });
      }
      set = checkContextSet(contexts, m.word);
      for (const r of set.rejected) invalidSentences.push({ word: m.word, problem: `${r.reason} — “${r.sentence}”` });
      // One practice sentence per word.
      set = { ...set, kept: set.kept.slice(0, 1) };
    }
    const sourceDefs = m.definitions.map((d) => d.text);
    const e = lex[m.word];
    const pos = a?.pos?.length ? a.pos : isFunctionWord(m.word) ? ['func'] : (e?.pos?.filter((p) => ['n', 'v', 'adj', 'adv'].includes(p)) ?? ['n']);
    const wnDef = senseForContexts(e, pos, [...set.kept.map((c) => c.sentence), ...senseEvidence], m.word);
    let definition = '';
    let definitionOrigin: VocabWord['definitionOrigin'] = 'app';
    if (sourceDefs.length) {
      definition = sourceDefs[0];
      definitionOrigin = 'source';
      fromSources++;
    } else if (collected && wnDef && !isFunctionWord(m.word) && !a?.definition) {
      // Words added from the trusted lists have no definition of their own: use WordNet's.
      definition = wnDef;
      definitionOrigin = 'dictionary';
    } else if (a?.definition) {
      definition = a.definition;
      writtenForApp++;
    } else missingDefinitions.push(m.word);
    definitionOrigins[definition ? definitionOrigin : 'missing']++;
    // Only a dictionary meaning for the same part of speech: "stuck" must not get the Bengali for a wooden stick.
    const dictBn = e?.bn ? pos.map((p) => e.bn![p]).find(Boolean) : undefined;
    let bengaliText = a?.bengali;
    let bengaliOrigin: VocabWord['bengaliOrigin'] = a?.bengali ? 'app' : undefined;
    if (!bengaliText && dictBn?.length) {
      bengaliText = dictBn.slice(0, 2).join(', ');
      bengaliOrigin = 'dictionary';
    }
    if (bengaliText) bengali++;
    bengaliOrigins[bengaliOrigin ?? 'none']++;
    const sourceLevels = m.levels.slice().sort((x, y) => ORDER.indexOf(y) - ORDER.indexOf(x));
    const small = isFunctionWord(m.word);
    const info = collected ? listInfo(lex, m.word) : { lists: [], cefr: undefined };
    const zipf = e?.z;
    const fromLists: Difficulty | undefined = info.cefr ? LEVEL_OF[info.cefr] : zipf !== undefined ? (zipf >= 4.5 ? 'easy' : zipf >= 3.8 ? 'intermediate' : 'advanced') : undefined;
    const difficulty: Difficulty = small ? 'easy' : (sourceLevels[0] ?? a?.level ?? (m.evidence.includes('trusted-list') ? fromLists : undefined) ?? heuristicLevel(m.word));
    const ukVariants = [...new Set([...m.ukVariants, ...(US_UK[m.word] ? [US_UK[m.word]] : [])])];
    const tags = [...m.tags];
    const notes = [...m.notes];
    if (BRITISH_WORDS[m.word]) {
      tags.push('british-word');
      notes.push(`British word (${BRITISH_WORDS[m.word]})`);
    }
    const ending = small ? undefined : endingSplit(m.word, base, m.tags.filter((t) => t.startsWith('ending:')));
    const score = evidenceScore(m);
    const w: VocabWord = {
      id,
      word: m.word,
      pos,
      definition,
      definitionOrigin,
      sourceDefinitions: sourceDefs,
      bengali: bengaliText,
      bengaliOrigin,
      ...(dictBn?.length ? { bengaliDictionary: dictBn.slice(0, 4) } : {}),
      ...(wnDef && definitionOrigin !== 'dictionary' && !small ? { dictionaryDefinition: wnDef } : {}),
      ...(info.cefr ? { cefr: info.cefr } : {}),
      ...(info.lists.length ? { lists: info.lists } : {}),
      ...(zipf !== undefined ? { zipf } : {}),
      base,
      family: m.word,
      ending,
      difficulty,
      basePriority: levelFor(score),
      evidenceScore: score,
      evidence: m.evidence,
      sources: m.sources,
      sections: m.sections,
      tags,
      collocations: m.collocations.map((c) => c.text),
      ukVariants,
      notes,
      gapCount: m.gapCount,
      isSmallWord: small,
      isCustom: false,
      contexts: set.kept,
    };
    if (definition && a?.definition && definitionOrigin === 'source') {
      // keep the app's sense-specific definition available for feedback
      w.notes.push(`App definition: ${a.definition}`);
    }
    for (const c of set.kept) {
      const err = validateQuestion(sentenceQuestion(w, c, 'spelling'), w);
      if (err) invalidSentences.push({ word: m.word, problem: `question check failed: ${err}` });
    }
    if (set.kept.length < 1) needingSentences.push(m.word);
    return w;
  });

  // Word families: link each form to its base when the base is also in the dataset.
  const byWord = new Map(words.map((w) => [w.word, w]));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const w of words) parent.set(w.word, w.word);
  for (const w of words) {
    if (w.base && byWord.has(w.base)) {
      const a = find(w.word);
      const b = find(w.base);
      if (a !== b) {
        // keep the shorter word as the family root
        if (b.length <= a.length) parent.set(a, b);
        else parent.set(b, a);
      }
    } else if (w.base) {
      parent.set(w.word, w.word);
    }
  }
  const baseOnly = new Map<string, string>(); // forms whose base is not a dataset word share a family named after the base
  for (const w of words) {
    const root = find(w.word);
    if (root === w.word && w.base && !byWord.has(w.base)) {
      const key = baseOnly.get(w.base) ?? w.base;
      baseOnly.set(w.base, key);
      w.family = key;
    } else w.family = root;
  }

  // Paragraphs for Read and Complete: collected real texts when available.
  const paragraphIssues: string[] = [];
  let paragraphs: Paragraph[];
  let candidateCount = 0;
  if (collected) {
    const ukCache = new Map<string, boolean>();
    const isUk = (w: string) => {
      if (!ukCache.has(w)) ukCache.set(w, w.length > 3 && isBritishSpelling(w, lex, US_UK));
      return ukCache.get(w)!;
    };
    const cands = paragraphCandidates(collected.texts, 2, isUk);
    candidateCount = cands.length;
    const usable = cands
      .map((c, k) => {
        const id = `rc-${c.source.id}-${k}`;
        const gaps = selectGaps(c.text, byWord);
        return {
          id,
          title: c.source.title.length > 70 ? c.source.title.slice(0, 67).replace(/\s+\S*$/, '') + '…' : c.source.title,
          topic: c.source.topic,
          difficulty: c.source.difficulty,
          text: c.text,
          gaps: gaps.map((g, i) => ({ ...g, contextId: `p:${id}:${i}` })),
          src: c.source.id,
          corpus: c.source.corpus,
        };
      })
      .filter((p) => p.gaps.length >= 8);
    paragraphs = chooseParagraphs(usable, PARAGRAPH_LIMIT);
  } else {
    paragraphs = authoredParagraphs.map((p) => {
      const gaps = selectGaps(p.text, byWord);
      if (gaps.length < 8) paragraphIssues.push(`${p.id} “${p.title}” has only ${gaps.length} gaps`);
      return { id: p.id, title: p.title, topic: p.topic, difficulty: p.level, text: p.text, gaps: gaps.map((g, i) => ({ ...g, contextId: `p:${p.id}:${i}` })) };
    });
  }
  const seenIds = new Set<string>();
  for (const p of paragraphs) {
    if (seenIds.has(p.id)) paragraphIssues.push(`duplicate paragraph id ${p.id}`);
    seenIds.add(p.id);
  }

  const sentenceContexts = words.reduce((n, w) => n + w.contexts.length, 0);
  const paragraphGaps = paragraphs.reduce((n, p) => n + p.gaps.length, 0);
  const byPriority: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const byDifficulty: Record<string, number> = { easy: 0, intermediate: 0, advanced: 0 };
  for (const w of words) {
    byPriority[w.basePriority]++;
    byDifficulty[w.difficulty]++;
  }
  // Interactive Reading: link each missing word to its library word.
  for (const set of interactive) for (const b of set.blanks) b.wordId = byWord.get(b.answer.toLowerCase())?.id;
  const usedTexts = new Set<string>();
  for (const w of words) for (const c of w.contexts) if (c.src && c.src !== 'wordnet') usedTexts.add(c.src);
  for (const p of paragraphs) if (p.src) usedTexts.add(p.src);
  for (const set of interactive) usedTexts.add(set.source.id);
  for (const w of words) for (const c of w.contexts) if (c.src === 'asset' || c.src?.startsWith('cefrsp')) usedTexts.add(c.src);
  const texts: TextSource[] = (collected?.texts ?? [])
    .filter((t) => usedTexts.has(t.id))
    .map((t) => ({ id: t.id, title: t.title, credit: t.credit, ...(t.url ? { url: t.url } : {}), license: t.license }));
  const extraSources = collected
    ? [
        { id: 'lists', title: 'Trusted word lists: NGSL 1.2 and NAWL 1.2 (CC BY-SA 4.0), CEFR-J 1.5, Octanove C1/C2 (CC BY-SA 4.0)' },
        { id: 'texts', title: 'Real texts: CommonLit CLEAR corpus (CC BY / CC BY-SA excerpts), OneStopEnglish (CC BY-SA 4.0), OpenStax textbooks (CC BY-NC-SA 4.0), ASSET (CC BY-NC 4.0), CEFR-SP (CC BY-SA 3.0 / CC BY-NC-SA 4.0)' },
      ]
    : [];
  const data: VocabData = {
    version: '',
    generatedAt: new Date().toISOString(),
    sources: [...extraction.sources.map((s) => ({ id: s.id, title: s.title })), ...extraSources],
    words,
    paragraphs,
    interactive,
    ...(collected ? { texts } : {}),
  };
  const licences: Record<string, number> = {};
  for (const t of texts) licences[t.license] = (licences[t.license] ?? 0) + 1;
  const paragraphsByCorpus: Record<string, number> = {};
  for (const p of paragraphs) {
    const corpus = p.src?.split('-')[0] ?? 'authored';
    paragraphsByCorpus[corpus] = (paragraphsByCorpus[corpus] ?? 0) + 1;
  }
  const addedByLevel: Record<string, number> = {};
  for (const m of added) {
    const k = listInfo(lex, m.word).cefr ?? 'list only';
    addedByLevel[k] = (addedByLevel[k] ?? 0) + 1;
  }
  const report: BuildReport = {
    generatedAt: data.generatedAt,
    sources: extraction.sources,
    totals: {
      sourceEntriesDetected: extraction.sources.reduce((n, s) => n + s.entriesDetected, 0),
      sourceEntriesAccepted: extraction.entries.length,
      rejectedEntries: extraction.rejected.length,
      uniqueSpellingTargets: words.length,
      duplicatesMerged: extraction.duplicatesMerged,
      missingDefinitions: missingDefinitions.length,
      needingSentences: needingSentences.length,
      practiceReady: words.length - needingSentences.length,
      sentenceContexts,
      paragraphs: paragraphs.length,
      paragraphGaps,
      totalPracticeContexts: sentenceContexts + paragraphGaps,
      definitionsFromSources: fromSources,
      definitionsWrittenForApp: writtenForApp,
      bengaliGlosses: bengali,
      failedSources: extraction.sources.filter((s) => s.status === 'failed').length,
      failedSections: extraction.sources.reduce((n, s) => n + s.sections.filter((x) => x.status === 'failed').length, 0),
    },
    byPriority,
    byDifficulty,
    smallWords: words.filter((w) => w.isSmallWord).length,
    rejected: extraction.rejected,
    missingDefinitions,
    needingSentences,
    invalidSentences,
    authoredNotInSources,
    authoredDuplicates,
    authoringErrors,
    paragraphIssues,
    notes: extraction.sources.flatMap((s) => s.notes),
    ...(collected
      ? {
          collected: {
            deleted,
            added: { count: added.length, byLevel: addedByLevel, sample: added.slice(0, 40).map((m) => m.word) },
            contextOrigins,
            wordsWithOnlyCollected,
            definitionOrigins,
            bengaliOrigins,
            paragraphsByCorpus,
            paragraphCandidates: candidateCount,
            interactiveSets: interactive.length,
            interactiveIssues,
            texts: texts.length,
            licences,
          },
        }
      : {}),
  };
  return { data, report };
}

/**
 * DET C-test gap selection (Technical Manual 2026): the title, first and last
 * sentences stay complete; from the second word of the second sentence,
 * alternating words lose their second half, across sentence boundaries. Numbers,
 * names, one-letter words, contractions and hyphenated words are never damaged
 * but still take their turn, so damaged words are never next to each other.
 * Words that are not in the library are also left whole (their progress could
 * not be tracked).
 */
export const MAX_GAPS = 16;

export function selectGaps(text: string, byWord: Map<string, VocabWord>, maxGaps = MAX_GAPS): Omit<ParagraphGap, 'contextId'>[] {
  const sentences = splitSentences(text);
  if (sentences.length < 3) return [];
  const regionStart = sentences[0].end;
  const regionEnd = sentences[sentences.length - 1].start;
  // Letters in any alphabet, so a word such as "résumé" is one (ineligible) token, never "sum".
  const tokens = [...text.slice(regionStart, regionEnd).matchAll(/\p{L}+(?:['’-]\p{L}+)*|\d+(?:[.,]\d+)*/gu)].map((m) => ({
    text: m[0],
    start: regionStart + (m.index ?? 0),
  }));
  const startsSentence = (pos: number) => sentences.some((sp) => sp.start <= pos && /^[\s"“‘(]*$/.test(text.slice(sp.start, pos)));
  const gaps: Omit<ParagraphGap, 'contextId'>[] = [];
  tokens.forEach((t, i) => {
    if (i % 2 === 0 || gaps.length >= maxGaps) return; // 1st, 3rd, 5th … word stay whole
    const lower = t.text.toLowerCase();
    const w = byWord.get(lower);
    const eligible = !!w && lower.length >= 2 && /^[A-Za-z]+$/.test(t.text) && (t.text === lower || startsSentence(t.start)) && !w.tags.includes('british-word');
    if (eligible) gaps.push({ wordId: w!.id, start: t.start, end: t.start + t.text.length });
  });
  // sanity: each gap text must be the word
  return gaps.filter((g) => findOccurrences(text.slice(g.start, g.end), text.slice(g.start, g.end)).length === 1);
}
