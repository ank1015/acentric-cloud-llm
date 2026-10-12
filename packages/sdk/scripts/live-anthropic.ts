// Live checks against Anthropic, through the direct client or a running gateway.
//
//   ANTHROPIC_API_KEY=... node --conditions=source scripts/live-anthropic.ts
//   ANTHROPIC_API_KEY=... GATEWAY_URL=http://localhost:8787 node --conditions=source scripts/live-anthropic.ts
//
// Costs about a cent, most of it the prompt-cache check. The context-overflow
// check uploads about 6 MB, which Anthropic refuses before billing. The key is
// read from the environment and never printed.

import assert from 'node:assert/strict';
import {
  createClient,
  LlmError,
  outputText,
  pendingToolCalls,
  reasoningSummary,
  toolResult,
  type CompletionResponse,
  type LlmClient,
  type Message,
  type ToolDefinition,
} from '../src/index.ts';
import { createDirectClient } from '../src/direct.ts';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY.');
const gateway = process.env.GATEWAY_URL;
const model = process.env.MODEL ?? 'claude-haiku-5-5';
const credentials = { anthropic: { apiKey } };
const llm: LlmClient<'anthropic'> = gateway
  ? createClient({ baseUrl: gateway, credentials })
  : createDirectClient({ credentials });

const weather: ToolDefinition = {
  type: 'function',
  name: 'get_weather',
  description: 'Current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
  strict: true,
};

const hi: Message<'anthropic'>[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
const brief = { max_tokens: 1024 } as const;

function summary(response: CompletionResponse<'anthropic'>) {
  return {
    stop: response.stopReason,
    ...(response.providerStopReason ? { providerStop: response.providerStopReason } : {}),
    blocks: response.message.content.map((block) => block.type),
    usage: response.usage,
    native: response.native,
    ms: response.durationMs,
  };
}

async function failure(run: () => Promise<unknown>): Promise<LlmError> {
  try {
    await run();
  } catch (error) {
    assert.ok(LlmError.is(error), `an LlmError, not ${String(error)}`);
    return error;
  }
  assert.fail('expected an error');
}

function errorBrief(error: LlmError) {
  const { providerError: _body, nativeError: _native, ...rest } = error.toJSON();
  return rest;
}

const results: [string, 'ok' | 'FAIL', unknown][] = [];
async function check(name: string, run: () => Promise<unknown>) {
  try {
    results.push([name, 'ok', await run()]);
  } catch (error) {
    const detail = LlmError.is(error)
      ? error.toJSON()
      : error instanceof Error
        ? error.message
        : error;
    results.push([name, 'FAIL', detail]);
  }
}

await check('text with summarized thinking, default max_tokens', async () => {
  const response = await llm.complete({
    provider: 'anthropic',
    model,
    instructions: 'You are a terse assistant. Answer with one word.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'A train leaves at 17:40 and takes 47 minutes. Reply with exactly the word pong if it arrives before 18:30, else ping.',
          },
        ],
      },
    ],
    providerOptions: {
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    },
  });
  assert.equal(response.stopReason, 'stop');
  assert.equal(response.providerStopReason, 'end_turn');
  assert.match(outputText(response.message).toLowerCase(), /pong/);
  assert.ok(response.usage?.cost, 'cost for a catalog model');
  assert.ok(response.id?.startsWith('msg_'));
  assert.equal(response.native.usage?.service_tier, 'standard');
  return {
    ...summary(response),
    text: outputText(response.message),
    reasoning: reasoningSummary(response.message),
  };
});

await check('tool loop with thinking, full replay, results as separate messages', async () => {
  const messages: Message<'anthropic'>[] = [
    { role: 'custom', tag: 'ui', data: 'never sent' },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'I am choosing between Paris and Rome for a picnic tomorrow. Check both with the tool, then pick one and say why in one sentence.',
        },
      ],
    },
  ];
  const options = { ...brief, thinking: { type: 'adaptive', display: 'summarized' } } as const;
  const forecast = (args: string | undefined) =>
    /rome/i.test(args ?? '') ? '{"tempC":24,"sky":"clear"}' : '{"tempC":12,"sky":"rain"}';
  let last = await llm.complete({
    provider: 'anthropic',
    model,
    messages,
    tools: [weather],
    providerOptions: options,
  });
  const first = last;
  let turns = 1;
  while (last.stopReason === 'tool_use' && turns < 4) {
    messages.push(
      last.message,
      ...pendingToolCalls(last.message).map((call) =>
        toolResult(call, forecast(call.arguments), { isError: false }),
      ),
    );
    last = await llm.complete({
      provider: 'anthropic',
      model,
      messages,
      tools: [weather],
      providerOptions: options,
    });
    turns += 1;
  }
  assert.equal(first.stopReason, 'tool_use');
  assert.equal(last.stopReason, 'stop');
  assert.match(outputText(last.message), /Rome/);
  return {
    first: summary(first),
    calls: pendingToolCalls(first.message).map((call) => call.arguments),
    turns,
    last: summary(last),
    text: outputText(last.message),
  };
});

