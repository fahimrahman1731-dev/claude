import type { Context, VocabWord } from '../engine/types';
import { checkContext, checkContextSet } from '../engine/validate';

export interface GeneratedContexts {
  added: Context[];
  rejected: { sentence: string; reason: string }[];
}

/**
 * Asks the optional sentence-generation server (server/ai-proxy.mjs) for new
 * practice sentences. The API key lives on that server, never in the browser.
 * Every returned sentence goes through the same validation as the imported
 * data; only sentences that pass are returned for caching.
 */
export async function generateContexts(endpoint: string, word: VocabWord, count = 2, signal?: AbortSignal): Promise<GeneratedContexts> {
  if (!endpoint) throw new Error('AI sentence generation is not configured. Add the server URL in Settings, or write your own sentences.');
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        word: word.word,
        pos: word.pos,
        definition: word.definition,
        existing: word.contexts.map((c) => c.sentence),
        count,
      }),
      signal,
    });
  } catch (e) {
    throw new Error(`The sentence server could not be reached (${e instanceof Error ? e.message : 'network error'}). Practice still works with the existing sentences.`);
  }
  const body = (await res.json().catch(() => ({}))) as { sentences?: unknown; error?: unknown };
  if (!res.ok) {
    const detail = typeof body.error === 'string' ? body.error : `It returned error ${res.status}.`;
    throw new Error(`The sentence server could not help: ${detail} Practice still works with the existing sentences.`);
  }
  const sentences = Array.isArray(body.sentences) ? body.sentences.filter((s): s is string => typeof s === 'string') : [];
  const rejected: GeneratedContexts['rejected'] = [];
  const fresh: Context[] = [];
  for (const s of sentences) {
    const c = checkContext(s, word.word, word.id, 'ai');
    if (c.context) fresh.push(c.context);
    else rejected.push({ sentence: s, reason: c.errors.join('; ') });
  }
  const set = checkContextSet([...word.contexts, ...fresh], word.word);
  const existingIds = new Set(word.contexts.map((c) => c.id));
  const added = set.kept.filter((c) => !existingIds.has(c.id));
  rejected.push(...set.rejected.filter((r) => fresh.some((f) => f.sentence === r.sentence)));
  return { added, rejected };
}
