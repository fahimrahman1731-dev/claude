/**
 * Checks Interactive Reading set files against the DET rules and their sources.
 *
 *   npx tsx scripts/validate-interactive.ts data/authored/interactive/batch-01.json [...]
 *
 * Prints every problem and exits with an error when any set is invalid.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectedText } from './lib/collected';
import { validateInteractive, type AuthoredInteractive } from './lib/interactive-build';

const root = join(import.meta.dirname, '..');
const texts: CollectedText[] = JSON.parse(readFileSync(join(root, 'data/collected/texts.json'), 'utf8'));
const byId = new Map(texts.map((t) => [t.id, t]));
let bad = 0;
let ok = 0;
for (const f of process.argv.slice(2)) {
  let items: AuthoredInteractive[];
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    items = Array.isArray(raw) ? raw : [raw];
  } catch (e) {
    console.log(`${f}: not valid JSON: ${e instanceof Error ? e.message : e}`);
    bad++;
    continue;
  }
  for (const a of items) {
    const src = byId.get(a.sourceId);
    if (!src && !a.source) {
      console.log(`${f} ${a.id}: unknown sourceId ${a.sourceId}`);
      bad++;
      continue;
    }
    const r = validateInteractive(a, src?.text);
    if (r.problems.length) {
      bad++;
      console.log(`${f} ${a.id}:\n  - ${r.problems.join('\n  - ')}`);
    } else ok++;
  }
}
console.log(`${ok} valid, ${bad} with problems`);
process.exit(bad ? 1 : 0);
