import type { Context, InteractiveSet, Paragraph, TextSource, VocabData, VocabWord } from '../engine/types';

/**
 * In-memory view of the vocabulary: the imported dataset (read-only, shipped
 * with the app) plus the student's custom words and any cached AI sentences.
 * Custom words stay separate (isCustom) but practice like any other word.
 */
export class VocabStore {
  readonly words: VocabWord[];
  readonly byId: Map<string, VocabWord>;
  readonly byWord: Map<string, VocabWord>;
  readonly families: Map<string, VocabWord[]>;
  readonly paragraphs: Paragraph[];
  readonly interactive: InteractiveSet[];
  /** Real texts used for sentences and passages, with attribution. */
  readonly texts: Map<string, TextSource>;
  readonly importedCount: number;

  constructor(
    readonly data: VocabData,
    custom: VocabWord[] = [],
    extraContexts: Context[] = [],
  ) {
    const extra = new Map<string, Context[]>();
    for (const c of extraContexts) extra.set(c.wordId, [...(extra.get(c.wordId) ?? []), c]);
    const withExtra = (w: VocabWord): VocabWord => {
      const more = extra.get(w.id);
      if (!more?.length) return w;
      const ids = new Set(w.contexts.map((c) => c.id));
      return { ...w, contexts: [...w.contexts, ...more.filter((c) => !ids.has(c.id))] };
    };
    this.words = [...data.words.map(withExtra), ...custom.map(withExtra)];
    this.importedCount = data.words.length;
    this.byId = new Map(this.words.map((w) => [w.id, w]));
    this.byWord = new Map(this.words.map((w) => [w.word, w]));
    this.families = new Map();
    for (const w of this.words) {
      const list = this.families.get(w.family) ?? [];
      list.push(w);
      this.families.set(w.family, list);
    }
    this.paragraphs = data.paragraphs;
    this.interactive = data.interactive ?? [];
    this.texts = new Map((data.texts ?? []).map((t) => [t.id, t]));
  }

  /** Attribution for a sentence's source id ('wordnet' or a text id). */
  credit(src: string | undefined): { label: string; url?: string } | undefined {
    if (!src) return undefined;
    if (src === 'wordnet') return { label: 'Example sentence from Princeton WordNet 3.0', url: 'https://wordnet.princeton.edu/' };
    const t = this.texts.get(src);
    return t ? { label: t.credit, url: t.url } : { label: src };
  }

  familyOf(w: VocabWord): VocabWord[] {
    return (this.families.get(w.family) ?? [w]).slice().sort((a, b) => a.word.length - b.word.length || a.word.localeCompare(b.word));
  }

  familyForms(w: VocabWord): string[] {
    const forms = this.familyOf(w).map((x) => x.word);
    if (w.base && !forms.includes(w.base)) forms.push(w.base);
    return forms;
  }

  practiceReady(w: VocabWord): boolean {
    return w.contexts.length >= 2;
  }
}

export async function fetchVocab(url: string): Promise<VocabData> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load the vocabulary file (${res.status} ${res.statusText}).`);
  const data = (await res.json()) as VocabData;
  if (!Array.isArray(data.words) || !Array.isArray(data.paragraphs)) throw new Error('The vocabulary file is damaged (missing words or paragraphs).');
  return data;
}
