// OpenRouter's Responses API (`POST /api/v1/responses`): request options, its
// items beyond the shared Responses format, and the response fields kept in
// `native`. Written from the OpenRouter docs, its OpenAPI spec, SDK 1.4.25 and
// live calls (2026-10-12). OpenRouter is itself a gateway: its output is its
// own translation of the upstream model's, and it may ignore a parameter the
// serving endpoint does not support. See docs/providers/openrouter.md.

import type { JsonObject } from '../json.ts';
import type {
  ResponsesCompaction,
  ResponsesCustomToolCall,
  ResponsesCustomToolCallOutput,
  ResponsesInputItem,
  ResponsesOutputItem,
  ResponsesReasoning,
  ResponsesStatus,
} from '../formats/responses.ts';

export interface OpenRouterCredentials {
  /** An OpenRouter API key (`sk-or-...`), sent as `Authorization: Bearer`. */
  readonly apiKey: string;
  /** The application's URL, sent as `HTTP-Referer` for app attribution. */
  readonly appUrl?: string;
  /** The application's name, sent as `X-OpenRouter-Title`. */
  readonly appTitle?: string;
}

// ---- Items beyond the shared format. Typed loosely: the adapter passes them
// through, and only the fields the extractors read are named.

type Item<T extends string, Fields = {}> = {
  readonly type: T;
  readonly id?: string;
  readonly [key: string]: unknown;
} & Fields;

/**
 * Reasoning as OpenRouter returns it: `format` names the upstream's encoding
 * (`meta-responses-v1`, `anthropic-claude-v1`, `google-gemini-v1`, ...), and
 * `encrypted_content` comes back without `include`. Bound to the model that
 * wrote it: OpenRouter silently ignores reasoning it cannot read.
 */
export type OpenRouterReasoning = ResponsesReasoning & {
  readonly format?: string | null;
  readonly signature?: string | null;
};

/**
 * OpenRouter's server tools (`openrouter:web_search`, `openrouter:web_fetch`,
 * `openrouter:datetime`, ...): it runs them, and their items are in the same
 * output. Hosted tool items in OpenAI's shape (`web_search_call`, ...) too.
 */
export type OpenRouterServerToolItem = Item<`openrouter:${string}`, { readonly status?: string }>;
export type OpenRouterWebSearchCall = Item<'web_search_call', { readonly status?: string }>;

/** OpenRouter has no custom tools for the models we use, and no compaction items. */
type SharedOutputItem = Exclude<
  ResponsesOutputItem,
  ResponsesCustomToolCall | ResponsesCompaction | ResponsesReasoning
>;

export type OpenRouterOutputItem =
  SharedOutputItem | OpenRouterReasoning | OpenRouterServerToolItem | OpenRouterWebSearchCall;

/** An item a `native` message may carry. */
export type OpenRouterInputItem =
  | Exclude<
      ResponsesInputItem,
      ResponsesCustomToolCall | ResponsesCustomToolCallOutput | ResponsesCompaction
    >
  | OpenRouterOutputItem;

// ---- Request options: the Responses request body minus `model`, `input` and
// `instructions`, which the request owns.

/** Upstream provider slugs, e.g. `meta`, `deepinfra`, `google-vertex/us-east5`. */
export type OpenRouterProviderSlug = string;

/** `max_price` values are USD per million tokens, or per request, image or audio unit. */
export interface OpenRouterMaxPrice {
  readonly prompt?: number | string;
  readonly completion?: number | string;
  readonly request?: number | string;
  readonly image?: number | string;
  readonly audio?: number | string;
}

type Percentiles = {
  readonly p50?: number;
  readonly p75?: number;
  readonly p90?: number;
  readonly p99?: number;
};

/**
 * Which upstream endpoints may serve the request. By default OpenRouter load
 * balances across them and falls back to others when one fails.
 */
export interface OpenRouterProviderPreferences {
  /** Try these first, in order. */
  readonly order?: readonly OpenRouterProviderSlug[];
  /** Only these. */
  readonly only?: readonly OpenRouterProviderSlug[];
  readonly ignore?: readonly OpenRouterProviderSlug[];
  /** `false` keeps the request on the ordered or primary endpoints. Default `true`. */
  readonly allow_fallbacks?: boolean;
  /**
   * Only endpoints that list every sent parameter as supported. It filters
   * endpoints; it does not make OpenRouter refuse a parameter it ignores.
   */
  readonly require_parameters?: boolean;
  readonly data_collection?: 'allow' | 'deny';
  /** Only zero-data-retention endpoints. */
  readonly zdr?: boolean;
  readonly enforce_distillable_text?: boolean;
  readonly quantizations?: readonly string[];
  readonly sort?:
    | 'price'
    | 'throughput'
    | 'latency'
    | 'exacto'
    | { readonly by: string; readonly partition?: 'model' | 'none' }
    | (string & {});
  readonly preferred_min_throughput?: number | Percentiles;
  readonly preferred_max_latency?: number | Percentiles;
  /** A price filter per token, not a budget for the call. */
  readonly max_price?: OpenRouterMaxPrice;
  /** Options forwarded to one upstream, keyed by its slug. */
  readonly options?: Readonly<Record<string, JsonObject>>;
  readonly [key: string]: unknown;
}

