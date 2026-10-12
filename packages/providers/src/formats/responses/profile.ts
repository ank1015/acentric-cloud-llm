import type {
  ApiOf,
  CompletionRequest,
  Credentials,
  LlmErrorKind,
  ModelInfo,
  NativeResponse,
  Provider,
  UsageCost,
} from '@acentric-llm/contracts';
import type { JsonRecord } from '../../shared.ts';

/** Providers served through the Responses format. */
export type ResponsesProvider = {
  [P in Provider]: ApiOf<P> extends 'openai-responses' ? P : never;
}[Provider];

/**
 * What one provider changes about the Responses format. Kept small: the format
 * adapter does the mapping; a profile says where to send it and what is its own.
 */
export interface ResponsesProfile<P extends ResponsesProvider> {
  readonly provider: P;
  /** Used in error messages, e.g. "OpenAI". */
  readonly label: string;
  /** The create-response URL. */
  readonly url: string;
  credentials(value: unknown): Credentials<P>;
  /** Authentication and other headers. */
  headers(credentials: Credentials<P>): Record<string, string>;
  /** The role mid-conversation system messages are sent with. */
  readonly systemRole: 'system' | 'developer';
  /**
   * Inline file bytes as the provider takes them in `input_file.file_data`.
   * Absent when the provider takes no files: file parts are then refused.
   */
  fileData?(mediaType: string, base64: string): string;
  /** Whether images and files may be a `file_id` in the provider's own storage. */
  readonly fileIds: boolean;
  /** Whether custom (freeform) tools work. When not, they and their results are refused. */
  readonly customTools: boolean;
  /** Response fields that only echo the request, left out of `native`. */
  readonly echoFields: readonly string[];
  /** Fields the provider reports on output items but refuses on input; left out on replay. */
  readonly outputOnlyFields: readonly string[];
  /**
   * Which model an assistant message records: the requested one, or the one
   * the response names, where routing (aliases, fallback lists) may pick
   * another model that the replayed reasoning then belongs to.
   */
  readonly messageModel: 'request' | 'response';
  readonly catalog: readonly ModelInfo<P>[];
  /**
   * The cost the provider reports it charged, read from its raw `usage`.
   * When present, it replaces the catalog estimate.
   */
  reportedCost?(usage: JsonRecord): UsageCost | undefined;
  /**
   * The price multiplier for the tier that served the response, or undefined
   * when unknown. Without it (or `reportedCost`) there is no cost.
   */
  priceMultiplier?(native: NativeResponse<P>, request: CompletionRequest<P>): number | undefined;
  /** A provider-specific reading of an error the format does not recognize. */
  classifyError?(error: ErrorInput): ErrorReading | undefined;
}

/** What a profile sees of an error. */
export interface ErrorInput {
  /** The HTTP status; absent for a failed response that arrived with HTTP 200. */
  readonly status?: number;
  readonly code?: string;
  readonly type?: string;
  readonly message?: string;
  /** The error's `metadata`, where the provider adds one. */
  readonly metadata?: JsonRecord;
  /** A canonical error category beside the error object (OpenRouter's `error_type`). */
  readonly errorType?: string;
}

/**
 * What an error means: its kind, the request field at fault when the error
 * does not name it, and a better message when the error's own is generic.
 */
export interface ErrorReading {
  readonly kind: LlmErrorKind;
  readonly param?: string;
  readonly message?: string;
}
