import type { ProviderFields } from './json.ts';
import type { NativeOutputItem, Provider } from './providers.ts';

/**
 * A call the caller must answer, as the SDK's extractors report it. The
 * assistant message keeps the call itself; this is a read-only view of it.
 */
export type ToolCall<P extends Provider = Provider> = P extends Provider
  ? {
      /** The ID a result answers. */
      readonly toolCallId: string;
      /** The tool's name, or the item type for provider-defined tools without one. */
      readonly toolName: string;
      /**
       * `function` and `custom` calls are answered with a `tool_result` message;
       * `native` calls (provider-defined tools such as computer use, shell or an
       * approval request) with a `native` message.
       */
      readonly toolType: 'function' | 'custom' | 'native';
      /** Function arguments exactly as the model wrote them: a JSON string, unparsed. */
      readonly arguments?: string;
      /** A custom tool's raw input. */
      readonly input?: string;
      readonly namespace?: string;
      /** The call may stay unanswered while the conversation continues. */
      readonly async?: boolean;
      /** Fields the provider requires on this call's result; `toolResult` copies them. */
      readonly resultOptions?: ProviderFields;
      /** The provider's item type, e.g. `function_call` or `computer_call`. */
      readonly itemType: string;
      /** The call as the provider wrote it. */
      readonly item: NativeOutputItem<P>;
    }
  : never;
