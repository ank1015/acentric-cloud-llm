import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmError, type AssistantMessage, type CompletionRequest } from '@acentric-llm/contracts';
import {
  complete,
  outputText,
  pendingToolCalls,
  reasoningSummary,
  refusals,
  toolResult,
} from '../src/index.ts';
import { fakeFetch } from './support.ts';

const MODEL = 'claude-haiku-5-5';

function request(
  overrides: Partial<CompletionRequest<'anthropic'>> = {},
): CompletionRequest<'anthropic'> {
  return {
    provider: 'anthropic',
    credentials: { apiKey: 'sk-ant-test' },
    model: MODEL,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    ...overrides,
  } as CompletionRequest<'anthropic'>;
}

const thinking = {
  type: 'thinking',
  thinking: 'Landing at 17:40, plus 25 minutes, then a 19-minute train: 18:24, before sunset.',
  signature: 'CAQSvQkKEAgSGAI4AUIIdGhp...',
};

const text = {
  type: 'text',
  text: 'You arrive at 18:24, seven minutes before sunset. Checking the weather now.',
};

const call = {
  type: 'tool_use',
  id: 'toolu_01SWdzRsZE65dSTe6rZMrSPA',
  name: 'get_weather',
  input: { city: 'Oslo' },
  caller: { type: 'direct' },
};

/** A tool call, as Anthropic answered it live on 2026-10-12 (signature and text cut). */
function messageBody(
  content: unknown[] = [thinking, text, call],
  extra: Record<string, unknown> = {},
  usage: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    model: MODEL,
    id: 'msg_011Cfw6Wq9AP4Q1sQoincAgW',
    type: 'message',
    role: 'assistant',
    content,
    container: null,
    stop_reason: 'tool_use',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 472,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      output_tokens: 450,
      output_tokens_details: { thinking_tokens: 257 },
      service_tier: 'standard',
      inference_geo: 'global',
      ...usage,
    },
    diagnostics: null,
    ...extra,
  };
}

async function run(body: unknown, overrides = {}, init = {}) {
  const { fetch, sent } = fakeFetch(body, init);
  const response = await complete(request(overrides), { fetch });
  return { response, sent };
}

function reply(content: unknown[], model = MODEL): AssistantMessage<'anthropic'> {
  return {
    role: 'assistant',
    provider: 'anthropic',
    api: 'anthropic-messages',
    model,
    id: 'msg_0',
    content,
  } as AssistantMessage<'anthropic'>;
}

test('sends to Anthropic with the key, version and beta headers', async () => {
  const { sent } = await run(messageBody(), {
    credentials: { apiKey: 'sk-ant-test', workspaceId: 'wrkspc_1' },
    providerOptions: { betas: ['compact-2026-01-12', 'fast-mode-2026-02-01'], max_tokens: 512 },
  });
  assert.equal(sent[0]?.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent[0]?.headers.get('x-api-key'), 'sk-ant-test');
  assert.equal(sent[0]?.headers.get('anthropic-version'), '2023-06-01');
  assert.equal(sent[0]?.headers.get('anthropic-beta'), 'compact-2026-01-12,fast-mode-2026-02-01');
  assert.equal(sent[0]?.headers.get('anthropic-workspace-id'), 'wrkspc_1');
  assert.equal(sent[0]?.headers.get('authorization'), null);
  assert.deepEqual(sent[0]?.body, {
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
  });
});

test('max_tokens defaults to the catalog maximum, or 128,000 for other models', async () => {
  const known = await run(messageBody());
  assert.equal(known.sent[0]?.body.max_tokens, 128_000);
  assert.equal(known.sent[0]?.headers.get('anthropic-beta'), null);
  const unknown = await run(messageBody(), { model: 'claude-next' });
  assert.equal(unknown.sent[0]?.body.max_tokens, 128_000);
});

