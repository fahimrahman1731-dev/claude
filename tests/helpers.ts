import { checkContext } from '../src/engine/validate';
import type { VocabWord } from '../src/engine/types';
import { isFunctionWord } from '../src/engine/morphology';

/** Builds a small vocabulary word with real, validated contexts for tests. */
export function makeWord(word: string, sentences: string[], extra: Partial<VocabWord> = {}): VocabWord {
  const id = `w:${word}`;
  const contexts = sentences.map((s) => {
    const c = checkContext(s, word, id, 'authored');
    if (!c.context) throw new Error(`bad test sentence for ${word}: ${c.errors.join(', ')}`);
    return c.context;
  });
  return {
    id,
    word,
    pos: ['n'],
    definition: `definition of ${word}`,
    definitionOrigin: 'app',
    sourceDefinitions: [],
    family: word,
    difficulty: 'easy',
    basePriority: 'medium',
    evidenceScore: 4,
    evidence: ['official'],
    sources: ['guide'],
    sections: ['test'],
    tags: [],
    collocations: [],
    ukVariants: [],
    notes: [],
    isSmallWord: isFunctionWord(word),
    isCustom: false,
    contexts,
    ...extra,
  };
}

/** Deterministic random numbers. */
export function seqRng(values: number[] = [0]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}
