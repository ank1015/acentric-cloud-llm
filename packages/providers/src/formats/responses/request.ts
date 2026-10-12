import type {
  CompletionRequest,
  ContentPart,
  MediaSource,
  ToolDefinition,
} from '@acentric-llm/contracts';
import { invalidRequest, isRecord, refuseOwned, type JsonRecord } from '../../shared.ts';
import type { ResponsesProfile, ResponsesProvider } from './profile.ts';

/** Request fields the request itself sets. */
const OWNED_OPTIONS = ['model', 'input', 'instructions'] as const;

/** Builds the JSON body of a non-streaming create-response request. */
export function buildRequest<P extends ResponsesProvider>(
  request: CompletionRequest<P>,
  profile: ResponsesProfile<P>,
): JsonRecord {
  const { provider } = profile;
  const options = refuseOwned(provider, request.providerOptions, OWNED_OPTIONS, 'request');
  if (options.stream === true) {
    throw invalidRequest(
      provider,
      'Streaming is not supported: complete returns one finished response.',
    );
  }
  if (options.background === true) {
    throw invalidRequest(
      provider,
      'Background mode is not supported: complete returns one finished response.',
    );
  }
  const { tools: nativeTools, ...passthrough } = options;
  if (nativeTools !== undefined && !Array.isArray(nativeTools)) {
    throw invalidRequest(
      provider,
      'providerOptions.tools must be an array of native tool definitions.',
    );
  }

  const tools = [
    ...(request.tools ?? []).map((tool) => buildTool(tool, profile)),
    ...(nativeTools ?? []),
  ];
  const instructions = buildInstructions(provider, request.instructions);
  if (!Array.isArray(request.messages))
    throw invalidRequest(provider, 'messages must be an array.');

  return {
    ...passthrough,
    model: request.model,
    ...(instructions !== undefined ? { instructions } : {}),
    input: request.messages.flatMap((message, index) =>
      buildItems(message as unknown, `messages[${index}]`, profile),
    ),
    ...(tools.length ? { tools } : {}),
  };
}

function buildInstructions(provider: string, value: unknown): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  if (!Array.isArray(value))
    throw invalidRequest(provider, 'instructions must be a string or text parts.');
  const texts = value.map((part, index) => {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') {
      throw invalidRequest(provider, `instructions[${index}] must be a text part.`);
    }
    if (part.providerOptions !== undefined) {
      throw invalidRequest(
        provider,
        `instructions[${index}].providerOptions is not supported: instructions are one string here. ` +
          'Send a system message to set options such as a cache breakpoint.',
      );
    }
    return part.text;
  });
  return texts.length ? texts.join('\n\n') : undefined;
}

function buildItems<P extends ResponsesProvider>(
  message: unknown,
  where: string,
  profile: ResponsesProfile<P>,
): readonly unknown[] {
  const { provider } = profile;
  if (!isRecord(message)) throw invalidRequest(provider, `${where} must be a message object.`);
  switch (message.role) {
    case 'user':
      return [
        { type: 'message', role: 'user', content: buildParts(message.content, where, profile) },
      ];
    case 'system':
      return [
        {
          type: 'message',
          role: profile.systemRole,
          content: buildParts(message.content, where, profile, true),
        },
      ];
    case 'assistant':
      if (message.provider !== provider) {
        throw invalidRequest(
          provider,
          `${where} is a ${String(message.provider)} assistant message; convert it before sending it to ${profile.label}.`,
        );
      }
      return nativeItems(provider, message.content, where).map((item) =>
        stripOutputOnly(item, profile.outputOnlyFields),
      );
    case 'native':
      if (message.provider !== provider) {
        throw invalidRequest(
          provider,
          `${where} holds ${String(message.provider)} items, which ${profile.label} cannot take.`,
        );
      }
      return nativeItems(provider, message.content, where);
    case 'tool_result':
      return [buildToolResult(message, where, profile)];
    case 'custom':
      throw invalidRequest(
        provider,
        `${where} is an application message; remove custom messages before sending.`,
      );
    default:
      throw invalidRequest(provider, `${where} has an unknown role: ${String(message.role)}.`);
  }
}

function nativeItems(provider: string, value: unknown, where: string): readonly JsonRecord[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => isRecord(item) && typeof item.type === 'string')
  ) {
    throw invalidRequest(provider, `${where}.content must be an array of typed items.`);
  }
  return value as JsonRecord[];
}

/** Fields the provider reports on output items and refuses on input. */
function stripOutputOnly(item: JsonRecord, fields: readonly string[]): JsonRecord {
  if (!fields.some((field) => field in item)) return item;
  return Object.fromEntries(Object.entries(item).filter(([key]) => !fields.includes(key)));
}

const RESULT_OWNED = ['type', 'call_id', 'output'] as const;