test('maps every shared message, one Anthropic message each', async () => {
  const { sent } = await run(messageBody(), {
    instructions: [
      { type: 'text', text: 'Be brief.' },
      { type: 'text', text: 'Manual.', providerOptions: { cache_control: { type: 'ephemeral' } } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look.' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'iVBOR' } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
          {
            type: 'file',
            source: { type: 'base64', mediaType: 'application/pdf', data: 'JVBER' },
            filename: 'a.pdf',
            providerOptions: { citations: { enabled: true } },
          },
          { type: 'file', source: { type: 'base64', mediaType: 'text/plain', data: 'aMOpbGxv' } },
          { type: 'file', source: { type: 'file_id', id: 'file_1' } },
        ],
      },
      reply([thinking, text, call]),
      {
        role: 'tool_result',
        toolCallId: call.id,
        toolName: 'get_weather',
        content: [{ type: 'text', text: 'Rain, 9C' }],
      },
      {
        role: 'tool_result',
        toolCallId: 'toolu_2',
        toolName: 'get_weather',
        isError: true,
        content: [
          { type: 'text', text: 'Failed.' },
          { type: 'image', source: { type: 'file_id', id: 'file_2' } },
        ],
      },
      { role: 'system', content: [{ type: 'text', text: 'Answer in French.' }] },
      {
        role: 'native',
        provider: 'anthropic',
        api: 'anthropic-messages',
        content: [{ type: 'search_result', source: 'https://a', title: 'A', content: [] }],
      },
    ],
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Weather.',
        parameters: { type: 'object', properties: {} },
        strict: true,
        providerOptions: { cache_control: { type: 'ephemeral' } },
      },
    ],
    providerOptions: {
      max_tokens: 1024,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }],
      thinking: { type: 'adaptive', display: 'summarized' },
    },
  });
  assert.deepEqual(sent[0]?.body, {
    max_tokens: 1024,
    thinking: { type: 'adaptive', display: 'summarized' },
    model: MODEL,
    system: [
      { type: 'text', text: 'Be brief.' },
      { cache_control: { type: 'ephemeral' }, type: 'text', text: 'Manual.' },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look.' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
          {
            citations: { enabled: true },
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' },
            title: 'a.pdf',
          },
          { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'héllo' } },
          { type: 'document', source: { type: 'file', file_id: 'file_1' } },
        ],
      },
      { role: 'assistant', content: [thinking, text, call] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: call.id, content: 'Rain, 9C' }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_2',
            content: [
              { type: 'text', text: 'Failed.' },
              { type: 'image', source: { type: 'file', file_id: 'file_2' } },
            ],
            is_error: true,
          },
        ],
      },
      { role: 'system', content: [{ type: 'text', text: 'Answer in French.' }] },
      {
        role: 'user',
        content: [{ type: 'search_result', source: 'https://a', title: 'A', content: [] }],
      },
    ],
    tools: [
      {
        cache_control: { type: 'ephemeral' },
        name: 'get_weather',
        description: 'Weather.',
        input_schema: { type: 'object', properties: {} },
        strict: true,
      },
      { type: 'web_search_20260209', name: 'web_search', max_uses: 1 },
    ],
  });
});

test("another model's thinking is left out; its other blocks replay as written", async () => {
  const redacted = { type: 'redacted_thinking', data: 'EmwKAhgBEgy...' };
  const { sent } = await run(messageBody(), {
    model: 'claude-sonnet-5-5',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      reply([thinking, redacted, text, call]),
      { role: 'tool_result', toolCallId: call.id, toolName: 'get_weather', content: [] },
      reply([thinking]),
      { role: 'user', content: [{ type: 'text', text: 'Go on.' }] },
      reply([thinking, text], 'claude-sonnet-5-5'),
      { role: 'user', content: [{ type: 'text', text: 'And?' }] },
    ],
  });
  const messages = sent[0]?.body.messages as { role: string; content: unknown }[];
  assert.deepEqual(
    messages.map((message) => message.role),
    ['user', 'assistant', 'user', 'user', 'assistant', 'user'],
  );
  assert.deepEqual(messages[1]?.content, [text, call]);
  assert.deepEqual(messages[4]?.content, [thinking, text]);
});

test('toolResult copies a toolset name into the result', async () => {
  const member = { ...call, name: 'screenshot', toolset_name: 'computer' };
  const [pending] = pendingToolCalls(reply([member]));
  assert.ok(pending);
  assert.deepEqual(pending.resultOptions, { toolset_name: 'computer' });
  const { sent } = await run(messageBody(), {
    messages: [reply([member]), toolResult(pending, 'done')],
  });
  const messages = sent[0]?.body.messages as { content: unknown[] }[];
  assert.deepEqual(messages[1]?.content, [
    { toolset_name: 'computer', type: 'tool_result', tool_use_id: call.id, content: 'done' },
  ]);
});

