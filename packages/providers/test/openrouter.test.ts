import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmError, type CompletionRequest, type Message } from '@acentric-llm/contracts';
import { complete, convert } from '../src/index.ts';
import { fakeFetch } from './support.ts';

const MODEL = 'meta/muse-spark-1.3-contributor';

function request(
  overrides: Partial<CompletionRequest<'openrouter'>> = {},
): CompletionRequest<'openrouter'> {
  return {
    provider: 'openrouter',
    credentials: { apiKey: 'sk-or-test' },
    model: MODEL,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Weather in Paris and Tokyo?' }] }],
    ...overrides,
  } as CompletionRequest<'openrouter'>;
}

// Output items as OpenRouter answered live on 2026-10-12 (ciphertext shortened).
const reasoning = {
  id: 'rs_6acc84ddc6e95a9002544ae2:rs_01a12ee7019476d497b06dae97d53501',
  type: 'reasoning',
  status: 'completed',
  summary: [],
  encrypted_content: 'opaque-meta-ciphertext',
  format: 'meta-responses-v1',
};
const commentary = {
  id: 'msg_tmp_u63tdsommk',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [
    {
      type: 'output_text',
      text: "I'll fetch the current weather for Paris and Tokyo simultaneously.",
      annotations: [],
      logprobs: [],
    },
  ],
  phase: 'commentary',
};
const calls = ['Paris', 'Tokyo'].map((city, index) => ({
  id: `fc_tmp_${index}`,
  type: 'function_call',
  status: 'completed',
  call_id: `call_01a12ee70${index}`,
  name: 'get_weather',
  arguments: JSON.stringify({ city }),
}));

/** A parallel tool call, as OpenRouter answered it live on 2026-10-12. */
function responseBody(
  output: unknown[] = [reasoning, commentary, ...calls],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'gen-1791788188-9R6ZXTBUhoniP5R4clFj',
    object: 'response',
    created_at: 1791788188,
    completed_at: 1791788190,
    model: MODEL,
    status: 'completed',
    output,
    error: null,
    incomplete_details: null,
    tools: [],
    tool_choice: 'auto',
    parallel_tool_calls: true,
    max_output_tokens: 2000,
    max_tool_calls: null,
    temperature: 1,
    top_p: 1,
    top_logprobs: 0,
    presence_penalty: 0,
    frequency_penalty: 0,
    metadata: {},
    background: false,
    previous_response_id: null,
    service_tier: 'auto',
    truncation: 'disabled',
    store: false,
    instructions: 'Use tools when needed.',
    text: { format: { type: 'text' } },
    reasoning: { effort: 'low' },
    safety_identifier: null,
    prompt_cache_key: null,
    prompt_cache_options: null,
    usage: {
      input_tokens: 972,
      input_tokens_details: { cached_tokens: 497 },
      output_tokens: 59,
      output_tokens_details: { reasoning_tokens: 41 },
      total_tokens: 1031,
      cost: 0.000060294,
      is_byok: false,
      cost_details: {
        upstream_inference_cost: 0.000060294,
        upstream_inference_input_cost: 0.000048494,
        upstream_inference_output_cost: 0.0000118,
      },
    },
    ...extra,
  };
}

async function run(body: unknown, overrides = {}, init = {}) {
  const { fetch, sent } = fakeFetch(body, init);
  const response = await complete(request(overrides), { fetch });
  return { response, sent };
}

test('sends to OpenRouter with a bearer key, attribution headers and system messages', async () => {
  const { sent } = await run(responseBody(), {
    credentials: { apiKey: 'sk-or-test', appUrl: 'https://example.com', appTitle: 'Example' },
    instructions: 'Use tools when needed.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'system', content: [{ type: 'text', text: 'Answer in French.' }] },
    ],
    providerOptions: {
      provider: { order: ['meta'], allow_fallbacks: false },
      reasoning: { effort: 'low' },
    },
  });
  const [call] = sent;
  assert.ok(call);
  assert.equal(call.url, 'https://openrouter.ai/api/v1/responses');
  assert.equal(call.headers.get('authorization'), 'Bearer sk-or-test');
  assert.equal(call.headers.get('http-referer'), 'https://example.com');
  assert.equal(call.headers.get('x-openrouter-title'), 'Example');
  assert.deepEqual(call.body.provider, { order: ['meta'], allow_fallbacks: false });
  assert.deepEqual(call.body.input, [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
    {
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text: 'Answer in French.' }],
    },
  ]);
});

