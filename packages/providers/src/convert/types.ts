import type { ApiFormat, Provider } from '@acentric-llm/contracts';
import type { JsonRecord } from '../shared.ts';

/** The provider and model a conversation is converted for. */
export interface ConvertTarget<P extends Provider = Provider> {
  readonly provider: P;
  readonly model: string;
}

export interface ConvertOptions {
  /**
   * Reasoning the target cannot use as is: another model's signed or
   * encrypted reasoning, and any reasoning sent to another provider.
   * `drop` (the default) leaves it out. `text` keeps its readable text: as a
   * plain reasoning item where the target reads one (Fireworks), otherwise as
   * assistant text. Reasoning with no readable text is dropped either way.
   */
  readonly reasoning?: 'drop' | 'text';
}

/** One thing `convert` dropped or rewrote. */
export interface ConversionChange {
  /** The message's index in the input. */
  readonly index: number;
  readonly action: 'dropped' | 'rewritten';
  readonly what:
    | 'message'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'tool_call_id'
    | 'tool_arguments'
    | 'provider_item'
    | 'citations'
    | 'refusal'
    | 'part'
    | 'part_option';
  /** What exactly, for logs, e.g. `web_search_call` or `cache_control`. */
  readonly detail: string;
}

/** Converted messages, and every change made to get them. */
export interface Conversion<M> {
  readonly messages: M[];
  readonly changes: readonly ConversionChange[];
}

/** What a target provider can take, as far as conversion cares. */
export interface TargetInfo {
  readonly provider: Provider;
  readonly model: string;
  readonly api: ApiFormat;
  /** Free-form custom tools and their calls. */
  readonly customTools: boolean;
  /** File parts. */
  readonly files: boolean;
  /** Images and files by a provider file ID. */
  readonly fileIds: boolean;
  /** Reads reasoning items that hold only text. */
  readonly plainReasoning: boolean;
}

/** The provider-neutral reading of one assistant item, used between formats. Never stored. */
export type Portable =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'refusal'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string }
  | {
      readonly kind: 'call';
      readonly id: string;
      readonly name: string;
      readonly arguments: string;
    }
  | {
      readonly kind: 'custom_call';
      readonly id: string;
      readonly name: string;
      readonly input: string;
    }
  | { readonly kind: 'other'; readonly type: string };

/** State shared while one conversation is converted. */
export interface Context {
  readonly target: TargetInfo;
  readonly reasoning: 'drop' | 'text';
  /** The input index of the message being converted. */
  index: number;
  /** Call IDs whose calls were dropped; their results are dropped too. */
  readonly droppedCalls: Set<string>;
  change(action: ConversionChange['action'], what: ConversionChange['what'], detail: string): void;
  /** A call ID as the target takes it; results are mapped the same way. */
  callId(id: string): string;
}

/** One API format's side of conversion. */
export interface FormatConverter {
  /** Items of a message from another provider or model in this same format. */
  sameFormat(items: readonly JsonRecord[], sameProvider: boolean, context: Context): JsonRecord[];
  /** Items of a message in this format, read for another format. */
  read(items: readonly JsonRecord[], context: Context): Portable[];
  /** Portable items written as this format's items. */
  write(parts: readonly Portable[], context: Context): JsonRecord[];
}
