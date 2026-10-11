// Live checks against OpenAI, through the direct client or a running gateway.
//
//   OPENAI_API_KEY=... node --conditions=source scripts/live-openai.ts
//   OPENAI_API_KEY=... GATEWAY_URL=http://localhost:8787 node --conditions=source scripts/live-openai.ts
//
// Costs a few cents. The key is read from the environment and never printed.

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

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY.');
const gateway = process.env.GATEWAY_URL;
const model = process.env.MODEL ?? 'gpt-6-luna';
const credentials = { openai: { apiKey } };
const llm: LlmClient<'openai'> = gateway
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

function summary(response: CompletionResponse<'openai'>) {
  return {
    stop: response.stopReason,
    ...(response.providerStopReason ? { providerStop: response.providerStopReason } : {}),
    items: response.message.content.map((item) => item.type),
    usage: response.usage,
    native: Object.keys(response.native).sort(),
    ms: response.durationMs,
  };
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

await check('text, stateless', async () => {
  const response = await llm.complete({
    provider: 'openai',
    model,
    instructions: [
      { type: 'text', text: 'You are a terse assistant.' },
      { type: 'text', text: 'Answer with one word.' },
    ],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Reply with exactly the word pong.' }] },
    ],
    providerOptions: { store: false, reasoning: { effort: 'low', summary: 'auto' } },
  });
  assert.equal(response.stopReason, 'stop');
  assert.match(outputText(response.message).toLowerCase(), /pong/);
  assert.ok(response.usage?.cost, 'cost for a catalog model');
  return {
    ...summary(response),
    text: outputText(response.message),
    reasoning: reasoningSummary(response.message),
  };
});

await check('tool loop, stateless full replay', async () => {
  const messages: Message<'openai'>[] = [
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
  const first = await llm.complete({
    provider: 'openai',
    model,
    messages,
    tools: [weather],
    providerOptions: { store: false, reasoning: { effort: 'high', summary: 'auto' } },
  });
  assert.equal(first.stopReason, 'tool_use');
  const calls = pendingToolCalls(first.message);
  assert.equal(calls[0]?.toolName, 'get_weather');
  const forecast = (call: (typeof calls)[number]) =>
    /rome/i.test(call.arguments ?? '') ? '{"tempC":24,"sky":"clear"}' : '{"tempC":12,"sky":"rain"}';
  messages.push(first.message, ...calls.map((call) => toolResult(call, forecast(call))));
  const second = await llm.complete({
    provider: 'openai',
    model,
    messages,
    tools: [weather],
    providerOptions: { store: false, reasoning: { effort: 'high', summary: 'auto' } },
  });
  assert.equal(second.stopReason, 'stop');
  assert.match(outputText(second.message), /Rome/);
  return {
    first: summary(first),
    calls: calls.map((call) => call.arguments),
    second: summary(second),
    text: outputText(second.message),
  };
});

await check('stateless replay of encrypted reasoning', async () => {
  const messages: Message<'openai'>[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Is 391 prime? Think it through, then answer yes or no.' }],
    },
  ];
  const options = { store: false, reasoning: { effort: 'medium', summary: 'auto' } } as const;
  const first = await llm.complete({
    provider: 'openai',
    model,
    messages,
    providerOptions: options,
  });
  const reasoning = first.message.content.find((item) => item.type === 'reasoning');
  assert.ok(
    reasoning && reasoning.type === 'reasoning' && reasoning.encrypted_content,
    'an encrypted reasoning item',
  );
  messages.push(first.message, {
    role: 'user',
    content: [
      { type: 'text', text: 'What are its two prime factors? Answer with just the two numbers.' },
    ],
  });
  const second = await llm.complete({
    provider: 'openai',
    model,
    messages,
    providerOptions: options,
  });
  assert.equal(second.stopReason, 'stop');
  assert.match(outputText(second.message), /17/);
  assert.match(outputText(second.message), /23/);
  return {
    first: {
      ...summary(first),
      text: outputText(first.message),
      summary: reasoningSummary(first.message),
    },
    second: { ...summary(second), text: outputText(second.message) },
  };
});

await check('tool loop, chained with previous_response_id', async () => {
  const first = await llm.complete({
    provider: 'openai',
    model,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Weather in Oslo? Use the tool.' }] },
    ],
    tools: [weather],
    providerOptions: { store: true, reasoning: { effort: 'low' } },
  });
  assert.equal(first.stopReason, 'tool_use');
  const second = await llm.complete({
    provider: 'openai',
    model,
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

await check('unknown previous_response_id is not_found', async () => {
  try {
    await llm.complete({
      provider: 'openai',
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      providerOptions: { previous_response_id: 'resp_does_not_exist_0000000000000000' },
    });
  } catch (error) {
    assert.ok(LlmError.is(error));
    assert.equal(error.kind, 'not_found');
    return error.toJSON();
  }
  assert.fail('expected an error');
});

await check('a rejected key is auth', async () => {
  try {
    await llm.complete({
      provider: 'openai',
      credentials: { apiKey: 'sk-invalid-key-for-testing' },
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
  } catch (error) {
    assert.ok(LlmError.is(error));
    assert.equal(error.kind, 'auth');
    const { providerError: _body, ...rest } = error.toJSON();
    return rest;
  }
  assert.fail('expected an error');
});

await check('output limit is length', async () => {
  const response = await llm.complete({
    provider: 'openai',
    model,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Write a 500-word story about the sea.' }] },
    ],
    providerOptions: { store: false, max_output_tokens: 16, reasoning: { effort: 'low' } },
  });
  assert.equal(response.stopReason, 'length');
  return summary(response);
});

await check('custom tool, mid-conversation system message, image input', async () => {
  // An 8x8 red PNG.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
  const response = await llm.complete({
    provider: 'openai',
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What single color is this image? Record it with the record_color tool.',
          },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: png } },
        ],
      },
      {
        role: 'system',
        content: [{ type: 'text', text: 'Always use the record_color tool for colors.' }],
      },
    ],
    tools: [
      { type: 'custom', name: 'record_color', description: 'Records a color name as plain text.' },
    ],
    providerOptions: {
      store: false,
      reasoning: { effort: 'low' },
      tool_choice: { type: 'custom', name: 'record_color' },
    },
  });
  assert.equal(response.stopReason, 'tool_use');
  const [call] = pendingToolCalls(response.message);
  assert.equal(call?.toolType, 'custom');
  return { ...summary(response), input: call?.input };
});

await check('structured output', async () => {
  const response = await llm.complete({
    provider: 'openai',
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Give the capital of Japan.' }] }],
    providerOptions: {
      store: false,
      reasoning: { effort: 'low' },
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

console.log(`mode: ${gateway ? `gateway ${gateway}` : 'direct'}, model: ${model}`);
for (const [name, status, detail] of results) {
  console.log(`\n[${status}] ${name}`);
  console.log(JSON.stringify(detail, null, 1).replaceAll(apiKey, '<key>'));
}
process.exitCode = results.some(([, status]) => status === 'FAIL') ? 1 : 0;
