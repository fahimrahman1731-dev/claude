/**
 * Small, dependency-free helpers for reading the study documents.
 * They only understand the Markdown features the two source files use:
 * ATX headings, pipe tables, bullet lists, *italic* and **bold** text.
 */

export interface Section {
  level: number;
  title: string;
  /** Lines between this heading and the next heading of the same or higher level. */
  body: string;
  /** 1-based line number of the heading, for error messages. */
  line: number;
}

export function sections(md: string): Section[] {
  const lines = md.split(/\r?\n/);
  const heads: { level: number; title: string; idx: number }[] = [];
  lines.forEach((l, idx) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), idx });
  });
  return heads.map((h, i) => {
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        end = heads[j].idx;
        break;
      }
    }
    return { level: h.level, title: h.title, body: lines.slice(h.idx + 1, end).join('\n'), line: h.idx + 1 };
  });
}

/** Finds the section whose heading starts with `prefix`. Throws if absent so failures are never silent. */
export function requireSection(all: Section[], prefix: string): Section {
  const s = all.find((x) => x.title.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!s) throw new Error(`Section starting with "${prefix}" was not found`);
  return s;
}

/** Text of a section up to (not including) its first sub-heading. */
export function ownText(s: Section): string {
  const idx = s.body.search(/^#{1,6}\s/m);
  return idx === -1 ? s.body : s.body.slice(0, idx);
}

/** Parses pipe-table rows (header and separator rows removed). */
export function tableRows(text: string): string[][] {
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('|'))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim()),
    );
  // drop header + separator
  const out: string[][] = [];
  let seenSeparator = false;
  for (const r of rows) {
    if (r.every((c) => /^:?-{3,}:?$/.test(c))) {
      seenSeparator = true;
      continue;
    }
    if (!seenSeparator) continue; // header row
    out.push(r);
  }
  return out;
}

/** Splits on commas/semicolons that are not inside parentheses. */
export function splitTopLevel(text: string, seps = [',']): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch)) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Removes footnote markers like \[5\] or [5]. */
export function stripFootnotes(s: string): string {
  return s.replace(/\\?\[\d+\\?\]/g, '');
}

/** All *italic* spans (not **bold**). */
export function italics(text: string): string[] {
  const out: string[] = [];
  const re = /(?<![*\\])\*(?!\*)([^*\n]+?)\*(?!\*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export function bullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => /^\s*-\s+/.test(l))
    .map((l) => l.replace(/^\s*-\s+/, '').trim());
}
