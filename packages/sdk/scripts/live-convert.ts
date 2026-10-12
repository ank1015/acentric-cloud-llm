// Live check of `convert`: one conversation moves OpenAI → Anthropic →
// Fireworks → OpenRouter → OpenAI, with tool loops on the way, through the
// direct client.
//
//   OPENAI_API_KEY=... ANTHROPIC_API_KEY=... FIREWORKS_API_KEY=... OPENROUTER_API_KEY=... \
//     node --conditions=source scripts/live-convert.ts
//
// Costs well under a cent. Keys are read from the environment and never printed.

import assert from 'node:assert/strict';
import {
  convert,
  outputText,
  pendingToolCalls,
  toolResult,
  type CompletionResponse,
  type ConversionChange,
  type ConvertOptions,
  type Message,
  type Provider,
  type ToolDefinition,
} from '../src/index.ts';
import { createDirectClient } from '../src/direct.ts';

function key(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

const llm = createDirectClient({
  credentials: {
    openai: { apiKey: key('OPENAI_API_KEY') },
    anthropic: { apiKey: key('ANTHROPIC_API_KEY') },
    fireworks: { apiKey: key('FIREWORKS_API_KEY') },
    openrouter: { apiKey: key('OPENROUTER_API_KEY') },
  },
});

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

const FORECASTS: Record<string, string> = {
  paris: '{"tempC":12,"sky":"rain"}',
  rome: '{"tempC":24,"sky":"clear"}',
  oslo: '{"tempC":-3,"sky":"snow"}',
};

function forecast(args: string | undefined): string {
  const city = Object.keys(FORECASTS).find((name) => args?.toLowerCase().includes(name));
  return city ? FORECASTS[city]! : '{"error":"unknown city"}';
}

const OPTIONS = {
  openai: {
    store: false,
    include: ['reasoning.encrypted_content'],
    reasoning: { effort: 'high', summary: 'auto' },
  },
  anthropic: {
    max_tokens: 4096,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: 'max' },
  },
  fireworks: { store: false, reasoning: { effort: 'low' } },
  openrouter: { reasoning: { effort: 'low' } },
} as const;

type Target = { provider: Provider; model: string };
let conversation: Message[] = [];
const log: unknown[] = [];

let lastChanges: readonly ConversionChange[] = [];

/** Converts the conversation for `to`, then runs a tool loop there until it answers. */
async function turn(to: Target, ask: string, options: ConvertOptions = {}): Promise<string> {
  const { messages, changes } = convert(conversation, to, options);
  lastChanges = changes;
  conversation = [...messages, { role: 'user', content: [{ type: 'text', text: ask }] }];
  let response: CompletionResponse;
  let rounds = 0;
  while (true) {
    response = await llm.complete({
      provider: to.provider,
      model: to.model,
      messages: conversation,
      tools: [weather],
      providerOptions: OPTIONS[to.provider],
    } as never);
    conversation.push(response.message);
    const calls = pendingToolCalls(response.message);
    if (response.stopReason !== 'tool_use' || !calls.length || ++rounds > 4) break;
    conversation.push(...calls.map((call) => toolResult(call, forecast(call.arguments))));
  }
  const text = outputText(response.message);
  log.push({
    to,
    changes: changes.map(
      ({ index, action, what, detail }: ConversionChange) =>
        `${index} ${action} ${what}: ${detail}`,
    ),
    blocks: response.message.content.map((item) => (item as { type: string }).type),
    stop: response.stopReason,
    rounds,
    text,
  });
  assert.equal(response.stopReason, 'stop', `${to.provider} answered`);
  return text;
}

const steps: [string, () => Promise<void>][] = [
  [
    'OpenAI: two calls',
    async () => {
      const text = await turn(
        { provider: 'openai', model: 'gpt-6-luna' },
        'I land at 17:40, clear the airport in 25 minutes and take a 19-minute train; sunset is 18:31. ' +
          'Work out whether I reach the city before sunset. Then check Paris and Rome with the tool ' +
          'and pick one for a picnic, in two sentences.',
      );
      assert.match(text, /Rome/);
    },
  ],
  [
    'Anthropic: continues with OpenAI history',
    async () => {
      const text = await turn(
        { provider: 'anthropic', model: 'claude-haiku-5-5' },
        'Now check Oslo with the tool and tell me its temperature.',
      );
      assert.match(text, /-\s?3|−3|minus 3/i);
      assert.ok(
        lastChanges.some((change) => change.what === 'reasoning' && change.action === 'dropped'),
        "OpenAI's encrypted reasoning was dropped",
      );
    },
  ],
  [
    'Fireworks: continues, reasoning kept as text',
    async () => {
      const text = await turn(
        { provider: 'fireworks', model: 'accounts/fireworks/models/deepseek-v4p1-flash' },
        'Without calling tools again: which of the three cities was coldest? One word.',
        { reasoning: 'text' },
      );
      assert.match(text, /Oslo/);
      assert.ok(
        lastChanges.some((change) => change.what === 'reasoning' && change.action === 'rewritten'),
        'reasoning was carried as text',
      );
    },
  ],
  [
    'OpenRouter: continues with the mixed history and calls the tool',
    async () => {
      const text = await turn(
        { provider: 'openrouter', model: 'meta/muse-spark-1.3-contributor' },
        'Check Rome again with the tool and tell me if it changed. One sentence.',
      );
      assert.match(text, /24/);
      assert.ok(
        lastChanges.some((change) => change.what === 'reasoning' && change.action === 'dropped'),
        "the other providers' reasoning was dropped",
      );
    },
  ],
  [
    'OpenAI: another model reads the whole mixed history',
    async () => {
      const text = await turn(
        { provider: 'openai', model: 'gpt-6.1-sol' },
        'Without calling tools: list the three temperatures you saw, warmest first.',
      );
      assert.match(text, /24[\s\S]*12[\s\S]*-?\s?3/);
    },
  ],
];

let failed = false;
for (const [name, run] of steps) {
  try {
    await run();
    console.log(`[ok] ${name}`);
  } catch (error) {
    failed = true;
    console.log(`[FAIL] ${name}: ${error instanceof Error ? error.message : String(error)}`);
    break;
  }
}
console.log(JSON.stringify(log, null, 1));
process.exitCode = failed ? 1 : 0;
