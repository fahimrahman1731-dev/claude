import { parseItem, type Evidence, type Level, type RawEntry, type Rejected } from './normalize';

export interface SectionReport {
  id: string;
  label: string;
  status: 'ok' | 'failed';
  detected: number;
  accepted: number;
  rejected: number;
  error?: string;
}

export interface EntryMeta {
  evidence: Evidence;
  definition?: string;
  collocation?: string;
  ukVariant?: string;
  note?: string;
  gapCount?: number;
  recurringSources?: number;
  level?: Level;
  tags?: string[];
}

/** Collects entries for one source and keeps per-section counts for the import report. */
export class Collector {
  entries: RawEntry[] = [];
  rejected: Rejected[] = [];
  sections: SectionReport[] = [];
  notes: string[] = [];
  /** Known British forms; an item equal to one of these is stored as a variant, not a target. */
  ukForms = new Map<string, string>();
  /** Forms the sources show as wrong (misspellings, non-standard plurals), with the reason. */
  knownBad = new Map<string, string>();
  private current?: SectionReport;

  constructor(public sourceId: string) {}

  section(id: string, label: string, fn: () => void): void {
    const rep: SectionReport = { id, label, status: 'ok', detected: 0, accepted: 0, rejected: 0 };
    this.sections.push(rep);
    this.current = rep;
    try {
      fn();
      if (rep.detected === 0) {
        rep.status = 'failed';
        rep.error = 'No entries were detected in this section. The document layout may have changed.';
      }
    } catch (e) {
      rep.status = 'failed';
      rep.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.current = undefined;
    }
  }

  reject(raw: string, reason: string): void {
    const rep = this.current!;
    rep.detected++;
    rep.rejected++;
    this.rejected.push({ raw, sourceId: this.sourceId, sectionId: rep.id, reason });
  }

  /** Adds one raw list item. Returns the normalized word, if accepted. */
  add(raw: string, meta: EntryMeta): string | undefined {
    const rep = this.current!;
    const p = parseItem(raw);
    if (p.reject || !p.word) {
      this.reject(raw, p.reject ?? 'unparseable');
      return undefined;
    }
    const bad = this.knownBad.get(p.word);
    if (bad) {
      this.reject(raw, bad);
      return undefined;
    }
    const usForUk = this.ukForms.get(p.word);
    if (usForUk) {
      this.reject(raw, `British spelling of "${usForUk}"; kept as an accepted variant for Fill in the Blanks, not as a separate target`);
      return undefined;
    }
    rep.detected++;
    rep.accepted++;
    this.entries.push({
      word: p.word,
      raw: raw.trim(),
      sourceId: this.sourceId,
      sectionId: rep.id,
      sectionLabel: rep.label,
      evidence: meta.evidence,
      definition: meta.definition ?? p.definition,
      collocation: meta.collocation,
      ukVariant: meta.ukVariant ?? p.ukVariant,
      note: [p.note, meta.note].filter(Boolean).join('; ') || undefined,
      gapCount: meta.gapCount,
      recurringSources: meta.recurringSources,
      level: meta.level,
      tags: meta.tags ?? [],
    });
    return p.word;
  }

  /**
   * Adds every word of a phrase such as "closely linked" or "the fiscal year".
   * Single letters are rejected with a reason, like any other item.
   */
  addPhrase(phrase: string, meta: EntryMeta): void {
    const parts = phrase
      .replace(/[…]/g, ' ')
      .split(/[\s/]+/)
      .map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, ''))
      .filter(Boolean);
    const multi = parts.length > 1;
    for (const w of parts) {
      this.add(w, { ...meta, tags: [...(meta.tags ?? []), ...(multi ? [`phrase:${phrase.trim()}`] : [])] });
    }
  }
}
