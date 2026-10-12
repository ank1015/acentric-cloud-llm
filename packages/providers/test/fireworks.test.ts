import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmError, type CompletionRequest } from '@acentric-llm/contracts';
import { complete } from '../src/index.ts';
import { assistant, fakeFetch } from './support.ts';

const MODEL = 'accounts/fireworks/models/gpt-oss-120b';

function request(
  overrides: Partial<CompletionRequest<'fireworks'>> = {},
): CompletionRequest<'fireworks'> {
  return {
    provider: 'fireworks',
    credentials: { apiKey: 'fw_test' },
    model: MODEL,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    ...overrides,
  } as CompletionRequest<'fireworks'>;
}

const reasoning = {
  id: 'rs_25f228d4ef3e4a429861f34a42f0605b',
  type: 'reasoning',
  summary: [{ type: 'summary_text', text: 'The user wants to call lookup with tag "alpha".' }],
};

const call = {
  id: 'fc_c385aaadad83414ba49a0761aac7d709',
  type: 'function_call',
  call_id: 'call_D8YbcxBxFGem51DFS1r6FNuh',
  name: 'lookup',
  arguments: '{\n"tag": "alpha"\n}',
  status: 'completed',
};

/** A tool call, as Fireworks answered it live on 2026-10-11. */
function responseBody(
  output: unknown[] = [reasoning, call],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'resp_eb0a567515954b7db6c336db2ab14d25',
    object: 'response',
    created_at: 1791735746,
    status: 'completed',
    model: MODEL,
    output,
    previous_response_id: null,
    usage: {
      input_tokens: 149,
      output_tokens: 61,
      total_tokens: 210,
      input_tokens_details: { cached_tokens: 48 },
    },
    error: null,
    incomplete_details: null,
    instructions: 'When giving the final number, prefix it with TOKEN: .',
    max_output_tokens: 256,
    max_tool_calls: null,
    parallel_tool_calls: true,
    reasoning: { effort: 'low' },
    store: true,
    temperature: 1.0,
    text: { format: { type: 'text' } },
    tool_choice: { type: 'function', name: 'lookup' },
    tools: [{ type: 'function', name: 'lookup', parameters: {}, strict: true }],
    top_p: 1.0,
    top_logprobs: null,
    truncation: 'disabled',
    user: null,
    background: null,
    metadata: {},
    ...extra,
  };
}

async function run(body: unknown, overrides = {}, init = {}) {
  const { fetch, sent } = fakeFetch(body, init);
  const response = await complete(request(overrides), { fetch });
  return { response, sent };
}

function fireworksAssistant(content: unknown[]) {
  return { ...assistant(content), provider: 'fireworks', model: MODEL };
}

test('sends to Fireworks with a bearer key, system messages as system', async () => {
  const { sent } = await run(responseBody(), {
    instructions: 'Be brief.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Look up alpha.' }] },
      fireworksAssistant([reasoning, call]),
      {
        role: 'tool_result',
        toolCallId: call.call_id,
        toolName: 'lookup',
        content: [{ type: 'text', text: '7' }],
      },
      { role: 'system', content: [{ type: 'text', text: 'Answer in French.' }] },
    ],
    providerOptions: { store: false, reasoning: { effort: 'low' }, prompt_cache_key: 's1' },
  });
  assert.equal(sent[0]?.url, 'https://api.fireworks.ai/inference/v1/responses');
  assert.equal(sent[0]?.headers.get('authorization'), 'Bearer fw_test');
  assert.deepEqual(sent[0]?.body, {
    store: false,
    reasoning: { effort: 'low' },
    prompt_cache_key: 's1',
    model: MODEL,
    instructions: 'Be brief.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Look up alpha.' }],
      },
      reasoning,
      call,
      { type: 'function_call_output', call_id: call.call_id, output: '7' },
      {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: 'Answer in French.' }],
      },
    ],
  });
});

test('reads a live tool-call response', async () => {
  const { response } = await run(responseBody());
  assert.equal(response.stopReason, 'tool_use');
  assert.equal(response.message.provider, 'fireworks');
  assert.equal(response.message.api, 'openai-responses');
  assert.deepEqual(response.message.content, [reasoning, call]);
  assert.equal(response.responseModel, undefined);
  const { cost, ...usage } = response.usage ?? {};
  // No reasoning count and no cache writes at Fireworks.
  assert.deepEqual(usage, { totalInput: 149, input: 101, output: 61, cacheRead: 48 });
  // gpt-oss-120b: input 0.15, cache read 0.015, output 0.6 per million.
  assert.ok(cost);
  assert.ok(Math.abs(cost.total - (101 * 0.15 + 48 * 0.015 + 61 * 0.6) / 1e6) < 1e-15);
  // Everything else echoes the request.
  assert.deepEqual(response.native, { created_at: 1791735746, status: 'completed' });
});

test('an incomplete response is cut short even when its items say completed', async () => {
  const partial = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Here are', annotations: [] }],
  };
  const { response } = await run(
    responseBody([partial], {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    }),
  );
  assert.equal(response.stopReason, 'length');
  assert.equal(response.providerStopReason, 'max_output_tokens');
  assert.deepEqual(response.native.incomplete_details, { reason: 'max_output_tokens' });
});

test('a requested tier other than default leaves the cost out', async () => {
  const standard = await run(responseBody(), { providerOptions: { service_tier: 'default' } });
  assert.ok(standard.response.usage?.cost);
  const priority = await run(responseBody(), { providerOptions: { service_tier: 'priority' } });
  assert.equal(priority.response.usage?.cost, undefined);
  assert.equal(priority.response.usage?.totalInput, 149);
});

