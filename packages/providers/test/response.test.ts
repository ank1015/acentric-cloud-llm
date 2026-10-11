import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmError } from '@acentric-llm/contracts';
import { complete } from '../src/index.ts';
import { fakeFetch, finalMessage, reasoning, request, responseBody } from './support.ts';

async function run(body: unknown, overrides = {}, init = {}) {
  const { fetch, sent } = fakeFetch(body, init);
  const response = await complete(request(overrides), { fetch });
  return { response, sent };
}

test('sends to OpenAI with the caller credentials', async () => {
  const { sent } = await run(responseBody([finalMessage]), {
    credentials: { apiKey: 'sk-test', organization: 'org_1', project: 'proj_1' },
  });
  assert.equal(sent[0]?.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent[0]?.headers.get('authorization'), 'Bearer sk-test');
  assert.equal(sent[0]?.headers.get('openai-organization'), 'org_1');
  assert.equal(sent[0]?.headers.get('openai-project'), 'proj_1');
});

test('keeps the output verbatim and fills the envelope', async () => {
  const output = [reasoning, finalMessage];
  const { response } = await run(responseBody(output, { model: 'gpt-6.1-sol-2026-09-01' }));
  assert.equal(response.id, 'resp_1');
  assert.equal(response.model, 'gpt-6.1-sol');
  assert.equal(response.responseModel, 'gpt-6.1-sol-2026-09-01');
  assert.equal(response.stopReason, 'stop');
  assert.deepEqual(response.message.content, output);
  assert.equal(response.message.provider, 'openai');
  assert.equal(response.message.api, 'openai-responses');
  assert.equal(response.message.model, 'gpt-6.1-sol');
  assert.equal(response.message.id, 'resp_1');
});

test('reads usage with cache reads and writes as parts of the input', async () => {
  const { response } = await run(responseBody([finalMessage]));
  const { cost, ...usage } = response.usage ?? {};
  assert.deepEqual(usage, {
    totalInput: 1000,
    input: 300,
    output: 200,
    reasoning: 150,
    cacheRead: 600,
    cacheWrite: 100,
  });
  // gpt-6.1-sol: input 2, cache read 0.1, cache write 2.5, output 10 per million.
  assert.ok(cost);
  assert.ok(Math.abs(cost.total - (300 * 2 + 600 * 0.1 + 100 * 2.5 + 200 * 10) / 1e6) < 1e-12);
});

test('native keeps what the response adds and none of the request echoes', async () => {
  const { response } = await run(responseBody([finalMessage]));
  assert.deepEqual(Object.keys(response.native).sort(), [
    'billing',
    'completed_at',
    'created_at',
    'prompt_cache_diagnostics',
    'reasoning',
    'service_tier',
    'status',
    'tool_usage',
  ]);
});

test('prices flex at half and leaves other tiers unpriced', async () => {
  const standard = (await run(responseBody([finalMessage]))).response.usage?.cost?.total ?? 0;
  const flex =
    (await run(responseBody([finalMessage], { service_tier: 'flex' }))).response.usage?.cost
      ?.total ?? 0;
  assert.ok(Math.abs(flex - standard / 2) < 1e-12);
  const priority = await run(responseBody([finalMessage], { service_tier: 'priority' }));
  assert.equal(priority.response.usage?.cost, undefined);
  const unknownModel = await run(responseBody([finalMessage], { model: 'gpt-7' }), {
    model: 'gpt-7',
  });
  assert.equal(unknownModel.response.usage?.cost, undefined);
});

const call = {
  type: 'function_call',
  id: 'fc_1',
  call_id: 'call_1',
  name: 'read',
  arguments: '{}',
  status: 'completed',
};
const commentary = { ...finalMessage, id: 'msg_c', phase: 'commentary' };

