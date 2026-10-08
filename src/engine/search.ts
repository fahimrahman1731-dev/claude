import type { VocabWord } from './types';

export type SearchBy = 'word' | 'prefix' | 'suffix' | 'bengali' | 'meaning';

/**
 * Library search. English searches are case-insensitive; prefixes and
 * suffixes may be typed with a hyphen ("un-", "-tion"). Exact matches come
 * first, then words that start with the search, then the rest A–Z.
 */
export function searchWords(words: VocabWord[], query: string, by: SearchBy): VocabWord[] {
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return words.slice().sort((a, b) => a.word.localeCompare(b.word));
  const match = (w: VocabWord): boolean => {
    switch (by) {
      case 'word':
        return w.word.includes(q);
      case 'prefix':
        return w.word.startsWith(q.replace(/-$/, ''));
      case 'suffix':
        return w.word.endsWith(q.replace(/^-/, ''));
      case 'bengali':
        return (w.bengali ?? '').includes(raw);
      case 'meaning':
        return w.definition.toLowerCase().includes(q) || w.sourceDefinitions.some((d) => d.toLowerCase().includes(q));
    }
  };
  const rank = (w: VocabWord) => (by !== 'word' ? 2 : w.word === q ? 0 : w.word.startsWith(q) ? 1 : 2);
  return words.filter(match).sort((a, b) => rank(a) - rank(b) || a.word.localeCompare(b.word));
}
