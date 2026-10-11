import type {
  CompletionRequest,
  CompletionResponse,
  Credentials,
  Provider,
} from '@acentric-llm/contracts';
import type { CallOptions } from './transport.ts';

/** One provider: how to read its credentials and how to complete a request. */
export interface ProviderDefinition<P extends Provider> {
  readonly provider: P;
  readonly label: string;
  /** Checks and normalizes caller credentials. Errors never echo values. */
  credentials(value: unknown): Credentials<P>;
  /** One provider call. Never retries. */
  complete(request: CompletionRequest<P>, options?: CallOptions): Promise<CompletionResponse<P>>;
}
