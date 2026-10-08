import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPrompt, createProxyServer, readRequest } from '../../server/ai-proxy.mjs';
import { generateContexts } from '../../src/services/ai';
import { makeWord } from '../helpers';

/** Stands in for the Anthropic client: records each request and replays a scripted reply. */
function fakeClient() {
  const calls: Record<string, unknown>[] = [];
  let reply: () => unknown = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sentences":[]}' }] });
  return {
    calls,
    setReply(fn: () => unknown) {
      reply = fn;
    },
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          return reply();
        },
      },
    },
  };
}

const client = fakeClient();
const server = createProxyServer({ client, log: { error() {} } as unknown as Console, ratePerMinute: 1000 });
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = (body: unknown, origin = 'http://localhost:5173') =>
  fetch(`${base}/api/contexts`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

describe('optional AI sentence server', () => {
  it('validates the request before calling the model', async () => {
    expect(readRequest({ word: 'two words' }).error).toMatch(/single English word/);
    expect(readRequest({ word: 'river', count: 9 }).error).toMatch(/1 to 5/);
    expect(readRequest({ word: 'river' })).toMatchObject({ word: 'river', count: 2, existing: [] });
    const res = await post({ word: 'x1' });
    expect(res.status).toBe(400);
    expect(client.calls).toHaveLength(0);
  });

  it('asks for structured output with the API key kept on the server', async () => {
    client.setReply(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sentences":["One.","Two.","Three."]}' }] }));
    const res = await post({ word: 'river', pos: 'n', definition: 'a large stream', existing: ['The river was wide.'], count: 2 });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(await res.json()).toEqual({ sentences: ['One.', 'Two.'] });
    const call = client.calls.at(-1)!;
    expect(call.model).toBe('claude-opus-5-5');
    expect(call.fallbacks).toBe('default');
    expect(call.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(call.output_config).toMatchObject({ format: { type: 'json_schema' } });
    expect(JSON.stringify(call)).toContain('The river was wide.');
    expect(buildPrompt({ word: 'river', pos: '', definition: '', existing: [], count: 1 })).toMatch(/Write 1 new sentence\./);
  });

  it('reports refusals, API errors and unknown origins as clear messages', async () => {
    client.setReply(() => ({ stop_reason: 'refusal', content: [] }));
    let res = await post({ word: 'river' });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/declined/);

    client.setReply(() => {
      throw new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers());
    });
    res = await post({ word: 'river' });
    expect(res.status).toBe(429);

    client.setReply(() => {
      throw new Anthropic.AuthenticationError(401, { type: 'error' }, 'bad key', new Headers());
    });
    res = await post({ word: 'river' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/API key was rejected/);

    res = await post({ word: 'river' }, 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('feeds the app, which still validates every generated sentence', async () => {
    const word = makeWord('harbor', []);
    client.setReply(() => ({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            sentences: [
              'Fishing boats returned to the harbor before the storm reached the coast.',
              'The harbor.', // too short: rejected by the app's validation
            ],
          }),
        },
      ],
    }));
    const r = await generateContexts(`${base}/api/contexts`, word, 2);
    expect(r.added.map((c) => c.sentence)).toEqual(['Fishing boats returned to the harbor before the storm reached the coast.']);
    expect(r.added[0].origin).toBe('ai');
    expect(r.rejected).toHaveLength(1);

    client.setReply(() => ({ stop_reason: 'refusal', content: [] }));
    await expect(generateContexts(`${base}/api/contexts`, word, 2)).rejects.toThrow(/declined.*Practice still works/);
    await expect(generateContexts('', word)).rejects.toThrow(/not configured/);
    await expect(generateContexts('http://127.0.0.1:1/api/contexts', word)).rejects.toThrow(/could not be reached/);
  });
});
