import type { AppDB } from '../db/db';
import { lastMisses, migrateProgress } from '../engine/progress';
import type { AttemptRecord, WordProgress } from '../engine/types';

export const BACKUP_FORMAT = 'det-vocab-backup';
// 2: adds the irResults table and the interactive-reading mode.
// 3: one-answer mastery; progress from version 1 and 2 backups is converted on restore.
export const BACKUP_VERSION = 3;

const TABLES = ['progress', 'attempts', 'mistakes', 'sessions', 'kv', 'customWords', 'aiContexts', 'imports', 'irResults'] as const;
type TableName = (typeof TABLES)[number];

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

/** Everything the student has done, as one JSON document. */
export async function exportBackup(db: AppDB): Promise<Backup> {
  const tables = {} as Record<TableName, unknown[]>;
  await db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) tables[t] = await db.table(t).toArray();
  });
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
}

/** Replaces all saved progress with a backup. Throws (and changes nothing) if the file is not a valid backup. */
export async function restoreBackup(db: AppDB, data: unknown): Promise<{ counts: Record<string, number> }> {
  const b = data as Backup;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object') throw new Error('This file is not a DET Vocab Trainer backup.');
  if (b.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app.');
  // Backups made before Interactive Reading existed have no irResults table; that is fine.
  for (const t of TABLES) if (!Array.isArray(b.tables[t] ?? [])) throw new Error(`Backup table "${t}" is damaged.`);
  const counts: Record<string, number> = {};
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      let rows = b.tables[t] ?? [];
      if (t === 'progress' && b.version < 3) {
        const misses = lastMisses((b.tables.attempts ?? []) as AttemptRecord[]);
        rows = (rows as WordProgress[]).map((p) => migrateProgress(p, misses.get(p.wordId)));
      }
      if (rows.length) await db.table(t).bulkPut(rows);
      counts[t] = rows.length;
    }
  });
  return { counts };
}

export async function resetAll(db: AppDB): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear();
  });
}
