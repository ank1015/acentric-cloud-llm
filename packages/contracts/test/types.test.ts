// Compile-time checks, run by `pnpm check`. Two fake providers are registered
// here, beside the real ones.
import { test } from 'node:test';
import type {
  AssistantMessage,
  CompletionRequest,
  CompletionResponse,
  Message,
  ModelInfo,
  Provider,
  RequestMessage,
} from '../src/index.ts';

interface AcmeItem {
  readonly type: 'message' | 'reasoning';
  readonly encrypted?: string;
}

declare module '../src/providers.ts' {
  interface Providers {
    acme: {
      api: 'openai-responses';
      credentials: { apiKey: string; project?: string };
      options: { store?: boolean; previous_response_id?: string };
      inputItem: { type: 'compaction'; encrypted: string };
      outputItem: AcmeItem;
      response: { service_tier?: string };
      modelId: 'acme-1' | 'acme-2';
    };
    zeta: {
      api: 'anthropic-messages';
      credentials: { apiKey: string };
      options: { max_tokens: number };
      inputItem: { type: 'zeta_block' };
      outputItem: { type: 'text'; text: string };
      response: { container?: { id: string } };
      modelId: 'zeta-large';
    };
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expect<T extends true>(): T | void {}

expect<Equal<Provider, 'openai' | 'fireworks' | 'acme' | 'zeta'>>();

const acmeReply: AssistantMessage<'acme'> = {
  role: 'assistant',
  provider: 'acme',
  api: 'openai-responses',
  model: 'acme-1',
  id: 'resp_1',
  content: [{ type: 'reasoning', encrypted: 'opaque' }],
};

const zetaReply: AssistantMessage<'zeta'> = {
  role: 'assistant',
  provider: 'zeta',
  api: 'anthropic-messages',
  model: 'zeta-large',
  content: [{ type: 'text', text: 'hi' }],
};

// A request replays its own provider's messages, with its own options and credentials.
const request: CompletionRequest<'acme'> = {
  provider: 'acme',
  credentials: { apiKey: 'sk' },
  model: 'acme-2',
  instructions: [{ type: 'text', text: 'Be brief.', providerOptions: { cache: true } }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    acmeReply,
    {
      role: 'native',
      provider: 'acme',
      api: 'openai-responses',
      content: [{ type: 'compaction', encrypted: 'x' }],
    },
    { role: 'tool_result', toolCallId: 'c1', toolName: 'read', toolType: 'custom', content: [] },
    { role: 'system', content: [{ type: 'text', text: 'Now be verbose.' }] },
  ],
  providerOptions: { store: false, previous_response_id: 'resp_1' },
};

// Any model ID is accepted, not only the catalog's.
const newModel: CompletionRequest<'acme'> = { ...request, model: 'acme-3-preview' };

// @ts-expect-error another provider's assistant message is refused
const mismatched: CompletionRequest = {
  provider: 'acme',
  credentials: { apiKey: 'sk' },
  model: 'acme-1',
  messages: [zetaReply],
};

const wrongOptions: CompletionRequest<'zeta'> = {
  provider: 'zeta',
  credentials: { apiKey: 'sk' },
  model: 'zeta-large',
  messages: [],
  // @ts-expect-error options are the provider's own
  providerOptions: { store: false },
};

const missingKey: CompletionRequest<'acme'> = {
  provider: 'acme',
  // @ts-expect-error credentials are the provider's own
  credentials: { token: 'sk' },
  model: 'acme-1',
  messages: [],
};

const wrongNative: RequestMessage<'acme'> = {
  role: 'native',
  provider: 'acme',
  api: 'openai-responses',
  // @ts-expect-error native items are the provider's own
  content: [{ type: 'zeta_block' }],
};

// @ts-expect-error the application's own messages are never sent
const customInRequest: RequestMessage<'acme'> = { role: 'custom', tag: 'ui', data: null };
const customInHistory: Message = { role: 'custom', tag: 'ui', data: { note: 'kept locally' } };

// The response, narrowed on its provider, carries that provider's native types.
function narrowsOnProvider(response: CompletionResponse) {
  if (response.provider === 'zeta') {
    expect<Equal<typeof response.message, AssistantMessage<'zeta'>>>();
    const container: { id: string } | undefined = response.native.container;
    void container;
  }
}

// The catalog lists only known IDs.
const info: ModelInfo<'zeta'> = { provider: 'zeta', id: 'zeta-large', name: 'Zeta Large' };
// @ts-expect-error catalog entries use known IDs
const unknownInfo: ModelInfo<'zeta'> = { provider: 'zeta', id: 'zeta-small', name: 'Zeta Small' };

void [
  newModel,
  mismatched,
  wrongOptions,
  missingKey,
  wrongNative,
  customInRequest,
  customInHistory,
  info,
  unknownInfo,
];

test('types compile', () => {});
