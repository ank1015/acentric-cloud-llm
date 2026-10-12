// Pure readers over an Anthropic assistant message. They never change the
// message: it is replayed as is. No I/O, clock or module state.

import type { AssistantMessage, ToolCall } from '@acentric-llm/contracts';
import { isRecord, type JsonRecord } from '../../shared.ts';
import type { MessagesProvider } from './profile.ts';

type Message<P extends MessagesProvider> = AssistantMessage<P>;

function blocks<P extends MessagesProvider>(message: Message<P>): readonly JsonRecord[] {
  return (message.content as readonly unknown[]).filter(isRecord);
}

/** The text of the answer. Text blocks split around citations are joined as written. */
export function outputText<P extends MessagesProvider>(message: Message<P>): string {
  return blocks(message)
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('');
}

/** Anthropic reports a refusal as the stop reason, not as content. */
export function refusals<P extends MessagesProvider>(_message: Message<P>): readonly string[] {
  return [];
}

/** Thinking texts, in order. Empty unless the request asked for `display: "summarized"`. */
export function reasoningSummary<P extends MessagesProvider>(
  message: Message<P>,
): readonly string[] {
  return blocks(message).flatMap((block) =>
    block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking
      ? [block.thinking]
      : [],
  );
}

/**
 * Calls to the caller's tools. Server tools (`server_tool_use`, `mcp_tool_use`)
 * run at Anthropic and are answered in the same message.
 */
export function toolCalls<P extends MessagesProvider>(message: Message<P>): readonly ToolCall<P>[] {
  return blocks(message).flatMap((block) => {
    if (
      block.type !== 'tool_use' ||
      typeof block.id !== 'string' ||
      typeof block.name !== 'string'
    ) {
      return [];
    }
    // A toolset member's result must name its toolset.
    const resultOptions =
      typeof block.toolset_name === 'string' ? { toolset_name: block.toolset_name } : undefined;
    return [
      {
        toolCallId: block.id,
        toolName: block.name,
        toolType: 'function',
        arguments: JSON.stringify(block.input ?? {}),
        ...(resultOptions !== undefined ? { resultOptions } : {}),
        itemType: 'tool_use',
        item: block,
      },
    ];
  }) as unknown as readonly ToolCall<P>[];
}

/** Every call is pending: an assistant message never holds the caller's results. */
export function pendingToolCalls<P extends MessagesProvider>(
  message: Message<P>,
): readonly ToolCall<P>[] {
  return toolCalls(message);
}
