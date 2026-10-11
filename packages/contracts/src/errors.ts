import type { Usage } from './usage.ts';

/** Whether each kind is worth retrying when the error does not say otherwise. */
const RETRYABLE_BY_DEFAULT = {
  /** The gateway or the provider refused the request. */
  invalid_request: false,
  /** Credentials missing, invalid or not permitted. */
  auth: false,
  /** Throttled; see `retryAfterMs`. */
  rate_limited: true,
  /** Out of credits or over a billing limit. */
  quota_exceeded: false,
  /** The prompt is too long for the model. */
  context_overflow: false,
  /** A provider safety policy refused the request; resending it as is will not help. */
  policy_violation: false,
  /** Unknown model, or an expired or invalid previous response; see `providerParam`. */
  not_found: false,
  /** Provider capacity. */
  overloaded: true,
  /** Any other provider failure. */
  provider_error: true,
  /** The provider answered with something that cannot be read. */
  invalid_response: false,
  /** The provider or the gateway could not be reached. */
  network_error: true,
  /** The call took longer than allowed. */
  timeout: true,
  /** The caller aborted. */
  cancelled: false,
  /** A gateway bug. */
  internal_error: false,
} as const satisfies Record<string, boolean>;

export type LlmErrorKind = keyof typeof RETRYABLE_BY_DEFAULT;

export const LLM_ERROR_KINDS = Object.keys(RETRYABLE_BY_DEFAULT) as readonly LlmErrorKind[];

/** The JSON form of an `LlmError`, shared by the gateway and the SDK. */
export interface LlmErrorData {
  readonly message: string;
  readonly kind: LlmErrorKind;
  /** Whether retrying the same request may succeed. */
  readonly retryable: boolean;
  /** Absent for errors raised before a provider was chosen. */
  readonly provider?: string;
  readonly providerCode?: string;
  readonly providerType?: string;
  /** The request field the provider blamed, e.g. `previous_response_id`. */
  readonly providerParam?: string;
  /** The provider's error object as received, or its text body, truncated. */
  readonly providerError?: unknown;
  /** The provider's HTTP status, not the gateway's. */
  readonly httpStatus?: number;
  /** The provider's requested delay before retrying. */
  readonly retryAfterMs?: number;
  /** The provider's request ID, for its support. */
  readonly requestId?: string;
  /** The provider's response ID, when a response was created before failing. */
  readonly responseId?: string;
  /** Tokens the provider reported, and may bill, for a failed generation. */
  readonly usage?: Usage;
}

type OptionalField = Exclude<keyof LlmErrorData, 'message' | 'kind' | 'retryable'>;

/** Constructor options. An `undefined` value counts as absent. */
export type LlmErrorOptions = {
  readonly [K in OptionalField]?: LlmErrorData[K] | undefined;
} & {
  readonly kind: LlmErrorKind;
  /** Defaults by kind. */
  readonly retryable?: boolean | undefined;
  /** Raw detail for local diagnostics. Never serialized. */
  readonly nativeError?: unknown;
};

const OPTIONAL_FIELDS = [
  'provider',
  'providerCode',
  'providerType',
  'providerParam',
  'providerError',
  'httpStatus',
  'retryAfterMs',
  'requestId',
  'responseId',
  'usage',
] as const satisfies readonly OptionalField[];

/** Every failure, from the gateway, the SDK or a provider. Retry policy is the caller's. */
export class LlmError extends Error {
  override readonly name = 'LlmError';
  readonly kind: LlmErrorKind;
  readonly retryable: boolean;
  // `declare` keeps absent fields absent at runtime instead of own `undefined` properties.
  declare readonly provider?: string;
  declare readonly providerCode?: string;
  declare readonly providerType?: string;
  declare readonly providerParam?: string;
  declare readonly providerError?: unknown;
  declare readonly httpStatus?: number;
  declare readonly retryAfterMs?: number;
  declare readonly requestId?: string;
  declare readonly responseId?: string;
  declare readonly usage?: Usage;
  declare readonly nativeError?: unknown;

  constructor(message: string, options: LlmErrorOptions) {
    super(message);
    this.kind = options.kind;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT[options.kind] ?? false;
    for (const key of [...OPTIONAL_FIELDS, 'nativeError'] as const) {
      if (options[key] !== undefined) {
        Object.defineProperty(this, key, { value: options[key], enumerable: true });
      }
    }
  }

  /** The JSON form, without `nativeError` or the stack. */
  toJSON(): LlmErrorData {
    const data: Record<string, unknown> = {
      message: this.message,
      kind: this.kind,
      retryable: this.retryable,
    };
    for (const key of OPTIONAL_FIELDS) if (this[key] !== undefined) data[key] = this[key];
    return data as unknown as LlmErrorData;
  }

  static fromJSON({ message, ...options }: LlmErrorData): LlmError {
    return new LlmError(message, options);
  }

  /** True for an `LlmError` from any copy of this package. */
  static is(value: unknown): value is LlmError {
    return (
      value instanceof LlmError ||
      (value instanceof Error &&
        value.name === 'LlmError' &&
        typeof (value as { kind?: unknown }).kind === 'string')
    );
  }
}
