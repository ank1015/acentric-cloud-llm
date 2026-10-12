import type { CompletionRequest, ContentPart, MediaSource } from '@acentric-llm/contracts';
import { invalidRequest, isRecord, refuseOwned, type JsonRecord } from '../../shared.ts';
import type { MessagesProfile, MessagesProvider } from './profile.ts';

/** Request fields the request itself sets. */
const OWNED_OPTIONS = ['model', 'messages', 'system'] as const;

/** Reasoning blocks are bound to the model that wrote them. */
const THINKING_BLOCKS: ReadonlySet<unknown> = new Set(['thinking', 'redacted_thinking']);

export interface MessagesRequest {
  /** The JSON body of a non-streaming create-message request. */
  readonly body: JsonRecord;
  /** Beta names for the `anthropic-beta` header. */
  readonly betas: readonly string[];
}

/** Builds a create-message request. Each of our messages becomes one Anthropic message. */
export function buildRequest<P extends MessagesProvider>(
  request: CompletionRequest<P>,
  profile: MessagesProfile<P>,
): MessagesRequest {
  const { provider } = profile;
  const options = refuseOwned(provider, request.providerOptions, OWNED_OPTIONS, 'request');
  if (options.stream === true) {
    throw invalidRequest(
      provider,
      'Streaming is not supported: complete returns one finished response.',
    );
  }
  const { tools: nativeTools, betas, ...passthrough } = options;
  if (nativeTools !== undefined && !Array.isArray(nativeTools)) {
    throw invalidRequest(
      provider,
      'providerOptions.tools must be an array of native tool definitions.',
    );
  }
  if (!Array.isArray(request.messages)) {
    throw invalidRequest(provider, 'messages must be an array.');
  }

  const tools = [
    ...(request.tools ?? []).map((tool, index) => buildTool(tool, `tools[${index}]`, provider)),
    ...(nativeTools ?? []),
  ];
  const system = buildSystem(request.instructions, provider);
  const maxTokens =
    passthrough.max_tokens ??
    profile.catalog.find((model) => model.id === request.model)?.maxOutputTokens ??
    profile.defaultMaxTokens;

  return {
    body: {
      ...passthrough,
      model: request.model,
      max_tokens: maxTokens,
      ...(system !== undefined ? { system } : {}),
      messages: request.messages.flatMap((message, index) =>
        buildMessage(message as unknown, `messages[${index}]`, request.model, profile),
      ),
      ...(tools.length ? { tools } : {}),
    },
    betas: readBetas(betas, provider),
  };
}

function readBetas(value: unknown, provider: string): readonly string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((name) => typeof name === 'string' && /^[\w.-]+$/.test(name))
  ) {
    throw invalidRequest(
      provider,
      'providerOptions.betas must be an array of beta names, such as "compact-2026-01-12".',
    );
  }
  return value;
}

/** `instructions`: a string stays a string; text parts become blocks, which may carry `cache_control`. */
function buildSystem(value: unknown, provider: string): string | JsonRecord[] | undefined {
  if (value === undefined || typeof value === 'string') return value;
  if (!Array.isArray(value)) {
    throw invalidRequest(provider, 'instructions must be a string or text parts.');
  }
  return value.map((part, index) => textBlock(part, `instructions[${index}]`, provider));
}

function buildMessage<P extends MessagesProvider>(
  message: unknown,
  where: string,
  model: string,
  profile: MessagesProfile<P>,
): readonly JsonRecord[] {
  const { provider, label } = profile;
  if (!isRecord(message)) throw invalidRequest(provider, `${where} must be a message object.`);
  switch (message.role) {
    case 'user':
      return [{ role: 'user', content: buildParts(message.content, where, provider) }];
    case 'system':
      return [{ role: 'system', content: textBlocks(message.content, where, provider) }];
    case 'assistant': {
      if (message.provider !== provider) {
        throw invalidRequest(
          provider,
          `${where} is a ${String(message.provider)} assistant message; convert it before sending it to ${label}.`,
        );
      }
      const blocks = nativeBlocks(message.content, where, provider);
      if (message.model === model) return [{ role: 'assistant', content: blocks }];
      // Another model's reasoning is bound to it: some models read it, others
      // ignore it without a word. Its other blocks replay as written.
      const kept = blocks.filter((block) => !THINKING_BLOCKS.has(block.type));
      return kept.length ? [{ role: 'assistant', content: kept }] : [];
    }
    case 'native':
      if (message.provider !== provider) {
        throw invalidRequest(
          provider,
          `${where} holds ${String(message.provider)} items, which ${label} cannot take.`,
        );
      }
      return [{ role: 'user', content: nativeBlocks(message.content, where, provider) }];
    case 'tool_result':
      return [{ role: 'user', content: [buildToolResult(message, where, profile)] }];
    case 'custom':
      throw invalidRequest(
        provider,
        `${where} is an application message; remove custom messages before sending.`,
      );
    default:
      throw invalidRequest(provider, `${where} has an unknown role: ${String(message.role)}.`);
  }
}

function nativeBlocks(value: unknown, where: string, provider: string): readonly JsonRecord[] {
  if (
    !Array.isArray(value) ||
    !value.every((block) => isRecord(block) && typeof block.type === 'string')
  ) {
    throw invalidRequest(provider, `${where}.content must be an array of typed blocks.`);
  }
  return value as JsonRecord[];
}

const RESULT_OWNED = ['type', 'tool_use_id', 'content', 'is_error'] as const;