const stops: [string, unknown[], Record<string, unknown>, string, string?][] = [
  ['a final message', [reasoning, finalMessage], {}, 'stop'],
  ['an empty output', [], {}, 'stop'],
  ['a pending function call', [reasoning, commentary, call], {}, 'tool_use'],
  ['an async call beside a final answer', [{ ...call, async: true }, finalMessage], {}, 'tool_use'],
  [
    'an MCP approval request',
    [{ type: 'mcp_approval_request', id: 'mcpr_1', server_label: 's', name: 'n', arguments: '{}' }],
    {},
    'tool_use',
  ],
  ['a local shell call', [{ type: 'shell_call', call_id: 'sh_1', action: {} }], {}, 'tool_use'],
  [
    'a hosted shell call with its output',
    [
      { type: 'shell_call', call_id: 'sh_1', action: {} },
      { type: 'shell_call_output', call_id: 'sh_1', output: [] },
      finalMessage,
    ],
    {},
    'stop',
  ],
  [
    'server tool search',
    [{ type: 'tool_search_call', execution: 'server', call_id: null }, finalMessage],
    {},
    'stop',
  ],
  [
    'a refusal',
    [{ ...finalMessage, content: [{ type: 'refusal', refusal: 'No.' }] }],
    {},
    'refusal',
  ],
  [
    'hosted work and commentary only',
    [{ type: 'web_search_call', id: 'ws_1', status: 'completed' }, commentary],
    {},
    'pause_turn',
  ],
  [
    'the output token limit',
    [reasoning],
    { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    'length',
    'max_output_tokens',
  ],
  [
    'a content filter',
    [],
    { status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
    'content_filter',
    'content_filter',
  ],
];

for (const [name, output, extra, expected, providerReason] of stops) {
  test(`stop reason for ${name}: ${expected}`, async () => {
    const { response } = await run(responseBody(output, extra));
    assert.equal(response.stopReason, expected);
    assert.equal(response.providerStopReason, providerReason);
  });
}

async function failure(body: unknown, init = {}): Promise<LlmError> {
  const { fetch } = fakeFetch(body, init);
  try {
    await complete(request(), { fetch });
  } catch (error) {
    assert.ok(error instanceof LlmError);
    return error;
  }
  assert.fail('expected an error');
}

test('a failed response on HTTP 200 is an error with its usage', async () => {
  const error = await failure(
    responseBody([], { status: 'failed', error: { code: 'server_error', message: 'Boom.' } }),
  );
  assert.equal(error.kind, 'provider_error');
  assert.equal(error.retryable, true);
  assert.equal(error.message, 'Boom.');
  assert.equal(error.responseId, 'resp_1');
  assert.equal(error.usage?.totalInput, 1000);
  assert.equal(error.requestId, 'req_test');
});

const httpErrors: [string, number, unknown, Record<string, string>, string, Partial<LlmError>?][] =
  [
    [
      'an invalid key',
      401,
      {
        error: {
          message: 'Incorrect API key.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
      {},
      'auth',
    ],
    [
      'a rate limit',
      429,
      { error: { message: 'Slow down.', type: 'rate_limit_error', code: 'slow_down' } },
      { 'retry-after': '2' },
      'rate_limited',
      { retryAfterMs: 2000 },
    ],
    [
      'exhausted credits',
      429,
      {
        error: {
          message: 'No credits.',
          type: 'insufficient_quota',
          code: 'credit_balance_exhausted',
        },
      },
      {},
      'quota_exceeded',
      { retryable: false },
    ],
    [
      'a context overflow',
      400,
      {
        error: {
          message: 'Too long.',
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
          param: 'input',
        },
      },
      {},
      'context_overflow',
    ],
    [
      'a context overflow without a code',
      400,
      {
        error: {
          message: 'Your input exceeds the context window of this model.',
          type: 'invalid_request_error',
          code: null,
        },
      },
      {},
      'context_overflow',
    ],
    [
      'an unknown previous response',
      400,
      {
        error: {
          message: 'Previous response not found.',
          type: 'invalid_request_error',
          code: 'previous_response_not_found',
          param: 'previous_response_id',
        },
      },
      {},
      'not_found',
      { providerParam: 'previous_response_id' },
    ],
    [
      'a policy refusal',
      400,
      { error: { message: 'Refused.', code: 'bio_policy' } },
      {},
      'policy_violation',
    ],
    [
      'an overloaded server',
      503,
      {
        error: {
          message: 'Busy.',
          type: 'service_unavailable_error',
          code: 'server_is_overloaded',
        },
      },
      {},
      'overloaded',
    ],
    [
      'a server error',
      500,
      { error: { message: 'Oops.', type: 'server_error' } },
      {},
      'provider_error',
    ],
    ['a proxy page', 502, '<html>Bad gateway</html>', {}, 'provider_error'],
  ];

for (const [name, status, body, headers, kind, fields] of httpErrors) {
  test(`HTTP error for ${name}: ${kind}`, async () => {
    const error = await failure(body, { status, headers });
    assert.equal(error.kind, kind);
    assert.equal(error.httpStatus, status);
    assert.equal(error.requestId, 'req_test');
    for (const [key, value] of Object.entries(fields ?? {}))
      assert.equal(error[key as keyof LlmError], value);
  });
}

test('an unreadable body is an invalid response', async () => {
  const error = await failure('not json');
  assert.equal(error.kind, 'invalid_response');
});

test('a queued response is not a finished one', async () => {
  const error = await failure(responseBody([], { status: 'queued' }));
  assert.equal(error.kind, 'invalid_response');
});

test('the caller can cancel', async () => {
  const controller = new AbortController();
  const fetchFn = ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof fetch;
  const pending = complete(request(), { fetch: fetchFn, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error: LlmError) => error.kind === 'cancelled');
});

test('a slow provider times out', async () => {
  const fetchFn = ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof fetch;
  await assert.rejects(
    complete(request({ timeoutMs: 10 }), { fetch: fetchFn }),
    (error: LlmError) => error.kind === 'timeout' && error.retryable,
  );
});
