// Provider-neutral readers over an assistant message. Each dispatches on the
// message's API format to that format's extractor. Pure.

import type {
  AssistantMessage,
  Message,
  Provider,
  RequestMessage,
  ToolCall,
} from '@acentric-llm/contracts';
import * as messages from './formats/anthropic/extract.ts';
import * as responses from './formats/responses/extract.ts';

export type { TextOptions } from './formats/responses/extract.ts';

/** One format's extractors, over any message of that format. */
interface Extractors {
  outputText(message: AssistantMessage, options?: responses.TextOptions): string;
  refusals(message: AssistantMessage): readonly string[];
  reasoningSummary(message: AssistantMessage): readonly string[];
  toolCalls(message: AssistantMessage): readonly ToolCall[];
  pendingToolCalls(message: AssistantMessage): readonly ToolCall[];
}

const FORMATS = {
  'openai-responses': responses as unknown as Extractors,
  'anthropic-messages': messages as unknown as Extractors,
};

function format(message: AssistantMessage): Extractors {
  switch (message.api) {
    case 'openai-responses':
    case 'anthropic-messages':
      return FORMATS[message.api];
    default:
      throw new TypeError(
        `No extractor for the ${String((message as { api?: unknown }).api)} format.`,
      );
  }
}

/**
 * The text of the message's answer. For the Responses format, commentary is
 * left out unless `{ phase: "all" }`.
 */
export function outputText(message: AssistantMessage, options?: responses.TextOptions): string {
  return format(message).outputText(message, options);
}

/** Refusal texts. Anthropic reports refusals as a stop reason, so its messages have none. */
export function refusals(message: AssistantMessage): readonly string[] {
  return format(message).refusals(message);
}

/** Reasoning summaries or thinking texts, in order. */
export function reasoningSummary(message: AssistantMessage): readonly string[] {
  return format(message).reasoningSummary(message);
}

/** Every call in the message the caller answers. */
export function toolCalls<P extends Provider>(
  message: AssistantMessage<P>,
): readonly ToolCall<P>[] {
  const any = message as AssistantMessage;
  return format(any).toolCalls(any) as unknown as readonly ToolCall<P>[];
}

/** Calls the caller still has to answer. */
export function pendingToolCalls<P extends Provider>(
  message: AssistantMessage<P>,
): readonly ToolCall<P>[] {
  const any = message as AssistantMessage;
  return format(any).pendingToolCalls(any) as unknown as readonly ToolCall<P>[];
}

/** The messages a provider receives: the application's own `custom` messages removed. */
export function requestMessages<P extends Provider>(
  messages: readonly Message<P>[],
): RequestMessage<P>[] {
  return messages.filter((message): message is RequestMessage<P> => message.role !== 'custom');
}
