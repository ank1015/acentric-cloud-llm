// Compile-time checks for Fireworks' registry entry, run by `pnpm check`.
import { test } from 'node:test';
import type {
  AssistantMessage,
  CompletionRequest,
  CompletionResponse,
  FireworksOutputItem,
} from '../src/index.ts';

const reply: AssistantMessage<'fireworks'> = {
  role: 'assistant',
  provider: 'fireworks',
  api: 'openai-responses',
  model: 'accounts/fireworks/models/deepseek-v4p1-flash',
  id: 'resp_1',
  content: [
    { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Thinking.' }] },
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'read',
      arguments: '{"path":"a"}',
      status: 'completed',
    },
  ],
};

const request: CompletionRequest<'fireworks'> = {
  provider: 'fireworks',
  credentials: { apiKey: 'fw_test' },
  model: 'accounts/fireworks/models/deepseek-v4p1-flash',
  instructions: 'Be brief.',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Read a.' }] },
    reply,
    {
      role: 'tool_result',
      toolCallId: 'call_1',
      toolName: 'read',
      content: [{ type: 'text', text: 'contents' }],
    },
    {
      role: 'native',
      provider: 'fireworks',
      api: 'openai-responses',
      content: [{ type: 'item_reference', id: 'msg_1' }],
    },
  ],
  providerOptions: {
    store: false,
    reasoning: { effort: 'low' },
    prompt_cache_key: 'session-1',
    tools: [{ type: 'mcp', server_url: 'https://mcp.example.com/sse' }],
  },
};

// Any model, deployment or router ID is accepted.
const deployment: CompletionRequest<'fireworks'> = {
  ...request,
  model: 'accounts/acme/deployments/abc123',
};

const streaming: CompletionRequest<'fireworks'> = {
  ...request,
  // @ts-expect-error complete never streams
  providerOptions: { stream: true },
};

const openAiOnly: CompletionRequest<'fireworks'> = {
  ...request,
  // @ts-expect-error OpenAI's options are not Fireworks'
  providerOptions: { context_management: [] },
};

const customCall: AssistantMessage<'fireworks'> = {
  ...reply,
  // @ts-expect-error Fireworks has no custom tool calls
  content: [{ type: 'custom_tool_call', call_id: 'c', name: 'n', input: 'x' }],
};

function narrowItems(item: FireworksOutputItem): string | undefined {
  switch (item.type) {
    case 'function_call':
      return item.arguments;
    case 'reasoning':
      return item.summary[0]?.text;
    default:
      return undefined;
  }
}

function createdAt(response: CompletionResponse<'fireworks'>) {
  return response.native.created_at;
}

void [deployment, streaming, openAiOnly, customCall, narrowItems, createdAt];

test('Fireworks types compile', () => {});
