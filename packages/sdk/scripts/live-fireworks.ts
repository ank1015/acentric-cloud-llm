// Live checks against Fireworks, through the direct client or a running gateway.
//
//   FIREWORKS_API_KEY=... node --conditions=source scripts/live-fireworks.ts
//   FIREWORKS_API_KEY=... GATEWAY_URL=http://localhost:8787 node --conditions=source scripts/live-fireworks.ts
//
// Costs well under a cent. The key is read from the environment and never printed.

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

const apiKey = process.env.FIREWORKS_API_KEY;
if (!apiKey) throw new Error('Set FIREWORKS_API_KEY.');
const gateway = process.env.GATEWAY_URL;
const model = process.env.MODEL ?? 'accounts/fireworks/models/deepseek-v4p1-flash';
const credentials = { fireworks: { apiKey } };
const llm: LlmClient<'fireworks'> = gateway
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

const hi: Message<'fireworks'>[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];

function summary(response: CompletionResponse<'fireworks'>) {
  return {
    stop: response.stopReason,
    ...(response.providerStopReason ? { providerStop: response.providerStopReason } : {}),
    items: response.message.content.map((item) => item.type),
    usage: response.usage,
    native: Object.keys(response.native).sort(),
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

function brief(error: LlmError) {
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

await check('text, stateless, with reasoning', async () => {
  const response = await llm.complete({
    provider: 'fireworks',
    model,
    instructions: [
      { type: 'text', text: 'You are a terse assistant.' },
      { type: 'text', text: 'Answer with one word.' },
    ],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Reply with exactly the word pong.' }] },
    ],
    providerOptions: { store: false, reasoning: { effort: 'low' } },
  });
  assert.equal(response.stopReason, 'stop');
  assert.match(outputText(response.message).toLowerCase(), /pong/);
  assert.ok(response.usage?.cost, 'cost for a catalog model');
  assert.ok(reasoningSummary(response.message).length > 0, 'reasoning text');
  // A response that was not stored still has an ID, which cannot be chained on.
  assert.ok(response.id);
  const unstored = await failure(() =>
    llm.complete({
      provider: 'fireworks',
      model,
      messages: hi,
      providerOptions: { store: false, previous_response_id: response.id },
    }),
  );
  assert.equal(unstored.kind, 'not_found');
  assert.equal(unstored.providerParam, 'previous_response_id');
  return {
    ...summary(response),
    text: outputText(response.message),
    reasoning: reasoningSummary(response.message),
  };
});

await check('tool loop, stateless full replay with reasoning', async () => {
  const messages: Message<'fireworks'>[] = [
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
  const options = { store: false, reasoning: { effort: 'low' } } as const;
  const first = await llm.complete({
    provider: 'fireworks',
    model,
    messages,
    tools: [weather],
    providerOptions: options,
  });
  assert.equal(first.stopReason, 'tool_use');
  const calls = pendingToolCalls(first.message);
  assert.equal(calls[0]?.toolName, 'get_weather');
  const forecast = (call: (typeof calls)[number]) =>
    /rome/i.test(call.arguments ?? '') ? '{"tempC":24,"sky":"clear"}' : '{"tempC":12,"sky":"rain"}';
  messages.push(first.message, ...calls.map((call) => toolResult(call, forecast(call))));
  let turns = 1;
  let last = first;
  // Some models call the tool once per turn.
  while (last.stopReason === 'tool_use' && turns < 4) {
    if (last !== first) {
      messages.push(
        last.message,
        ...pendingToolCalls(last.message).map((call) => toolResult(call, forecast(call))),
      );
    }
    last = await llm.complete({
      provider: 'fireworks',
      model,
      messages,
      tools: [weather],
      providerOptions: options,
    });
    turns += 1;
  }
  assert.equal(last.stopReason, 'stop');
  assert.match(outputText(last.message), /Rome/);
  return {
    first: summary(first),
    calls: calls.map((call) => call.arguments),
    turns,
    last: summary(last),
    text: outputText(last.message),
  };
});

await check('tool loop, chained with previous_response_id', async () => {
  const first = await llm.complete({
    provider: 'fireworks',
    model,
    instructions: 'Give temperatures in Celsius with the unit.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Weather in Oslo? Use the tool.' }] },
    ],
    tools: [weather],
    providerOptions: { store: true, reasoning: { effort: 'low' } },
  });
  assert.equal(first.stopReason, 'tool_use');
  assert.ok(first.id, 'a stored response has an ID');
  const second = await llm.complete({
    provider: 'fireworks',
    model,
    // Instructions and tools are not inherited: send them again.
    instructions: 'Give temperatures in Celsius with the unit.',
    messages: pendingToolCalls(first.message).map((call) =>
      toolResult(call, '{"tempC":-3,"sky":"snow"}'),
    ),
    tools: [weather],
    providerOptions: { store: true, previous_response_id: first.id, reasoning: { effort: 'low' } },
  });
  assert.equal(second.stopReason, 'stop');
  assert.match(outputText(second.message), /-?3/);
  return { second: summary(second), text: outputText(second.message) };
});

