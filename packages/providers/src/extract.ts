// Provider-neutral readers over an assistant message. Each dispatches on the
// message's API format to that format's extractor. Pure.

import type {
  AssistantMessage,
  Message,
  Provider,
  RequestMessage,
  ToolCall,
} from '@acentric-llm/contracts';
import * as responses from './formats/responses/extract.ts';

export type { TextOptions } from './formats/responses/extract.ts';

function format(message: AssistantMessage): 'openai-responses' {
  switch (message.api) {
    case 'openai-responses':
      return message.api;
    default:
      throw new TypeError(
        `No extractor for the ${String((message as { api?: unknown }).api)} format.`,
      );
  }
}

/** The text of the message's answer. Commentary is left out unless `{ phase: "all" }`. */
export function outputText(message: AssistantMessage, options?: responses.TextOptions): string {
  format(message);
  return responses.outputText(message, options);
}

export function refusals(message: AssistantMessage): readonly string[] {
  format(message);
  return responses.refusals(message);
}

export function reasoningSummary(message: AssistantMessage): readonly string[] {
  format(message);
  return responses.reasoningSummary(message);
}

/** Every call in the message the caller answers. */
export function toolCalls<P extends Provider>(
  message: AssistantMessage<P>,
): readonly ToolCall<P>[] {
  format(message);
  return responses.toolCalls(message as never) as unknown as readonly ToolCall<P>[];
}

/** Calls the caller still has to answer. */
export function pendingToolCalls<P extends Provider>(
  message: AssistantMessage<P>,
): readonly ToolCall<P>[] {
  format(message);
  return responses.pendingToolCalls(message as never) as unknown as readonly ToolCall<P>[];
}

/** The messages a provider receives: the application's own `custom` messages removed. */
export function requestMessages<P extends Provider>(
  messages: readonly Message<P>[],
): RequestMessage<P>[] {
  return messages.filter((message): message is RequestMessage<P> => message.role !== 'custom');
}
