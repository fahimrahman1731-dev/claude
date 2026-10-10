import { describe, expect, it } from 'vitest';
import { BRITISH_WORDS, selectGaps, US_UK } from '../../scripts/lib/build-lib';
import { checkFibSentence, isSensitive, paragraphWindows, splitSentences } from '../../scripts/lib/collected';
import { sentenceAt } from '../../src/engine/sentences';
import { findOccurrences } from '../../src/engine/text';
import type { VocabWord } from '../../src/engine/types';
import { deletionReason, isBritishSpelling, pickContexts, sentenceIndex, type Lexicon } from '../../scripts/lib/enrich';
import { vocab } from '../functional/env';

describe('real-text sentences', () => {
  it('splits sentences without breaking at abbreviations or decimals', () => {
    const t = 'Dr. Lee measured 3.5 litres of water. It was enough! Was it, e.g. for the test? Yes.';
    const s = splitSentences(t).map((x) => t.slice(x.start, x.end));
    expect(s).toEqual(['Dr. Lee measured 3.5 litres of water.', 'It was enough!', 'Was it, e.g. for the test?', 'Yes.']);
  });
  it('never joins a heading or list item to the next sentence', () => {
    const t = 'Five jobs\n\n4. Eel ecologist\n\nThe job is to help eels survive. It is hard work.';
    const s = splitSentences(t).map((x) => ({ text: t.slice(x.start, x.end), open: !!x.open }));
    expect(s).toEqual([
      { text: 'Five jobs', open: true },
      { text: '4.', open: false },
      { text: 'Eel ecologist', open: true },
      { text: 'The job is to help eels survive.', open: false },
      { text: 'It is hard work.', open: false },
    ]);
  });
  it('finds the whole sentence around a word, even with initials, and where the word is', () => {
    const t = 'The most obvious difference between the fossils, A. africanus and P. robustus, is that one is larger. It was found later.';
    const at = t.indexOf('that');
    const r = sentenceAt(t, at, at + 4);
    expect(r.sentence).toBe('The most obvious difference between the fossils, A. africanus and P. robustus, is that one is larger.');
    expect(r.sentence.slice(r.at, r.at + 4)).toBe('that');
  });
  it('does not find a short word inside an accented name', () => {
    expect(findOccurrences('Émile walked a mile.', 'mile')).toEqual([{ start: 15, end: 19 }]);
  });
  it('keeps only complete, stand-alone, DET-like sentences', () => {
    expect(checkFibSentence('The chess played is speed chess. Each competitor has twelve minutes to finish.').reason).toBe('more than one sentence');
    expect(checkFibSentence('An energy-level diagram of the atomic transitions is shown in ⟦REF⟧ below.').ok).toBe(false);
    expect(checkFibSentence('As a functionalist, Émile Durkheim stressed how the parts of society work together.').reason).toBe('unusual characters');
    expect(checkFibSentence('Scientists measured how quickly the ice melted during the warm summer months.').ok).toBe(true);
    expect(checkFibSentence('She had a beautiful necklace around her neck at the party.').ok).toBe(true);
    expect(checkFibSentence('Too short to use.').reason).toBe('too short');
    expect(checkFibSentence('However, the results of the second experiment were very different from the first.').reason).toBe('depends on the previous sentence');
    expect(checkFibSentence('The soldiers fought a long battle near the river in the cold winter.').reason).toBe('sensitive topic');
    expect(checkFibSentence('The team (led by a young engineer) designed a lighter and stronger bridge.').reason).toBe('brackets, symbols or links');
    expect(checkFibSentence('The manager said “we are very happy” about the result of the match.').reason).toBe('quotation');
  });
  it('filters topics the DET avoids', () => {
    expect(isSensitive('The police arrested a criminal.')).toBe(true);
    expect(isSensitive('The election results were announced.')).toBe(true);
    expect(isSensitive('Bees carry pollen from flower to flower.')).toBe(false);
    for (const t of ['The consul was held hostage at gunpoint.', 'Jesus preached on the mountain.', 'They stood up against racism.', 'She began to pray.'])
      expect(isSensitive(t), t).toBe(true);
    expect(isSensitive('The results demonstrate that the shell is hard.')).toBe(false);
  });
  it('cuts Read and Complete texts at sentence boundaries', () => {
    const text = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} about plants and how they grow in spring.`).join(' ');
    for (const w of paragraphWindows(text, { minWords: 50, maxWords: 100, minSentences: 4, maxSentences: 7 })) {
      const piece = text.slice(w.start, w.end);
      expect(piece.endsWith('.')).toBe(true);
      expect(piece.split(/\s+/).length).toBeLessThanOrEqual(100);
    }
  });
});

describe('Read and Complete gaps', () => {
  const word = (w: string): VocabWord => ({ id: `w:${w}`, word: w, tags: [] }) as unknown as VocabWord;
  const byWord = new Map(['on', 'in', 'society', 'people', 'music', 'the', 'and', 'more', 'than'].map((w) => [w, word(w)]));
  it('keeps the first and last sentences whole even with abbreviations and prices', () => {
    const text = 'People in the U.S. spent just $39.52 on music in 2014 and more on society. The people in the city and the people in the town like music more than ever. Then the society changed again in the U.S. and in society.';
    const gaps = selectGaps(text, byWord);
    const first = text.indexOf('. The people') + 1;
    const last = text.indexOf('Then the society');
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect(g.start).toBeGreaterThan(first);
      expect(g.end).toBeLessThanOrEqual(last);
    }
  });
});

describe('which words stay', () => {
  const lex: Lexicon = {
    hullabaloo: { z: 2.3 },
    toil: { z: 3.0, cefr: 'B2' },
    jots: { z: 1.6 },
    fluctuate: { z: 2.99, cefr: 'C2' },
    planet: { z: 4.6, cefr: 'A2', lists: ['ngsl'] },
    exacerbation: { z: 2.3 },
  };
  it('deletes rare trap words, C2-only and very rare unofficial words, and British-only words', () => {
    expect(deletionReason({ word: 'hullabaloo', evidence: ['official', 'distractor'], tags: [] }, lex, BRITISH_WORDS)).toMatch(/only as a wrong option/);
    expect(deletionReason({ word: 'fluctuate', evidence: ['author-selection'], tags: [] }, lex, BRITISH_WORDS)).toMatch(/C2/);
    expect(deletionReason({ word: 'exacerbation', evidence: ['third-party'], tags: [] }, lex, BRITISH_WORDS)).toMatch(/very rare/);
    expect(deletionReason({ word: 'kerb', evidence: ['official'], tags: [] }, lex, BRITISH_WORDS)).toMatch(/British/);
  });
  it('keeps official DET answer words however rare, small words and spelling traps', () => {
    expect(deletionReason({ word: 'jots', evidence: ['official'], tags: [] }, lex, BRITISH_WORDS)).toBeUndefined();
    expect(deletionReason({ word: 'toil', evidence: ['official'], tags: [] }, lex, BRITISH_WORDS)).toBeUndefined();
    expect(deletionReason({ word: 'the', evidence: [], tags: [] }, lex, BRITISH_WORDS)).toBeUndefined();
    expect(deletionReason({ word: 'minuscule', evidence: ['distractor'], tags: ['spelling-trap:commonly-misspelled'] }, { minuscule: { z: 2.99 } }, BRITISH_WORDS)).toBeUndefined();
    expect(deletionReason({ word: 'planet', evidence: ['best-estimate'], tags: [] }, lex, BRITISH_WORDS)).toBeUndefined();
  });
  it('never adds British spellings from the word lists', () => {
    const l: Lexicon = { colour: { z: 4 }, color: { z: 4.5 }, organise: { z: 3 }, organize: { z: 3.6 }, centre: { z: 4.3 }, center: { z: 4.8 }, planet: { z: 4.6 } };
    expect(isBritishSpelling('colour', l, US_UK)).toBe(true);
    expect(isBritishSpelling('organise', l, US_UK)).toBe(true);
    expect(isBritishSpelling('centre', l, US_UK)).toBe(true);
    expect(isBritishSpelling('aeroplane', l, US_UK)).toBe(true);
    expect(isBritishSpelling('planet', l, US_UK)).toBe(false);
    for (const w of ['learnt', 'maths', 'savour', 'tonnes', 'acknowledgement', 'whilst']) expect(isBritishSpelling(w, l, US_UK), w).toBe(true);
  });
});

describe('real sentences for each word', () => {
  it('prefers real sentences from different texts and falls back to app sentences only when needed', () => {
    const texts = [
      { id: 't1', corpus: 'clear', title: 'A', license: 'CC BY 4.0', credit: 'A', genre: 'expository' as const, topic: 'x', difficulty: 'easy' as const, text: 'Farmers water their crops early in the morning before the sun gets hot.' },
      { id: 't2', corpus: 'ose', title: 'B', license: 'CC BY-SA 4.0', credit: 'B', genre: 'expository' as const, topic: 'x', difficulty: 'easy' as const, text: 'Many plants need water every day to grow strong and healthy roots.' },
    ];
    const index = sentenceIndex(texts);
    // The app ships one sentence per word: by default one real sentence is picked.
    const one = pickContexts('water', 'w:water', index, {}, ['The children drank cold water after the long football match.']);
    expect(one.contexts).toHaveLength(1);
    expect(one.collected).toBe(1);
    expect(one.authored).toBe(0);
    expect(['t1', 't2']).toContain(one.contexts[0].src);
    // More can be asked for: they come from different texts.
    const pick = pickContexts('water', 'w:water', index, {}, ['The children drank cold water after the long football match.'], 2);
    expect(pick.collected).toBe(2);
    expect(pick.authored).toBe(0);
    expect(new Set(pick.contexts.map((c) => c.src))).toEqual(new Set(['t1', 't2']));
    const authored = ['Rain helps the crops grow in the dry fields near the village.'];
    const real = pickContexts('crops', 'w:crops', index, {}, authored);
    expect(real.contexts).toHaveLength(1);
    expect(real.collected).toBe(1);
    expect(real.authored).toBe(0);
    const fallback = pickContexts('crops', 'w:crops', index, {}, authored, 2);
    expect(fallback.collected).toBe(1);
    expect(fallback.authored).toBe(1);
    // A word with no real sentence gets the app's own sentence.
    const only = pickContexts('village', 'w:village', index, {}, authored);
    expect(only.contexts.map((c) => c.origin)).toEqual(['authored']);
  });
  it('most practice sentences in the shipped data are real, one per word', () => {
    for (const w of vocab.words) expect(w.contexts, w.word).toHaveLength(1);
    let real = 0;
    let all = 0;
    for (const w of vocab.words)
      for (const c of w.contexts) {
        all++;
        if (c.origin === 'collected') real++;
      }
    expect(real / all).toBeGreaterThan(0.9);
    // every collected sentence names its source
    for (const w of vocab.words) for (const c of w.contexts) if (c.origin === 'collected') expect(c.src).toBeTruthy();
  });
});

describe('one good sentence per word in the shipped data', () => {
  const first = vocab.words.map((w) => ({ w, c: w.contexts[0] }));
  it('almost every word has a sentence no other word uses', () => {
    const count = new Map<string, number>();
    for (const { c } of first) count.set(c.sentence, (count.get(c.sentence) ?? 0) + 1);
    const shared = [...count.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);
    expect(shared).toBeLessThanOrEqual(10);
  });
  it('no sentence leans on missing context, talks to the reader, or gives the answer away', () => {
    for (const { w, c } of first) {
      expect(c.sentence, w.word).not.toMatch(/^(For (example|instance)|In (addition|other words|this case)|As a result|After all|Let['’]s)\b/);
      expect(c.sentence, w.word).not.toMatch(/\b(this|the following) (chapter|section|table|article)\b/i);
      expect(c.start, w.word).toBeGreaterThan(0);
      if (w.word.length < 5)
        for (const m of c.sentence.matchAll(/[A-Za-z]+/g))
          if (m.index !== c.start) expect(m[0].toLowerCase().startsWith(w.word) && m[0].length > w.word.length, `${w.word}: ${c.sentence}`).toBe(false);
    }
  });
  it('reference lists are never used as sentences', () => {
    const titles = new Map((vocab.texts ?? []).map((t) => [t.id, t.title]));
    for (const { w, c } of first) if (c.src) expect(titles.get(c.src) ?? '', w.word).not.toMatch(/^(references|bibliography)$/i);
  });
});

