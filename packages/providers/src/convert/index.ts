// Cross-provider conversion (design D13). Pure: no I/O, clock or randomness.
//
// Assistant messages are the only provider-specific messages. One from the
// target's own provider and model is kept as is. One from another provider or
// model in the same API format is filtered (the fast path). Any other is read
// into provider-neutral parts and written in the target's format (the hub).
// Shared messages keep their shape, minus what the target cannot take.

import type {
  ApiFormat,
  ContentPart,
  Message,
  Provider,
  ToolResultMessage,
} from '@acentric-llm/contracts';
import { fireworksProfile } from '../providers/fireworks.ts';
import { openAiProfile } from '../providers/openai.ts';
import { openRouterProfile } from '../providers/openrouter.ts';
import { isRecord, type JsonRecord } from '../shared.ts';
import { messagesConverter } from './messages.ts';
import { responsesConverter } from './responses.ts';
import type {
  Context,
  Conversion,
  ConversionChange,
  ConvertOptions,
  ConvertTarget,
  FormatConverter,
  TargetInfo,
} from './types.ts';

export type { Conversion, ConversionChange, ConvertOptions, ConvertTarget } from './types.ts';

type Capabilities = Omit<TargetInfo, 'provider' | 'model'>;

/** What each provider takes. Adding a provider fails to compile until it is here. */
const TARGETS: { readonly [P in Provider]: Capabilities } = {
  openai: {
    api: 'openai-responses',
    customTools: openAiProfile.customTools,
    files: openAiProfile.fileData !== undefined,
    fileIds: openAiProfile.fileIds,
    // OpenAI accepts reasoning items with only text and ignores them.
    plainReasoning: false,
  },
  fireworks: {
    api: 'openai-responses',
    customTools: fireworksProfile.customTools,
    files: fireworksProfile.fileData !== undefined,
    fileIds: fireworksProfile.fileIds,
    plainReasoning: true,
  },
  anthropic: {
    api: 'anthropic-messages',
    customTools: false,
    files: true,
    fileIds: true,
    plainReasoning: false,
  },
  openrouter: {
    api: 'openai-responses',
    customTools: openRouterProfile.customTools,
    files: openRouterProfile.fileData !== undefined,
    fileIds: openRouterProfile.fileIds,
    // Counted as input, but the model does not use reasoning without its ciphertext.
    plainReasoning: false,
  },
};

/**
 * Options each provider reads on shared parts and tool results. When
 * converting, keys owned by other providers and not by the target are
 * dropped; unknown keys are kept. Nothing is translated: cache breakpoints
 * are a per-request strategy that providers place and limit differently.
 */
const PART_OPTIONS: { readonly [P in Provider]: readonly string[] } = {
  openai: ['detail', 'prompt_cache_breakpoint', 'caller', 'namespace'],
  fireworks: ['detail'],
  anthropic: ['cache_control', 'citations', 'context', 'title', 'transformations', 'toolset_name'],
  // Its Responses API takes breakpoints, not per-block `cache_control`.
  openrouter: ['detail', 'prompt_cache_breakpoint'],
};

const FORMATS: { readonly [A in ApiFormat]?: FormatConverter } = {
  'openai-responses': responsesConverter,
  'anthropic-messages': messagesConverter,
};

/** Anthropic's tool use IDs; other formats take any string. */
const MESSAGES_CALL_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * The conversation, ready to send to `to.provider` and `to.model`, with a
 * record of everything dropped or rewritten. Messages already fit for the
 * target come back unchanged; the application's `custom` messages are kept.
 */
export function convert<P extends Provider>(
  messages: readonly Message[],
  to: ConvertTarget<P>,
  options: ConvertOptions = {},
): Conversion<Message<P>> {
  const capabilities = TARGETS[to.provider as Provider];
  if (capabilities === undefined) throw new TypeError(`Unknown provider: ${String(to.provider)}.`);
  const target: TargetInfo = { ...capabilities, provider: to.provider, model: to.model };
  const changes: ConversionChange[] = [];
  const rewrittenIds = new Set<string>();
  const context: Context = {
    target,
    reasoning: options.reasoning ?? 'drop',
    index: 0,
    droppedCalls: new Set(),
    change(action, what, detail) {
      changes.push({ index: context.index, action, what, detail });
    },
    callId(id) {
      if (target.api !== 'anthropic-messages' || MESSAGES_CALL_ID.test(id)) return id;
      const mapped = `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}_${hash(id)}`;
      // Reported once, where the call is; its result follows the same mapping.
      if (!rewrittenIds.has(id)) context.change('rewritten', 'tool_call_id', `${id} → ${mapped}`);
      rewrittenIds.add(id);
      return mapped;
    },
  };
  const foreign = foreignOptions(to.provider);

  const out: Message<P>[] = [];
  messages.forEach((message, index) => {
    context.index = index;
    const converted = convertMessage(message, context, foreign);
    if (converted !== undefined) out.push(converted as Message<P>);
  });
  return { messages: out, changes };
}

