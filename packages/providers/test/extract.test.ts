import assert from 'node:assert/strict';
import { test } from 'node:test';
import { responses, toolResult } from '../src/index.ts';
import { buildRequest } from '../src/formats/responses/request.ts';
import { openAiProfile } from '../src/index.ts';
import { assistant, finalMessage, reasoning, request } from './support.ts';

const { outputText, refusals, reasoningSummary, toolCalls, pendingToolCalls } = responses;

const commentary = {
  ...finalMessage,
  id: 'msg_c',
  phase: 'commentary',
  content: [{ type: 'output_text', text: 'Checking the file.', annotations: [] }],
};

test('outputText leaves commentary out unless asked', () => {
  const message = assistant([reasoning, commentary, finalMessage]);
  assert.equal(outputText(message), 'Hi there.');
  assert.equal(outputText(message, { phase: 'all' }), 'Checking the file.\n\nHi there.');
  assert.equal(outputText(assistant([reasoning])), '');
});

test('refusals and reasoning summaries', () => {
  const message = assistant([
    reasoning,
    { ...finalMessage, content: [{ type: 'refusal', refusal: 'No.' }] },
  ]);
  assert.deepEqual(refusals(message), ['No.']);
  assert.deepEqual(reasoningSummary(message), ['Thinking about greetings.']);
});

test('tool calls: function, custom and native, with what results must echo', () => {
  const caller = { type: 'program', caller_id: 'call_p' };
  const message = assistant([
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'read',
      arguments: '{"path":"a"}',
      namespace: 'fs',
      caller,
    },
    {
      type: 'custom_tool_call',
      id: 'ctc_1',
      call_id: 'call_2',
      name: 'patch',
      input: '*** Begin',
      async: true,
    },
    {
      type: 'computer_call',
      id: 'cu_1',
      call_id: 'call_3',
      actions: [],
      pending_safety_checks: [],
      status: 'completed',
    },
    {
      type: 'mcp_approval_request',
      id: 'mcpr_1',
      server_label: 'github',
      name: 'create_issue',
      arguments: '{}',
    },
    { type: 'web_search_call', id: 'ws_1', status: 'completed' },
    { type: 'shell_call', call_id: 'sh_1', action: {} },
    { type: 'shell_call_output', call_id: 'sh_1', output: [] },
  ]);
  const calls = toolCalls(message);
  assert.deepEqual(
    calls.map(({ item: _item, ...call }) => call),
    [
      {
        toolCallId: 'call_1',
        toolName: 'read',
        toolType: 'function',
        arguments: '{"path":"a"}',
        namespace: 'fs',
        resultOptions: { caller, namespace: 'fs' },
        itemType: 'function_call',
      },
      {
        toolCallId: 'call_2',
        toolName: 'patch',
        toolType: 'custom',
        input: '*** Begin',
        async: true,
        itemType: 'custom_tool_call',
      },
      { toolCallId: 'call_3', toolName: 'computer', toolType: 'native', itemType: 'computer_call' },
      {
        toolCallId: 'mcpr_1',
        toolName: 'create_issue',
        toolType: 'native',
        namespace: 'github',
        itemType: 'mcp_approval_request',
      },
      { toolCallId: 'sh_1', toolName: 'shell', toolType: 'native', itemType: 'shell_call' },
    ],
  );
  // The hosted shell call was answered within the response.
  assert.deepEqual(
    pendingToolCalls(message).map((call) => call.toolCallId),
    ['call_1', 'call_2', 'call_3', 'mcpr_1'],
  );
});

test('toolResult carries the call and its echoed fields into the next request', () => {
  const caller = { type: 'program', caller_id: 'call_p' };
  const message = assistant([
    { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{}', caller },
  ]);
  const [call] = toolCalls(message);
  assert.ok(call);
  const result = toolResult(call, 'contents');
  assert.deepEqual(result, {
    role: 'tool_result',
    toolCallId: 'call_1',
    toolName: 'read',
    toolType: 'function',
    content: [{ type: 'text', text: 'contents' }],
    providerOptions: { caller },
  });
  const body = buildRequest(request({ messages: [message, result] }), openAiProfile);
  assert.deepEqual((body.input as unknown[])[1], {
    caller,
    type: 'function_call_output',
    call_id: 'call_1',
    output: 'contents',
  });

  const [native] = toolCalls(assistant([{ type: 'computer_call', call_id: 'c', actions: [] }]));
  assert.ok(native);
  assert.throws(() => toolResult(native, 'x'), /answer it with a native message/);
});
