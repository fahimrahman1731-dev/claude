import { Collector, type SectionReport } from './collector';
import type { Evidence, Level, RawEntry, Rejected } from './normalize';
import { parseGuide } from './sources/guide';
import { parseHarvest } from './sources/harvest';

export interface SourceManifestEntry {
  id: string;
  title: string;
  file: string;
  parser: string;
}

export interface SourceReport {
  id: string;
  title: string;
  file: string;
  status: 'ok' | 'partial' | 'failed';
  error?: string;
  sections: SectionReport[];
  entriesDetected: number;
  entriesAccepted: number;
  entriesRejected: number;
  notes: string[];
}

export interface MergedWord {
  word: string;
  occurrences: number;
  sources: string[];
  sections: string[];
  evidence: Evidence[];
  definitions: { text: string; section: string }[];
  collocations: { text: string; section: string }[];
  ukVariants: string[];
  notes: string[];
  gapCount?: number;
  recurringSources?: number;
  levels: Level[];
  tags: string[];
}

export interface ExtractionResult {
  sources: SourceReport[];
  entries: RawEntry[];
  rejected: Rejected[];
  words: MergedWord[];
  /** Number of accepted raw entries that merged into an existing spelling. */
  duplicatesMerged: number;
}

export const PARSERS: Record<string, (md: string, c: Collector) => void> = {
  guide: parseGuide,
  harvest: parseHarvest,
};

/**
 * Runs every source through its parser. A missing file, an unknown parser or a
 * section whose layout cannot be read is recorded as a failure: nothing is
 * skipped silently.
 */
export function extractAll(manifest: SourceManifestEntry[], read: (file: string) => string): ExtractionResult {
  const sources: SourceReport[] = [];
  const entries: RawEntry[] = [];
  const rejected: Rejected[] = [];

  for (const src of manifest) {
    const report: SourceReport = {
      id: src.id,
      title: src.title,
      file: src.file,
      status: 'ok',
      sections: [],
      entriesDetected: 0,
      entriesAccepted: 0,
      entriesRejected: 0,
      notes: [],
    };
    sources.push(report);
    let md: string;
    try {
      md = read(src.file);
      if (!md.trim()) throw new Error('File is empty');
    } catch (e) {
      report.status = 'failed';
      report.error = `Could not read ${src.file}: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }
    const parser = PARSERS[src.parser];
    if (!parser) {
      report.status = 'failed';
      report.error = `No parser named "${src.parser}"`;
      continue;
    }
    const c = new Collector(src.id);
    try {
      parser(md, c);
    } catch (e) {
      report.status = 'failed';
      report.error = e instanceof Error ? e.message : String(e);
    }
    report.sections = c.sections;
    report.notes = c.notes;
    report.entriesAccepted = c.entries.length;
    report.entriesRejected = c.rejected.length;
    report.entriesDetected = c.entries.length + c.rejected.length;
    const failed = c.sections.filter((s) => s.status === 'failed').length;
    if (report.status !== 'failed') {
      if (c.sections.length === 0 || failed === c.sections.length) {
        report.status = 'failed';
        report.error ??= 'No section of this document could be read.';
      } else if (failed > 0) report.status = 'partial';
    }
    entries.push(...c.entries);
    rejected.push(...c.rejected);
  }

  const map = new Map<string, MergedWord>();
  let duplicatesMerged = 0;
  for (const e of entries) {
    let w = map.get(e.word);
    if (!w) {
      w = {
        word: e.word,
        occurrences: 0,
        sources: [],
        sections: [],
        evidence: [],
        definitions: [],
        collocations: [],
        ukVariants: [],
        notes: [],
        levels: [],
        tags: [],
      };
      map.set(e.word, w);
    } else duplicatesMerged++;
    w.occurrences++;
    const addU = <T>(arr: T[], v: T | undefined) => {
      if (v !== undefined && v !== '' && !arr.includes(v)) arr.push(v);
    };
    addU(w.sources, e.sourceId);
    addU(w.sections, e.sectionId);
    addU(w.evidence, e.evidence);
    if (e.definition && !w.definitions.some((d) => d.text === e.definition)) w.definitions.push({ text: e.definition, section: e.sectionId });
    if (e.collocation && !w.collocations.some((d) => d.text === e.collocation)) w.collocations.push({ text: e.collocation, section: e.sectionId });
    addU(w.ukVariants, e.ukVariant);
    addU(w.notes, e.note);
    if (e.gapCount !== undefined) w.gapCount = Math.max(w.gapCount ?? 0, e.gapCount);
    if (e.recurringSources !== undefined) w.recurringSources = Math.max(w.recurringSources ?? 0, e.recurringSources);
    addU(w.levels, e.level);
    for (const t of e.tags) addU(w.tags, t);
  }
  const words = [...map.values()].sort((a, b) => a.word.localeCompare(b.word));
  return { sources, entries, rejected, words, duplicatesMerged };
}