test('replays output items exactly as they came, with nothing stripped', async () => {
  const withCreatedBy = { ...commentary, created_by: 'someone' };
  const { sent } = await run(responseBody(), {
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
      {
        role: 'assistant',
        provider: 'openrouter',
        api: 'openai-responses',
        model: MODEL,
        content: [reasoning, withCreatedBy, ...calls],
      },
      ...calls.map((call) => ({
        role: 'tool_result',
        toolCallId: call.call_id,
        toolName: call.name,
        content: [{ type: 'text', text: '18°C' }],
      })),
    ],
  });
  const input = sent[0]?.body.input as unknown[];
  assert.deepEqual(input.slice(1, 5), [reasoning, withCreatedBy, ...calls]);
  assert.deepEqual(input[5], {
    type: 'function_call_output',
    call_id: calls[0]?.call_id,
    output: '18°C',
  });
});

test('reads a live tool-call response, with the cost OpenRouter reports', async () => {
  const { response } = await run(responseBody());
  assert.equal(response.id, 'gen-1791788188-9R6ZXTBUhoniP5R4clFj');
  assert.equal(response.stopReason, 'tool_use');
  assert.deepEqual(
    response.message.content.map((item) => item.type),
    ['reasoning', 'message', 'function_call', 'function_call'],
  );
  assert.equal(response.message.model, MODEL);
  assert.deepEqual(response.usage, {
    totalInput: 972,
    input: 475,
    output: 59,
    reasoning: 41,
    cacheRead: 497,
    cost: { source: 'reported', total: 0.000060294 },
  });
  assert.deepEqual(response.native, {
    status: 'completed',
    created_at: 1791788188,
    completed_at: 1791788190,
    service_tier: 'auto',
    usage: {
      cost: 0.000060294,
      is_byok: false,
      cost_details: {
        upstream_inference_cost: 0.000060294,
        upstream_inference_input_cost: 0.000048494,
        upstream_inference_output_cost: 0.0000118,
      },
    },
  });
});

test('the assistant message records the model that answered', async () => {
  const { response } = await run(responseBody(undefined, { model: 'meta/muse-spark-1.3' }), {
    providerOptions: { models: ['meta/muse-spark-1.3'] },
  });
  assert.equal(response.model, MODEL);
  assert.equal(response.responseModel, 'meta/muse-spark-1.3');
  assert.equal(response.message.model, 'meta/muse-spark-1.3');
});

test('cost: own upstream keys add the upstream charge; no reported cost, no cost', async () => {
  const usage = (extra: Record<string, unknown>) =>
    responseBody(undefined, {
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, ...extra },
    });
  const byok = await run(
    usage({ cost: 0.00001, is_byok: true, cost_details: { upstream_inference_cost: 0.0002 } }),
  );
  assert.deepEqual(byok.response.usage?.cost, { source: 'reported', total: 0.00021 });
  const unknownUpstream = await run(usage({ cost: 0.00001, is_byok: true }));
  assert.equal(unknownUpstream.response.usage?.cost, undefined);
  const none = await run(usage({}));
  assert.equal(none.response.usage?.cost, undefined);
  const free = await run(usage({ cost: 0, is_byok: false }));
  assert.deepEqual(free.response.usage?.cost, { source: 'reported', total: 0 });
});

test('a response cut short with no output is a length stop, still charged', async () => {
  const { response } = await run(
    responseBody([], {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: {
        input_tokens: 32,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 16,
        output_tokens_details: { reasoning_tokens: 13 },
        total_tokens: 48,
        cost: 0.0000064,
        is_byok: false,
      },
    }),
  );
  assert.equal(response.stopReason, 'length');
  assert.equal(response.providerStopReason, 'max_output_tokens');
  assert.deepEqual(response.message.content, []);
  assert.equal(response.usage?.cost?.total, 0.0000064);
});

