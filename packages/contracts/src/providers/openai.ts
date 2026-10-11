// OpenAI's Responses API: request options, its items beyond the shared
// Responses format, and the response fields kept in `native`. Written from the
// API reference, the OpenAPI spec v2.3.0 and openai-node v7.32.0 (2026-10-11).
// See docs/providers/openai.md.

import type { JsonObject } from '../json.ts';
import type {
  ResponsesCaller,
  ResponsesInputContent,
  ResponsesInputItem,
  ResponsesOutputItem,
  ResponsesStatus,
} from '../formats/responses.ts';

export interface OpenAiCredentials {
  readonly apiKey: string;
  /** Sent as `OpenAI-Organization`. */
  readonly organization?: string;
  /** Sent as `OpenAI-Project`. */
  readonly project?: string;
}

// ---- Items beyond the shared format. Typed loosely: the adapter passes them
// through, and only the fields the extractors read are named.

type Item<T extends string, Fields = {}> = {
  readonly type: T;
  readonly id?: string;
  readonly [key: string]: unknown;
} & Fields;

type CallStatus = { readonly status?: string };
type Called = { readonly call_id: string; readonly caller?: ResponsesCaller };

/** Hosted tools: OpenAI runs them and their results are in the same output. */
export type OpenAiWebSearchCall = Item<'web_search_call', CallStatus>;
export type OpenAiFileSearchCall = Item<'file_search_call', CallStatus>;
export type OpenAiCodeInterpreterCall = Item<'code_interpreter_call', CallStatus>;
export type OpenAiImageGenerationCall = Item<
  'image_generation_call',
  CallStatus & { readonly result?: string | null }
>;
export type OpenAiMcpCall = Item<
  'mcp_call',
  CallStatus & { readonly server_label: string; readonly name: string }
>;
export type OpenAiMcpListTools = Item<'mcp_list_tools', { readonly server_label: string }>;

/** Provider-defined tools the caller executes. Answered with `native` items. */
export type OpenAiComputerCall = Item<'computer_call', Called & CallStatus>;
export type OpenAiShellCall = Item<'shell_call', Called & CallStatus>;
export type OpenAiApplyPatchCall = Item<'apply_patch_call', Called & CallStatus>;
export type OpenAiLocalShellCall = Item<'local_shell_call', Called & CallStatus>;
export type OpenAiToolSearchCall = Item<
  'tool_search_call',
  CallStatus & { readonly call_id?: string | null; readonly execution?: 'server' | 'client' }
>;
/** A hosted MCP tool waiting for the caller's approval. */
export type OpenAiMcpApprovalRequest = Item<
  'mcp_approval_request',
  {
    readonly id: string;
    readonly server_label: string;
    readonly name: string;
    readonly arguments: string;
  }
>;

/** Results of the calls above, and other items the caller writes. */
export type OpenAiComputerCallOutput = Item<'computer_call_output', Called>;
export type OpenAiShellCallOutput = Item<'shell_call_output', Called>;
export type OpenAiApplyPatchCallOutput = Item<
  'apply_patch_call_output',
  Called & { readonly status: 'completed' | 'failed'; readonly output?: string | null }
>;
export type OpenAiLocalShellCallOutput = Item<
  'local_shell_call_output',
  { readonly output: string }
>;
export type OpenAiToolSearchOutput = Item<
  'tool_search_output',
  { readonly call_id?: string | null; readonly tools: readonly OpenAiTool[] }
>;
export type OpenAiMcpApprovalResponse = Item<
  'mcp_approval_response',
  { readonly approval_request_id: string; readonly approve: boolean; readonly reason?: string }
>;
/** Programmatic tool calling: a program the model wrote, and its result. */
export type OpenAiProgram = Item<
  'program',
  { readonly call_id: string; readonly fingerprint: string }
