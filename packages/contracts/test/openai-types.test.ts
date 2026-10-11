// Compile-time checks for OpenAI's registry entry, run by `pnpm check`.
import { test } from 'node:test';
import type {
  AssistantMessage,
  CompletionRequest,
  CompletionResponse,
  OpenAiOutputItem,
} from '../src/index.ts';

const reply: AssistantMessage<'openai'> = {
  role: 'assistant',
  provider: 'openai',
  api: 'openai-responses',
  model: 'gpt-6.1-sol',
  id: 'resp_1',
  content: [
    { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' },
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      phase: 'commentary',
      content: [{ type: 'output_text', text: 'Looking.', annotations: [] }],
    },
    { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"path":"a"}' },
    { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search' } },
  ],
};

const request: CompletionRequest<'openai'> = {
  provider: 'openai',
  credentials: { apiKey: 'sk', project: 'proj_1' },
  model: 'gpt-6.1-sol',
  instructions: 'Be brief.',
  messages: [
    { role: 'user', content: [{ type: 'image', source: { type: 'file_id', id: 'file_1' } }] },
    reply,
    {
      role: 'tool_result',
      toolCallId: 'call_1',
      toolName: 'read',
      content: [{ type: 'text', text: 'contents' }],
      providerOptions: { caller: { type: 'program', caller_id: 'call_p' } },
    },
    {
      role: 'native',
      provider: 'openai',
      api: 'openai-responses',
      content: [{ type: 'mcp_approval_response', approval_request_id: 'mcpr_1', approve: true }],
    },
  ],
  providerOptions: {
    store: false,
    previous_response_id: 'resp_0',
    reasoning: { effort: 'high', summary: 'auto' },
    tools: [{ type: 'web_search' }],
    context_management: [{ type: 'compaction', compact_threshold: 200_000 }],
  },
};

const streaming: CompletionRequest<'openai'> = {
  ...request,
  // @ts-expect-error complete never streams
  providerOptions: { stream: true },
};

function narrowItems(item: OpenAiOutputItem): string | undefined {
  switch (item.type) {
    case 'function_call':
      return item.arguments;
    case 'message':
      return item.phase ?? undefined;
    case 'mcp_approval_request':
      return item.server_label;
    default:
      return undefined;
  }
}

function serviceTier(response: CompletionResponse<'openai'>) {
  return response.native.service_tier;
}

void [request, streaming, narrowItems, serviceTier];

test('OpenAI types compile', () => {});
