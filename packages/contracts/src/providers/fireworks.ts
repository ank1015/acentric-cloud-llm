// Fireworks AI's Responses API: request options, its items beyond the shared
// Responses format, and the response fields kept in `native`. Written from the
// Fireworks docs and live calls (2026-10-11). Fireworks accepts unknown request
// fields without an error and ignores them, so these types are the only check.
// See docs/providers/fireworks.md.

import type { JsonObject } from '../json.ts';
import type {
  ResponsesCompaction,
  ResponsesCustomToolCall,
  ResponsesCustomToolCallOutput,
  ResponsesInputItem,
  ResponsesOutputItem,
  ResponsesStatus,
} from '../formats/responses.ts';

export interface FireworksCredentials {
  /** A Fireworks API key (`fw_...`), sent as `Authorization: Bearer`. */
  readonly apiKey: string;
}

// ---- Items beyond the shared format. Typed loosely, as for OpenAI.

type Item<T extends string, Fields = {}> = {
  readonly type: T;
  readonly id?: string;
  readonly [key: string]: unknown;
} & Fields;

/** Hosted tools: Fireworks runs them and their results are in the same output. */
export type FireworksMcpCall = Item<
  'mcp_call',
  { readonly status?: string; readonly server_label?: string; readonly name?: string }
>;
export type FireworksWebSearchCall = Item<'web_search_call', { readonly status?: string }>;

/** Fireworks has no custom tools and no compaction. */
type SharedOutputItem = Exclude<ResponsesOutputItem, ResponsesCustomToolCall | ResponsesCompaction>;

export type FireworksOutputItem = SharedOutputItem | FireworksMcpCall | FireworksWebSearchCall;

/** An item a `native` message may carry. */
export type FireworksInputItem =
  | Exclude<
      ResponsesInputItem,
      ResponsesCustomToolCall | ResponsesCustomToolCallOutput | ResponsesCompaction
    >
  | FireworksOutputItem;

// ---- Request options: the Responses request body minus `model`, `input` and
// `instructions`, which the request owns.

/**
 * Accepted values depend on the model: gpt-oss takes only low, medium and high;
 * GLM cannot turn reasoning off; Kimi K3 and DeepSeek V4.1 map medium and xhigh
 * to their nearest tier. A value a model does not take is a 400.
 */
export type FireworksReasoningEffort =
  'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | (string & {});

/** A native tool definition: functions, remote MCP or SSE servers, web search, namespaces. */
export type FireworksTool = {
  readonly type: 'function' | 'mcp' | 'sse' | 'web_search' | 'namespace' | (string & {});
  readonly [key: string]: unknown;
};

export type FireworksTextFormat =
  | { readonly type: 'text' }
  | { readonly type: 'json_object' }
  | {
      readonly type: 'json_schema';
      readonly name: string;
      readonly schema: JsonObject;
      readonly description?: string;
      readonly strict?: boolean | null;
    };

export interface FireworksOptions {
  /** Hosted and other native tools, sent after the request's own tools. */
  readonly tools?: readonly FireworksTool[];
  readonly tool_choice?: 'none' | 'auto' | 'required' | ({ readonly type: string } & JsonObject);
  readonly parallel_tool_calls?: boolean | null;
  /** Caps calls to hosted tools. */
  readonly max_tool_calls?: number | null;
  /** Covers visible output and reasoning. */
  readonly max_output_tokens?: number | null;
  readonly temperature?: number | null;
  readonly top_p?: number | null;
  readonly top_logprobs?: number | null;
  /** The summary is not configurable: reasoning text always comes back. */
  readonly reasoning?: { readonly effort?: FireworksReasoningEffort | null } | null;
  /** A JSON schema turns reasoning off on some models. */
  readonly text?: { readonly format?: FireworksTextFormat } | null;
  /**
   * Defaults to `true` at Fireworks: the response is kept for 30 days.
   * Zero-data-retention accounts must send `false`.
   */
  readonly store?: boolean | null;
  /** Only `message.output_text.logprobs`. There is no encrypted reasoning. */
  readonly include?: readonly ('message.output_text.logprobs' | (string & {}))[] | null;
  /** Chain on a stored response. Only the new items are sent; instructions and tools are not inherited. */
  readonly previous_response_id?: string | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
  readonly truncation?: 'auto' | 'disabled' | null;
  /** Routes requests to the same replica, which raises prompt-cache hits. */
  readonly prompt_cache_key?: string | null;
  readonly user?: string | null;
  /**
   * Not documented for the Responses API and not validated there. A request
   * that sets a tier other than `default` gets no cost estimate.
   */
  readonly service_tier?: 'default' | 'priority' | (string & {}) | null;
  /** `complete` returns one finished response; `true` is refused. */
  readonly stream?: false | null;
  /** `complete` returns one finished response; `true` is refused. */
  readonly background?: false | null;
}

/**
 * The response's own fields, kept in `native`. Fireworks echoes nearly every
 * request field; those are left out.
 */
export interface FireworksNativeResponse {
  readonly status: ResponsesStatus;
  readonly created_at?: number;
  readonly incomplete_details?: { readonly reason?: string } | null;
  readonly [key: string]: unknown;
}

/** Catalog model IDs. Any other model, deployment or router ID works too. */
export type FireworksModelId =
  | 'accounts/fireworks/models/kimi-k3'
  | 'accounts/fireworks/routers/kimi-k3-fast'
  | 'accounts/fireworks/models/ember-1'
  | 'accounts/fireworks/models/deepseek-v4p1-flash'
  | 'accounts/fireworks/models/glm-5p3'
  | 'accounts/fireworks/routers/glm-5p3-fast'
  | 'accounts/fireworks/models/glm-5p3-flash'
  | 'accounts/fireworks/models/qwen3p8-max'
  | 'accounts/fireworks/models/minimax-m3'
  | 'accounts/fireworks/models/gpt-oss-120b'
  | 'accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b'
  | 'accounts/fireworks/models/nemotron-3-ultra-nvfp4'
  | 'accounts/fireworks/models/inkling';

export interface FireworksSpec {
  readonly api: 'openai-responses';
  readonly credentials: FireworksCredentials;
  readonly options: FireworksOptions;
  readonly inputItem: FireworksInputItem;
  readonly outputItem: FireworksOutputItem;
  readonly response: FireworksNativeResponse;
  readonly modelId: FireworksModelId;
}
