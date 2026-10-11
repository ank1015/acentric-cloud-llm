import { isRecord, type JsonRecord } from '../../shared.ts';

/** Item types the caller answers with a `tool_result`. */
const RESULT_CALLS: Readonly<Record<string, 'function' | 'custom'>> = {
  function_call: 'function',
  custom_tool_call: 'custom',
};

/** Provider-defined calls the caller executes and answers with a `native` item. */
const NATIVE_CALLS = new Set([
  'computer_call',
  'shell_call',
  'apply_patch_call',
  'local_shell_call',
  'tool_search_call',
  'mcp_approval_request',
]);

export interface CallItem {
  readonly item: JsonRecord;
  /** The ID its answer carries. */
  readonly id: string;
  readonly toolType: 'function' | 'custom' | 'native';
}

/** Calls in `items` that the caller answers, in order. */
export function callItems(items: readonly unknown[]): readonly CallItem[] {
  const calls: CallItem[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.type !== 'string') continue;
    const toolType =
      RESULT_CALLS[item.type] ?? (NATIVE_CALLS.has(item.type) ? 'native' : undefined);
    if (toolType === undefined) continue;
    // Server-run tool search has no call to answer.
    if (item.type === 'tool_search_call' && item.execution !== 'client') continue;
    const id = item.type === 'mcp_approval_request' ? item.id : item.call_id;
    if (typeof id !== 'string' || !id) continue;
    calls.push({ item, id, toolType });
  }
  return calls;
}

/** IDs answered within `items`, as a hosted shell call is by its output. */
export function answeredIds(items: readonly unknown[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.type !== 'string') continue;
    if (item.type === 'mcp_approval_response' && typeof item.approval_request_id === 'string') {
      ids.add(item.approval_request_id);
    } else if (item.type.endsWith('_output') && typeof item.call_id === 'string') {
      ids.add(item.call_id);
    }
  }
  return ids;
}

/** Calls in `items` with no answer in `items`. */
export function pendingCallItems(items: readonly unknown[]): readonly CallItem[] {
  const answered = answeredIds(items);
  return callItems(items).filter((call) => !answered.has(call.id));
}
