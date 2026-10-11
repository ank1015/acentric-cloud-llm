import type { ContentPart, TextContent } from './content.ts';
import type { JsonValue, Metadata, ProviderFields } from './json.ts';
import type { ApiOf, NativeInputItem, NativeOutputItem, Provider } from './providers.ts';
import type { ToolType } from './tools.ts';

interface MessageBase {
  /** For assistant messages, the provider's response ID. Otherwise the application's. */
  readonly id?: string;
  /** Unix time in milliseconds. */
  readonly timestamp?: number;
  /** The application's own attributes. Never sent to a provider. */
  readonly metadata?: Metadata;
}

export interface UserMessage extends MessageBase {
  readonly role: 'user';
  readonly content: readonly ContentPart[];
}

/**
 * A mid-conversation instruction. The request's `instructions` is the
 * top-level one. A provider without mid-conversation system messages refuses it.
 */
export interface SystemMessage extends MessageBase {
  readonly role: 'system';
  readonly content: readonly TextContent[];
}

/**
 * The provider's output, verbatim, for replay. Send it back as is; extract tool
 * calls and text with the SDK's helpers. Replay is safe for the same provider,
 * API format and model.
 */
export type AssistantMessage<P extends Provider = Provider> = P extends Provider
  ? MessageBase & {
      readonly role: 'assistant';
      readonly provider: P;
      readonly api: ApiOf<P>;
      /** The model ID the request asked for. */
      readonly model: string;
      readonly content: readonly NativeOutputItem<P>[];
    }
  : never;

/** The result of a tool call the caller executed. */
export interface ToolResultMessage extends MessageBase {
  readonly role: 'tool_result';
  readonly toolCallId: string;
  readonly toolName: string;
  /** The type of the tool that was called. Defaults to `function`. */
  readonly toolType?: ToolType;
  readonly content: readonly ContentPart[];
  /**
   * The tool failed. Sent only where the provider has a field for it; `content`
   * must describe the failure either way.
   */
  readonly isError?: boolean;
  /**
   * Merged into the provider's result item, for fields it requires on results,
   * such as OpenAI's `caller`. `toolResult(call, content)` copies them from the call.
   */
  readonly providerOptions?: ProviderFields;
}

/** Provider-specific input items, such as a compaction item, sent verbatim. */
export type NativeMessage<P extends Provider = Provider> = P extends Provider
  ? MessageBase & {
      readonly role: 'native';
      readonly provider: P;
      readonly api: ApiOf<P>;
      readonly content: readonly NativeInputItem<P>[];
    }
  : never;

/** The application's own entry in a conversation. Never sent to a provider. */
export interface CustomMessage extends MessageBase {
  readonly role: 'custom';
  /** Says how the application reads `data`. */
  readonly tag: string;
  readonly data: JsonValue;
}

/** A message a request to provider `P` may carry. */
export type RequestMessage<P extends Provider = Provider> =
  UserMessage | SystemMessage | ToolResultMessage | AssistantMessage<P> | NativeMessage<P>;

/** Any message in a conversation, including the application's own. */
export type Message<P extends Provider = Provider> = RequestMessage<P> | CustomMessage;

export type Role = Message['role'];
