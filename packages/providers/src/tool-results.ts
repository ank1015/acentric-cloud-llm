import type { ContentPart, Provider, ToolCall, ToolResultMessage } from '@acentric-llm/contracts';

export interface ToolResultOptions {
  /** Sent only where the provider has an error field; the content must say what failed. */
  readonly isError?: boolean;
}

/**
 * The result of a `function` or `custom` call, carrying the fields the provider
 * requires on it (e.g. OpenAI's `caller`). Pure. `native` calls are answered with
 * a `native` message instead.
 */
export function toolResult<P extends Provider>(
  call: ToolCall<P>,
  content: string | readonly ContentPart[],
  { isError }: ToolResultOptions = {},
): ToolResultMessage {
  if (call.toolType === 'native') {
    throw new TypeError(
      `${call.itemType} is a provider-defined call; answer it with a native message.`,
    );
  }
  return {
    role: 'tool_result',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    toolType: call.toolType,
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    ...(isError !== undefined ? { isError } : {}),
    ...(call.resultOptions !== undefined ? { providerOptions: call.resultOptions } : {}),
  };
}
