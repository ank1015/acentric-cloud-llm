import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantMessage, Message } from '@acentric-llm/contracts';
import { complete, convert, type ConversionChange } from '../src/index.ts';
import { fakeFetch } from './support.ts';

const user: Message = {
  role: 'user',
  content: [
    {
      type: 'text',
      text: 'Weather in Oslo?',
      providerOptions: { prompt_cache_breakpoint: { mode: 'explicit' } },
    },
    {
      type: 'image',
      source: { type: 'url', url: 'https://example.com/a.png' },
      providerOptions: { detail: 'low', future_option: 1 },
    },
  ],
};

const openAiReply = {
  role: 'assistant',
  provider: 'openai',
  api: 'openai-responses',
  model: 'gpt-6-luna',
  id: 'resp_1',
  content: [
    {
      type: 'reasoning',
      id: 'rs_1',
      summary: [{ type: 'summary_text', text: 'Check the weather first.' }],
      encrypted_content: 'gAAAA-opaque',
    },
    { type: 'web_search_call', id: 'ws_1', status: 'completed' },
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      phase: 'commentary',
      content: [
        { type: 'output_text', text: 'Checking ', annotations: [] },
        {
          type: 'output_text',
          text: 'Oslo.',
          annotations: [
            { type: 'url_citation', url: 'https://a', title: 'A', start_index: 0, end_index: 4 },
          ],
        },
      ],
    },
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'functions.get_weather:0',
      name: 'get_weather',
      arguments: '{"city":"Oslo"}',
      caller: { type: 'program', caller_id: 'ci_1' },
      status: 'completed',
    },
    {
      type: 'custom_tool_call',
      id: 'ctc_1',
      call_id: 'call_patch',
      name: 'patch',
      input: '*** diff',
    },
  ],
} as AssistantMessage<'openai'>;

const openAiResults: Message[] = [
  {
    role: 'tool_result',
    toolCallId: 'functions.get_weather:0',
    toolName: 'get_weather',
    content: [{ type: 'text', text: 'Snow, -3C' }],
    providerOptions: { caller: { type: 'program', caller_id: 'ci_1' } },
  },
  {
    role: 'tool_result',
    toolCallId: 'call_patch',
    toolName: 'patch',
    toolType: 'custom',
    content: [{ type: 'text', text: 'applied' }],
  },
];

const anthropicReply = {
  role: 'assistant',
  provider: 'anthropic',
  api: 'anthropic-messages',
  model: 'claude-haiku-5-5',
  id: 'msg_01',
  content: [
    { type: 'thinking', thinking: 'Oslo in October: look it up.', signature: 'EqQB...' },
    { type: 'redacted_thinking', data: 'EmwK...' },
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Oslo' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
    { type: 'text', text: 'It is ', citations: null },
    {
      type: 'text',
      text: 'cold.',
      citations: [{ type: 'web_search_result_location', url: 'https://a' }],
    },
    {
      type: 'tool_use',
      id: 'toolu_1',
      name: 'get_weather',
      input: { city: 'Oslo' },
      caller: { type: 'direct' },
    },
  ],
} as AssistantMessage<'anthropic'>;

const anthropicResult: Message = {
  role: 'tool_result',
  toolCallId: 'toolu_1',
  toolName: 'get_weather',
  isError: false,
  content: [
    { type: 'text', text: 'Snow, -3C', providerOptions: { cache_control: { type: 'ephemeral' } } },
  ],
  providerOptions: { toolset_name: 'weather' },
};

function whats(changes: readonly ConversionChange[]): string[] {
  return changes.map(({ index, action, what, detail }) => `${index} ${action} ${what}: ${detail}`);
}

test('messages already fit for the target come back unchanged', () => {
  const messages = [
    user,
    openAiReply,
    ...openAiResults,
    { role: 'custom', tag: 'ui', data: 1 } as const,
  ];
  const { messages: out, changes } = convert(messages, { provider: 'openai', model: 'gpt-6-luna' });
  assert.equal(out[1], openAiReply);
  assert.deepEqual(out[0], user);
  assert.deepEqual(out[4], messages[4]);
  assert.deepEqual(changes, []);
});

