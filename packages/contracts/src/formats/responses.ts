// The Responses API format: OpenAI's Responses API and the Open Responses
// specification (openresponses.org) that other providers implement. These are
// the shapes the base adapter builds and reads. Providers extend the item unions
// with their own items; see `providers/openai.ts`.
//
// Items are typed for what the adapter and extractors interpret. Providers add
// fields and item types often: the adapter passes unknown ones through as is.

/** An explicit prompt-cache breakpoint on a content part (OpenAI, GPT-5.6 and later). */
export interface ResponsesCacheBreakpoint {
  readonly mode: 'explicit';
}

export interface ResponsesInputText {
  readonly type: 'input_text';
  readonly text: string;
  readonly prompt_cache_breakpoint?: ResponsesCacheBreakpoint;
}

export interface ResponsesInputImage {
  readonly type: 'input_image';
  /** A URL or a `data:` URL. */
  readonly image_url?: string;
  readonly file_id?: string;
  readonly detail?: 'auto' | 'low' | 'high' | 'original';
  readonly prompt_cache_breakpoint?: ResponsesCacheBreakpoint;
}

export interface ResponsesInputFile {
  readonly type: 'input_file';
  readonly file_id?: string;
  readonly file_url?: string;
  /** File bytes; OpenAI takes a `data:` URL. */
  readonly file_data?: string;
  readonly filename?: string;
  readonly detail?: 'auto' | 'low' | 'high';
  readonly prompt_cache_breakpoint?: ResponsesCacheBreakpoint;
}

export type ResponsesInputContent = ResponsesInputText | ResponsesInputImage | ResponsesInputFile;

/** A user, system or developer message in `input`. */
export interface ResponsesInputMessage {
  readonly type: 'message';
  readonly role: 'user' | 'system' | 'developer';
  readonly content: readonly ResponsesInputContent[];
}

export type ResponsesAnnotation =
  | {
      readonly type: 'url_citation';
      readonly url: string;
      readonly title: string;
      readonly start_index: number;
      readonly end_index: number;
    }
  | {
      readonly type: 'file_citation';
      readonly file_id: string;
      readonly filename: string;
      readonly index: number;
    }
  | {
      readonly type: 'container_file_citation';
      readonly container_id: string;
      readonly file_id: string;
      readonly filename: string;
      readonly start_index: number;
      readonly end_index: number;
    }
  | { readonly type: 'file_path'; readonly file_id: string; readonly index: number };

export interface ResponsesOutputText {
  readonly type: 'output_text';
  readonly text: string;
  readonly annotations: readonly ResponsesAnnotation[];
  readonly logprobs?: readonly unknown[];
}

export interface ResponsesRefusal {
  readonly type: 'refusal';
  readonly refusal: string;
}

/** An assistant message in `output`. */
export interface ResponsesOutputMessage {
  readonly type: 'message';
  readonly id: string;
  readonly role: 'assistant';
  readonly status: 'in_progress' | 'completed' | 'incomplete';
  /** `commentary` is a progress update, not the answer. Keep it on replay. */
  readonly phase?: 'commentary' | 'final_answer' | null;
  readonly content: readonly (ResponsesOutputText | ResponsesRefusal)[];
}

export interface ResponsesReasoning {
  readonly type: 'reasoning';
  readonly id: string;
  readonly summary: readonly { readonly type: 'summary_text'; readonly text: string }[];
  readonly content?: readonly { readonly type: 'reasoning_text'; readonly text: string }[];
  /** Opaque; replay it unchanged. */
  readonly encrypted_content?: string | null;
  readonly status?: 'in_progress' | 'completed' | 'incomplete';
}

/** Who issued a call, e.g. `{ type: "program", caller_id }` for programmatic tool calling. */
export type ResponsesCaller = { readonly type: string } & Readonly<Record<string, unknown>>;

export interface ResponsesFunctionCall {
  readonly type: 'function_call';
  readonly id?: string;
  /** The ID a result answers; `id` is only the item's ID. */
  readonly call_id: string;
  readonly name: string;
  /** A JSON string, exactly as the model wrote it. */
  readonly arguments: string;
  readonly namespace?: string;
  readonly caller?: ResponsesCaller;
  readonly async?: boolean;
  readonly status?: 'in_progress' | 'completed' | 'incomplete';
}

export interface ResponsesCustomToolCall {
  readonly type: 'custom_tool_call';
  readonly id?: string;
  readonly call_id: string;
  readonly name: string;
  readonly input: string;
  readonly namespace?: string;
  readonly caller?: ResponsesCaller;
  readonly async?: boolean;
}

export interface ResponsesFunctionCallOutput {
  readonly type: 'function_call_output';
  readonly call_id: string;
  readonly output: string | readonly ResponsesInputContent[];
  readonly id?: string;
  readonly name?: string;
  readonly namespace?: string;
  readonly caller?: ResponsesCaller;
  readonly status?: 'in_progress' | 'completed' | 'incomplete';
}

export interface ResponsesCustomToolCallOutput {
  readonly type: 'custom_tool_call_output';
  readonly call_id: string;
  readonly output: string | readonly ResponsesInputContent[];
  readonly id?: string;
  readonly caller?: ResponsesCaller;
}

/** Compacted earlier context. Opaque; replay it unchanged. */
export interface ResponsesCompaction {
  readonly type: 'compaction';
  readonly id?: string;
  readonly encrypted_content: string;
}

/** A stored item, by ID. Needs the provider to have stored it. */
export interface ResponsesItemReference {
  readonly type: 'item_reference';
  readonly id: string;
}

/** Output items every Responses provider shares. */
export type ResponsesOutputItem =
  | ResponsesOutputMessage
  | ResponsesReasoning
  | ResponsesFunctionCall
  | ResponsesCustomToolCall
  | ResponsesCompaction;

/** Input items every Responses provider shares, besides replayed output items. */
export type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesFunctionCallOutput
  | ResponsesCustomToolCallOutput
  | ResponsesItemReference
  | ResponsesOutputItem;

/** Token usage as the Responses format reports it. */
export interface ResponsesUsage {
  /** Every input token, cached or not. */
  readonly input_tokens: number;
  readonly input_tokens_details?: {
    readonly cached_tokens?: number;
    readonly cache_write_tokens?: number;
  } | null;
  /** Output tokens, reasoning included. */
  readonly output_tokens: number;
  readonly output_tokens_details?: { readonly reasoning_tokens?: number } | null;
  readonly total_tokens?: number;
}

export type ResponsesStatus =
  'completed' | 'incomplete' | 'failed' | 'cancelled' | 'queued' | 'in_progress';