test('refuses what complete cannot return', async () => {
  for (const providerOptions of [{ stream: true }, { background: true }]) {
    await assert.rejects(
      complete(request({ providerOptions } as never), { fetch: fakeFetch({}).fetch }),
      (error: unknown) => error instanceof LlmError && error.kind === 'invalid_request',
    );
  }
});

const upstream = (message: string, param: string) => ({
  error: {
    message: 'Provider returned error',
    code: 400,
    metadata: {
      raw: JSON.stringify({
        error: { code: null, message, param, type: 'invalid_request_error' },
      }),
      provider_name: 'Meta',
      is_byok: false,
    },
  },
  user_id: 'user_1',
});

/** Error bodies as OpenRouter answered live, and as its docs describe the rest. */
const ERRORS: [string, number, unknown, string, string | undefined][] = [
  ['a bad key', 401, { error: { message: 'User not found.', code: 401 } }, 'auth', undefined],
  [
    'an unknown model',
    400,
    { error: { message: 'meta/does-not-exist is not a valid model ID', code: 400 } },
    'not_found',
    'model',
  ],
  [
    'stored state',
    400,
    {
      error: {
        code: 'invalid_prompt',
        message:
          'store: true is not supported on this proxy. Each response request is independent.',
      },
      metadata: {
        raw: JSON.stringify([
          { code: 'invalid_value', path: ['store'], message: 'store: true is not supported' },
        ]),
      },
    },
    'invalid_request',
    'store',
  ],
  [
    "an upstream's refusal of a parameter",
    400,
    upstream('only `"auto"` is supported for `tool_choice`.', 'tool_choice'),
    'invalid_request',
    'tool_choice',
  ],
  [
    'no endpoint left after routing filters',
    404,
    {
      error: {
        message: 'No endpoints found that satisfy the max price for this request',
        code: 404,
        metadata: { routing_funnel: [], failed_routing_step: 'Filter by Max Price' },
      },
    },
    'not_found',
    'provider',
  ],
  [
    'no credits',
    402,
    {
      error: {
        message: 'Insufficient credits',
        code: 402,
        metadata: { limit_source: 'openrouter_credits' },
      },
    },
    'quota_exceeded',
    undefined,
  ],
  [
    'a full in-flight budget',
    402,
    {
      error: {
        message: 'In-flight budget exhausted',
        code: 402,
        metadata: {
          limit_source: 'openrouter_in_flight_budget',
          reason: 'in_flight_budget_exhausted',
        },
      },
    },
    'rate_limited',
    undefined,
  ],
  [
    'a key budget',
    403,
    {
      error: {
        message: 'Key limit exceeded',
        code: 403,
        metadata: { limit_source: 'openrouter_key_limit' },
      },
    },
    'quota_exceeded',
    undefined,
  ],
  [
    'moderation',
    403,
    {
      error: {
        message: 'Input was flagged',
        code: 403,
        metadata: {
          reasons: ['violence'],
          flagged_input: '...',
          provider_name: 'Meta',
          model_slug: MODEL,
        },
      },
    },
    'policy_violation',
    undefined,
  ],
  [
    'a context overflow',
    400,
    {
      error: {
        message: 'Prompt too long',
        code: 400,
        metadata: { error_type: 'context_length_exceeded' },
      },
    },
    'context_overflow',
    undefined,
  ],
  [
    'throttling',
    429,
    { error: { message: 'Rate limit exceeded', code: 429 } },
    'rate_limited',
    undefined,
  ],
  [
    'an upstream failure',
    502,
    { error: { message: 'Provider down', code: 502 } },
    'provider_error',
    undefined,
  ],
  ['an edge timeout', 524, { error: { message: 'Timed out', code: 524 } }, 'timeout', undefined],
  [
    'a file URL it cannot fetch',
    400,
    {
      error: {
        message: 'Invalid file URL: Received 403 when fetching URL: https://www.w3.org',
        code: 400,
        metadata: { provider_name: null },
      },
    },
    'invalid_request',
    undefined,
  ],
];

