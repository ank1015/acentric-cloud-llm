// Live checks against OpenRouter, through the direct client or a running gateway.
//
//   OPENROUTER_API_KEY=... node --conditions=source scripts/live-openrouter.ts
//   OPENROUTER_API_KEY=... GATEWAY_URL=http://localhost:8787 node --conditions=source scripts/live-openrouter.ts
//
// Costs well under a cent. The key is read from the environment and never printed.

import assert from 'node:assert/strict';
import {
  createClient,
  LlmError,
  outputText,
  pendingToolCalls,
  toolResult,
  type CompletionResponse,
  type LlmClient,
  type Message,
  type ToolDefinition,
} from '../src/index.ts';
import { createDirectClient } from '../src/direct.ts';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error('Set OPENROUTER_API_KEY.');
const gateway = process.env.GATEWAY_URL;
const model = process.env.MODEL ?? 'meta/muse-spark-1.3-contributor';
const credentials = {
  openrouter: {
    apiKey,
    appUrl: 'https://github.com/acentric',
    appTitle: 'acentric-llm live checks',
  },
};
const llm: LlmClient<'openrouter'> = gateway
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

const hi: Message<'openrouter'>[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
const low = { reasoning: { effort: 'low' } } as const;

function summary(response: CompletionResponse<'openrouter'>) {
  return {
    stop: response.stopReason,
    ...(response.providerStopReason ? { providerStop: response.providerStopReason } : {}),
    model: response.message.model,
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

await check('text with encrypted reasoning and the reported cost', async () => {
  const response = await llm.complete({
    provider: 'openrouter',
    model,
    instructions: 'You are terse.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Reply with exactly the word pong.' }] },
    ],
    providerOptions: low,
  });
  assert.equal(response.stopReason, 'stop');
  assert.match(outputText(response.message).toLowerCase(), /pong/);
  assert.equal(response.usage?.cost?.source, 'reported');
  assert.ok((response.usage?.cost?.total ?? 0) > 0);
  assert.equal(response.native.usage?.is_byok, false);
  const thought = response.message.content.find((item) => item.type === 'reasoning');
  assert.ok(thought && 'encrypted_content' in thought && thought.encrypted_content);
  assert.ok(response.id?.startsWith('gen-'));
  return summary(response);
});

await check('tool loop, full replay with reasoning, three turns', async () => {
  const messages: Message<'openrouter'>[] = [
    { role: 'custom', tag: 'ui', data: 'never sent' },
    {
      role: 'user',
      content: [{ type: 'text', text: 'Check Paris and Tokyo with the tool. Which is warmer?' }],
    },
  ];
  const forecast = (args: string | undefined) => (/tokyo/i.test(args ?? '') ? '24°C' : '18°C');
  let last: CompletionResponse<'openrouter'> | undefined;
  let rounds = 0;
  while (rounds < 4) {
    last = await llm.complete({
      provider: 'openrouter',
      model,
      messages,
      tools: [weather],
      providerOptions: low,
    });
    messages.push(last.message);
    const calls = pendingToolCalls(last.message);
    if (last.stopReason !== 'tool_use' || !calls.length) break;
    messages.push(...calls.map((call) => toolResult(call, forecast(call.arguments))));
    rounds += 1;
  }
  assert.ok(last && rounds >= 1, 'called the tool');
  assert.equal(last.stopReason, 'stop');
  assert.match(outputText(last.message), /Tokyo/);
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: 'Without tools: by how many degrees? Number only.' }],
  });
  const third = await llm.complete({
    provider: 'openrouter',
    model,
    messages,
    tools: [weather],
    providerOptions: low,
  });
  assert.match(outputText(third.message), /6/);
  return { rounds, last: summary(last), third: summary(third), text: outputText(third.message) };
});

await check('the canonical slug answers as the ordinary model ID', async () => {
  const response = await llm.complete({
    provider: 'openrouter',
    model: `${model}-20260902`,
    messages: hi,
    providerOptions: low,
  });
  assert.equal(response.model, `${model}-20260902`);
  assert.equal(response.message.model, model);
  return {
    model: response.model,
    responseModel: response.responseModel,
    message: response.message.model,
  };
});

