import { LlmError } from '@acentric-llm/contracts';

/** Default and maximum time for one provider call, including reading the body. */
export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** Text error bodies (e.g. a proxy's HTML page) are cut to this before reaching callers. */
const MAX_TEXT_ERROR_CHARS = 4096;

export interface CallOptions {
  /** Aborts the provider call. */
  readonly signal?: AbortSignal | undefined;
  /** A `fetch` to use instead of the global one, e.g. in tests. */
  readonly fetch?: typeof fetch | undefined;
}

export interface PostRequest {
  readonly provider: string;
  readonly label: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
  readonly fetch?: typeof fetch | undefined;
  /** Turns a non-2xx answer into an error. */
  readonly httpError: (answer: HttpAnswer) => LlmError;
}

/** A provider's non-2xx answer. */
export interface HttpAnswer {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  /** The parsed JSON body, or the text body cut to a few KiB. */
  readonly body: unknown;
}

export interface JsonAnswer {
  readonly body: unknown;
  readonly durationMs: number;
  /** Unix time in milliseconds when the answer was read. */
  readonly timestamp: number;
  readonly requestId?: string;
}

/** One HTTP attempt with a JSON body. Never retries. */
export async function postJson(request: PostRequest): Promise<JsonAnswer> {
  const { provider, label, signal } = request;
  const controller = new AbortController();
  const onAbort = () => controller.abort(cancelled(provider, label));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(
    () =>
      controller.abort(new LlmError(`${label} request timed out.`, { provider, kind: 'timeout' })),
    request.timeoutMs,
  );
  const started = performance.now();
  let requestId: string | undefined;

  try {
    controller.signal.throwIfAborted();
    // Called unbound: some runtimes throw "Illegal invocation" for fetch with a foreign `this`.
    const fetchFn = request.fetch ?? globalThis.fetch;
    const response = await fetchFn(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      redirect: 'manual',
    });
    requestId = response.headers.get('x-request-id')?.trim() || undefined;
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new LlmError(`${label} redirects are not followed.`, {
        provider,
        kind: 'network_error',
      });
    }
    const text = await readBody(response, provider, label);
    controller.signal.throwIfAborted();
    if (!response.ok) {
      throw request.httpError({
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: parseErrorBody(text),
      });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new LlmError(`${label} returned invalid JSON.`, {
        provider,
        kind: 'invalid_response',
        httpStatus: response.status,
        nativeError: text.slice(0, MAX_TEXT_ERROR_CHARS),
      });
    }
    return {
      body,
      durationMs: Math.round(performance.now() - started),
      timestamp: Date.now(),
      ...(requestId !== undefined ? { requestId } : {}),
    };
  } catch (error) {
    if (controller.signal.aborted) throw withRequestId(controller.signal.reason, requestId);
    if (error instanceof LlmError) throw withRequestId(error, requestId);
    throw new LlmError(`${label} could not be reached.`, {
      provider,
      kind: 'network_error',
      requestId,
      nativeError: error,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** JSON request headers; credentials with characters invalid in a header are refused. */
export function jsonHeaders(provider: string, entries: Record<string, string>): Headers {
  try {
    return new Headers({
      accept: 'application/json',
      'content-type': 'application/json',
      ...entries,
    });
  } catch {
    throw new LlmError('credentials contain characters that are not valid in HTTP headers.', {
      provider,
      kind: 'invalid_request',
    });
  }
}

/** `Retry-After` in milliseconds, from seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : undefined;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function cancelled(provider: string, label: string): LlmError {
  return new LlmError(`${label} request was cancelled.`, { provider, kind: 'cancelled' });
}

function parseErrorBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, MAX_TEXT_ERROR_CHARS);
  }
}

/** Errors raised after the provider answered carry its request ID, for its support. */
export function withRequestId(error: unknown, requestId: string | undefined): unknown {
  if (!(error instanceof LlmError) || requestId === undefined || error.requestId !== undefined) {
    return error;
  }
  const { message, ...data } = error.toJSON();
  return new LlmError(message, { ...data, requestId, nativeError: error.nativeError });
}

async function readBody(response: Response, provider: string, label: string): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new LlmError(`${label} response exceeded ${MAX_RESPONSE_BYTES} bytes.`, {
          provider,
          kind: 'invalid_response',
          httpStatus: response.status,
        });
      }
      text += decode(value, true);
    }
    return text + decode();
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  function decode(value?: Uint8Array, stream = false): string {
    try {
      return decoder.decode(value, { stream });
    } catch {
      throw new LlmError(`${label} returned invalid UTF-8.`, {
        provider,
        kind: 'invalid_response',
        httpStatus: response.status,
      });
    }
  }
}