test('OpenAI to Anthropic: through the hub', () => {
  const { messages, changes } = convert([user, openAiReply, ...openAiResults], {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
  });
  const mapped =
    'functions_get_weather_0_' +
    /_([a-z0-9]+)$/.exec(String((messages[2] as { toolCallId: string }).toolCallId))?.[1];
  assert.deepEqual(messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Weather in Oslo?' },
        {
          type: 'image',
          source: { type: 'url', url: 'https://example.com/a.png' },
          providerOptions: { future_option: 1 },
        },
      ],
    },
    {
      role: 'assistant',
      provider: 'anthropic',
      api: 'anthropic-messages',
      model: 'claude-sonnet-5-5',
      content: [
        { type: 'text', text: 'Checking ' },
        { type: 'text', text: 'Oslo.' },
        { type: 'tool_use', id: mapped, name: 'get_weather', input: { city: 'Oslo' } },
      ],
    },
    {
      role: 'tool_result',
      toolCallId: mapped,
      toolName: 'get_weather',
      content: [{ type: 'text', text: 'Snow, -3C' }],
    },
  ]);
  assert.deepEqual(whats(changes), [
    '0 dropped part_option: prompt_cache_breakpoint',
    '0 dropped part_option: detail',
    '1 dropped citations: 1 annotations',
    '1 dropped reasoning: bound to its model',
    '1 dropped provider_item: web_search_call',
    `1 rewritten tool_call_id: functions.get_weather:0 → ${mapped}`,
    '1 dropped tool_call: custom tool patch',
    '2 dropped part_option: caller',
    '3 dropped tool_result: answers dropped call call_patch',
  ]);
});

test('Anthropic to OpenAI: through the hub, reasoning kept as text on request', () => {
  const { messages, changes } = convert(
    [anthropicReply, anthropicResult],
    { provider: 'openai', model: 'gpt-6.1-sol' },
    { reasoning: 'text' },
  );
  assert.deepEqual(messages, [
    {
      role: 'assistant',
      provider: 'openai',
      api: 'openai-responses',
      model: 'gpt-6.1-sol',
      content: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Oslo in October: look it up.', annotations: [] }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'It is ', annotations: [] },
            { type: 'output_text', text: 'cold.', annotations: [] },
          ],
        },
        {
          type: 'function_call',
          call_id: 'toolu_1',
          name: 'get_weather',
          arguments: '{"city":"Oslo"}',
        },
      ],
    },
    {
      role: 'tool_result',
      toolCallId: 'toolu_1',
      toolName: 'get_weather',
      isError: false,
      content: [{ type: 'text', text: 'Snow, -3C' }],
    },
  ]);
  assert.deepEqual(whats(changes), [
    '0 dropped citations: 1 citations',
    '0 rewritten reasoning: as assistant text',
    '0 dropped reasoning: no readable text',
    '0 dropped provider_item: server_tool_use',
    '0 dropped provider_item: web_search_tool_result',
    '1 dropped part_option: toolset_name',
    '1 dropped part_option: cache_control',
  ]);
});

test('to Fireworks: plain reasoning, and no files or file IDs', () => {
  const { messages, changes } = convert(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read these.' },
          { type: 'file', source: { type: 'url', url: 'https://example.com/a.pdf' } },
          { type: 'image', source: { type: 'file_id', id: 'file_1' } },
        ],
      },
      { role: 'user', content: [{ type: 'file', source: { type: 'file_id', id: 'file_2' } }] },
      anthropicReply,
    ],
    { provider: 'fireworks', model: 'accounts/fireworks/models/glm-5p3' },
    { reasoning: 'text' },
  );
  assert.deepEqual(messages[0], { role: 'user', content: [{ type: 'text', text: 'Read these.' }] });
  assert.deepEqual((messages[1] as AssistantMessage<'fireworks'>).content[0], {
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: 'Oslo in October: look it up.' }],
  });
  assert.deepEqual(whats(changes).slice(0, 3), [
    '0 dropped part: file part; fireworks takes no files',
    '0 dropped part: image by file ID; fireworks takes no file IDs',
    '1 dropped part: file part; fireworks takes no files',
  ]);
  assert.ok(whats(changes).includes('1 dropped message: user message left empty'));
});