function convertMessage(
  message: Message,
  context: Context,
  foreign: ReadonlySet<string>,
): Message | undefined {
  const { target } = context;
  switch (message.role) {
    case 'custom':
      return message;
    case 'assistant':
      return convertAssistant(message, context);
    case 'native':
      if (message.provider === target.provider) return message;
      context.change('dropped', 'message', `${message.provider} native items`);
      return undefined;
    case 'tool_result':
      return convertToolResult(message, context, foreign);
    case 'user':
    case 'system': {
      const content = parts(message.content, context, foreign);
      if (!content.length) {
        context.change('dropped', 'message', `${message.role} message left empty`);
        return undefined;
      }
      return { ...message, content } as Message;
    }
  }
}

function convertAssistant(message: Message & { role: 'assistant' }, context: Context) {
  const { target } = context;
  const sameProvider = message.provider === target.provider;
  if (sameProvider && message.model === target.model) return message;

  const items = (message.content as readonly unknown[]).filter(isRecord);
  const source = FORMATS[message.api];
  const writer = FORMATS[target.api];
  if (source === undefined || writer === undefined) {
    throw new TypeError(`No conversion from ${message.api} to ${target.api}.`);
  }
  const content =
    message.api === target.api
      ? source.sameFormat(items, sameProvider, context)
      : writer.write(source.read(items, context), context);
  if (!content.length) {
    context.change('dropped', 'message', 'assistant message left empty');
    return undefined;
  }
  // A response ID belongs to the provider that answered.
  const { id, ...rest } = message;
  return {
    ...rest,
    ...(sameProvider && id !== undefined ? { id } : {}),
    provider: target.provider,
    api: target.api,
    model: target.model,
    content,
  } as unknown as Message;
}

function convertToolResult(
  message: ToolResultMessage,
  context: Context,
  foreign: ReadonlySet<string>,
): Message | undefined {
  if (context.droppedCalls.has(message.toolCallId)) {
    context.change('dropped', 'tool_result', `answers dropped call ${message.toolCallId}`);
    return undefined;
  }
  const { providerOptions, ...rest } = message;
  const fields = options(providerOptions, context, foreign);
  return {
    ...rest,
    toolCallId: context.callId(message.toolCallId),
    content: parts(message.content, context, foreign),
    ...(fields !== undefined ? { providerOptions: fields } : {}),
  };
}

function parts<T extends ContentPart>(
  content: readonly T[],
  context: Context,
  foreign: ReadonlySet<string>,
): T[] {
  const { target } = context;
  return content.flatMap((part) => {
    if (part.type === 'file' && !target.files) {
      context.change('dropped', 'part', `file part; ${target.provider} takes no files`);
      return [];
    }
    if (part.type !== 'text' && part.source.type === 'file_id' && !target.fileIds) {
      context.change(
        'dropped',
        'part',
        `${part.type} by file ID; ${target.provider} takes no file IDs`,
      );
      return [];
    }
    const { providerOptions, ...rest } = part;
    const fields = options(providerOptions, context, foreign);
    return [{ ...rest, ...(fields !== undefined ? { providerOptions: fields } : {}) } as T];
  });
}

/** `providerOptions` without other providers' keys; undefined when nothing is left. */
function options(
  value: Readonly<Record<string, unknown>> | undefined,
  context: Context,
  foreign: ReadonlySet<string>,
): JsonRecord | undefined {
  if (value === undefined) return undefined;
  const kept = Object.fromEntries(
    Object.entries(value).filter(([key]) => {
      if (!foreign.has(key)) return true;
      context.change('dropped', 'part_option', key);
      return false;
    }),
  );
  return Object.keys(kept).length ? kept : undefined;
}

/** Keys other providers own that the target does not. */
function foreignOptions(provider: Provider): ReadonlySet<string> {
  const own = new Set(PART_OPTIONS[provider]);
  return new Set(
    Object.entries(PART_OPTIONS)
      .filter(([other]) => other !== provider)
      .flatMap(([, keys]) => keys)
      .filter((key) => !own.has(key)),
  );
}

/** FNV-1a, base 36: a short, stable suffix that keeps rewritten IDs distinct. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}