test('refuses what Anthropic has no place for, before sending', async () => {
  const refused = async (overrides: Partial<CompletionRequest<'anthropic'>>, match: RegExp) => {
    const { fetch, sent } = fakeFetch(messageBody());
    await assert.rejects(complete(request(overrides), { fetch }), (error: unknown) => {
      assert.ok(error instanceof LlmError);
      assert.equal(error.kind, 'invalid_request');
      assert.match(error.message, match);
      return true;
    });
    assert.equal(sent.length, 0);
  };
  await refused(
    { tools: [{ type: 'custom', name: 'patch', description: 'Apply a patch.' }] },
    /custom tool; Anthropic has no free-form tools/,
  );
  await refused(
    {
      messages: [
        {
          role: 'tool_result',
          toolCallId: 'c1',
          toolName: 'patch',
          toolType: 'custom',
          content: [{ type: 'text', text: 'ok' }],
        },
      ],
    },
    /answers a custom tool; Anthropic has none/,
  );
  await refused({ providerOptions: { stream: true } as never }, /Streaming is not supported/);
  await refused(
    { providerOptions: { system: 'x' } as never },
    /providerOptions.system is set by the request/,
  );
  await refused({ providerOptions: { betas: ['a,b'] } }, /betas must be an array of beta names/);
  await refused(
    {
      messages: [
        {
          role: 'system',
          content: [{ type: 'image', source: { type: 'url', url: 'https://a' } }] as never,
        },
      ],
    },
    /messages\[0\].content\[0\] must be a text part/,
  );
  await refused(
    {
      messages: [
        {
          role: 'assistant',
          provider: 'openai',
          api: 'openai-responses',
          model: 'gpt-6.1-sol',
          content: [],
        } as never,
      ],
    },
    /openai assistant message; convert it before sending it to Anthropic/,
  );
  await refused(
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file', source: { type: 'base64', mediaType: 'text/plain', data: '//79' } },
          ],
        },
      ],
    },
    /base64 UTF-8 text/,
  );
});

test('reads a live tool-call response', async () => {
  const { response } = await run(messageBody());
  assert.equal(response.id, 'msg_011Cfw6Wq9AP4Q1sQoincAgW');
  assert.equal(response.stopReason, 'tool_use');
  assert.equal(response.providerStopReason, undefined);
  assert.equal(response.responseModel, undefined);
  assert.equal(response.message.api, 'anthropic-messages');
  assert.equal(response.message.id, response.id);
  assert.deepEqual(response.message.content, [thinking, text, call]);
  const { cost, ...usage } = response.usage ?? {};
  assert.deepEqual(usage, {
    totalInput: 472,
    input: 472,
    output: 450,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 257,
  });
  // Haiku 5.5: input 0.10, output 0.50 per million.
  assert.ok(cost);
  assert.ok(Math.abs(cost.total - (472 * 0.1 + 450 * 0.5) / 1e6) < 1e-15);
  // Null fields and the empty cache split say nothing.
  assert.deepEqual(response.native, {
    usage: { service_tier: 'standard', inference_geo: 'global' },
  });
  assert.equal(outputText(response.message), text.text);
  assert.deepEqual(reasoningSummary(response.message), [thinking.thinking]);
  assert.deepEqual(refusals(response.message), []);
  const calls = pendingToolCalls(response.message);
  assert.deepEqual(
    calls.map(({ item: _item, ...rest }) => rest),
    [
      {
        toolCallId: call.id,
        toolName: 'get_weather',
        toolType: 'function',
        arguments: '{"city":"Oslo"}',
        itemType: 'tool_use',
      },
    ],
  );
});

test('stop reasons', async () => {
  const cases: [string, string, string | undefined][] = [
    ['end_turn', 'stop', 'end_turn'],
    ['stop_sequence', 'stop', 'stop_sequence'],
    ['max_tokens', 'length', 'max_tokens'],
    ['model_context_window_exceeded', 'length', 'model_context_window_exceeded'],
    ['tool_use', 'tool_use', undefined],
    ['pause_turn', 'pause_turn', undefined],
    ['compaction', 'pause_turn', 'compaction'],
    ['refusal', 'refusal', undefined],
  ];
  for (const [stop, stopReason, providerStopReason] of cases) {
    const { response } = await run(
      messageBody([text], {
        stop_reason: stop,
        stop_sequence: stop === 'stop_sequence' ? '5' : null,
      }),
    );
    assert.equal(response.stopReason, stopReason, stop);
    assert.equal(response.providerStopReason, providerStopReason, stop);
  }
  const { response } = await run(
    messageBody([text], { stop_reason: 'stop_sequence', stop_sequence: '5' }),
  );
  assert.equal(response.native.stop_sequence, '5');
});