test('OpenAI to Fireworks: the same-format fast path', () => {
  const { messages, changes } = convert([openAiReply, ...openAiResults], {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/deepseek-v4p1-flash',
  });
  assert.deepEqual(messages[0], {
    role: 'assistant',
    provider: 'fireworks',
    api: 'openai-responses',
    model: 'accounts/fireworks/models/deepseek-v4p1-flash',
    content: [
      {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: (openAiReply.content[2] as { content: unknown }).content,
      },
      {
        type: 'function_call',
        call_id: 'functions.get_weather:0',
        name: 'get_weather',
        arguments: '{"city":"Oslo"}',
      },
    ],
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(whats(changes), [
    '0 dropped reasoning: bound to its model',
    '0 dropped provider_item: web_search_call',
    '0 dropped tool_call: custom tool patch',
    '1 dropped part_option: caller',
    '2 dropped tool_result: answers dropped call call_patch',
  ]);
});

test('another model of the same provider: only bound reasoning goes', () => {
  const openai = convert([openAiReply], { provider: 'openai', model: 'gpt-5.6-luna' });
  const content = (openai.messages[0] as AssistantMessage<'openai'>).content;
  assert.deepEqual(content, openAiReply.content.slice(1));
  assert.equal((openai.messages[0] as AssistantMessage).id, 'resp_1');

  const anthropic = convert([anthropicReply], { provider: 'anthropic', model: 'claude-fable-5-1' });
  assert.deepEqual(
    (anthropic.messages[0] as AssistantMessage<'anthropic'>).content,
    anthropicReply.content.slice(2),
  );

  const fireworksReply = {
    ...openAiReply,
    provider: 'fireworks',
    model: 'accounts/fireworks/models/kimi-k3',
    content: [
      { type: 'reasoning', id: 'rs_2', summary: [{ type: 'summary_text', text: 'Plain.' }] },
    ],
  } as AssistantMessage<'fireworks'>;
  const fireworks = convert([fireworksReply], {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/glm-5p3',
  });
  assert.deepEqual(
    (fireworks.messages[0] as AssistantMessage<'fireworks'>).content,
    fireworksReply.content,
  );
  assert.deepEqual(fireworks.changes, []);
});

test('empty assistant messages, foreign native messages and odd arguments', () => {
  const { messages, changes } = convert(
    [
      { ...anthropicReply, content: [anthropicReply.content[0]] } as AssistantMessage<'anthropic'>,
      {
        role: 'native',
        provider: 'openai',
        api: 'openai-responses',
        content: [{ type: 'item_reference', id: 'msg_1' }],
      } as Message,
      {
        ...openAiReply,
        content: [{ type: 'function_call', call_id: 'c1', name: 'f', arguments: '[1, 2]' }],
      } as AssistantMessage<'openai'>,
    ],
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  );
  assert.deepEqual((messages[0] as AssistantMessage<'anthropic'>).content, [
    { type: 'tool_use', id: 'c1', name: 'f', input: { arguments: '[1, 2]' } },
  ]);
  assert.deepEqual(whats(changes), [
    '0 dropped reasoning: bound to its model',
    '0 dropped message: assistant message left empty',
    '1 dropped message: openai native items',
    '2 rewritten tool_arguments: not a JSON object: wrapped as { arguments }',
  ]);
});

test('a converted conversation is accepted by the target adapter', async () => {
  const { messages } = convert([user, openAiReply, ...openAiResults], {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
  });
  const { fetch, sent } = fakeFetch({
    id: 'msg_2',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: 'Cold.' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 2 },
  });
  await complete(
    {
      provider: 'anthropic',
      credentials: { apiKey: 'sk-ant-test' },
      model: 'claude-haiku-5-5',
      messages: messages as never,
    },
    { fetch },
  );
  const body = sent[0]?.body as { messages: { role: string }[] };
  assert.deepEqual(
    body.messages.map((message) => message.role),
    ['user', 'assistant', 'user'],
  );
});
