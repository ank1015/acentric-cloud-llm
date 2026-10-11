import type { StopReason } from '@acentric-llm/contracts';
import { isRecord } from '../../shared.ts';
import { pendingCallItems } from './calls.ts';

/**
 * Derives the stop reason of a completed or incomplete response. The format has
 * no stop reason of its own: it reports a status, and the output shows the rest.
 */
export function deriveStopReason(
  status: 'completed' | 'incomplete',
  incompleteReason: string | undefined,
  output: readonly unknown[],
): StopReason {
  if (status === 'incomplete')
    return incompleteReason === 'content_filter' ? 'content_filter' : 'length';
  if (pendingCallItems(output).length) return 'tool_use';

  const messages = output.filter((item) => isRecord(item) && item.type === 'message');
  const refused = messages.some(
    (message) =>
      isRecord(message) &&
      Array.isArray(message.content) &&
      message.content.some((part) => isRecord(part) && part.type === 'refusal'),
  );
  if (refused) return 'refusal';

  const answered = messages.some((message) => isRecord(message) && message.phase !== 'commentary');
  // Work without a final answer (hosted calls, a program, commentary) continues when sent back.
  return answered || output.length === 0 ? 'stop' : 'pause_turn';
}
