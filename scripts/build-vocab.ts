/**
 * Builds the app's vocabulary database from the study documents:
 *   1. extract every entry from data/sources (see manifest.json),
 *   2. merge with authored definitions, Bengali glosses and sentences in data/authored,
 *   3. validate every sentence and question,
 *   4. write public/data/vocab.json and the import / validation report.
 *
 * Usage: npm run build:data            (writes files, warns about problems)
 *        npm run build:data -- --strict  (also exits with an error if anything is incomplete)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAuthoredParagraphs, parseAuthoredWords, type AuthoredParagraph, type AuthoredWord } from './lib/authored';
import { buildVocab, type BuildReport, type CollectedInput } from './lib/build-lib';
import { loadInteractive } from './lib/interactive-build';
import { extractAll, type SourceManifestEntry } from './lib/extract-lib';

const root = join(import.meta.dirname, '..');
const strict = process.argv.includes('--strict');
const srcDir = join(root, 'data/sources');
const manifest: SourceManifestEntry[] = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));
const extraction = extractAll(manifest, (f) => readFileSync(join(srcDir, f), 'utf8'));

const authored: AuthoredWord[] = [];
const paragraphs: AuthoredParagraph[] = [];
const errors: string[] = [];
const wordsDir = join(root, 'data/authored/words');
if (existsSync(wordsDir)) {
  for (const f of readdirSync(wordsDir).filter((x) => x.endsWith('.txt')).sort()) {
    const r = parseAuthoredWords(readFileSync(join(wordsDir, f), 'utf8'), `words/${f}`);
    authored.push(...r.words);
    errors.push(...r.errors);
  }
}
const parDir = join(root, 'data/authored/paragraphs');
if (existsSync(parDir)) {
  for (const f of readdirSync(parDir).filter((x) => x.endsWith('.txt')).sort()) {
    const r = parseAuthoredParagraphs(readFileSync(join(parDir, f), 'utf8'), `paragraphs/${f}`);
    paragraphs.push(...r.paragraphs);
    errors.push(...r.errors);
  }
}

// Collected real material (made by scripts/collect/collect.py and committed).
const collectedDir = join(root, 'data/collected');
let collected: CollectedInput | undefined;
if (existsSync(join(collectedDir, 'texts.json')) && existsSync(join(collectedDir, 'lexicon.json'))) {
  collected = {
    texts: JSON.parse(readFileSync(join(collectedDir, 'texts.json'), 'utf8')),
    lexicon: JSON.parse(readFileSync(join(collectedDir, 'lexicon.json'), 'utf8')),
    sentences: existsSync(join(collectedDir, 'sentences.json')) ? JSON.parse(readFileSync(join(collectedDir, 'sentences.json'), 'utf8')) : [],
  };
} else console.warn('data/collected is missing: building from the study materials and authored data only.');
const ir = collected ? loadInteractive(join(root, 'data/authored/interactive'), collected.texts) : { sets: [], issues: [] };

const { data, report } = buildVocab(extraction, authored, paragraphs, errors, collected, ir.sets, ir.issues);
// The version is a hash of the content only, so an unchanged rebuild keeps the
// previous timestamp and writes identical files.
const body = JSON.stringify([{ ...data, version: '', generatedAt: '' }, { ...report, generatedAt: '' }]);
data.version = createHash('sha256').update(body).digest('hex').slice(0, 12);
const outFile = join(root, 'public/data/vocab.json');
if (existsSync(outFile)) {
  const previous = JSON.parse(readFileSync(outFile, 'utf8')) as { version?: string; generatedAt?: string };
  if (previous.version === data.version && previous.generatedAt) data.generatedAt = report.generatedAt = previous.generatedAt;
}

mkdirSync(join(root, 'public/data'), { recursive: true });
writeFileSync(outFile, JSON.stringify(data));
writeFileSync(join(root, 'public/data/import-report.json'), JSON.stringify({ ...report, version: data.version }, null, 1));
mkdirSync(join(root, 'data/generated'), { recursive: true });
writeFileSync(join(root, 'data/generated/import-report.md'), toMarkdown(report, data.version));

const t = report.totals;
const cs = report.collected;
if (cs) {
  console.log(`Deleted as unrealistic DET words: ${cs.deleted.length}; added from trusted lists: ${cs.added.count}`);
  console.log(`Sentences: ${cs.contextOrigins.collected} real, ${cs.contextOrigins.dictionary} WordNet, ${cs.contextOrigins.authored} written for the app`);
  console.log(`Read and Complete texts: ${JSON.stringify(cs.paragraphsByCorpus)} (from ${cs.paragraphCandidates} candidates); Interactive Reading sets: ${cs.interactiveSets}`);
  if (cs.interactiveIssues.length) console.log(`Interactive Reading issues:\n  ${cs.interactiveIssues.join('\n  ')}`);
}
console.log(`Sources: ${report.sources.map((s) => `${s.title} [${s.status}]`).join('; ')}`);
console.log(`Entries detected ${t.sourceEntriesDetected}, accepted ${t.sourceEntriesAccepted}, rejected ${t.rejectedEntries}`);
console.log(`Unique spelling targets ${t.uniqueSpellingTargets} (duplicates merged ${t.duplicatesMerged})`);
console.log(`Practice-ready ${t.practiceReady}; needing sentences ${t.needingSentences}; missing definitions ${t.missingDefinitions}`);
console.log(`Sentence contexts ${t.sentenceContexts}; paragraphs ${t.paragraphs} with ${t.paragraphGaps} gaps; Bengali glosses ${t.bengaliGlosses}`);
console.log(`Priority ${JSON.stringify(report.byPriority)}; difficulty ${JSON.stringify(report.byDifficulty)}; small words ${report.smallWords}`);
if (report.invalidSentences.length) console.log(`Invalid sentences: ${report.invalidSentences.length} (see data/generated/import-report.md)`);
if (report.authoredNotInSources.length) console.log(`Authored words not in any source (ignored): ${report.authoredNotInSources.join(', ')}`);
if (report.authoredDuplicates.length) console.log(`Duplicate authored lines: ${report.authoredDuplicates.join(', ')}`);
if (errors.length) console.log(`Authoring errors:\n  ${errors.join('\n  ')}`);
if (report.paragraphIssues.length) console.log(`Paragraph issues:\n  ${report.paragraphIssues.join('\n  ')}`);
const failed = t.failedSources + t.failedSections;
if (failed) console.error(`WARNING: ${t.failedSources} source(s) and ${t.failedSections} section(s) failed to import. See the report.`);
if (strict && (failed || t.needingSentences || t.missingDefinitions || report.invalidSentences.length || errors.length || cs?.interactiveIssues.length)) {
  console.error('Strict mode: the import is incomplete.');
  process.exit(1);
}

function toMarkdown(r: BuildReport, version: string): string {
  const t = r.totals;
  const lines: string[] = [];
  lines.push(`# Vocabulary import and validation report`, '', `Data version \`${version}\`, generated ${r.generatedAt}.`, '');
  lines.push('## Totals', '', '| Measure | Count |', '| --- | --- |');
  const rows: [string, number][] = [
    ['Source entries detected (with repeats)', t.sourceEntriesDetected],
    ['Entries accepted', t.sourceEntriesAccepted],
    ['Entries rejected (with reasons below)', t.rejectedEntries],
    ['Unique spelling targets imported', t.uniqueSpellingTargets],
    ['Duplicate entries merged', t.duplicatesMerged],
    ['Definitions taken from the study materials', t.definitionsFromSources],
    ['Entries with missing definitions', t.missingDefinitions],
    ['Words with a Bengali meaning', t.bengaliGlosses],
    ['Entries needing example sentences (fewer than 2 valid)', t.needingSentences],
    ['Practice-ready words (2+ distinct valid sentences)', t.practiceReady],
    ['Sentence contexts', t.sentenceContexts],
    ['Read and Complete paragraphs', t.paragraphs],
    ['Paragraph gaps', t.paragraphGaps],
    ['Total practice contexts', t.totalPracticeContexts],
    ['Failed sources', t.failedSources],
    ['Failed sections', t.failedSections],
  ];
  for (const [k, v] of rows) lines.push(`| ${k} | ${v} |`);
  lines.push('', `Priority: high ${r.byPriority.high}, medium ${r.byPriority.medium}, low ${r.byPriority.low}. Difficulty: easy ${r.byDifficulty.easy}, intermediate ${r.byDifficulty.intermediate}, advanced ${r.byDifficulty.advanced}. Small grammar words: ${r.smallWords}.`, '');
  lines.push('## Sources and sections', '');
  for (const s of r.sources) {
    lines.push(`### ${s.title} — ${s.status.toUpperCase()}`, '');
    if (s.error) lines.push(`**Error:** ${s.error}`, '');
    lines.push('| Section | Status | Accepted | Rejected |', '| --- | --- | --- | --- |');
    for (const sec of s.sections) lines.push(`| ${sec.label} | ${sec.status}${sec.error ? ` (${sec.error})` : ''} | ${sec.accepted} | ${sec.rejected} |`);
    lines.push('');
  }
  if (r.notes.length) lines.push('## Notes', '', ...r.notes.map((n) => `- ${n}`), '');
  if (r.collected) {
    const c = r.collected;
    const o = c.contextOrigins;
    lines.push('## Real collected material', '');
    lines.push('Sentences, Read and Complete texts and Interactive Reading passages come from real, openly licensed texts (see data/collected and scripts/collect/collect.py). Nothing is copied from live DET tests.', '');
    lines.push('| Measure | Count |', '| --- | --- |');
    lines.push(`| Sentences: real (collected) | ${o.collected} |`);
    lines.push(`| Sentences: WordNet examples | ${o.dictionary} |`);
    lines.push(`| Sentences: written for the app (only where too few real ones exist) | ${o.authored} |`);
    lines.push(`| Words practised only with real sentences | ${c.wordsWithOnlyCollected} |`);
    lines.push(`| Words added from trusted lists (NGSL, NAWL, CEFR-J, Octanove C1) | ${c.added.count} |`);
    lines.push(`| Words deleted as unrealistic DET words | ${c.deleted.length} |`);
    lines.push(`| Read and Complete texts | ${Object.entries(c.paragraphsByCorpus).map(([k, v]) => `${k} ${v}`).join(', ')} (from ${c.paragraphCandidates} candidates) |`);
    lines.push(`| Interactive Reading sets | ${c.interactiveSets} |`);
    lines.push(`| Definitions: study materials / WordNet / app | ${c.definitionOrigins.source ?? 0} / ${c.definitionOrigins.dictionary ?? 0} / ${c.definitionOrigins.app ?? 0} |`);
    lines.push(`| Bengali: app / Apertium dictionary / none | ${c.bengaliOrigins.app ?? 0} / ${c.bengaliOrigins.dictionary ?? 0} / ${c.bengaliOrigins.none ?? 0} |`);
    lines.push(`| Source texts used | ${c.texts} |`, '');
    lines.push(`Words added by level: ${Object.entries(c.added.byLevel).sort().map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
    lines.push('### Deleted words', '', '| Word | Reason |', '| --- | --- |');
    for (const x of c.deleted) lines.push(`| ${x.word} | ${x.reason} |`);
    lines.push('', '### Licences of the texts used', '');
    for (const [k, v] of Object.entries(c.licences)) lines.push(`- ${k}: ${v} texts`);
    lines.push('');
    if (c.interactiveIssues.length) lines.push('### Interactive Reading sets left out', '', ...c.interactiveIssues.map((x) => `- ${x}`), '');
  }
  lines.push('## Rejected entries', '', '| Entry | Section | Reason |', '| --- | --- | --- |');
  for (const x of r.rejected) lines.push(`| ${x.raw.replace(/\|/g, '/')} | ${x.sectionId} | ${x.reason} |`);
  lines.push('');
  const list = (title: string, items: string[]) => {
    lines.push(`## ${title} (${items.length})`, '', items.length ? items.join(', ') : 'None.', '');
  };
  list('Missing definitions', r.missingDefinitions);
  list('Needing example sentences', r.needingSentences);
  list('Authored lines for words not in any source (not imported)', r.authoredNotInSources);
  lines.push(`## Invalid sentences (${r.invalidSentences.length})`, '');
  for (const i of r.invalidSentences) lines.push(`- **${i.word}**: ${i.problem}`);
  lines.push('');
  if (r.paragraphIssues.length) lines.push('## Paragraph issues', '', ...r.paragraphIssues.map((x) => `- ${x}`), '');
  return lines.join('\n');
}
