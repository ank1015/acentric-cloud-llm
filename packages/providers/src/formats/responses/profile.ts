import type {
  ApiOf,
  CompletionRequest,
  Credentials,
  LlmErrorKind,
  ModelInfo,
  NativeResponse,
  Provider,
} from '@acentric-llm/contracts';

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
  readonly catalog: readonly ModelInfo<P>[];
  /** The price multiplier for the tier that served the response, or undefined when unknown. */
  priceMultiplier(native: NativeResponse<P>, request: CompletionRequest<P>): number | undefined;
  /** A provider-specific reading of an error the format does not recognize. */
  classifyError?(error: {
    status?: number;
    code?: string;
    type?: string;
    message?: string;
  }): ErrorReading | undefined;
}

/** What an error means: its kind, and the request field at fault when the error does not name it. */
export interface ErrorReading {
  readonly kind: LlmErrorKind;
  readonly param?: string;
}
