// Anthropic's Messages API: credentials, request options and the response
// fields kept in `native`. Written from the API reference, the TypeScript SDK
// v0.133.0 and live calls (2026-10-12), for Claude 5 models. Anthropic refuses
// unknown fields with a 400, so a typo never passes silently.
// See docs/providers/anthropic.md.

import type { JsonObject } from '../json.ts';
import type {
  AnthropicCacheControl,
  AnthropicInputBlock,
  AnthropicOutputBlock,
  AnthropicUsage,
} from '../formats/anthropic.ts';

export interface AnthropicCredentials {
  /** An Anthropic API key, sent as `x-api-key`. */
  readonly apiKey: string;
  /** Sent as `anthropic-workspace-id`; required by keys that span workspaces. */
  readonly workspaceId?: string;
}

/**
 * `adaptive` lets the model decide; it is the default on Claude 5 models.
 * Turning thinking off depends on the model: `disabled` (Haiku 5.5, Opus 5,
 * Sonnet 5, at effort `high` or below), `between_tools` (Sonnet 5.5 only), and
 * not at all on Opus 5.5, Fable 5.1 and Fable 5. Budgeted (`enabled`) thinking
 * is refused by every Claude 5 model.
 */
export type AnthropicThinking =
  | {
      readonly type: 'adaptive';
      /** `omitted` (the default) returns empty thinking text; `summarized` returns a summary. */
      readonly display?: 'summarized' | 'omitted' | (string & {});
      /** Beta `thinking-binding-controls-2026-08-01`: `error` or `drop_block` on a changed prefix. */
      readonly block_binding?: { readonly prefix_mismatch_behavior: 'error' | 'drop_block' };
    }
  | { readonly type: 'disabled' }
  | { readonly type: 'between_tools' }
  | { readonly type: 'enabled'; readonly budget_tokens: number };

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | (string & {});

export type AnthropicToolChoice =
  | { readonly type: 'auto'; readonly disable_parallel_tool_use?: boolean }
  /** `any` and `tool` are refused by Opus 5.5, Sonnet 5.5 and Fable 5.1, and skip thinking elsewhere. */
  | { readonly type: 'any'; readonly disable_parallel_tool_use?: boolean }
  | { readonly type: 'tool'; readonly name: string; readonly disable_parallel_tool_use?: boolean }
  | { readonly type: 'none' };

/** A native tool: a server tool (`web_search_20260209`, ...) or an Anthropic-defined client tool. */
export type AnthropicTool = {
  readonly type?: string;
  readonly name: string;
  readonly [key: string]: unknown;
};

export interface AnthropicOptions {
  /**
   * The output limit, thinking included. Defaults to the model's maximum from
   * the catalog (128,000 on Claude 5 models, and for models outside the
   * catalog). Anthropic counts it against the output rate limit up front, and
   * very long generations without streaming risk a dropped connection.
   */
  readonly max_tokens?: number;
  /** Sent as the `anthropic-beta` header, comma-joined. An unknown name refuses the request. */
  readonly betas?: readonly string[];
  readonly thinking?: AnthropicThinking;
  readonly output_config?: {
    /** Defaults to `medium` on Opus 5.5 and Haiku 5.5 and `high` elsewhere. */
    readonly effort?: AnthropicEffort;
    /** Structured output; refused with citations. */
    readonly format?: { readonly type: 'json_schema'; readonly schema: JsonObject };
    readonly [key: string]: unknown;
  };
  /** Server tools and Anthropic-defined client tools, sent after the request's own tools. */
  readonly tools?: readonly AnthropicTool[];
  readonly tool_choice?: AnthropicToolChoice;
  readonly stop_sequences?: readonly string[];
  /** An opaque user ID for abuse detection; never an email or other personal data. */
  readonly metadata?: { readonly user_id?: string };
  /** `auto` uses Priority Tier where the organization has it. */
  readonly service_tier?: 'auto' | 'standard_only';
  /** `us` keeps inference in the US at 1.1x the price. */
  readonly inference_geo?: 'global' | 'us' | (string & {});
  /** Automatic caching: one breakpoint on the last cacheable block. Uses one of the four slots. */
  readonly cache_control?: AnthropicCacheControl;
  /** A code execution container to reuse, by ID, or `{ id?, skills? }`. */
  readonly container?: string | JsonObject;
  /** Beta: clearing tool uses or thinking, and threshold compaction. */
  readonly context_management?: JsonObject;
  /** Beta: on-demand compaction. */
  readonly compaction?: JsonObject;
  /** Beta: remote MCP servers. May hold secrets; never logged. */
  readonly mcp_servers?: readonly JsonObject[];
  /** Beta fast mode (`fast-mode-2026-02-01`): twice the price on Opus 5.5 and Opus 5. */
  readonly speed?: 'standard' | 'fast';
  /** Beta: retry on another model after a refusal. */
  readonly fallbacks?: 'default' | readonly JsonObject[];
  readonly diagnostics?: { readonly previous_message_id: string | null };
  /** Only the defaults are accepted on Claude 5 models (`temperature: 1`, `top_p` 0.99 or more). */
  readonly temperature?: number;
  readonly top_p?: number;
  /** `complete` returns one finished response; `true` is refused. */
  readonly stream?: false;
}

/**
 * The response's own fields, kept in `native`: the stop sequence that matched,
 * stop details (a refusal's category), the code execution container, context
 * management and cache diagnostics, and the usage fields the envelope does not
 * map (cache writes by time to live, service tier, inference geo, speed, server
 * tool counts, iterations).
 */
export interface AnthropicNativeResponse {
  readonly stop_sequence?: string;
  readonly stop_details?: { readonly category?: string | null; readonly [key: string]: unknown };
  readonly container?: { readonly id: string; readonly expires_at?: string };
  readonly context_management?: JsonObject;
  readonly diagnostics?: JsonObject;
  readonly usage?: Omit<
    AnthropicUsage,
    | 'input_tokens'
    | 'output_tokens'
    | 'cache_creation_input_tokens'
    | 'cache_read_input_tokens'
    | 'output_tokens_details'
  >;
  readonly [key: string]: unknown;
}

/** Catalog model IDs. Any other model ID works too. */
export type AnthropicModelId =
  | 'claude-fable-5-1'
  | 'claude-opus-5-5'
  | 'claude-sonnet-5-5'
  | 'claude-haiku-5-5'
  | 'claude-fable-5'
  | 'claude-opus-5'
  | 'claude-sonnet-5';

export interface AnthropicSpec {
  readonly api: 'anthropic-messages';
  readonly credentials: AnthropicCredentials;
  readonly options: AnthropicOptions;
  readonly inputItem: AnthropicInputBlock;
  readonly outputItem: AnthropicOutputBlock;
  readonly response: AnthropicNativeResponse;
  readonly modelId: AnthropicModelId;
}
