import { Collector } from '../collector';
import { italics, ownText, requireSection, sections, splitTopLevel, tableRows } from '../markdown';
import type { Level } from '../normalize';

/**
 * Parser for "DET Reading: Strategy Guide and Vocabulary Bank".
 * Every bank, table and example list is read from the document text itself.
 */
export function parseGuide(md: string, c: Collector): void {
  const all = sections(md);

  // British forms first, so later sections can recognize them as variants.
  c.section('guide.bank6.american', 'Bank 6: American spelling for Read and Complete', () => {
    const s = requireSection(all, 'American spelling for Read and Complete');
    for (const [us, uk] of tableRows(s.body)) {
      const usList = splitTopLevel(us);
      const ukList = splitTopLevel(uk);
      if (usList.length !== ukList.length) throw new Error(`Row "${us}" has ${usList.length} US and ${ukList.length} UK forms`);
      usList.forEach((u, i) => c.ukForms.set(ukList[i].toLowerCase(), u.toLowerCase()));
      usList.forEach((u, i) =>
        c.add(u, { evidence: 'author-selection', ukVariant: ukList[i].toLowerCase(), tags: ['us-spelling', 'spelling-trap:us-uk-same-length'] }),
      );
    }
    const para = /blank count shows you the American one:\s*([^\n]+)/.exec(s.body);
    if (!para) throw new Error('"Where the two forms differ in length" list not found');
    for (const w of splitTopLevel(para[1].replace(/\.$/, ''))) {
      c.add(w, { evidence: 'author-selection', tags: ['us-spelling', 'spelling-trap:us-uk-different-length'] });
    }
  });

  // ---- Strategy prose: italic example words -------------------------------------------
  const vocabStart = md.indexOf('## Vocabulary bank');
  const strategy = vocabStart > 0 ? md.slice(0, vocabStart) : '';
  c.section('guide.strategy', 'Strategy sections: example words in the text', () => {
    if (!strategy) throw new Error('Strategy part of the guide not found');
    // "*hots* for *heats*": the first form is a trap shown as wrong.
    const traps = new Set<string>();
    for (const m of strategy.matchAll(/\*(\w+)\* for \*(\w+)\*/g)) traps.add(m[1].toLowerCase());
    const official = /Official (items|answers) include/;
    for (const para of strategy.split(/\n/)) {
      const ev = official.test(para) ? 'official' : 'strategy-example';
      for (const span of italics(para)) {
        for (const item of splitTopLevel(span, [',', ';'])) {
          const clean = item.replace(/^(and|or)\s+/i, '');
          if (/^-/.test(clean)) {
            c.reject(item, 'word ending, not a word');
            continue;
          }
          if (traps.has(clean.toLowerCase())) {
            c.reject(item, 'shown in the guide as a wrong form (trap)');
            continue;
          }
          c.addPhrase(clean, { evidence: ev, tags: ['strategy-example'] });
        }
      }
    }
  });

  // ---- Bank 1 -------------------------------------------------------------------------
  c.section('guide.bank1.ranked', 'Bank 1: small words ranked by gap count', () => {
    const s = requireSection(all, 'Bank 1');
    for (const [, cell] of tableRows(ownText(s))) {
      for (const group of cell.split(';').map((g) => g.trim())) {
        const more = /^(\d+) more words once each$/.exec(group);
        if (more) {
          c.notes.push(
            `Bank 1 says ${more[1]} more small words filled one gap each, but does not list them. They cannot be imported.`,
          );
          continue;
        }
        const each = /\((\d+) each\)\s*$/.exec(group);
        if (each) {
          const words = group.replace(each[0], '');
          for (const w of splitTopLevel(words)) c.add(w, { evidence: 'official', gapCount: +each[1], tags: ['small-word', 'bank1-ranked'] });
        } else {
          for (const item of splitTopLevel(group)) {
            const m = /^(\w+)\s*\((\d+)\)$/.exec(item);
            if (!m) throw new Error(`Cannot read Bank 1 item "${item}"`);
            c.add(m[1], { evidence: 'official', gapCount: +m[2], tags: ['small-word', 'bank1-ranked'] });
          }
        }
      }
    }
  });

  c.section('guide.bank1.lookup', 'Bank 1: look-up table (what you see → likely words)', () => {
    const s = requireSection(all, 'Look-up: what you see');
    for (const row of tableRows(s.body)) {
      for (const w of splitTopLevel(row[2])) c.add(w, { evidence: 'author-selection', tags: ['small-word', 'bank1-lookup'] });
    }
  });

  // ---- Bank 2 -------------------------------------------------------------------------
  c.section('guide.bank2.endings', 'Bank 2: word endings', () => {
    const s = requireSection(all, 'Bank 2');
    for (const [endings, makes, words] of tableRows(ownText(s))) {
      const endingTags = splitTopLevel(endings).map((e) => `ending:${e}`);
      for (const w of splitTopLevel(words)) c.add(w, { evidence: 'author-selection', tags: [...endingTags, `makes:${makes}`] });
    }
  });

  c.section('guide.bank2.rules', 'Bank 2: five spelling rules for endings (examples)', () => {
    const s = requireSection(all, 'Five spelling rules');
    const rulesText = s.body.split('\n').filter((l) => /^\d\.\s/.test(l));
    rulesText.forEach((line) => {
      const n = line[0];
      for (const m of line.matchAll(/\b([a-z]+) → ([a-z]+)\b/g)) {
        c.add(m[1], { evidence: 'author-selection', tags: [`spelling-rule:${n}`, 'rule-base'] });
        c.add(m[2], { evidence: 'author-selection', tags: [`spelling-rule:${n}`, 'rule-derived'] });
      }
    });
  });

  c.section('guide.bank2.irregular', 'Bank 2: irregular past forms', () => {
    const s = requireSection(all, 'Five spelling rules');
    const m = /\*\*Irregular past forms\*\* from the official paragraphs:\s*([^.]+)\.\s*Add\s*([^.]+)\./.exec(s.body);
    if (!m) throw new Error('Irregular past forms paragraph not found');
    for (const w of splitTopLevel(m[1])) c.add(w, { evidence: 'official', tags: ['irregular-form'] });
    for (const w of splitTopLevel(m[2])) c.add(w, { evidence: 'author-selection', tags: ['irregular-form'] });
  });

  // ---- Bank 3 -------------------------------------------------------------------------
  const levelSections: [string, string, Level][] = [
    ['Level 1: everyday words', 'guide.bank3.level1', 'easy'],
    ['Level 2: mid-level words', 'guide.bank3.level2', 'intermediate'],
  ];
  for (const [prefix, id, level] of levelSections) {
    c.section(id, `Bank 3: ${prefix}`, () => {
      const s = requireSection(all, prefix);
      for (const [, words] of tableRows(s.body)) {
        for (const w of splitTopLevel(words)) c.add(w, { evidence: 'official', level, tags: ['rc-official', 'bank3'] });
      }
    });
  }
  c.section('guide.bank3.level3', 'Bank 3: Level 3: harder words', () => {
    const s = requireSection(all, 'Level 3: harder words');
    for (const [w, meaning] of tableRows(s.body)) {
      c.add(w, { evidence: 'official', level: 'advanced', definition: meaning, tags: ['rc-official', 'bank3'] });
    }
  });

  // ---- Bank 4 -------------------------------------------------------------------------
  c.section('guide.bank4.topics', 'Bank 4: topic vocabulary', () => {
    const s = requireSection(all, 'Bank 4');
    for (const [topic, words] of tableRows(s.body)) {
      for (const w of splitTopLevel(words)) c.add(w, { evidence: 'author-selection', tags: [`topic:${topic}`] });
    }
  });

  // ---- Bank 5 -------------------------------------------------------------------------
  c.section('guide.bank5.easy', 'Bank 5: easy official Fill in the Blanks answers', () => {
    const s = requireSection(all, 'Bank 5');
    const m = /\*\*Easy official answers:\*\*\s*([^\n]+)/.exec(s.body);
    if (!m) throw new Error('Easy official answers list not found');
    for (const w of splitTopLevel(m[1].replace(/\.$/, ''))) c.add(w, { evidence: 'official', level: 'easy', tags: ['fib-official'] });
  });
  c.section('guide.bank5.harder', 'Bank 5: harder official Fill in the Blanks answers', () => {
    const s = requireSection(all, 'Harder official answers');
    for (const [w, meaning, clue] of tableRows(s.body)) {
      c.add(w, { evidence: 'official', level: 'advanced', definition: meaning, collocation: clue, tags: ['fib-official'] });
    }
  });
  c.section('guide.bank5.more', 'Bank 5: 120 more words at the same level', () => {
    const s = requireSection(all, '120 more words');
    for (const [w, meaning, partner] of tableRows(s.body)) {
      c.add(w, { evidence: 'author-selection', level: 'advanced', definition: meaning, collocation: partner, tags: ['fib-level'] });
    }
  });

  // ---- Bank 6 -------------------------------------------------------------------------
  c.section('guide.bank6.misspell', 'Bank 6: words people misspell', () => {
    const s = requireSection(all, 'Words people misspell');
    for (const [trap, words] of tableRows(s.body)) {
      const tag = `spelling-trap:${trap.toLowerCase().replace(/\s+/g, '-')}`;
      for (const w of splitTopLevel(words)) c.add(w, { evidence: 'author-selection', tags: [tag] });
    }
  });
  c.section('guide.bank6.pairs', 'Bank 6: pairs that get swapped', () => {
    const s = requireSection(all, 'Pairs that get swapped');
    const m = /before you type:\s*([^\n]+)/.exec(s.body);
    if (!m) throw new Error('Swapped pairs list not found');
    for (const pair of splitTopLevel(m[1].replace(/\.$/, ''))) {
      const words = pair.split('/').map((x) => x.trim());
      for (const w of words) {
        const others = words.filter((o) => o !== w).map((o) => o.replace(/\s*\(.*\)$/, ''));
        c.add(w, { evidence: 'author-selection', tags: ['confusable', ...others.map((o) => `confusable-with:${o.toLowerCase()}`)] });
      }
    }
  });
}
