// Compile-time checks for OpenRouter's registry entry, run by `pnpm check`.
import { test } from 'node:test';
import type {
  AssistantMessage,
  CompletionRequest,
  CompletionResponse,
  OpenRouterOutputItem,
  UsageCost,
} from '../src/index.ts';

const reply: AssistantMessage<'openrouter'> = {
  role: 'assistant',
  provider: 'openrouter',
  api: 'openai-responses',
  model: 'meta/muse-spark-1.3-contributor',
  id: 'gen-1',
  content: [
    {
      type: 'reasoning',
      id: 'rs_1:rs_2',
      summary: [],
      encrypted_content: 'opaque',
      format: 'meta-responses-v1',
      status: 'completed',
    },
    {
      type: 'function_call',
      id: 'fc_tmp_1',
      call_id: 'call_1',
      name: 'read',
      arguments: '{"path":"a"}',
      status: 'completed',
    },
    { type: 'openrouter:web_search', status: 'completed', query: 'x' },
  ],
};

const request: CompletionRequest<'openrouter'> = {
  provider: 'openrouter',
  credentials: { apiKey: 'sk-or-test', appUrl: 'https://example.com', appTitle: 'Example' },
  model: 'meta/muse-spark-1.3-contributor',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Read a.' }] },
    reply,
    {
      role: 'tool_result',
      toolCallId: 'call_1',
      toolName: 'read',
      content: [{ type: 'text', text: 'contents' }],
    },
  ],
  providerOptions: {
    reasoning: { effort: 'low' },
    provider: { order: ['meta'], allow_fallbacks: false, max_price: { prompt: 1 } },
    models: ['meta/muse-spark-1.3'],
    session_id: 'session-1',
    tools: [{ type: 'openrouter:web_search' }],
  },
};

// Any model ID, alias or variant is accepted.
const other: CompletionRequest<'openrouter'> = { ...request, model: 'deepseek/deepseek-v4:nitro' };

const stored: CompletionRequest<'openrouter'> = {
  ...request,
  // @ts-expect-error OpenRouter keeps nothing
  providerOptions: { store: true },
};

const chained: CompletionRequest<'openrouter'> = {
  ...request,
  // @ts-expect-error OpenRouter keeps nothing
  providerOptions: { previous_response_id: 'gen-1' },
};

const customCall: AssistantMessage<'openrouter'> = {
  ...reply,
  // @ts-expect-error no custom tool calls
  content: [{ type: 'custom_tool_call', call_id: 'c', name: 'n', input: 'x' }],
};

function narrowItems(item: OpenRouterOutputItem): string | undefined {
  switch (item.type) {
    case 'function_call':
      return item.arguments;
    case 'reasoning':
      return item.format ?? undefined;
    default:
      return undefined;
  }
}

function charged(
  response: CompletionResponse<'openrouter'>,
): UsageCost['source'] | number | undefined {
  return response.native.usage?.cost ?? response.usage?.cost?.source;
}

void [other, stored, chained, customCall, narrowItems, charged];

test('OpenRouter types compile', () => {});
