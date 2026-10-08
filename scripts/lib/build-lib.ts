import { endingSplit, IRREGULAR, isFunctionWord } from '../../src/engine/morphology';
import { levelFor } from '../../src/engine/priority';
import { sentenceQuestion, validateQuestion } from '../../src/engine/questions';
import { findOccurrences } from '../../src/engine/text';
import type { Context, Difficulty, Paragraph, ParagraphGap, VocabData, VocabWord } from '../../src/engine/types';
import { checkContext, checkContextSet } from '../../src/engine/validate';
import type { AuthoredParagraph, AuthoredWord } from './authored';
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
}

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

  const words: VocabWord[] = extraction.words.map((m) => {
    const a = authoredMap.get(m.word);
    const id = `w:${m.word}`;
    const base = a?.base ?? IRREGULAR[m.word];
    const contexts: Context[] = [];
    for (const s of a?.sentences ?? []) {
      const c = checkContext(s, m.word, id, 'authored');
      const giveaway = c.warnings.find((x) => x.startsWith('giveaway'));
      if (c.context && !giveaway) contexts.push(c.context);
      else invalidSentences.push({ word: m.word, problem: `${giveaway ?? c.errors.join('; ')} — “${s}”` });
    }
    const set = checkContextSet(contexts, m.word);
    for (const r of set.rejected) invalidSentences.push({ word: m.word, problem: `${r.reason} — “${r.sentence}”` });
    const sourceDefs = m.definitions.map((d) => d.text);
    let definition = '';
    let definitionOrigin: VocabWord['definitionOrigin'] = 'app';
    if (sourceDefs.length) {
      definition = sourceDefs[0];
      definitionOrigin = 'source';
      fromSources++;
    } else if (a?.definition) {
      definition = a.definition;
      writtenForApp++;
    } else missingDefinitions.push(m.word);
    if (a?.bengali) bengali++;
    const sourceLevels = m.levels.slice().sort((x, y) => ORDER.indexOf(y) - ORDER.indexOf(x));
    const small = isFunctionWord(m.word);
    const difficulty: Difficulty = small ? 'easy' : sourceLevels[0] ?? a?.level ?? heuristicLevel(m.word);
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
      pos: a?.pos?.length ? a.pos : small ? ['func'] : ['n'],
      definition,
      definitionOrigin,
      sourceDefinitions: sourceDefs,
      bengali: a?.bengali,
      bengaliOrigin: a?.bengali ? 'app' : undefined,
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
      // keep the app's fuller definition available for feedback
      w.notes.push(`App definition: ${a.definition}`);
    }
    for (const c of set.kept) {
      const err = validateQuestion(sentenceQuestion(w, c, 'spelling'), w);
      if (err) invalidSentences.push({ word: m.word, problem: `question check failed: ${err}` });
    }
    if (set.kept.length < 2) needingSentences.push(m.word);
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

  // Paragraphs for Read and Complete.
  const paragraphIssues: string[] = [];
  const paragraphs: Paragraph[] = authoredParagraphs.map((p) => {
    const gaps = selectGaps(p.text, byWord);
    if (gaps.length < 8) paragraphIssues.push(`${p.id} “${p.title}” has only ${gaps.length} gaps`);
    return { id: p.id, title: p.title, topic: p.topic, difficulty: p.level, text: p.text, gaps: gaps.map((g, i) => ({ ...g, contextId: `p:${p.id}:${i}` })) };
  });
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
  const data: VocabData = {
    version: '',
    generatedAt: new Date().toISOString(),
    sources: extraction.sources.map((s) => ({ id: s.id, title: s.title })),
    words,
    paragraphs,
  };
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
  };
  return { data, report };
}

/**
 * DET-style gap selection: the first and last sentences stay complete; in
 * between, every other eligible word loses its second half. Eligible words
 * are dataset words of two or more letters that are not names, contractions
 * or hyphenated words, and gaps are never next to each other.
 */
export const MAX_GAPS = 20;

export function selectGaps(text: string, byWord: Map<string, VocabWord>, maxGaps = MAX_GAPS): Omit<ParagraphGap, 'contextId'>[] {
  const sentences = [...text.matchAll(/[^.!?]+[.!?]+["”’)]?\s*/g)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  if (sentences.length < 3) return [];
  const regionStart = sentences[0].end;
  const regionEnd = sentences[sentences.length - 1].start;
  const tokens = [...text.slice(regionStart, regionEnd).matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)].map((m) => ({
    text: m[0],
    start: regionStart + (m.index ?? 0),
  }));
  const gaps: Omit<ParagraphGap, 'contextId'>[] = [];
  let lastGapToken = -2;
  let want = false; // first word of the region stays visible, then alternate
  tokens.forEach((t, i) => {
    const lower = t.text.toLowerCase();
    const w = byWord.get(lower);
    const prevChar = text.slice(0, t.start).trimEnd().slice(-1);
    const sentenceStart = !prevChar || /[.!?]/.test(prevChar);
    const eligible =
      !!w && w.contexts.length >= 0 && lower.length >= 2 && !/['’-]/.test(t.text) && (t.text === lower || sentenceStart) && !w.tags.includes('british-word');
    if (gaps.length >= maxGaps) return;
    if (want && eligible && i - lastGapToken > 1) {
      gaps.push({ wordId: w!.id, start: t.start, end: t.start + t.text.length });
      lastGapToken = i;
      want = false;
    } else if (!want) want = true;
  });
  // sanity: each gap text must be the word
  return gaps.filter((g) => findOccurrences(text.slice(g.start, g.end), text.slice(g.start, g.end)).length === 1);
}
