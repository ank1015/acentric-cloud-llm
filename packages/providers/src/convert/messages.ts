// The Messages format's side of conversion (Anthropic).

import { isRecord, type JsonRecord } from '../shared.ts';
import type { Context, FormatConverter, Portable } from './types.ts';

const THINKING: ReadonlySet<unknown> = new Set(['thinking', 'redacted_thinking']);

/** Signed reasoning the target cannot use: dropped, or kept as text. */
function carryReasoning(text: string, context: Context): JsonRecord | undefined {
  if (context.reasoning === 'drop' || !text) {
    context.change('dropped', 'reasoning', text ? 'bound to its model' : 'no readable text');
    return undefined;
  }
  context.change('rewritten', 'reasoning', 'as assistant text');
  return { type: 'text', text };
}

/** Tool input must be an object; anything else is wrapped. */
function toolInput(args: string, context: Context): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(args);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Wrapped below.
  }
  context.change('rewritten', 'tool_arguments', 'not a JSON object: wrapped as { arguments }');
  return { arguments: args };
}

export const messagesConverter: FormatConverter = {
  sameFormat(items, sameProvider, context) {
    const out: JsonRecord[] = [];
    for (const block of items) {
      if (THINKING.has(block.type)) {
        const carried = carryReasoning(
          typeof block.thinking === 'string' ? block.thinking : '',
          context,
        );
        if (carried) out.push(carried);
      } else if (sameProvider || block.type === 'text' || block.type === 'tool_use') {
        out.push(block);
      } else {
        context.change('dropped', 'provider_item', String(block.type));
      }
    }
    return out;
  },

  read(items, context) {
    return items.map((block): Portable => {
      switch (block.type) {
        case 'text':
          if (Array.isArray(block.citations) && block.citations.length) {
            context.change('dropped', 'citations', `${block.citations.length} citations`);
          }
          return { kind: 'text', text: typeof block.text === 'string' ? block.text : '' };
        case 'thinking':
          return {
            kind: 'reasoning',
            text: typeof block.thinking === 'string' ? block.thinking : '',
          };
        case 'redacted_thinking':
          return { kind: 'reasoning', text: '' };
        case 'tool_use':
          return {
            kind: 'call',
            id: String(block.id),
            name: String(block.name),
            arguments: JSON.stringify(block.input ?? {}),
          };
        default:
          return { kind: 'other', type: String(block.type) };
      }
    });
  },

  write(parts, context) {
    const out: JsonRecord[] = [];
    for (const part of parts) {
      switch (part.kind) {
        case 'text':
          // Anthropic refuses empty text blocks.
          if (part.text) out.push({ type: 'text', text: part.text });
          break;
        case 'refusal':
          context.change('rewritten', 'refusal', 'as assistant text');
          if (part.text) out.push({ type: 'text', text: part.text });
          break;
        case 'reasoning': {
          const carried = carryReasoning(part.text, context);
          if (carried) out.push(carried);
          break;
        }
        case 'call':
          out.push({
            type: 'tool_use',
            id: context.callId(part.id),
            name: part.name,
            input: toolInput(part.arguments, context),
          });
          break;
        case 'custom_call':
          context.droppedCalls.add(part.id);
          context.change('dropped', 'tool_call', `custom tool ${part.name}`);
          break;
        case 'other':
          context.change('dropped', 'provider_item', part.type);
      }
    }
    return out;
  },
};
