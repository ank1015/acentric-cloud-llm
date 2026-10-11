import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantMessage, CompletionRequest } from '@acentric-llm/contracts';
import { openAiProfile } from '../src/index.ts';
import { buildRequest } from '../src/formats/responses/request.ts';
import { assistant, request } from './support.ts';

const build = (overrides: Partial<CompletionRequest<'openai'>>) =>
  buildRequest(request(overrides), openAiProfile);

test('maps every shared message and part', () => {
  const body = build({
    instructions: [
      { type: 'text', text: 'You are terse.' },
      { type: 'text', text: 'Answer in English.' },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Look',
            providerOptions: { prompt_cache_breakpoint: { mode: 'explicit' } },
          },
          {
            type: 'image',
            source: { type: 'url', url: 'https://x.test/a.png' },
            providerOptions: { detail: 'original' },
          },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AAAA' } },
          {
            type: 'file',
            source: { type: 'base64', mediaType: 'application/pdf', data: 'JVBE' },
            filename: 'a.pdf',
          },
          { type: 'file', source: { type: 'url', url: 'https://x.test/b.pdf' } },
          { type: 'file', source: { type: 'file_id', id: 'file_1' } },
        ],
      },
      { role: 'system', content: [{ type: 'text', text: 'Now be verbose.' }] },
    ],
  });
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.instructions, 'You are terse.\n\nAnswer in English.');
  assert.deepEqual(body.input, [
    {
      type: 'message',
      role: 'user',
      content: [
        { prompt_cache_breakpoint: { mode: 'explicit' }, type: 'input_text', text: 'Look' },
        { detail: 'original', type: 'input_image', image_url: 'https://x.test/a.png' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        { type: 'input_file', file_data: 'data:application/pdf;base64,JVBE', filename: 'a.pdf' },
        { type: 'input_file', file_url: 'https://x.test/b.pdf' },
        { type: 'input_file', file_id: 'file_1' },
      ],
    },
    {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'Now be verbose.' }],
    },
  ]);
});

test('replays assistant items verbatim, without the output-only created_by', () => {
  const call = {
    type: 'function_call',
    id: 'fc_1',
    call_id: 'call_1',
    name: 'read',
    arguments: '{"a":1}',
    status: 'completed',
  };
  const compaction = {
    type: 'compaction',
    id: 'cmp_1',
    encrypted_content: 'x',
    created_by: 'server',
  };
  const body = build({
    messages: [
      assistant([
        { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'e' },
        call,
        compaction,
      ]),
    ],
  });
  assert.deepEqual(body.input, [
    { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'e' },
    call,
    { type: 'compaction', id: 'cmp_1', encrypted_content: 'x' },
  ]);
});

test('maps tool results by tool type and merges their provider options', () => {
  const body = build({
    messages: [
      {
        role: 'tool_result',
        toolCallId: 'call_1',
        toolName: 'read',
        content: [{ type: 'text', text: 'ok' }],
        isError: true,
      },
      {
        role: 'tool_result',
        toolCallId: 'call_2',
        toolName: 'patch',
        toolType: 'custom',
        content: [
          { type: 'text', text: 'see' },
          { type: 'image', source: { type: 'file_id', id: 'file_2' } },
        ],
        providerOptions: { caller: { type: 'program', caller_id: 'call_p' } },
      },
    ],
  });
  assert.deepEqual(body.input, [
    // isError has no OpenAI field and is not sent.
    { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
    {
      caller: { type: 'program', caller_id: 'call_p' },
      type: 'custom_tool_call_output',
      call_id: 'call_2',
      output: [
        { type: 'input_text', text: 'see' },
        { type: 'input_image', file_id: 'file_2' },
      ],
    },
  ]);
});

test('sends native items verbatim and in place', () => {
  const approval = {
    type: 'mcp_approval_response',
    approval_request_id: 'mcpr_1',
    approve: true,
  } as const;
  const body = build({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'native', provider: 'openai', api: 'openai-responses', content: [approval] },
    ],
  });
  assert.deepEqual((body.input as unknown[])[1], approval);
});

test('maps our tools and appends native ones, passing every other option through', () => {
  const body = build({
    tools: [
      {
        type: 'function',
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object' },
      },
      {
        type: 'function',
        name: 'grep',
        description: 'Search',
        parameters: { type: 'object' },
        strict: false,
        providerOptions: { defer_loading: true },
      },
      {
        type: 'custom',
        name: 'patch',
        description: 'Apply a patch',
        format: { type: 'grammar', syntax: 'lark', definition: 'start: "x"' },
      },
    ],
    providerOptions: {
      tools: [{ type: 'web_search' }],
      store: false,
      previous_response_id: 'resp_0',
      reasoning: { effort: 'high' },
      context_management: [{ type: 'compaction', compact_threshold: 200_000 }],
    },
  });
  assert.deepEqual(body.tools, [
    // An omitted strict stays omitted.
    { type: 'function', name: 'read', description: 'Read a file', parameters: { type: 'object' } },
    {
      defer_loading: true,
      type: 'function',
      name: 'grep',
      description: 'Search',
      parameters: { type: 'object' },
      strict: false,
    },
    {
      type: 'custom',
      name: 'patch',
      description: 'Apply a patch',
      format: { type: 'grammar', syntax: 'lark', definition: 'start: "x"' },
    },
    { type: 'web_search' },
  ]);
  assert.equal(body.store, false);
  assert.equal(body.previous_response_id, 'resp_0');
  assert.deepEqual(body.reasoning, { effort: 'high' });
  assert.deepEqual(body.context_management, [{ type: 'compaction', compact_threshold: 200_000 }]);
  assert.equal('stream' in body, false);
});

test('refuses what complete cannot do and what the request owns', () => {
  const refused: [Partial<CompletionRequest<'openai'>>, RegExp][] = [
    [{ providerOptions: { stream: true } as never }, /Streaming/],
    [{ providerOptions: { background: true } as never }, /Background/],
    [{ providerOptions: { model: 'x' } as never }, /providerOptions\.model/],
    [{ providerOptions: { input: [] } as never }, /providerOptions\.input/],
    [
      { instructions: [{ type: 'text', text: 'x', providerOptions: { a: 1 } }] },
      /instructions\[0\]\.providerOptions/,
    ],
    [
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'x', providerOptions: { type: 'y' } }] },
        ],
      },
      /providerOptions\.type/,
    ],
    [{ messages: [{ role: 'custom', tag: 'ui', data: null }] as never }, /application message/],
    [
      {
        messages: [
          {
            role: 'assistant',
            provider: 'anthropic',
            api: 'anthropic-messages',
            model: 'x',
            content: [],
          } as unknown as AssistantMessage<'openai'>,
        ],
      },
      /anthropic assistant message; convert it/,
    ],
    [
      {
        messages: [
          { role: 'system', content: [{ type: 'image', source: { type: 'url', url: 'u' } }] },
        ] as never,
      },
      /must be a text part/,
    ],
  ];
  for (const [overrides, message] of refused) {
    assert.throws(
      () => build(overrides),
      (error: Error) => error.name === 'LlmError' && message.test(error.message),
    );
  }
});
