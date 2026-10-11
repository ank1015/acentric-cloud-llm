import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import worker from '../src/index.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers provider calls with `body` and records what was sent upstream. */
function upstream(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return sent;
}

const completion = {
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  error: null,
  incomplete_details: null,
  model: 'gpt-6-luna',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Hi.', annotations: [] }],
    },
  ],
  usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2 },
  service_tier: 'default',
  instructions: 'Be brief.',
};

const body = {
  provider: 'openai',
  credentials: { apiKey: 'sk-test' },
  model: 'gpt-6-luna',
  instructions: 'Be brief.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
};

function post(path: string, payload: unknown, init: RequestInit = {}) {
  return worker.fetch(
    new Request(`https://gateway.test${path}`, {
      method: 'POST',
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
      ...init,
    }),
  );
}

test('completes through the provider and answers the envelope', async () => {
  const sent = upstream(completion);
  const response = await post('/v1/complete', body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const json = await response.json();
  assert.equal(json.stopReason, 'stop');
  assert.equal(json.message.content[0].content[0].text, 'Hi.');
  assert.equal('instructions' in json.native, false);
  assert.equal(sent[0]?.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent[0]?.body.instructions, 'Be brief.');
});

test('a provider client error keeps its status and kind', async () => {
  upstream(
    {
      error: {
        message: 'Previous response not found.',
        type: 'invalid_request_error',
        code: 'previous_response_not_found',
        param: 'previous_response_id',
      },
    },
    400,
  );
  const response = await post('/v1/complete', body);
  assert.equal(response.status, 400);
  const { error } = await response.json();
  assert.equal(error.kind, 'not_found');
  assert.equal(error.providerParam, 'previous_response_id');
  assert.equal(error.retryable, false);
});

test('a rate limit passes Retry-After on', async () => {
  upstream({ error: { message: 'Slow down.', code: 'slow_down' } }, 429, { 'retry-after': '3' });
  const response = await post('/v1/complete', body);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '3');
});

test('a provider server error is a 502', async () => {
  upstream({ error: { message: 'Oops.' } }, 500);
  const response = await post('/v1/complete', body);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.kind, 'provider_error');
});

test('refuses bad requests before calling the provider', async () => {
  const sent = upstream(completion);
  const cases: [unknown, number, RegExp][] = [
    ['{', 400, /not valid JSON/],
    [{ ...body, provider: 'nope' }, 400, /provider must be one of/],
    [{ ...body, credentials: undefined }, 400, /credentials are required/],
    [{ ...body, messages: [{ role: 'custom', tag: 'ui', data: 1 }] }, 400, /application message/],
    [{ ...body, providerOptions: { stream: true } }, 400, /Streaming/],
  ];
  for (const [payload, status, message] of cases) {
    const response = await post('/v1/complete', payload);
    assert.equal(response.status, status);
    assert.match((await response.json()).error.message, message);
  }
  assert.equal(sent.length, 0);
});

test('routes, methods and preflight', async () => {
  assert.equal((await worker.fetch(new Request('https://gateway.test/nope'))).status, 404);
  const wrongMethod = await worker.fetch(new Request('https://gateway.test/v1/complete'));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST, OPTIONS');
  const options = await worker.fetch(
    new Request('https://gateway.test/v1/complete', { method: 'OPTIONS' }),
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  const models = await worker.fetch(new Request('https://gateway.test/v1/models'));
  const { models: list } = await models.json();
  assert.ok(list.some((model: { id: string }) => model.id === 'gpt-6-luna'));
});

test('an oversized body is refused', async () => {
  const response = await post('/v1/complete', 'x', {
    headers: { 'content-length': String(64 * 1024 * 1024) },
  });
  assert.equal(response.status, 413);
});

test('a network failure is a 502 that says nothing about the request', async () => {
  globalThis.fetch = (() => {
    throw new TypeError('sk-test leaked?');
  }) as typeof fetch;
  // A thrown TypeError from fetch is a network error, not a gateway bug.
  const response = await post('/v1/complete', body);
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes('sk-test'), false);
});