/**
 * Accepted values depend on the model; Muse Spark takes minimal to max and
 * always reasons. `enabled` and `max_tokens` are OpenRouter's own.
 */
export interface OpenRouterReasoningOptions {
  readonly effort?:
    'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | (string & {});
  readonly summary?: 'auto' | 'concise' | 'detailed' | (string & {}) | null;
  readonly enabled?: boolean;
  readonly max_tokens?: number;
  readonly [key: string]: unknown;
}

/** A native tool: functions, OpenRouter server tools (`openrouter:web_search`, ...). */
export type OpenRouterTool = {
  readonly type: 'function' | `openrouter:${string}` | (string & {});
  readonly [key: string]: unknown;
};

export type OpenRouterTextFormat =
  | { readonly type: 'text' }
  | { readonly type: 'json_object' }
  | {
      readonly type: 'json_schema';
      readonly name: string;
      readonly schema: JsonObject;
      readonly description?: string;
      readonly strict?: boolean | null;
    };

/** A plugin, e.g. `{ id: "file-parser", pdf: { engine } }` or `{ id: "response-healing" }`. */
export type OpenRouterPlugin = { readonly id: string; readonly [key: string]: unknown };

export interface OpenRouterOptions {
  /** Fallback models, tried in order when the requested one fails. */
  readonly models?: readonly string[];
  /** Upstream routing. */
  readonly provider?: OpenRouterProviderPreferences;
  readonly plugins?: readonly OpenRouterPlugin[];
  /** Server tools and other native tool definitions, sent after the request's own tools. */
  readonly tools?: readonly OpenRouterTool[];
  /** Muse Spark takes only `auto`; others are a 400 from the upstream. */
  readonly tool_choice?: 'none' | 'auto' | 'required' | ({ readonly type: string } & JsonObject);
  readonly parallel_tool_calls?: boolean | null;
  /** Caps server-tool steps. */
  readonly max_tool_calls?: number | null;
  readonly stop_server_tools_when?: JsonObject;
  /** OpenRouter's tool search: its state rides in reasoning; replay history unchanged. */
  readonly deferred_tools?: JsonObject;
  /** Covers visible output and reasoning; Muse Spark needs at least 16. */
  readonly max_output_tokens?: number | null;
  readonly temperature?: number | null;
  readonly top_p?: number | null;
  readonly top_k?: number | null;
  readonly frequency_penalty?: number | null;
  readonly presence_penalty?: number | null;
  readonly top_logprobs?: number | null;
  readonly reasoning?: OpenRouterReasoningOptions | null;
  readonly text?: {
    readonly format?: OpenRouterTextFormat;
    readonly verbosity?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | (string & {});
  } | null;
  /** Encrypted reasoning comes back without it on the models seen so far. */
  readonly include?: readonly ('reasoning.encrypted_content' | (string & {}))[] | null;
  readonly truncation?: 'auto' | 'disabled' | null;
  /** Anthropic-style automatic caching, for upstreams that take it. */
  readonly cache_control?: { readonly type: 'ephemeral'; readonly ttl?: '5m' | '1h' };
  readonly prompt_cache_key?: string | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
  /** A stable end-user ID, hashed before it reaches the upstream. */
  readonly user?: string | null;
  readonly safety_identifier?: string | null;
  /** Groups requests and keeps them on one endpoint where possible. */
  readonly session_id?: string;
  /** Exported with the request to the account's observability destinations. */
  readonly trace?: JsonObject;
  readonly service_tier?: 'auto' | 'default' | 'flex' | 'priority' | (string & {}) | null;
  /** OpenRouter keeps nothing: `true` is a 400. Send the full history every time. */
  readonly store?: false | null;
  /** OpenRouter keeps nothing: any ID is a 400. */
  readonly previous_response_id?: null;
  /** `complete` returns one finished response; `true` is refused. */
  readonly stream?: false | null;
  /** `complete` returns one finished response; `true` is refused (OpenRouter would ignore it). */
  readonly background?: false | null;
}

/**
 * The response's own fields, kept in `native`. `usage` holds what OpenRouter
 * reports beyond tokens: `cost`, `is_byok`, `cost_details`. With the
 * `X-OpenRouter-Metadata` header, `openrouter_metadata` names the endpoint.
 */
export interface OpenRouterNativeResponse {
  readonly status: ResponsesStatus;
  readonly created_at?: number;
  readonly completed_at?: number | null;
  readonly incomplete_details?: { readonly reason?: string } | null;
  readonly service_tier?: string | null;
  readonly usage?: {
    readonly cost?: number;
    readonly is_byok?: boolean;
    readonly cost_details?: JsonObject;
    readonly [key: string]: unknown;
  };
  readonly openrouter_metadata?: JsonObject;
  readonly [key: string]: unknown;
}

/** Catalog model IDs. Any other OpenRouter model ID, alias or variant works too. */
export type OpenRouterModelId = 'meta/muse-spark-1.3-contributor';

export interface OpenRouterSpec {
  readonly api: 'openai-responses';
  readonly credentials: OpenRouterCredentials;
  readonly options: OpenRouterOptions;
  readonly inputItem: OpenRouterInputItem;
  readonly outputItem: OpenRouterOutputItem;
  readonly response: OpenRouterNativeResponse;
  readonly modelId: OpenRouterModelId;
}
