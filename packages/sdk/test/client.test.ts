import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createClient,
  LlmError,
  outputText,
  pendingToolCalls,
  toolResult,
  type Message,
} from '../src/index.ts';
import { createDirectClient } from '../src/direct.ts';
import * as core from '../src/core.ts';

const completion = {
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  error: null,
  incomplete_details: null,
  model: 'gpt-6-luna',
  output: [{ type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"path":"a"}' }],
  usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2 },
  service_tier: 'default',
};

/** A fetch answering every call with `body`, recording what was sent. */
function fakeFetch(body: unknown, status = 200) {
  const sent: { url: string; body: any }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetch: fetchFn, sent };
}

const history: Message<'openai'>[] = [
  { role: 'custom', tag: 'ui.note', data: 'kept locally' },
  { role: 'user', content: [{ type: 'text', text: 'Read a' }] },
];

test('the gateway client sends saved credentials and strips application messages', async () => {
  const gatewayAnswer = { provider: 'openai', stopReason: 'stop', message: { role: 'assistant' } };
  const { fetch, sent } = fakeFetch(gatewayAnswer);
  const llm = createClient({
    baseUrl: 'http://localhost:8787/',
    credentials: { openai: { apiKey: 'sk' } },
    fetch,
  });
  const response = await llm.complete({
    provider: 'openai',
    model: 'gpt-6-luna',
    messages: history,
  });
  assert.equal(response.stopReason, 'stop');
  assert.equal(sent[0]?.url, 'http://localhost:8787/v1/complete');
  assert.deepEqual(sent[0]?.body.credentials, { apiKey: 'sk' });
  assert.deepEqual(sent[0]?.body.messages, [history[1]]);
});

test('the gateway client rebuilds the gateway error', async () => {
  const { fetch } = fakeFetch(
    {
      error: {
        message: 'Slow down.',
        kind: 'rate_limited',
        retryable: true,
        provider: 'openai',
        retryAfterMs: 2000,
      },
    },
    429,
  );
  const llm = createClient({ baseUrl: 'https://gw.test', fetch });
  await assert.rejects(
    llm.complete({ provider: 'openai', credentials: { apiKey: 'sk' }, model: 'm', messages: [] }),
    (error: LlmError) =>
      error instanceof LlmError && error.kind === 'rate_limited' && error.retryAfterMs === 2000,
  );
});

test('missing credentials are refused before sending', async () => {
  const { fetch, sent } = fakeFetch({});
  const llm = createClient({ baseUrl: 'https://gw.test', fetch });
  // @ts-expect-error credentials are required when the client holds none for the provider
  const pending = llm.complete({ provider: 'openai', model: 'm', messages: [] });
  await assert.rejects(pending, (error: LlmError) => error.kind === 'invalid_request');
  assert.equal(sent.length, 0);
});

test('a proxy page is an invalid response; an unreachable gateway is a network error', async () => {
  const proxy = (async () => new Response('<html>502</html>', { status: 502 })) as typeof fetch;
  await assert.rejects(
    createClient({ baseUrl: 'https://gw.test', fetch: proxy }).models(),
    (error: LlmError) => error.kind === 'invalid_response',
  );
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await assert.rejects(
    createClient({ baseUrl: 'https://gw.test', fetch: down }).models(),
    (error: LlmError) => error.kind === 'network_error',
  );
});

test('a client timeout aborts the call', async () => {
  const hang = ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
    )) as typeof fetch;
  await assert.rejects(
    createClient({ baseUrl: 'https://gw.test', fetch: hang, timeoutMs: 10 }).models(),
    (error: LlmError) => error.kind === 'timeout',
  );
});

test('the direct client runs the adapter in process, with the same shape', async () => {
  const { fetch, sent } = fakeFetch(completion);
  const llm = createDirectClient({ credentials: { openai: { apiKey: 'sk' } }, fetch });
  const response = await llm.complete({
    provider: 'openai',
    model: 'gpt-6-luna',
    messages: history,
  });
  assert.equal(sent[0]?.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent[0]?.body.input.length, 1);
  assert.equal(response.stopReason, 'tool_use');
  const [call] = pendingToolCalls(response.message);
  assert.ok(call);
  assert.deepEqual(toolResult(call, 'contents').content, [{ type: 'text', text: 'contents' }]);
  assert.equal(outputText(response.message), '');
  assert.ok((await llm.models()).some((model) => model.id === 'gpt-6-luna'));
});

test('the gateway client defaults to the gateway acentric runs', async () => {
  const { fetch, sent } = fakeFetch({ models: [] });
  await createClient({ fetch }).models();
  assert.equal(sent[0]?.url, 'https://llm.cloud.acentric.dev/v1/models');
});

test('the core entry has the helpers and no client', () => {
  assert.equal(typeof core.toolCalls, 'function');
  assert.equal(typeof core.toolResult, 'function');
  assert.equal(typeof core.LlmError, 'function');
  assert.equal('createClient' in core, false);
});
