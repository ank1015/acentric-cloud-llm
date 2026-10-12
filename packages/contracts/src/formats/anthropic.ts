// The Anthropic Messages format (`POST /v1/messages`): the content blocks the
// adapter builds and reads. Written from the API reference, the TypeScript SDK
// v0.133.0 and live calls (2026-10-12). See docs/providers/anthropic.md.
//
// Blocks are typed for what the adapter and extractors interpret. Anthropic
// adds block types and fields often: the adapter passes unknown ones through.

/** A prompt-cache breakpoint on a block, tool or system text. */
export interface AnthropicCacheControl {
  readonly type: 'ephemeral';
  /** `5m` (the default) or `1h`; the hour costs twice the input rate to write. */
  readonly ttl?: '5m' | '1h';
}

type Block<T extends string, Fields = {}> = {
  readonly type: T;
  readonly [key: string]: unknown;
} & Fields;

// ---- Output blocks: an assistant message's `content`, replayed verbatim.

export interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
  /** Where the text comes from, with documents or search results that enable citations. */
  readonly citations?: readonly unknown[] | null;
}

/**
 * The model's reasoning. `thinking` is a summary, or empty when `display` is
 * `omitted` (the default on Claude 5 models); the reasoning itself travels in
 * the `signature`, which is checked on every replay and bound to the
 * conversation before it. Replay it unchanged.
 */
export interface AnthropicThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
  readonly signature: string;
}

/** Reasoning flagged by the safety systems, encrypted. Replay it unchanged. */
export interface AnthropicRedactedThinkingBlock {
  readonly type: 'redacted_thinking';
  readonly data: string;
}

/** Who issued a call: `direct`, or code execution for programmatic tool calling. */
export type AnthropicCaller = { readonly type: string } & Readonly<Record<string, unknown>>;

/** A call to one of the caller's tools, answered with a `tool_result`. */
export interface AnthropicToolUseBlock {
  readonly type: 'tool_use';
  /** Matches `^[a-zA-Z0-9_-]+$`. */
  readonly id: string;
  readonly name: string;
  /** The parsed arguments. */
  readonly input: unknown;
  readonly caller?: AnthropicCaller;
  /** Set for members of an Anthropic toolset (computer, browser); the result must echo it. */
  readonly toolset_name?: string;
}

/** A call to a server tool (web search, web fetch, code execution, tool search). */
export type AnthropicServerToolUseBlock = Block<
  'server_tool_use',
  { readonly id: string; readonly name: string; readonly input: unknown }
>;

/** Results of server tools, in the same message. Some hold encrypted content: replay unchanged. */
export type AnthropicServerToolResultBlock = Block<
  | 'web_search_tool_result'
  | 'web_fetch_tool_result'
  | 'code_execution_tool_result'
  | 'bash_code_execution_tool_result'
  | 'text_editor_code_execution_tool_result'
  | 'tool_search_tool_result',
  { readonly tool_use_id: string }
>;

/** Calls to remote MCP servers (beta `mcp_servers`) and their results. */
export type AnthropicMcpToolUseBlock = Block<'mcp_tool_use', { readonly id: string }>;
export type AnthropicMcpToolResultBlock = Block<
  'mcp_tool_result',
  { readonly tool_use_id: string }
>;

/** Summarized earlier context (beta compaction). Replay unchanged, with the beta header. */
export type AnthropicCompactionBlock = Block<'compaction'>;

/** A file uploaded to the code execution container. */
export type AnthropicContainerUploadBlock = Block<'container_upload', { readonly file_id: string }>;

export type AnthropicOutputBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicRedactedThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicServerToolUseBlock
  | AnthropicServerToolResultBlock
  | AnthropicMcpToolUseBlock
  | AnthropicMcpToolResultBlock
  | AnthropicCompactionBlock
  | AnthropicContainerUploadBlock;

// ---- Input blocks the adapter builds from shared content, and blocks a
// `native` message may carry (sent as a user turn).

export type AnthropicMediaSource =
  | { readonly type: 'base64'; readonly media_type: string; readonly data: string }
  | { readonly type: 'url'; readonly url: string }
  | { readonly type: 'file'; readonly file_id: string }
  | { readonly type: 'text'; readonly media_type: 'text/plain'; readonly data: string }
  | { readonly type: 'content'; readonly content: unknown };

export type AnthropicImageBlock = Block<'image', { readonly source: AnthropicMediaSource }>;
export type AnthropicDocumentBlock = Block<'document', { readonly source: AnthropicMediaSource }>;
/** A search result the model may cite. */
export type AnthropicSearchResultBlock = Block<
  'search_result',
  { readonly source: string; readonly title: string; readonly content: readonly unknown[] }
>;
export type AnthropicToolResultBlock = Block<
  'tool_result',
  { readonly tool_use_id: string; readonly is_error?: boolean }
>;

/** A block a `native` message may carry; it is sent in a user turn. */
export type AnthropicInputBlock =
  | Block<'text', { readonly text: string }>
  | AnthropicImageBlock
  | AnthropicDocumentBlock
  | AnthropicSearchResultBlock
  | AnthropicToolResultBlock
  | AnthropicContainerUploadBlock;

/** Why generation stopped. */
export type AnthropicStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | 'model_context_window_exceeded'
  | 'compaction'
  | (string & {});

/** Token usage as the Messages format reports it. */
export interface AnthropicUsage {
  /** Uncached input only. */
  readonly input_tokens: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  /** Cache writes split by time to live. */
  readonly cache_creation?: {
    readonly ephemeral_5m_input_tokens?: number;
    readonly ephemeral_1h_input_tokens?: number;
  } | null;
  /** Output tokens, thinking included. */
  readonly output_tokens: number;
  readonly output_tokens_details?: { readonly thinking_tokens?: number } | null;
  readonly server_tool_use?: Readonly<Record<string, number>> | null;
  /** The tier that served the request: `standard`, `priority` or `batch`. */
  readonly service_tier?: string | null;
  /** Where inference ran: `global` or `us` (1.1x price). */
  readonly inference_geo?: string | null;
  /** Beta fast mode: `standard` or `fast`. */
  readonly speed?: string | null;
  /** Beta: the whole bill per sampling iteration, each with its own model. */
  readonly iterations?: readonly AnthropicUsageIteration[] | null;
}

export interface AnthropicUsageIteration {
  readonly type: 'message' | 'compaction' | 'advisor_message' | 'fallback_message' | (string & {});
  readonly model?: string | null;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation?: AnthropicUsage['cache_creation'];
}