>;
export type OpenAiProgramOutput = Item<'program_output', { readonly call_id: string }>;
/** Tools added mid-conversation, at this position. */
export type OpenAiAdditionalTools = Item<
  'additional_tools',
  { readonly role: string; readonly tools: readonly OpenAiTool[] }
>;
/** Changes the reasoning effort mid-conversation without breaking the prompt cache (GPT-6). */
export type OpenAiConfigurationUpdate = Item<
  'configuration_update',
  { readonly reasoning?: { readonly effort?: OpenAiReasoningEffort } }
>;
/** Compacts the context so far. Must be the last input item. */
export type OpenAiCompactionTrigger = Item<'compaction_trigger'>;

export type OpenAiOutputItem =
  | ResponsesOutputItem
  | OpenAiWebSearchCall
  | OpenAiFileSearchCall
  | OpenAiCodeInterpreterCall
  | OpenAiImageGenerationCall
  | OpenAiMcpCall
  | OpenAiMcpListTools
  | OpenAiMcpApprovalRequest
  | OpenAiMcpApprovalResponse
  | OpenAiComputerCall
  | OpenAiShellCall
  | OpenAiShellCallOutput
  | OpenAiApplyPatchCall
  | OpenAiApplyPatchCallOutput
  | OpenAiLocalShellCall
  | OpenAiToolSearchCall
  | OpenAiToolSearchOutput
  | OpenAiProgram
  | OpenAiProgramOutput
  | OpenAiAdditionalTools;

/** An item a `native` message may carry. */
export type OpenAiInputItem =
  | ResponsesInputItem
  | OpenAiOutputItem
  | OpenAiComputerCallOutput
  | OpenAiLocalShellCallOutput
  | OpenAiConfigurationUpdate
  | OpenAiCompactionTrigger;

// ---- Request options: the Responses request body minus `model`, `input` and
// `instructions`, which the request owns.

export type OpenAiReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** A native tool definition: hosted tools, namespaces, tool search, MCP, shell, computer, ... */
export type OpenAiTool = {
  readonly type:
    | 'function'
    | 'custom'
    | 'namespace'
    | 'tool_search'
    | 'programmatic_tool_calling'
    | 'web_search'
    | 'file_search'
    | 'code_interpreter'
    | 'image_generation'
    | 'mcp'
    | 'shell'
    | 'apply_patch'
    | 'computer'
    | (string & {});
  readonly [key: string]: unknown;
};

export type OpenAiInclude =
  | 'reasoning.encrypted_content'
  | 'message.output_text.logprobs'
  | 'message.input_image.image_url'
  | 'web_search_call.action.sources'
  | 'web_search_call.results'
  | 'file_search_call.results'
  | 'code_interpreter_call.outputs'
  | 'computer_call_output.output.image_url'
  | (string & {});

export type OpenAiServiceTier =
  'auto' | 'default' | 'flex' | 'scale' | 'priority' | 'fast' | 'ultrafast';

export type OpenAiTextFormat =
  | { readonly type: 'text' }
  | { readonly type: 'json_object' }
  | {
      readonly type: 'json_schema';
      readonly name: string;
      readonly schema: JsonObject;
      readonly description?: string;
      readonly strict?: boolean | null;
    };

