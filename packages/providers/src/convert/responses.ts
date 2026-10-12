// The Responses format's side of conversion (OpenAI, Fireworks).

import { isRecord, type JsonRecord } from '../shared.ts';
import type { Context, FormatConverter, Portable } from './types.ts';

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []))
    : [];
}

/** The readable text of a reasoning item: its summary, else its reasoning text. */
function reasoningText(item: JsonRecord): string {
  const summary = texts(item.summary);
  return (summary.length ? summary : texts(item.content)).join('\n\n');
}

function message(content: JsonRecord[]): JsonRecord {
  return { type: 'message', role: 'assistant', content };
}

function outputText(text: string): JsonRecord {
  return { type: 'output_text', text, annotations: [] };
}

/** Reasoning the target cannot use as is: dropped, or kept as text. */
function carryReasoning(text: string, context: Context): JsonRecord | undefined {
  if (context.reasoning === 'drop' || !text) {
    context.change('dropped', 'reasoning', text ? 'bound to its model' : 'no readable text');
    return undefined;
  }
  if (context.target.plainReasoning) {
    context.change('rewritten', 'reasoning', 'as a plain reasoning item');
    return { type: 'reasoning', summary: [{ type: 'summary_text', text }] };
  }
  context.change('rewritten', 'reasoning', 'as assistant text');
  return message([outputText(text)]);
}

function call(item: JsonRecord): JsonRecord {
  return {
    type: 'function_call',
    call_id: item.call_id,
    name: item.name,
    arguments: item.arguments,
  };
}

export const responsesConverter: FormatConverter = {
  sameFormat(items, sameProvider, context) {
    const out: JsonRecord[] = [];
    for (const item of items) {
      switch (item.type) {
        case 'message': {
          if (sameProvider) {
            out.push(item);
            break;
          }
          const { id: _id, status: _status, ...rest } = item;
          out.push(rest);
          break;
        }
        case 'reasoning': {
          // A provider's own plain reasoning reads the same on any of its models.
          if (sameProvider && context.target.plainReasoning && !item.encrypted_content) {
            out.push(item);
            break;
          }
          const carried = carryReasoning(reasoningText(item), context);
          if (carried) out.push(carried);
          break;
        }
        case 'function_call':
          out.push(sameProvider ? item : call(item));
          break;
        case 'custom_tool_call':
          if (context.target.customTools) {
            const { id: _id, status: _status, ...rest } = item;
            out.push(sameProvider ? item : rest);
          } else {
            if (typeof item.call_id === 'string') context.droppedCalls.add(item.call_id);
            context.change('dropped', 'tool_call', `custom tool ${String(item.name)}`);
          }
          break;
        default:
          if (sameProvider) out.push(item);
          else context.change('dropped', 'provider_item', String(item.type));
      }
    }
    return out;
  },

  read(items, context) {
    const parts: Portable[] = [];
    for (const item of items) {
      switch (item.type) {
        case 'message':
          for (const part of Array.isArray(item.content) ? item.content : []) {
            if (!isRecord(part)) continue;
            if (part.type === 'output_text' && typeof part.text === 'string') {
              if (Array.isArray(part.annotations) && part.annotations.length) {
                context.change('dropped', 'citations', `${part.annotations.length} annotations`);
              }
              parts.push({ kind: 'text', text: part.text });
            } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
              parts.push({ kind: 'refusal', text: part.refusal });
            } else {
              parts.push({ kind: 'other', type: `message ${String(part.type)}` });
            }
          }
          break;
        case 'reasoning':
          parts.push({ kind: 'reasoning', text: reasoningText(item) });
          break;
        case 'function_call':
          parts.push({
            kind: 'call',
            id: String(item.call_id),
            name: String(item.name),
            arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
          });
          break;
        case 'custom_tool_call':
          parts.push({
            kind: 'custom_call',
            id: String(item.call_id),
            name: String(item.name),
            input: typeof item.input === 'string' ? item.input : '',
          });
          break;
        default:
          parts.push({ kind: 'other', type: String(item.type) });
      }
    }
    return parts;
  },

  write(parts, context) {
    const out: JsonRecord[] = [];
    let open: JsonRecord[] | undefined;
    const close = () => {
      if (open?.length) out.push(message(open));
      open = undefined;
    };
    for (const part of parts) {
      switch (part.kind) {
        case 'text':
          (open ??= []).push(outputText(part.text));
          break;
        case 'refusal':
          (open ??= []).push({ type: 'refusal', refusal: part.text });
          break;
        case 'reasoning': {
          close();
          const carried = carryReasoning(part.text, context);
          if (carried) out.push(carried);
          break;
        }
        case 'call':
          close();
          out.push({
            type: 'function_call',
            call_id: context.callId(part.id),
            name: part.name,
            arguments: part.arguments,
          });
          break;
        case 'custom_call':
          close();
          if (context.target.customTools) {
            out.push({
              type: 'custom_tool_call',
              call_id: context.callId(part.id),
              name: part.name,
              input: part.input,
            });
          } else {
            context.droppedCalls.add(part.id);
            context.change('dropped', 'tool_call', `custom tool ${part.name}`);
          }
          break;
        case 'other':
          context.change('dropped', 'provider_item', part.type);
      }
    }
    close();
    return out;
  },
};