await check('stored state is invalid_request on its field', async () => {
  const store = await failure(() =>
    llm.complete({
      provider: 'openrouter',
      model,
      messages: hi,
      providerOptions: { store: true } as never,
    }),
  );
  const chained = await failure(() =>
    llm.complete({
      provider: 'openrouter',
      model,
      messages: hi,
      providerOptions: { previous_response_id: 'gen-1' } as never,
    }),
  );
  assert.deepEqual([store.kind, store.providerParam], ['invalid_request', 'store']);
  assert.deepEqual(
    [chained.kind, chained.providerParam],
    ['invalid_request', 'previous_response_id'],
  );
  return [brief(store), brief(chained)];
});

await check("an upstream's refusal names its field and message", async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'openrouter',
      model,
      messages: hi,
      tools: [weather],
      providerOptions: { ...low, tool_choice: 'required' },
    }),
  );
  assert.equal(error.kind, 'invalid_request');
  assert.equal(error.providerParam, 'tool_choice');
  assert.match(error.message, /^Meta returned an error: /);
  return brief(error);
});

await check('routing filters that leave no endpoint are not_found on provider', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'openrouter',
      model,
      messages: hi,
      providerOptions: { provider: { only: ['no-such-provider'] } },
    }),
  );
  assert.deepEqual([error.kind, error.providerParam], ['not_found', 'provider']);
  return brief(error);
});

await check('a rejected key is auth', async () => {
  const error = await failure(() =>
    llm.complete({
      provider: 'openrouter',
      credentials: { apiKey: 'sk-or-v1-invalid' },
      model,
      messages: hi,
    }),
  );
  assert.equal(error.kind, 'auth');
  return brief(error);
});

await check('an unknown model is not_found on model', async () => {
  const error = await failure(() =>
    llm.complete({ provider: 'openrouter', model: 'meta/no-such-model', messages: hi }),
  );
  assert.deepEqual([error.kind, error.providerParam], ['not_found', 'model']);
  return brief(error);
});

await check('output limit is length, and still charged', async () => {
  const response = await llm.complete({
    provider: 'openrouter',
    model,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Write a 500-word story about the sea.' }] },
    ],
    providerOptions: { ...low, max_output_tokens: 16 },
  });
  assert.equal(response.stopReason, 'length');
  assert.ok((response.usage?.cost?.total ?? 0) > 0);
  return summary(response);
});

await check('mid-conversation system message, image and PDF input', async () => {
  // A 64x64 red PNG: OpenRouter's models misread tiny images.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC';
  const response = await llm.complete({
    provider: 'openrouter',
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What single color is this image, and what does the PDF say?' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: png } },
          {
            type: 'file',
            filename: 'hello.pdf',
            source: {
              type: 'url',
              url: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/examples/learning/helloworld.pdf',
            },
          },
        ],
      },
      {
        role: 'system',
        content: [{ type: 'text', text: 'Answer as COLOR / TEXT, the color in uppercase.' }],
      },
    ],
    providerOptions: low,
  });
  assert.equal(response.stopReason, 'stop');
  assert.match(outputText(response.message), /RED/);
  assert.match(outputText(response.message), /hello,? world/i);
  return { ...summary(response), text: outputText(response.message) };
});

await check('structured output', async () => {
  const response = await llm.complete({
    provider: 'openrouter',
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Give the capital of Japan.' }] }],
    providerOptions: {
      ...low,
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

await check('custom tools and file IDs are refused before sending', async () => {
  const custom = await failure(() =>
    llm.complete({
      provider: 'openrouter',
      model,
      messages: hi,
      tools: [{ type: 'custom', name: 'patch', description: 'Apply a patch.' }],
    }),
  );
  const fileId = await failure(() =>
    llm.complete({
      provider: 'openrouter',
      model,
      messages: [
        { role: 'user', content: [{ type: 'file', source: { type: 'file_id', id: 'or_file_1' } }] },
      ],
    }),
  );
  assert.equal(custom.kind, 'invalid_request');
  assert.equal(fileId.kind, 'invalid_request');
  return [custom.message, fileId.message];
});

console.log(`mode: ${gateway ? `gateway ${gateway}` : 'direct'}, model: ${model}`);
for (const [name, status, detail] of results) {
  console.log(`\n[${status}] ${name}`);
  console.log(JSON.stringify(detail, null, 1).replaceAll(apiKey, '<key>'));
}
process.exitCode = results.some(([, status]) => status === 'FAIL') ? 1 : 0;
