// Compile-time checks for Anthropic's registry entry, run by `pnpm check`.
import { test } from 'node:test';
import type {
  AnthropicOutputBlock,
  AssistantMessage,
  CompletionRequest,
  CompletionResponse,
} from '../src/index.ts';

const reply: AssistantMessage<'anthropic'> = {
  role: 'assistant',
  provider: 'anthropic',
  api: 'anthropic-messages',
  model: 'claude-haiku-5-5',
  id: 'msg_1',
  content: [
    { type: 'thinking', thinking: '', signature: 'EqQB...' },
    { type: 'text', text: 'Checking.', citations: null },
    {
      type: 'tool_use',
      id: 'toolu_1',
      name: 'read',
      input: { path: 'a' },
      caller: { type: 'direct' },
    },
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'x' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
  ],
};

const request: CompletionRequest<'anthropic'> = {
  provider: 'anthropic',
  credentials: { apiKey: 'sk-ant-test', workspaceId: 'wrkspc_1' },
  model: 'claude-haiku-5-5',
  instructions: [{ type: 'text', text: 'Be brief.' }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Read a.' }] },
    reply,
    {
      role: 'tool_result',
      toolCallId: 'toolu_1',
      toolName: 'read',
      isError: false,
      content: [{ type: 'text', text: 'contents' }],
    },
    { role: 'system', content: [{ type: 'text', text: 'Answer in French.' }] },
    {
      role: 'native',
      provider: 'anthropic',
      api: 'anthropic-messages',
      content: [{ type: 'search_result', source: 'https://a', title: 'A', content: [] }],
    },
  ],
  providerOptions: {
    max_tokens: 4096,
    betas: ['thinking-binding-controls-2026-08-01'],
    thinking: {
      type: 'adaptive',
      display: 'summarized',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    },
    output_config: { effort: 'high' },
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    cache_control: { type: 'ephemeral', ttl: '1h' },
    inference_geo: 'us',
  },
};

// A model outside the catalog is accepted.
const other: CompletionRequest<'anthropic'> = { ...request, model: 'claude-next' };

const badStream: CompletionRequest<'anthropic'> = {
  ...request,
  // @ts-expect-error `complete` returns one finished response.
  providerOptions: { stream: true },
};

const badCredentials: CompletionRequest<'anthropic'> = {
  ...request,
  // @ts-expect-error Anthropic credentials have no organization.
  credentials: { apiKey: 'sk-ant-test', organization: 'org_1' },
};

const badReply: AssistantMessage<'anthropic'> = {
  ...reply,
  // @ts-expect-error A Responses item is not an Anthropic block.
  content: [{ type: 'function_call', call_id: 'c1', name: 'read', arguments: '{}' }],
};

function read(response: CompletionResponse<'anthropic'>) {
  const block: AnthropicOutputBlock | undefined = response.message.content[0];
  const container: string | undefined = response.native.container?.id;
  const tier: string | null | undefined = response.native.usage?.service_tier;
  return [block, container, tier];
}

test('Anthropic types compile', () => {
  void [request, other, badStream, badCredentials, badReply, read];
});