await check("another model's thinking is left out on replay", async () => {
  const messages: Message<'anthropic'>[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'I land in Oslo at 17:40, clear the airport in 25 minutes and take a 19-minute train. Sunset is 18:31. Work out whether I reach the city before sunset, then check the Oslo weather with the tool.',
        },
      ],
    },
  ];
  const first = await llm.complete({
    provider: 'anthropic',
    model,
    messages,
    tools: [weather],
    providerOptions: {
      ...brief,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'max' },
    },
  });
  assert.equal(first.stopReason, 'tool_use');
  assert.ok(
    first.message.content.some((block) => block.type === 'thinking'),
    'thinking to strip',
  );
  messages.push(
    first.message,
    ...pendingToolCalls(first.message).map((call) => toolResult(call, '{"tempC":-3,"sky":"snow"}')),
  );
  const second = await llm.complete({
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    messages,
    tools: [weather],
    providerOptions: brief,
  });
  assert.equal(second.stopReason, 'stop');
  assert.match(outputText(second.message), /-?3|snow/i);
  return { firstBlocks: first.message.content.map((b) => b.type), second: summary(second) };
});

await check('prompt cache: system blocks with a one-hour breakpoint', async () => {
  // Enough text to pass the minimum cacheable length; a random tag keeps the prefix new.
  const tag = Math.random().toString(36).slice(2);
  const manual =
    `Reference ${tag}.\n` + 'The quick brown fox jumps over the lazy dog. '.repeat(160);
  const call = () =>
    llm.complete({
      provider: 'anthropic',
      model,
      instructions: [
        { type: 'text', text: 'Answer from the manual in one word.' },
        {
          type: 'text',
          text: manual,
          providerOptions: { cache_control: { type: 'ephemeral', ttl: '1h' } },
        },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Which animal jumps?' }] }],
      providerOptions: { ...brief, thinking: { type: 'disabled' } },
    });
  const write = await call();
  const read = await call();
  assert.ok((write.usage?.cacheWrite ?? 0) > 1000, 'the first call writes the cache');
  assert.ok((read.usage?.cacheRead ?? 0) > 1000, 'the second call reads it');
  assert.ok(write.usage?.cost?.cacheWrite, 'one-hour writes are priced');
  assert.equal(
    write.usage?.totalInput,
    (write.usage?.input ?? 0) + (write.usage?.cacheWrite ?? 0) + (write.usage?.cacheRead ?? 0),
  );
  return { write: write.usage, writeNative: write.native.usage, read: read.usage };
});

await check('mid-conversation system message and image input', async () => {
  // An 8x8 red PNG.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
  const response = await llm.complete({
    provider: 'anthropic',
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What single color is this image?' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: png } },
        ],
      },
      {
        role: 'system',
        content: [{ type: 'text', text: 'Answer with the color name in uppercase only.' }],
      },
    ],
    providerOptions: brief,
  });
  assert.equal(response.stopReason, 'stop');
  assert.match(outputText(response.message), /RED/);
  return { ...summary(response), text: outputText(response.message) };
});

await check('a plain-text file part becomes a text document', async () => {
  const note = Buffer.from('The vault code is 4417. Do not share it with anyone but Sam.').toString(
    'base64',
  );
  const response = await llm.complete({
    provider: 'anthropic',
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            source: { type: 'base64', mediaType: 'text/plain', data: note },
            filename: 'vault.txt',
          },
          {
            type: 'text',
            text: 'What is the vault code in vault.txt? Answer with the number only.',
          },
        ],
      },
    ],
    providerOptions: brief,
  });
  assert.match(outputText(response.message), /4417/);
  return { text: outputText(response.message), usage: response.usage };
});

