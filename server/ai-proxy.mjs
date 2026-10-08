// Optional sentence-generation server for the DET Vocab Trainer.
//
// The browser app never sees the API key: it POSTs a word to this server,
// which asks Claude for new practice sentences and returns them. The app then
// validates every sentence with the same rules as the imported data before
// saving any of them. Practice works without this server.
//
//   ANTHROPIC_API_KEY=... npm run ai-proxy
//
// Environment:
//   ANTHROPIC_API_KEY  required (read by the Anthropic SDK; never sent to the browser)
//   PORT               default 8787
//   HOST               default 127.0.0.1 (only this computer can connect)
//   ALLOWED_ORIGINS    comma-separated browser origins allowed to call the server,
//                      default: any http://localhost or http://127.0.0.1 origin
//   AI_MODEL           default claude-opus-5-5
//   AI_EFFORT          low | medium | high, default low (short, constrained task)
//   RATE_LIMIT_PER_MIN requests per minute per client address, default 20

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const MAX_BODY_BYTES = 16 * 1024;
const WORD_RE = /^[A-Za-z]{2,40}$/;

const SENTENCE_SCHEMA = {
  type: 'object',
  properties: { sentences: { type: 'array', items: { type: 'string' } } },
  required: ['sentences'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write example sentences for students preparing for the reading section of an English proficiency test (in the style of "Read and Complete" and fill-in-the-blank tasks). A student will see each sentence with the target word partly hidden and must spell it from the context.

Rules for every sentence:
- Use the target word exactly as given (same spelling and form), exactly once. Do not use any other form or relative of it (no plural, past tense, -ly, -ness, -tion or other family member) anywhere in the sentence.
- Write 8 to 22 words of natural, neutral, academic-style English: science, history, nature, society, daily life or study.
- The context must make the meaning guessable, but must not define the word or repeat its meaning in other words.
- Each sentence must use a clearly different situation from the existing sentences and from each other.
- Use plain punctuation, no quotation marks around the word, no lists, no names of real living people.
Return only the JSON object.`;

/** Checks and normalizes the request body; returns an error string when it is unusable. */
export function readRequest(body) {
  if (!body || typeof body !== 'object') return { error: 'Expected a JSON object.' };
  const { word, pos, definition, existing, count } = body;
  if (typeof word !== 'string' || !WORD_RE.test(word)) return { error: 'word must be a single English word (letters only).' };
  const n = count === undefined ? 2 : Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 5) return { error: 'count must be a whole number from 1 to 5.' };
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const prior = Array.isArray(existing) ? existing.filter((s) => typeof s === 'string').slice(0, 20).map((s) => s.slice(0, 400)) : [];
  return { word, pos: text(pos, 20), definition: text(definition, 300), existing: prior, count: n };
}

export function buildPrompt({ word, pos, definition, existing, count }) {
  const lines = [`Target word: ${word}`];
  if (pos) lines.push(`Part of speech: ${pos}`);
  if (definition) lines.push(`Meaning: ${definition}`);
  lines.push(existing.length ? `Existing sentences (do not reuse these situations):\n${existing.map((s) => `- ${s}`).join('\n')}` : 'There are no existing sentences.');
  lines.push(`Write ${count} new sentence${count === 1 ? '' : 's'}.`);
  return lines.join('\n');
}

function corsOrigin(origin, allowed) {
  if (!origin) return null;
  if (allowed.length) return allowed.includes(origin) ? origin : null;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null;
}

/**
 * Creates the HTTP server. `client` is an Anthropic client (or a stand-in with
 * the same `beta.messages.create` method, which the tests use).
 */
export function createProxyServer({
  client,
  model = 'claude-opus-5-5',
  effort = 'low',
  allowedOrigins = [],
  ratePerMinute = 20,
  log = console,
  now = () => Date.now(),
}) {
  const hits = new Map();
  const limited = (key) => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < 60_000);
    recent.push(t);
    hits.set(key, recent);
    return recent.length > ratePerMinute;
  };

  return createServer(async (req, res) => {
    const origin = corsOrigin(req.headers.origin, allowedOrigins);
    const send = (status, payload) => {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' };
      if (origin) Object.assign(headers, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' });
      res.writeHead(status, headers);
      res.end(payload === undefined ? undefined : JSON.stringify(payload));
    };

    const path = (req.url ?? '/').split('?')[0];
    if (req.headers.origin && !origin) return send(403, { error: 'This browser origin is not allowed. Add it to ALLOWED_ORIGINS on the server.' });
    if (req.method === 'OPTIONS') return send(204);
    if (req.method === 'GET' && path === '/api/health') return send(200, { ok: true, model });
    if (path !== '/api/contexts') return send(404, { error: 'Not found. POST to /api/contexts.' });
    if (req.method !== 'POST') return send(405, { error: 'Use POST.' });
    if (limited(req.socket.remoteAddress ?? 'unknown')) return send(429, { error: 'Too many requests. Wait a minute and try again.' });

    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY_BYTES) return send(413, { error: 'Request too large.' });
      }
    } catch {
      return send(400, { error: 'Could not read the request.' });
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(400, { error: 'Request body must be JSON.' });
    }
    const input = readRequest(body);
    if (input.error) return send(400, { error: input.error });

    try {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        // On a safety decline the API retries on Anthropic's recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        output_config: { effort, format: { type: 'json_schema', schema: SENTENCE_SCHEMA } },
        messages: [{ role: 'user', content: buildPrompt(input) }],
      });
      if (response.stop_reason === 'refusal') {
        return send(422, { error: 'The model declined to write sentences for this word. Write your own on the word’s page.' });
      }
      if (response.stop_reason === 'max_tokens') return send(502, { error: 'The model’s answer was cut off. Try again.' });
      const text = response.content.find((b) => b.type === 'text')?.text ?? '';
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return send(502, { error: 'The model returned an unreadable answer. Try again.' });
      }
      const sentences = Array.isArray(parsed?.sentences) ? parsed.sentences.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean) : [];
      return send(200, { sentences: sentences.slice(0, input.count) });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) {
        log.error('Anthropic rejected the API key. Check ANTHROPIC_API_KEY.');
        return send(502, { error: 'The server’s API key was rejected. Ask whoever runs the server to check it.' });
      }
      if (e instanceof Anthropic.RateLimitError) return send(429, { error: 'The AI service is busy (rate limited). Try again shortly.' });
      if (e instanceof Anthropic.APIError) {
        log.error(`Anthropic API error ${e.status}: ${e.message}`);
        return send(502, { error: `The AI service returned an error (${e.status ?? 'network'}). Try again later.` });
      }
      log.error(e);
      return send(500, { error: 'Unexpected server error.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error('ANTHROPIC_API_KEY is not set. Start the server with:\n  ANTHROPIC_API_KEY=your-key npm run ai-proxy');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const server = createProxyServer({
    client: new Anthropic(),
    model: process.env.AI_MODEL ?? 'claude-opus-5-5',
    effort: process.env.AI_EFFORT ?? 'low',
    allowedOrigins,
    ratePerMinute: Number(process.env.RATE_LIMIT_PER_MIN ?? 20),
  });
  server.listen(port, host, () => {
    console.log(`Sentence server listening on http://${host}:${port}/api/contexts`);
    console.log(`Allowed browser origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'http://localhost:* and http://127.0.0.1:*'}`);
  });
}