await check('unknown previous_response_id is not_found on previous_response_id', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'fireworks',
      model,
      messages: hi,
      providerOptions: { previous_response_id: 'resp_00000000000000000000000000000000' },
    }),
  );
  assert.equal(error.kind, 'not_found');
  assert.equal(error.providerParam, 'previous_response_id');
  return brief(error);
});

await check('a rejected key is auth', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'fireworks',
      credentials: { apiKey: 'fw_invalid_key_for_testing' },
      model,
      messages: hi,
    }),
  );
  assert.equal(error.kind, 'auth');
  return brief(error);
});

await check('an unknown model is not_found on model', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'fireworks',
      model: 'accounts/fireworks/models/no-such-model',
      messages: hi,
    }),
  );
  assert.equal(error.kind, 'not_found');
  assert.equal(error.providerParam, 'model');
  return brief(error);
});

await check('a prompt over the context window is context_overflow', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'fireworks',
      model: 'accounts/fireworks/models/gpt-oss-120b',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello '.repeat(150_000) }] }],
      providerOptions: { store: false, max_output_tokens: 16 },
    }),
  );
  assert.equal(error.kind, 'context_overflow');
  return brief(error);
});

await check('a validation error names its field', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'fireworks',
      model,
      messages: hi,
      providerOptions: { store: false, temperature: -1 },
    }),
  );
  assert.equal(error.kind, 'invalid_request');
  assert.equal(error.providerParam, 'temperature');
  return brief(error);
});

await check('output limit is length', async () => {
  const response = await llm.complete({
    provider: 'fireworks',
    model,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Write a 500-word story about the sea.' }] },
    ],
    providerOptions: { store: false, max_output_tokens: 16, reasoning: { effort: 'none' } },
  });
  assert.equal(response.stopReason, 'length');
  return summary(response);
});

await check('mid-conversation system message and image input', async () => {
  // An 8x8 red PNG.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
  const response = await llm.complete({
    provider: 'fireworks',
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
    providerOptions: { store: false, reasoning: { effort: 'none' } },
  });
  assert.equal(response.stopReason, 'stop');
  assert.match(outputText(response.message), /RED/);
  return { ...summary(response), text: outputText(response.message) };
});

await check('structured output', async () => {
  const response = await llm.complete({
    provider: 'fireworks',
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Give the capital of Japan.' }] }],
    providerOptions: {
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'capital',
          strict: true,
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

await check('custom tools and files are refused before sending', async () => {
  const custom = await failure(() =>
    llm.complete({
      provider: 'fireworks',
      model,
      messages: hi,
      tools: [{ type: 'custom', name: 'patch', description: 'Apply a patch.' }],
    }),
  );
  const file = await failure(() =>
    llm.complete({
      provider: 'fireworks',
      model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'file', source: { type: 'url', url: 'https://example.com/a.pdf' } }],
        },
      ],
    }),
  );
  assert.equal(custom.kind, 'invalid_request');
  assert.equal(file.kind, 'invalid_request');
  return [custom.message, file.message];
});

console.log(`mode: ${gateway ? `gateway ${gateway}` : 'direct'}, model: ${model}`);
for (const [name, status, detail] of results) {
  console.log(`\n[${status}] ${name}`);
  console.log(JSON.stringify(detail, null, 1).replaceAll(apiKey, '<key>'));
}
process.exitCode = results.some(([, status]) => status === 'FAIL') ? 1 : 0;
