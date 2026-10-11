import type { LlmErrorData } from './errors.ts';
import type { ModelInfo } from './models.ts';

/** Gateway routes, relative to its base URL. */
export const ROUTES = {
  /** POST a `CompletionRequest`; answers a `CompletionResponse`. */
  complete: '/v1/complete',
  /** GET; answers a `ModelsResponse`. */
  models: '/v1/models',
} as const;

export interface ModelsResponse {
  readonly models: readonly ModelInfo[];
}

/** Body of every unsuccessful gateway response. */
export interface ErrorResponse {
  readonly error: LlmErrorData;
}
