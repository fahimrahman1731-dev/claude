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
import { buildVocab, type BuildReport } from './lib/build-lib';
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

const { data, report } = buildVocab(extraction, authored, paragraphs, errors);
const body = JSON.stringify({ ...data, version: '' });
data.version = createHash('sha256').update(body).digest('hex').slice(0, 12);

mkdirSync(join(root, 'public/data'), { recursive: true });
writeFileSync(join(root, 'public/data/vocab.json'), JSON.stringify(data));
writeFileSync(join(root, 'public/data/import-report.json'), JSON.stringify({ ...report, version: data.version }, null, 1));
mkdirSync(join(root, 'data/generated'), { recursive: true });
writeFileSync(join(root, 'data/generated/import-report.md'), toMarkdown(report, data.version));

const t = report.totals;
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
if (strict && (failed || t.needingSentences || t.missingDefinitions || report.invalidSentences.length || errors.length)) {
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
    ['Definitions written for the app (source had none)', t.definitionsWrittenForApp],
    ['Entries with missing definitions', t.missingDefinitions],
    ['Bengali glosses (written for the app; sources have none)', t.bengaliGlosses],
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