await check('structured output', async () => {
  const response = await llm.complete({
    provider: 'anthropic',
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Give the capital of Japan.' }] }],
    providerOptions: {
      ...brief,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { country: { type: 'string' }, capital: { type: 'string' } },
            required: ['country', 'capital'],
            additionalProperties: false,
          },
        },
      },
    },
  });
  const parsed = JSON.parse(outputText(response.message));
  assert.equal(parsed.capital, 'Tokyo');
  return parsed;
});

await check('stop sequence and output limit', async () => {
  const stopped = await llm.complete({
    provider: 'anthropic',
    model,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Count from 1 to 10, one number per line.' }],
      },
    ],
    providerOptions: { ...brief, thinking: { type: 'disabled' }, stop_sequences: ['5'] },
  });
  assert.equal(stopped.stopReason, 'stop');
  assert.equal(stopped.providerStopReason, 'stop_sequence');
  assert.equal(stopped.native.stop_sequence, '5');
  const cut = await llm.complete({
    provider: 'anthropic',
    model,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Write a 500-word story about the sea.' }] },
    ],
    providerOptions: { max_tokens: 16, thinking: { type: 'disabled' } },
  });
  assert.equal(cut.stopReason, 'length');
  assert.equal(cut.providerStopReason, 'max_tokens');
  return { stopped: summary(stopped), cut: summary(cut) };
});

await check('a beta option with its header', async () => {
  const response = await llm.complete({
    provider: 'anthropic',
    model,
    messages: hi,
    providerOptions: {
      ...brief,
      betas: ['thinking-binding-controls-2026-08-01'],
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'error' } },
    },
  });
  const missing = await failure(() =>
    llm.complete({
      provider: 'anthropic',
      model,
      messages: hi,
      providerOptions: {
        ...brief,
        thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'error' } },
      },
    }),
  );
  const unknown = await failure(() =>
    llm.complete({
      provider: 'anthropic',
      model,
      messages: hi,
      providerOptions: { ...brief, betas: ['no-such-beta-2026-01-01'] },
    }),
  );
  assert.equal(response.stopReason, 'stop');
  assert.equal(missing.kind, 'invalid_request');
  assert.equal(unknown.kind, 'invalid_request');
  return { missing: missing.message, unknown: unknown.message };
});

await check('a rejected key is auth', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'anthropic',
      credentials: { apiKey: 'sk-ant-invalid-key-for-testing' },
      model,
      messages: hi,
      providerOptions: brief,
    }),
  );
  assert.equal(error.kind, 'auth');
  assert.equal(error.retryable, false);
  assert.ok(error.requestId?.startsWith('req_'));
  return errorBrief(error);
});

await check('an unknown model is not_found on model', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'anthropic',
      model: 'claude-no-such-model',
      messages: hi,
      providerOptions: brief,
    }),
  );
  assert.equal(error.kind, 'not_found');
  assert.equal(error.providerParam, 'model');
  return errorBrief(error);
});

await check('a validation error names its field', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'anthropic',
      model,
      messages: hi,
      providerOptions: { max_tokens: 200_000 },
    }),
  );
  assert.equal(error.kind, 'invalid_request');
  assert.equal(error.providerParam, 'max_tokens');
  return errorBrief(error);
});

await check('a prompt over the context window is context_overflow', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'anthropic',
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello '.repeat(1_100_000) }] }],
      providerOptions: { max_tokens: 16 },
    }),
  );
  assert.equal(error.kind, 'context_overflow');
  return errorBrief(error);
});

await check('custom tools and streaming are refused before sending', async () => {
  const custom = await failure(() =>
    llm.complete({
      provider: 'anthropic',
      model,
      messages: hi,
      tools: [{ type: 'custom', name: 'patch', description: 'Apply a patch.' }],
    }),
  );
  const stream = await failure(() =>
    llm.complete({
      provider: 'anthropic',
      model,
      messages: hi,
      providerOptions: { stream: true } as never,
    }),
  );
  assert.equal(custom.kind, 'invalid_request');
  assert.equal(stream.kind, 'invalid_request');
  assert.equal(custom.requestId, undefined);
  return [custom.message, stream.message];
});

console.log(`mode: ${gateway ? `gateway ${gateway}` : 'direct'}, model: ${model}`);
for (const [name, status, detail] of results) {
  console.log(`\n[${status}] ${name}`);
  console.log(JSON.stringify(detail, null, 1).replaceAll(apiKey, '<key>'));
}
process.exitCode = results.some(([, status]) => status === 'FAIL') ? 1 : 0;
