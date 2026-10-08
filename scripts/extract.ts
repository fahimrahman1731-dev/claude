/**
 * Step 1 of the data pipeline: read the study documents listed in
 * data/sources/manifest.json and write every detected entry, rejection and
 * per-section count to data/generated/extracted.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractAll, type SourceManifestEntry } from './lib/extract-lib';

const root = join(import.meta.dirname, '..');
const srcDir = join(root, 'data/sources');
const manifest: SourceManifestEntry[] = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));
const result = extractAll(manifest, (f) => readFileSync(join(srcDir, f), 'utf8'));
mkdirSync(join(root, 'data/generated'), { recursive: true });
writeFileSync(join(root, 'data/generated/extracted.json'), JSON.stringify(result, null, 1));

for (const s of result.sources) {
  console.log(`\n${s.title} [${s.status}]${s.error ? ' ERROR: ' + s.error : ''}`);
  for (const sec of s.sections) {
    console.log(`  ${sec.status === 'ok' ? '✓' : '✗'} ${sec.label}: ${sec.accepted} accepted, ${sec.rejected} rejected${sec.error ? ' — ' + sec.error : ''}`);
  }
  for (const n of s.notes) console.log(`  note: ${n}`);
}
console.log(`\nEntries accepted: ${result.entries.length}, rejected: ${result.rejected.length}`);
console.log(`Unique spellings: ${result.words.length} (duplicates merged: ${result.duplicatesMerged})`);
