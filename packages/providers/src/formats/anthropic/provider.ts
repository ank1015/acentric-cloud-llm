import type { ProviderDefinition } from '../../definition.ts';
import { invalidRequest } from '../../shared.ts';
import {
  cancelled,
  DEFAULT_TIMEOUT_MS,
  jsonHeaders,
  MAX_TIMEOUT_MS,
  postJson,
  withRequestId,
} from '../../transport.ts';
import { httpError } from './errors.ts';
import type { MessagesProfile, MessagesProvider } from './profile.ts';
import { buildRequest } from './request.ts';
import { parseResponse } from './response.ts';

/** The only Messages API version. */
export const ANTHROPIC_VERSION = '2023-06-01';

/** A provider definition for a Messages profile. */
export function createMessagesProvider<P extends MessagesProvider>(
  profile: MessagesProfile<P>,
): ProviderDefinition<P> {
  return {
    provider: profile.provider,
    label: profile.label,
    credentials: (value) => profile.credentials(value),

    async complete(request, options = {}) {
      const { provider, label } = profile;
      if (options.signal?.aborted) throw cancelled(provider, label);
      const credentials = profile.credentials(request.credentials);
      const { body: json, betas } = buildRequest(request, profile);
      let body: string;
      try {
        body = JSON.stringify(json);
      } catch {
        throw invalidRequest(provider, `The ${label} request could not be serialized to JSON.`);
      }
      const answer = await postJson({
        provider,
        label,
        url: profile.url,
        headers: jsonHeaders(provider, {
          ...profile.headers(credentials),
          'anthropic-version': ANTHROPIC_VERSION,
          ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}),
        }),
        body,
        timeoutMs: Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
        signal: options.signal,
        fetch: options.fetch,
        httpError: (http) => httpError(profile, http),
      });
      try {
        return parseResponse(request, answer, profile);
      } catch (error) {
        throw withRequestId(error, answer.requestId);
      }
    },
  };
}
