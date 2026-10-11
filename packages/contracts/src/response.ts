import type { AssistantMessage } from './messages.ts';
import type { ModelId, NativeResponse, Provider } from './providers.ts';
import type { Usage } from './usage.ts';

export type StopReason =
  /** Generation ended normally, including at a stop sequence. */
  | 'stop'
  /** Cut short by an output token or length limit. */
  | 'length'
  /** The model called tools for the caller to execute. */
  | 'tool_use'
  /** The model declined the request. */
  | 'refusal'
  /** A provider safety filter blocked or ended generation. */
  | 'content_filter'
  /** The provider paused a turn that can be continued, e.g. during a long server tool run. */
  | 'pause_turn';

/** Success body of `POST /v1/complete`. */
export type CompletionResponse<P extends Provider = Provider> = P extends Provider
  ? {
      /** The provider's response ID, e.g. for `previous_response_id`. */
      readonly id?: string;
      readonly provider: P;
      /** The model ID the request asked for. */
      readonly model: ModelId<P>;
      /** The model the provider reports, when it differs. */
      readonly responseModel?: string;
      readonly message: AssistantMessage<P>;
      readonly stopReason: StopReason;
      /** The provider's own reason, verbatim, when it says more than `stopReason`. */
      readonly providerStopReason?: string;
      readonly usage?: Usage;
      /** The provider's response fields other than its output. */
      readonly native: NativeResponse<P>;
      /** Duration of the provider call, excluding the gateway's own time. */
      readonly durationMs: number;
      /** Unix time in milliseconds when the response was received. */
      readonly timestamp: number;
    }
  : never;