export interface OpenAiOptions {
  /** Hosted and other native tools, sent after the request's own tools. */
  readonly tools?: readonly OpenAiTool[];
  readonly tool_choice?: 'none' | 'auto' | 'required' | ({ readonly type: string } & JsonObject);
  readonly parallel_tool_calls?: boolean | null;
  /** Caps calls to built-in tools. */
  readonly max_tool_calls?: number | null;
  /** Covers visible output and reasoning. */
  readonly max_output_tokens?: number | null;
  readonly temperature?: number | null;
  readonly top_p?: number | null;
  readonly top_logprobs?: number | null;
  readonly reasoning?: {
    readonly effort?: OpenAiReasoningEffort | null;
    readonly summary?: 'auto' | 'concise' | 'detailed' | null;
    readonly context?: 'auto' | 'current_turn' | 'all_turns' | null;
    readonly mode?: 'standard' | 'pro' | (string & {}) | null;
  } | null;
  readonly text?: {
    readonly format?: OpenAiTextFormat;
    readonly verbosity?: 'low' | 'medium' | 'high' | null;
  } | null;
  /** Defaults to `true` at OpenAI: the response is kept at least 30 days. */
  readonly store?: boolean | null;
  readonly include?: readonly OpenAiInclude[] | null;
  /** Chain on a stored response. Only the new items are sent; instructions and tools are not inherited. */
  readonly previous_response_id?: string | null;
  /** A server-side Conversation. Excludes `previous_response_id`. */
  readonly conversation?: string | { readonly id: string } | null;
  /** Server-side compaction inside the request. */
  readonly context_management?:
    | readonly {
        readonly type: 'compaction' | (string & {});
        readonly compact_threshold?: number;
      }[]
    | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
  readonly safety_identifier?: string | null;
  readonly prompt_cache_key?: string | null;
  /** @deprecated Use `prompt_cache_options.ttl`. */
  readonly prompt_cache_retention?: 'in_memory' | '24h' | null;
  readonly prompt_cache_options?: {
    readonly ttl?: '30m' | (string & {});
    readonly mode?: 'implicit' | 'explicit';
    readonly prewarm?: boolean;
    readonly comparison_response_id?: string;
  } | null;
  readonly service_tier?: OpenAiServiceTier | null;
  readonly moderation?: JsonObject | null;
  readonly access_programs?: JsonObject | null;
  /** @deprecated Ignored past `disabled`; overflow is an error. */
  readonly truncation?: 'auto' | 'disabled' | null;
  /** @deprecated Use `safety_identifier` and `prompt_cache_key`. */
  readonly user?: string;
  /** @deprecated Reusable prompts shut down on 2026-11-30. */
  readonly prompt?: {
    readonly id: string;
    readonly version?: string;
    readonly variables?: Readonly<Record<string, string | ResponsesInputContent>>;
  } | null;
  /** `complete` returns one finished response; `true` is refused. */
  readonly stream?: false | null;
  /** `complete` returns one finished response; `true` is refused. */
  readonly background?: false | null;
}

/**
 * The response's own fields, kept in `native`: what the response says that the
 * request did not. Echoes of the request and the fields already in the
 * envelope are left out.
 */
export interface OpenAiNativeResponse {
  readonly status: ResponsesStatus;
  readonly created_at?: number;
  readonly completed_at?: number | null;
  readonly incomplete_details?: { readonly reason?: string } | null;
  /** The tier actually used; may differ from the one requested. */
  readonly service_tier?: OpenAiServiceTier | null;
  /** The effective reasoning settings. */
  readonly reasoning?: JsonObject | null;
  readonly prompt_cache_diagnostics?: JsonObject | null;
  readonly moderation?: JsonObject | null;
  readonly access_programs?: JsonObject | null;
  readonly [key: string]: unknown;
}

/** Catalog model IDs. Any other model ID works too. */
export type OpenAiModelId =
  | 'gpt-6-astra'
  | 'gpt-6.1-sol'
  | 'gpt-6-sol'
  | 'gpt-6-luna'
  | 'gpt-5.6-sol'
  | 'gpt-5.6-terra'
  | 'gpt-5.6-luna'
  | 'gpt-5.5'
  | 'gpt-5.4'
  | 'gpt-5.4-mini'
  | 'gpt-4.1';

export interface OpenAiSpec {
  readonly api: 'openai-responses';
  readonly credentials: OpenAiCredentials;
  readonly options: OpenAiOptions;
  readonly inputItem: OpenAiInputItem;
  readonly outputItem: OpenAiOutputItem;
  readonly response: OpenAiNativeResponse;
  readonly modelId: OpenAiModelId;
}