test('cost: one-hour writes, long context, geo, speed and tiers', async () => {
  const cost = async (usage: Record<string, unknown>, overrides = {}, extra = {}) =>
    (await run(messageBody([text], { stop_reason: 'end_turn', ...extra }, usage), overrides))
      .response.usage?.cost;
  const near = (actual: number | undefined, expected: number) =>
    assert.ok(
      actual !== undefined && Math.abs(actual - expected) < 1e-12,
      `${actual} ≠ ${expected}`,
    );

  // 1,000 written for 5 minutes at 0.125 and 3,000 for an hour at 0.20.
  const writes = await cost({
    input_tokens: 10,
    cache_creation_input_tokens: 4000,
    cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 3000 },
    cache_read_input_tokens: 0,
    output_tokens: 0,
    output_tokens_details: { thinking_tokens: 0 },
  });
  near(writes?.cacheWrite, (1000 * 0.125 + 3000 * 0.2) / 1e6);

  // Over 100,000 prompt tokens, Haiku 5.5 bills the whole request at 0.50 / 2.50.
  const long = await cost({
    input_tokens: 50_000,
    cache_read_input_tokens: 60_000,
    output_tokens: 100,
  });
  near(long?.total, (50_000 * 0.5 + 60_000 * 0.05 + 100 * 2.5) / 1e6);

  const base = { input_tokens: 1000, output_tokens: 100 };
  const standard = (1000 * 0.1 + 100 * 0.5) / 1e6;
  near((await cost({ ...base, inference_geo: 'us' }))?.total, standard * 1.1);
  near((await cost({ ...base, speed: 'fast' }))?.total, standard * 2);
  near((await cost({ ...base, service_tier: 'batch' }))?.total, standard * 0.5);
  assert.equal(await cost({ ...base, service_tier: 'priority' }), undefined);
  assert.equal(await cost(base, { providerOptions: { speed: 'fast' } }), undefined);
  // Writes not split by time to live cannot be priced.
  assert.equal(
    await cost({ ...base, cache_creation_input_tokens: 10, cache_creation: null }),
    undefined,
  );
  assert.equal(await cost(base, { model: 'claude-next' }, { model: 'claude-next' }), undefined);
});

test('cost: iterations are the whole bill, each at its own model', async () => {
  const { response } = await run(
    messageBody(
      [text],
      { stop_reason: 'end_turn' },
      {
        input_tokens: 100,
        output_tokens: 10,
        iterations: [
          { type: 'compaction', input_tokens: 2000, output_tokens: 300 },
          { type: 'message', model: MODEL, input_tokens: 100, output_tokens: 10 },
          {
            type: 'advisor_message',
            model: 'claude-opus-5-5',
            input_tokens: 500,
            output_tokens: 50,
          },
        ],
      },
    ),
  );
  const { cost, ...usage } = response.usage ?? {};
  assert.deepEqual(usage, {
    totalInput: 2600,
    input: 2600,
    output: 360,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 257,
  });
  const expected = (2100 * 0.1 + 310 * 0.5 + 500 * 4 + 50 * 20) / 1e6;
  assert.ok(cost && Math.abs(cost.total - expected) < 1e-12);
  assert.equal((response.native.usage?.iterations as unknown[]).length, 3);
});

test('cost: a refusal before any output is free outside the billed categories', async () => {
  const refusal = (category: string | null) =>
    run(messageBody([], { stop_reason: 'refusal', stop_details: { category } }));
  assert.equal((await refusal('cyber')).response.usage?.cost, undefined);
  assert.equal((await refusal(null)).response.usage?.cost, undefined);
  assert.ok((await refusal('bio')).response.usage?.cost);
  assert.equal((await refusal('cyber')).response.usage?.totalInput, 472);
});

