import type { JsonObject, ProviderFields } from './json.ts';

/** A JSON Schema object. */
export type JsonSchema = JsonObject;

interface ToolBase {
  readonly name: string;
  readonly description: string;
  /** Merged into the provider's tool definition, e.g. Anthropic `cache_control`. */
  readonly providerOptions?: ProviderFields;
}

/** A tool called with JSON arguments matching `parameters`. */
export interface FunctionTool extends ToolBase {
  readonly type: 'function';
  readonly parameters: JsonSchema;
  /** Ask the provider to constrain arguments to the schema, where supported. */
  readonly strict?: boolean;
}

/** Free-form input, optionally constrained by a grammar. Not every provider supports it. */
export interface CustomTool extends ToolBase {
  readonly type: 'custom';
  readonly format?: CustomToolFormat;
}

export type CustomToolFormat =
  | { readonly type: 'text' }
  | { readonly type: 'grammar'; readonly syntax: 'lark' | 'regex'; readonly definition: string };

/**
 * Tools the caller executes. Hosted or server tools are the provider's own
 * definitions, passed in `providerOptions.tools`.
 */
export type ToolDefinition = FunctionTool | CustomTool;

export type ToolType = ToolDefinition['type'];