function buildToolResult<P extends MessagesProvider>(
  message: JsonRecord,
  where: string,
  { provider, label }: MessagesProfile<P>,
): JsonRecord {
  if (typeof message.toolCallId !== 'string' || !message.toolCallId) {
    throw invalidRequest(provider, `${where}.toolCallId must be a nonempty string.`);
  }
  const toolType = message.toolType ?? 'function';
  if (toolType === 'custom') {
    throw invalidRequest(provider, `${where} answers a custom tool; ${label} has none.`);
  }
  if (toolType !== 'function') {
    throw invalidRequest(provider, `${where}.toolType must be function or custom.`);
  }
  if (message.isError !== undefined && typeof message.isError !== 'boolean') {
    throw invalidRequest(provider, `${where}.isError must be a boolean.`);
  }
  const fields = refuseOwned(provider, message.providerOptions, RESULT_OWNED, where);
  const content = message.content;
  if (!Array.isArray(content)) throw invalidRequest(provider, `${where}.content must be an array.`);
  const only = content[0];
  const output =
    content.length === 1 &&
    isRecord(only) &&
    only.type === 'text' &&
    typeof only.text === 'string' &&
    only.providerOptions === undefined
      ? only.text
      : buildParts(content, where, provider);
  return {
    ...fields,
    type: 'tool_result',
    tool_use_id: message.toolCallId,
    content: output,
    ...(message.isError !== undefined ? { is_error: message.isError } : {}),
  };
}

function textBlocks(value: unknown, where: string, provider: string): readonly JsonRecord[] {
  if (!Array.isArray(value)) {
    throw invalidRequest(provider, `${where}.content must be an array of text parts.`);
  }
  return value.map((part, index) => textBlock(part, `${where}.content[${index}]`, provider));
}

function textBlock(part: unknown, at: string, provider: string): JsonRecord {
  if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') {
    throw invalidRequest(provider, `${at} must be a text part.`);
  }
  const fields = refuseOwned(provider, part.providerOptions, ['type', 'text'], at);
  return { ...fields, type: 'text', text: part.text };
}

function buildParts(value: unknown, where: string, provider: string): readonly JsonRecord[] {
  if (!Array.isArray(value)) {
    throw invalidRequest(provider, `${where}.content must be an array of parts.`);
  }
  return value.map((part: unknown, index) => {
    const at = `${where}.content[${index}]`;
    if (!isRecord(part)) throw invalidRequest(provider, `${at} must be a content part.`);
    return buildPart(part as unknown as ContentPart, at, provider);
  });
}

function buildPart(part: ContentPart, at: string, provider: string): JsonRecord {
  switch (part.type) {
    case 'text':
      return textBlock(part, at, provider);
    case 'image': {
      const fields = refuseOwned(provider, part.providerOptions, ['type', 'source'], at);
      return { ...fields, type: 'image', source: mediaSource(part.source, at, provider) };
    }
    case 'file': {
      if (part.filename !== undefined && typeof part.filename !== 'string') {
        throw invalidRequest(provider, `${at}.filename must be a string.`);
      }
      const owned = part.filename !== undefined ? ['type', 'source', 'title'] : ['type', 'source'];
      const fields = refuseOwned(provider, part.providerOptions, owned, at);
      return {
        ...fields,
        type: 'document',
        source: mediaSource(part.source, at, provider, true),
        ...(part.filename !== undefined ? { title: part.filename } : {}),
      };
    }
    default:
      throw invalidRequest(
        provider,
        `${at} has an unknown type: ${String((part as { type?: unknown }).type)}.`,
      );
  }
}

/** A shared source as Anthropic's. Plain text documents go as text, which Anthropic takes only that way. */
function mediaSource(source: unknown, at: string, provider: string, document = false): JsonRecord {
  const checked = checkSource(source, at, provider);
  switch (checked.type) {
    case 'url':
      return { type: 'url', url: checked.url };
    case 'file_id':
      return { type: 'file', file_id: checked.id };
    case 'base64':
      if (document && checked.mediaType === 'text/plain') {
        return {
          type: 'text',
          media_type: 'text/plain',
          data: decodeText(checked.data, at, provider),
        };
      }
      return { type: 'base64', media_type: checked.mediaType, data: checked.data };
  }
}

function checkSource(source: unknown, at: string, provider: string): MediaSource {
  if (isRecord(source)) {
    if (source.type === 'url' && typeof source.url === 'string') return source as MediaSource;
    if (source.type === 'file_id' && typeof source.id === 'string') return source as MediaSource;
    if (
      source.type === 'base64' &&
      typeof source.data === 'string' &&
      typeof source.mediaType === 'string'
    ) {
      return source as MediaSource;
    }
  }
  throw invalidRequest(provider, `${at}.source must be a url, base64 or file_id source.`);
}

function decodeText(base64: string, at: string, provider: string): string {
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidRequest(provider, `${at}.source must hold base64 UTF-8 text for text/plain.`);
  }
}

function buildTool(tool: unknown, where: string, provider: string): JsonRecord {
  if (!isRecord(tool) || typeof tool.name !== 'string' || typeof tool.description !== 'string') {
    throw invalidRequest(provider, 'Each tool needs a type, a name and a description.');
  }
  const at = `tool ${tool.name}`;
  if (tool.type === 'custom') {
    throw invalidRequest(
      provider,
      `${at} is a custom tool; Anthropic has no free-form tools. Use a function tool.`,
    );
  }
  if (tool.type !== 'function') {
    throw invalidRequest(provider, `${where} has an unknown type: ${String(tool.type)}.`);
  }
  const owned = ['type', 'name', 'description', 'input_schema', 'strict'];
  const fields = refuseOwned(provider, tool.providerOptions, owned, at);
  if (!isRecord(tool.parameters)) {
    throw invalidRequest(provider, `${at}: parameters must be a JSON Schema object.`);
  }
  return {
    ...fields,
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
  };
}