test('the request ID comes from the request-id header', async () => {
  const fetchFn = (async () =>
    new Response(
      JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
      {
        status: 529,
        headers: { 'request-id': 'req_011abc', 'x-should-retry': 'true' },
      },
    )) as typeof fetch;
  await assert.rejects(complete(request(), { fetch: fetchFn }), (error: unknown) => {
    assert.ok(error instanceof LlmError);
    assert.equal(error.requestId, 'req_011abc');
    assert.equal(error.kind, 'overloaded');
    assert.equal(error.retryable, true);
    return true;
  });
});

function errorBody(type: string, message: string, details?: unknown) {
  return {
    type: 'error',
    error: { type, message, ...(details !== undefined ? { details } : {}) },
    request_id: 'req_011Cfw4nEDAvdPiaeh7MPN1U',
  };
}

const ERRORS: [
  string,
  number,
  unknown,
  Record<string, string>,
  string,
  string | undefined,
  boolean,
][] = [
  [
    'a rejected key',
    401,
    errorBody('authentication_error', 'invalid x-api-key'),
    { 'x-should-retry': 'false' },
    'auth',
    undefined,
    false,
  ],
  [
    'a key without access',
    403,
    errorBody('permission_error', 'Not allowed.'),
    {},
    'auth',
    undefined,
    false,
  ],
  [
    'an unknown model',
    404,
    errorBody('not_found_error', 'model: claude-no-such-model'),
    {},
    'not_found',
    'model',
    false,
  ],
  [
    'a prompt longer than the context',
    400,
    errorBody('invalid_request_error', 'prompt is too long: 205024 tokens > 200000 maximum'),
    {},
    'context_overflow',
    undefined,
    false,
  ],
  [
    'a field out of range',
    400,
    errorBody(
      'invalid_request_error',
      'max_tokens: 200000 > 128000, which is the maximum allowed number of output tokens for claude-haiku-5-5',
    ),
    {},
    'invalid_request',
    'max_tokens',
    false,
  ],
  [
    'a changed prefix under a thinking block',
    400,
    errorBody(
      'invalid_request_error',
      'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.',
    ),
    {},
    'invalid_request',
    'messages.1.content.0',
    false,
  ],
  [
    'a spend limit the organization set',
    400,
    errorBody(
      'invalid_request_error',
      'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.',
    ),
    {},
    'quota_exceeded',
    undefined,
    false,
  ],
  [
    'a billing problem',
    402,
    errorBody('billing_error', 'Payment required.'),
    {},
    'quota_exceeded',
    undefined,
    false,
  ],
  [
    'throttling',
    429,
    errorBody(
      'rate_limit_error',
      'Number of request tokens has exceeded your per-minute rate limit',
    ),
    { 'retry-after': '7' },
    'rate_limited',
    undefined,
    true,
  ],
  [
    "the tier's monthly spend cap",
    429,
    errorBody('rate_limit_error', 'You have reached your monthly spend limit.', {
      error_code: 'enforced_spend_limit_reached',
    }),
    { 'x-should-retry': 'false' },
    'quota_exceeded',
    undefined,
    false,
  ],
  [
    'a body over 32 MB',
    413,
    {
      error: {
        type: 'request_too_large',
        message: 'Request exceeds the maximum allowed number of bytes.',
      },
    },
    {},
    'invalid_request',
    undefined,
    false,
  ],
  [
    'an internal error',
    500,
    errorBody('api_error', 'Internal server error'),
    {},
    'provider_error',
    undefined,
    true,
  ],
  [
    'a slow request',
    504,
    errorBody('timeout_error', 'Request timed out'),
    {},
    'timeout',
    undefined,
    true,
  ],
  ['overload', 529, errorBody('overloaded_error', 'Overloaded'), {}, 'overloaded', undefined, true],
  ['an edge error page', 502, '<html>Bad gateway</html>', {}, 'provider_error', undefined, true],
];

for (const [name, status, body, headers, kind, param, retryable] of ERRORS) {
  test(`Anthropic error for ${name}: ${kind}`, async () => {
    const { fetch } = fakeFetch(body, { status, headers });
    await assert.rejects(complete(request(), { fetch }), (error: unknown) => {
      assert.ok(error instanceof LlmError);
      assert.equal(error.kind, kind);
      assert.equal(error.httpStatus, status);
      assert.equal(error.providerParam, param);
      assert.equal(error.retryable, retryable);
      assert.equal(error.requestId, 'req_test');
      if (headers['retry-after']) assert.equal(error.retryAfterMs, 7000);
      return true;
    });
  });
}
