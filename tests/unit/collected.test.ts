import { describe, expect, it } from 'vitest';
import { BRITISH_WORDS, US_UK } from '../../scripts/lib/build-lib';
import { checkFibSentence, isSensitive, paragraphWindows, splitSentences } from '../../scripts/lib/collected';
import { deletionReason, isBritishSpelling, pickContexts, sentenceIndex, type Lexicon } from '../../scripts/lib/enrich';
import { vocab } from '../functional/env';

describe('real-text sentences', () => {
  it('splits sentences without breaking at abbreviations or decimals', () => {
    const t = 'Dr. Lee measured 3.5 litres of water. It was enough! Was it, e.g. for the test? Yes.';
    const s = splitSentences(t).map((x) => t.slice(x.start, x.end));
    expect(s).toEqual(['Dr. Lee measured 3.5 litres of water.', 'It was enough!', 'Was it, e.g. for the test?', 'Yes.']);
  });
  it('keeps only complete, stand-alone, DET-like sentences', () => {
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
  });
});

describe('real sentences for each word', () => {
  it('prefers real sentences from different texts and falls back to app sentences only when needed', () => {
    const texts = [
      { id: 't1', corpus: 'clear', title: 'A', license: 'CC BY 4.0', credit: 'A', genre: 'expository' as const, topic: 'x', difficulty: 'easy' as const, text: 'Farmers water their crops early in the morning before the sun gets hot.' },
      { id: 't2', corpus: 'ose', title: 'B', license: 'CC BY-SA 4.0', credit: 'B', genre: 'expository' as const, topic: 'x', difficulty: 'easy' as const, text: 'Many plants need water every day to grow strong and healthy roots.' },
    ];
    const index = sentenceIndex(texts);
    const pick = pickContexts('water', 'w:water', index, {}, ['The children drank cold water after the long football match.']);
    expect(pick.collected).toBe(2);
    expect(pick.authored).toBe(0);
    expect(new Set(pick.contexts.map((c) => c.src))).toEqual(new Set(['t1', 't2']));
    const fallback = pickContexts('crops', 'w:crops', index, {}, ['Rain helps the crops grow in the dry fields near the village.']);
    expect(fallback.collected).toBe(1);
    expect(fallback.authored).toBe(1);
  });
  it('most practice sentences in the shipped data are real', () => {
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