function buildToolResult<P extends ResponsesProvider>(
  message: JsonRecord,
  where: string,
  profile: ResponsesProfile<P>,
): JsonRecord {
  const { provider } = profile;
  if (typeof message.toolCallId !== 'string' || !message.toolCallId) {
    throw invalidRequest(provider, `${where}.toolCallId must be a nonempty string.`);
  }
  const toolType = message.toolType ?? 'function';
  if (toolType !== 'function' && toolType !== 'custom') {
    throw invalidRequest(provider, `${where}.toolType must be function or custom.`);
  }
  if (toolType === 'custom' && !profile.customTools) {
    throw invalidRequest(provider, `${where} answers a custom tool; ${profile.label} has none.`);
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
      : buildParts(content, where, profile);
  return {
    ...fields,
    type: toolType === 'function' ? 'function_call_output' : 'custom_tool_call_output',
    call_id: message.toolCallId,
    output,
  };
}

function buildParts<P extends ResponsesProvider>(
  value: unknown,
  where: string,
  profile: ResponsesProfile<P>,
  textOnly = false,
): readonly JsonRecord[] {
  const { provider } = profile;
  if (!Array.isArray(value))
    throw invalidRequest(provider, `${where}.content must be an array of parts.`);
  return value.map((part: unknown, index) => {
    const at = `${where}.content[${index}]`;
    if (!isRecord(part)) throw invalidRequest(provider, `${at} must be a content part.`);
    if (textOnly && part.type !== 'text')
      throw invalidRequest(provider, `${at} must be a text part.`);
    return buildPart(part as unknown as ContentPart, at, profile);
  });
}

function buildPart<P extends ResponsesProvider>(
  part: ContentPart,
  at: string,
  profile: ResponsesProfile<P>,
): JsonRecord {
  const { provider } = profile;
  switch (part.type) {
    case 'text': {
      if (typeof part.text !== 'string')
        throw invalidRequest(provider, `${at}.text must be a string.`);
      const fields = refuseOwned(provider, part.providerOptions, ['type', 'text'], at);
      return { ...fields, type: 'input_text', text: part.text };
    }
    case 'image': {
      const fields = refuseOwned(
        provider,
        part.providerOptions,
        ['type', 'image_url', 'file_id'],
        at,
      );
      const source = checkSource(part.source, at, profile);
      return {
        ...fields,
        type: 'input_image',
        ...(source.type === 'url'
          ? { image_url: source.url }
          : source.type === 'base64'
            ? { image_url: dataUrl(source.mediaType, source.data) }
            : { file_id: source.id }),
      };
    }
    case 'file': {
      const { fileData } = profile;
      if (fileData === undefined) {
        throw invalidRequest(
          provider,
          `${at} is a file; ${profile.label} takes no files and would drop it without an error.`,
        );
      }
      const owned = ['type', 'file_url', 'file_data', 'file_id', 'filename'];
      const fields = refuseOwned(provider, part.providerOptions, owned, at);
      const source = checkSource(part.source, at, profile);
      if (part.filename !== undefined && typeof part.filename !== 'string') {
        throw invalidRequest(provider, `${at}.filename must be a string.`);
      }
      return {
        ...fields,
        type: 'input_file',
        ...(source.type === 'url'
          ? { file_url: source.url }
          : source.type === 'base64'
            ? { file_data: fileData(source.mediaType, source.data) }
            : { file_id: source.id }),
        ...(part.filename !== undefined ? { filename: part.filename } : {}),
      };
    }
    default:
      throw invalidRequest(
        provider,
        `${at} has an unknown type: ${String((part as { type?: unknown }).type)}.`,
      );
  }
}

function checkSource<P extends ResponsesProvider>(
  source: unknown,
  at: string,
  profile: ResponsesProfile<P>,
): MediaSource {
  const { provider } = profile;
  if (isRecord(source)) {
    if (source.type === 'url' && typeof source.url === 'string') return source as MediaSource;
    if (source.type === 'file_id' && typeof source.id === 'string') {
      if (!profile.fileIds) {
        throw invalidRequest(
          provider,
          `${at}.source is a file ID; ${profile.label} takes no file IDs here. Send a URL or base64 data.`,
        );
      }
      return source as MediaSource;
    }
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

export function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

function buildTool<P extends ResponsesProvider>(
  tool: ToolDefinition,
  profile: ResponsesProfile<P>,
): JsonRecord {
  const { provider } = profile;
  if (!isRecord(tool) || typeof tool.name !== 'string' || typeof tool.description !== 'string') {
    throw invalidRequest(provider, 'Each tool needs a type, a name and a description.');
  }
  const where = `tool ${tool.name}`;
  if (tool.type === 'function') {
    const owned = ['type', 'name', 'description', 'parameters', 'strict'];
    const fields = refuseOwned(provider, tool.providerOptions, owned, where);
    if (!isRecord(tool.parameters))
      throw invalidRequest(provider, `${where}: parameters must be a JSON Schema object.`);
    return {
      ...fields,
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      // An omitted `strict` stays omitted: the provider treats it differently from false.
      ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    };
  }
  if (tool.type === 'custom') {
    if (!profile.customTools) {
      throw invalidRequest(
        provider,
        `${where} is a custom tool; ${profile.label} takes no custom tools here. Use a function tool.`,
      );
    }
    const fields = refuseOwned(
      provider,
      tool.providerOptions,
      ['type', 'name', 'description', 'format'],
      where,
    );
    return {
      ...fields,
      type: 'custom',
      name: tool.name,
      description: tool.description,
      ...(tool.format !== undefined ? { format: tool.format } : {}),
    };
  }
  throw invalidRequest(
    provider,
    `${where} has an unknown type: ${String((tool as { type?: unknown }).type)}.`,
  );
}
