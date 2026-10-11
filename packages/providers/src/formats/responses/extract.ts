// Pure readers over a Responses assistant message. They never change the
// message: it is replayed as is. No I/O, clock or module state, so a reducer's
// pure step can use them.

import type { AssistantMessage, ToolCall } from '@acentric-llm/contracts';
import { isRecord, type JsonRecord } from '../../shared.ts';
import { callItems, pendingCallItems, type CallItem } from './calls.ts';
import type { ResponsesProvider } from './profile.ts';

type Message<P extends ResponsesProvider> = AssistantMessage<P>;

function items<P extends ResponsesProvider>(message: Message<P>): readonly unknown[] {
  return message.content;
}

function messageItems<P extends ResponsesProvider>(message: Message<P>): readonly JsonRecord[] {
  return items(message).filter(
    (item): item is JsonRecord =>
      isRecord(item) && item.type === 'message' && Array.isArray(item.content),
  );
}

export interface TextOptions {
  /** `final` (the default) leaves out commentary, which is not the answer. */
  readonly phase?: 'final' | 'all';
}

/** The text of the message's answer; messages are separated by a blank line. */
export function outputText<P extends ResponsesProvider>(
  message: Message<P>,
  { phase = 'final' }: TextOptions = {},
): string {
  return messageItems(message)
    .filter((item) => phase === 'all' || item.phase !== 'commentary')
    .map((item) =>
      (item.content as unknown[])
        .map((part) =>
          isRecord(part) && part.type === 'output_text' && typeof part.text === 'string'
            ? part.text
            : '',
        )
        .join(''),
    )
    .filter((text) => text !== '')
    .join('\n\n');
}

/** Refusal texts, in order. */
export function refusals<P extends ResponsesProvider>(message: Message<P>): readonly string[] {
  return messageItems(message).flatMap((item) =>
    (item.content as unknown[]).flatMap((part) =>
      isRecord(part) && part.type === 'refusal' && typeof part.refusal === 'string'
        ? [part.refusal]
        : [],
    ),
  );
}

/** Reasoning summary texts, in order. Encrypted reasoning stays in the message. */
export function reasoningSummary<P extends ResponsesProvider>(
  message: Message<P>,
): readonly string[] {
  return items(message).flatMap((item) =>
    isRecord(item) && item.type === 'reasoning' && Array.isArray(item.summary)
      ? item.summary.flatMap((part) =>
          isRecord(part) && typeof part.text === 'string' ? [part.text] : [],
        )
      : [],
  );
}

/** Every call in the message the caller answers, answered within it or not. */
export function toolCalls<P extends ResponsesProvider>(
  message: Message<P>,
): readonly ToolCall<P>[] {
  return callItems(items(message)).map(toToolCall) as unknown as readonly ToolCall<P>[];
}

/** Calls the caller still has to answer. Async calls may stay pending while the conversation goes on. */
export function pendingToolCalls<P extends ResponsesProvider>(
  message: Message<P>,
): readonly ToolCall<P>[] {
  return pendingCallItems(items(message)).map(toToolCall) as unknown as readonly ToolCall<P>[];
}

function toToolCall({ item, id, toolType }: CallItem): JsonRecord {
  const type = item.type as string;
  const name = typeof item.name === 'string' ? item.name : type.replace(/_call$/, '');
  const namespace =
    typeof item.namespace === 'string'
      ? item.namespace
      : type === 'mcp_approval_request' && typeof item.server_label === 'string'
        ? item.server_label
        : undefined;
  // A result must echo the call's `caller` (programmatic tool calling) and may name its namespace.
  const resultOptions = {
    ...(isRecord(item.caller) ? { caller: item.caller } : {}),
    ...(toolType === 'function' && typeof item.namespace === 'string'
      ? { namespace: item.namespace }
      : {}),
  };
  return {
    toolCallId: id,
    toolName: name,
    toolType,
    ...(typeof item.arguments === 'string' && toolType !== 'native'
      ? { arguments: item.arguments }
      : {}),
    ...(typeof item.input === 'string' ? { input: item.input } : {}),
    ...(namespace !== undefined ? { namespace } : {}),
    ...(item.async === true ? { async: true } : {}),
    ...(Object.keys(resultOptions).length ? { resultOptions } : {}),
    itemType: type,
    item,
  };
}