for (const [name, status, body, kind, param] of ERRORS) {
  test(`OpenRouter error for ${name}: ${kind}`, async () => {
    const { fetch } = fakeFetch(body, { status, headers: { 'retry-after': '2' } });
    await assert.rejects(complete(request(), { fetch }), (error: unknown) => {
      assert.ok(error instanceof LlmError);
      assert.equal(error.kind, kind);
      assert.equal(error.httpStatus, status);
      assert.equal(error.providerParam, param);
      assert.equal(error.retryAfterMs, 2000);
      return true;
    });
  });
}

test("an upstream's error message replaces the generic one", async () => {
  const { fetch } = fakeFetch(upstream('unknown parameter `foo`', 'foo'), { status: 400 });
  const error = await complete(request(), { fetch }).catch((caught: unknown) => caught);
  assert.ok(error instanceof LlmError);
  assert.equal(error.message, 'Meta returned an error: unknown parameter `foo`');
  assert.equal(error.providerParam, 'foo');
});

test('failures on HTTP 200: the canonical type wins over the reduced code', async () => {
  const failed = await run(
    responseBody([], {
      status: 'failed',
      error: { code: 'server_error', message: 'Upstream timed out' },
      error_type: 'timeout',
    }),
  ).catch((caught: unknown) => caught);
  assert.ok(failed instanceof LlmError);
  assert.equal(failed.kind, 'timeout');
  assert.equal(failed.responseId, 'gen-1791788188-9R6ZXTBUhoniP5R4clFj');
  assert.equal(failed.usage?.totalInput, 972);

  const bare = await run({
    id: 'gen-2',
    error: { code: 502, message: 'Provider returned error' },
  }).catch((caught: unknown) => caught);
  assert.ok(bare instanceof LlmError);
  assert.equal(bare.kind, 'provider_error');
  assert.equal(bare.responseId, 'gen-2');
});

test('the generation ID names the call when there is no request ID header', async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ error: { message: 'User not found.', code: 401 } }), {
      status: 401,
      headers: { 'x-generation-id': 'gen-3' },
    })) as unknown as typeof fetch;
  const error = await complete(request(), { fetch: fetchFn }).catch((caught: unknown) => caught);
  assert.ok(error instanceof LlmError);
  assert.equal(error.requestId, 'gen-3');
});

test('convert: other providers lose reasoning and foreign options; the same model keeps all', () => {
  const own = {
    role: 'assistant',
    provider: 'openrouter',
    api: 'openai-responses',
    model: MODEL,
    content: [reasoning, commentary],
  } as unknown as Message;
  const kept = convert([own], { provider: 'openrouter', model: MODEL });
  assert.deepEqual(kept.messages, [own]);
  assert.deepEqual(kept.changes, []);

  const fromOpenAi = convert(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hi', providerOptions: { cache_control: { type: 'ephemeral' } } },
        ],
      },
      {
        role: 'assistant',
        provider: 'openai',
        api: 'openai-responses',
        model: 'gpt-6.1-sol',
        id: 'resp_1',
        content: [
          { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'gAAAA' },
          { ...commentary, id: 'msg_1' },
        ],
      },
    ] as unknown as Message[],
    { provider: 'openrouter', model: MODEL },
  );
  const [user, message] = fromOpenAi.messages;
  assert.ok(user?.role === 'user');
  assert.deepEqual(user.content, [{ type: 'text', text: 'Hi' }]);
  assert.ok(message?.role === 'assistant');
  assert.equal(message.provider, 'openrouter');
  assert.equal(message.id, undefined);
  assert.deepEqual(
    message.content.map((item) => item.type),
    ['message'],
  );
  assert.deepEqual(
    fromOpenAi.changes.map(({ what, action }) => `${action} ${what}`),
    ['dropped part_option', 'dropped reasoning'],
  );
});