test('refuses what Fireworks would drop or never use', async () => {
  const refused = async (overrides: Partial<CompletionRequest<'fireworks'>>, match: RegExp) => {
    const { fetch, sent } = fakeFetch(responseBody());
    await assert.rejects(complete(request(overrides), { fetch }), (error: unknown) => {
      assert.ok(error instanceof LlmError);
      assert.equal(error.kind, 'invalid_request');
      assert.match(error.message, match);
      return true;
    });
    assert.equal(sent.length, 0);
  };
  await refused(
    {
      tools: [{ type: 'custom', name: 'patch', description: 'Apply a patch.' }],
    },
    /custom tool; Fireworks takes no custom tools here/,
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
    /answers a custom tool; Fireworks has none/,
  );
  for (const source of [
    { type: 'url', url: 'https://example.com/a.pdf' },
    { type: 'base64', mediaType: 'text/plain', data: 'aGk=' },
  ] as const) {
    await refused(
      { messages: [{ role: 'user', content: [{ type: 'file', source }] }] },
      /takes no files and would drop it/,
    );
  }
  await refused(
    {
      messages: [
        { role: 'user', content: [{ type: 'image', source: { type: 'file_id', id: 'file_1' } }] },
      ],
    },
    /file ID; Fireworks takes no file IDs here/,
  );
  await refused(
    { messages: [assistant([{ type: 'reasoning', id: 'rs_1', summary: [] }])] as never },
    /openai assistant message; convert it before sending it to Fireworks/,
  );
});

test('images go as data URLs', async () => {
  const { sent } = await run(responseBody(), {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', mediaType: 'image/png', data: 'iVBOR' },
            providerOptions: { detail: 'low' },
          },
        ],
      },
    ],
  });
  assert.deepEqual((sent[0]?.body.input as unknown[])[0], {
    type: 'message',
    role: 'user',
    content: [{ detail: 'low', type: 'input_image', image_url: 'data:image/png;base64,iVBOR' }],
  });
});

const ERRORS: [string, number, unknown, string, string | undefined][] = [
  [
    'an unknown or unstored previous response',
    404,
    { detail: 'Previous response not found' },
    'not_found',
    'previous_response_id',
  ],
  [
    'an unknown model',
    404,
    {
      error: { message: 'Model not found', param: 'model', code: 'NOT_FOUND', type: 'error' },
      request_id: 'r1',
    },
    'not_found',
    'model',
  ],
  [
    'a rejected key',
    401,
    {
      error: { message: 'Unauthorized', param: null, code: 'UNAUTHORIZED', type: 'error' },
      request_id: 'r1',
    },
    'auth',
    undefined,
  ],
  [
    'a prompt longer than the context',
    400,
    {
      error: {
        type: 'invalid_request_error',
        code: 'invalid_request_error',
        message: 'prompt is too long: 150073 tokens exceeds maximum context length of 131069',
      },
    },
    'context_overflow',
    undefined,
  ],
  [
    'an unsupported reasoning effort',
    400,
    {
      error: {
        type: 'invalid_request_error',
        code: 'invalid_request_error',
        message: 'Invalid reasoning effort: none',
      },
    },
    'invalid_request',
    undefined,
  ],
  [
    'a validation error list',
    422,
    {
      detail: [
        {
          type: 'greater_than_equal',
          loc: ['body', 'temperature'],
          msg: 'Input should be greater than or equal to 0',
          input: -1,
          ctx: { ge: 0.0 },
        },
      ],
    },
    'invalid_request',
    'temperature',
  ],
  ['a plan or spending limit', 402, { detail: 'Payment required' }, 'quota_exceeded', undefined],
  ['a suspended account', 412, { detail: 'Account suspended' }, 'auth', undefined],
  ['load shedding', 503, { detail: 'Service Overloaded' }, 'overloaded', undefined],
  ['an empty gateway error', 502, '', 'provider_error', undefined],
  [
    'a server error',
    500,
    { error: { type: 'server_error', code: 'server_error', message: 'Internal server error.' } },
    'provider_error',
    undefined,
  ],
];

for (const [name, status, body, kind, param] of ERRORS) {
  test(`Fireworks error for ${name}: ${kind}`, async () => {
    const { fetch } = fakeFetch(body, { status });
    await assert.rejects(complete(request(), { fetch }), (error: unknown) => {
      assert.ok(error instanceof LlmError);
      assert.equal(error.kind, kind);
      assert.equal(error.httpStatus, status);
      assert.equal(error.providerParam, param);
      assert.equal(error.requestId, 'req_test');
      return true;
    });
  });
}

test('error messages come from every body shape', async () => {
  const message = async (body: unknown, status: number) => {
    const { fetch } = fakeFetch(body, { status });
    const error = await complete(request(), { fetch }).catch((caught: unknown) => caught);
    assert.ok(error instanceof LlmError);
    return error.message;
  };
  assert.equal(
    await message({ detail: 'Previous response not found' }, 404),
    'Previous response not found',
  );
  assert.equal(
    await message(
      { detail: [{ loc: ['body', 'temperature'], msg: 'Input should be at least 0' }] },
      422,
    ),
    'temperature: Input should be at least 0',
  );
  assert.equal(
    await message(
      {
        detail: {
          type: 'not_found_error',
          code: 'model_not_supported_for_background',
          message: 'Background mode is not supported for this model',
          param: 'model',
        },
      },
      404,
    ),
    'Background mode is not supported for this model',
  );
  assert.equal(await message('', 502), 'Fireworks request failed with HTTP 502.');
});
