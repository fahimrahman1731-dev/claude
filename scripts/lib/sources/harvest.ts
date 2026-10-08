import { Collector } from '../collector';
import { bullets, italics, ownText, requireSection, sections, splitTopLevel, stripFootnotes, tableRows } from '../markdown';
import { isSpellingVariant, type Level } from '../normalize';

/** Comma lists in parentheses where every item is one lowercase word: "(walked, stumbled, flickered)". */
function parentheticalWordLists(text: string): string[][] {
  const out: string[][] = [];
  for (const m of text.matchAll(/\(([^()]+)\)/g)) {
    const items = m[1].split(',').map((x) => x.trim());
    if (items.length >= 2 && items.every((x) => /^[a-z]+$/.test(x))) out.push(items);
  }
  return out;
}

/**
 * Parser for "DET Reading Vocabulary Harvest, Part 2 (2026)".
 */
export function parseHarvest(md: string, c: Collector): void {
  const all = sections(md);

  // UK forms named anywhere as "(UK: x)" become accepted variants, not targets.
  for (const m of md.matchAll(/([a-z]+)\s*\(UK(?: also)?:\s*([a-z]+)/g)) {
    if (m[1] !== m[2] && isSpellingVariant(m[1], m[2])) c.ukForms.set(m[2], m[1]);
  }
  c.knownBad.set('miniscule', 'misspelling shown as a trap; the correct spelling "minuscule" is imported instead');
  c.knownBad.set('evidences', 'non-standard plural shown as a trap ("evidence" is uncountable)');
  c.ukForms.set('grey', 'gray');
  c.ukForms.set('organising', 'organizing');

  c.section('harvest.keyfindings', 'Key Findings: example words', () => {
    const s = requireSection(all, 'Key Findings');
    for (const list of parentheticalWordLists(s.body)) {
      for (const w of list) c.add(w, { evidence: 'official', tags: ['strategy-example'] });
    }
    for (const span of italics(s.body)) {
      for (const item of splitTopLevel(span, [',', ';', '/'])) c.addPhrase(item, { evidence: 'official', tags: ['strategy-example'] });
    }
  });

  c.section('harvest.1a', 'Vol 4 Fill in the Blanks: all 45 answers', () => {
    const s = requireSection(all, '1A.');
    for (const [num, answer, clue, meaning] of tableRows(s.body)) {
      const n = +num;
      const level: Level = n <= 10 ? 'easy' : n <= 32 ? 'intermediate' : 'advanced';
      const def = meaning.replace(/★/g, '').trim() || undefined;
      c.add(answer, { evidence: 'official', level, definition: def, collocation: clue, tags: ['fib-official', `vol4-fib:${n}`] });
    }
  });

  c.section('harvest.1b', 'Vol 4 Read and Complete: content-word answers by passage', () => {
    const s = requireSection(all, '1B.');
    const lines = s.body.split('\n').filter((l) => /^\d+\s/.test(l));
    if (lines.length !== 30) throw new Error(`Expected 30 passages, found ${lines.length}`);
    for (const line of lines) {
      const m = /^(\d+)\s+(.*?)\s*\(((?:[^()]|\([^()]*\))*)\):\s*(.*)$/.exec(line);
      if (!m) throw new Error(`Cannot read passage line "${line.slice(0, 60)}"`);
      const [, num, title, topic, rest] = m;
      const body = rest.split('**Note:**')[0];
      for (const item of splitTopLevel(body)) {
        c.add(item, { evidence: 'official', tags: ['rc-official', `vol4-rc:${num}`, `passage:${title}`, `topic:${topic.replace(/\s*\(UK.*\)$/, '')}`] });
      }
    }
  });

  c.section('harvest.1c', 'Vol 4 Interactive Reading: answers and trap options', () => {
    const s = requireSection(all, '1C.');
    let set = '';
    for (const [setCell, answer, traps, why] of tableRows(s.body)) {
      if (setCell) set = setCell;
      const ans = c.add(answer, { evidence: 'official', collocation: why, tags: ['ir-answer', `ir-set:${set}`] });
      for (const t of splitTopLevel(traps)) {
        c.add(t, { evidence: 'distractor', tags: ['ir-distractor', ...(ans ? [`distractor-for:${ans}`] : [])] });
      }
      for (const m of why.matchAll(/correct spelling:\s*([a-z]+)/g)) {
        c.add(m[1], { evidence: 'distractor', note: 'correct spelling of the trap option "miniscule"', tags: ['ir-distractor', 'spelling-trap:commonly-misspelled'] });
      }
    }
  });

  c.section('harvest.section2', 'Section 2: words recurring across sources', () => {
    const s = requireSection(all, 'Section 2');
    for (const b of bullets(s.body)) {
      const label = /^\*\*(.+?)\*\*\s*/.exec(b);
      const rest = label ? b.slice(label[0].length) : b;
      const countMatch = label ? /^(\d+) sources/.exec(label[1]) : null;
      const items = countMatch ? splitTopLevel(rest, [';']) : splitTopLevel(rest, [',']);
      for (const item of items) {
        const pm = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(item);
        const words = (pm ? pm[1] : item).trim();
        const srcCount = countMatch ? +countMatch[1] : pm ? pm[2].split(/[;,]/).length : 1;
        for (let w of words.split('/')) {
          w = w.trim();
          const plural = /^(\w+)\(s\)$/.exec(w);
          const forms = plural ? [plural[1], plural[1] + 's'] : [w];
          for (const f of forms) {
            c.add(f, {
              evidence: 'recurring',
              recurringSources: srcCount,
              tags: [countMatch ? `recurring:${countMatch[1]}-sources` : 'recurring:vol4-repeated'],
            });
          }
        }
      }
    }
  });

  c.section('harvest.section3', 'Section 3: third-party answer words by topic', () => {
    const s = requireSection(all, 'Section 3');
    for (const b of bullets(ownText(s))) {
      const label = /^\*\*(.+?):\*\*\s*/.exec(b);
      if (!label) continue;
      for (const item of splitTopLevel(stripFootnotes(b.slice(label[0].length)))) {
        c.add(item, { evidence: 'third-party', tags: [`topic:${label[1]}`, ...(label[1].startsWith('Connectors') ? ['connector'] : [])] });
      }
    }
  });

  c.section('harvest.best-estimate', 'Best-estimate topic list (not harvested from any DET item)', () => {
    const s = requireSection(all, 'Best-estimate topic list');
    for (const b of bullets(s.body)) {
      const label = /^\*\*(.+?):\*\*\s*/.exec(b);
      if (!label) continue;
      for (const item of splitTopLevel(b.slice(label[0].length))) {
        c.add(item, { evidence: 'best-estimate', tags: [`topic:${label[1]}`] });
      }
    }
  });

  c.section('harvest.section4', 'Section 4: Fill in the Blanks meanings and collocates', () => {
    const s = requireSection(all, 'Section 4');
    for (const b of bullets(s.body)) {
      const m = /^(\w+)(?:\s*\(([^)]+)\))?\s*–\s*([^;]+);\s*(.*)$/.exec(stripFootnotes(b));
      if (!m) throw new Error(`Cannot read meaning line "${b}"`);
      const [, w, src, meaning, colloc] = m;
      const ev = !src || src === 'Handbook' ? 'official' : 'third-party';
      c.add(w, { evidence: ev, definition: meaning.trim(), collocation: colloc.replace(/\*/g, '').trim(), tags: ['fib-meaning'] });
    }
  });

  c.section('harvest.section5', 'Section 5: other Complete the Sentences examples', () => {
    const s = requireSection(all, 'Section 5');
    for (const span of italics(s.body)) for (const w of splitTopLevel(span)) c.add(w, { evidence: 'third-party', tags: ['ir-answer'] });
    for (const m of s.body.matchAll(/\*\*(\w+)\*\* ✔ vs ([a-z, ]+)/g)) {
      c.add(m[1], { evidence: 'third-party', tags: ['ir-answer'] });
      for (const t of splitTopLevel(m[2])) c.add(t, { evidence: 'distractor', tags: ['ir-distractor', `distractor-for:${m[1]}`] });
    }
  });

  c.section('harvest.strategy', 'Additional Strategy Points: example words', () => {
    const s = requireSection(all, 'Additional Strategy Points');
    for (const list of parentheticalWordLists(s.body)) for (const w of list) c.add(w, { evidence: 'strategy-example', tags: ['strategy-example'] });
    for (const span of italics(s.body)) {
      for (const item of splitTopLevel(span, [','])) c.addPhrase(item, { evidence: 'strategy-example', tags: ['strategy-example'] });
    }
  });

  c.section('harvest.us-card', 'Recommendations: US spelling card', () => {
    const s = requireSection(all, 'Recommendations');
    const m = /\(([a-z, ]+)\), and ([a-z, ]+)\./.exec(s.body);
    if (!m) throw new Error('US spelling card list not found');
    for (const w of [...splitTopLevel(m[1]), ...splitTopLevel(m[2])]) c.add(w, { evidence: 'author-selection', tags: ['us-spelling'] });
  });
}
