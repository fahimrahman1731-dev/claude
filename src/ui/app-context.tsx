import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../engine/config';
import type { VocabWord, WordProgress } from '../engine/types';
import { AppDB, SETTINGS_KEY } from '../db/db';
import { fetchVocab, VocabStore } from '../data/vocabStore';
import { PracticeService } from '../services/practice';

export interface ImportReportJson {
  version: string;
  generatedAt: string;
  totals: Record<string, number>;
  sources: { id: string; title: string; file: string; status: string; error?: string; sections: { id: string; label: string; status: string; accepted: number; rejected: number; error?: string }[]; notes: string[] }[];
  byPriority: Record<string, number>;
  byDifficulty: Record<string, number>;
  smallWords: number;
  rejected: { raw: string; sourceId: string; sectionId: string; reason: string }[];
  missingDefinitions: string[];
  needingSentences: string[];
  invalidSentences: { word: string; problem: string }[];
  authoredNotInSources: string[];
  paragraphIssues: string[];
  notes: string[];
  /** Present when the data was built with the collected real material. */
  collected?: {
    deleted: { word: string; reason: string }[];
    added: { count: number; byLevel: Record<string, number>; sample: string[] };
    contextOrigins: { collected: number; dictionary: number; authored: number };
    wordsWithOnlyCollected: number;
    definitionOrigins: Record<string, number>;
    bengaliOrigins: Record<string, number>;
    paragraphsByCorpus: Record<string, number>;
    paragraphCandidates: number;
    interactiveSets: number;
    interactiveIssues: string[];
    texts: number;
    licences: Record<string, number>;
  };
}

export interface Toast {
  id: number;
  kind: 'error' | 'info' | 'success';
  text: string;
}

interface AppValue {
  db: AppDB;
  store: VocabStore;
  service: PracticeService;
  report: ImportReportJson | null;
  reportError: string | null;
  persisted: boolean | null;
  reloadStore: () => Promise<void>;
  toasts: Toast[];
  notify: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string; detail?: string } | { status: 'ready'; value: Omit<AppValue, 'toasts' | 'notify' | 'dismiss' | 'reloadStore'> };

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dataRef = useRef<Awaited<ReturnType<typeof fetchVocab>> | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const db = new AppDB();
    try {
      await db.open();
    } catch (e) {
      setState({
        status: 'error',
        message: 'This browser blocked the app’s database, so progress cannot be saved.',
        detail: `${e instanceof Error ? e.message : String(e)}. Private/incognito windows and some privacy settings block IndexedDB. Open the app in a normal window.`,
      });
      return;
    }
    let data;
    try {
      data = await fetchVocab(`${import.meta.env.BASE_URL}data/vocab.json`);
      dataRef.current = data;
    } catch (e) {
      setState({ status: 'error', message: 'The vocabulary could not be loaded.', detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    let report: ImportReportJson | null = null;
    let reportError: string | null = null;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/import-report.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status}`);
      report = await r.json();
    } catch (e) {
      reportError = `The import report could not be loaded (${e instanceof Error ? e.message : String(e)}).`;
    }
    const [custom, ai] = await Promise.all([db.customWords.toArray(), db.aiContexts.toArray()]);
    const store = new VocabStore(data, custom, ai);
    const service = new PracticeService({ db, store });
    let persisted: boolean | null = null;
    try {
      if (navigator.storage?.persist) persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    } catch {
      persisted = null;
    }
    setState({ status: 'ready', value: { db, store, service, report, reportError, persisted } });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    if (kind !== 'error') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const reloadStore = useCallback(async () => {
    if (state.status !== 'ready' || !dataRef.current) return;
    const { db, service } = state.value;
    const [custom, ai] = await Promise.all([db.customWords.toArray(), db.aiContexts.toArray()]);
    const store = new VocabStore(dataRef.current, custom, ai);
    service.store = store;
    setState({ status: 'ready', value: { ...state.value, store } });
  }, [state]);

  const value = useMemo<AppValue | null>(
    () => (state.status === 'ready' ? { ...state.value, toasts, notify, dismiss, reloadStore } : null),
    [state, toasts, notify, dismiss, reloadStore],
  );

  if (state.status === 'loading') {
    return (
      <div className="boot" role="status" aria-live="polite">
        <div className="spinner" aria-hidden />
        <p>Loading your vocabulary…</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="boot boot-error" role="alert">
        <h1>Something went wrong</h1>
        <p>{state.message}</p>
        {state.detail && <p className="muted">{state.detail}</p>}
        <button className="btn primary" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ------------------------------------------------------------------ live data hooks

export function useSettings(): Settings {
  const { db } = useApp();
  const row = useLiveQuery(() => db.kv.get(SETTINGS_KEY), [db]);
  const stored = (row?.value ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored, customTimers: { ...DEFAULT_SETTINGS.customTimers, ...(stored.customTimers ?? {}) } };
}

export function useProgressMap(): Map<string, WordProgress> | undefined {
  const { db } = useApp();
  return useLiveQuery(async () => new Map((await db.progress.toArray()).map((p) => [p.wordId, p])), [db]);
}

export function useWord(id: string): VocabWord | undefined {
  const { store } = useApp();
  return store.byId.get(id);
}
