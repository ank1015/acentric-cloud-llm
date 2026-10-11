import type { AssistantMessage, CompletionRequest } from '@acentric-llm/contracts';

export interface Sent {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

/** A fetch that records the request and answers with `status` and `body`. */
export function fakeFetch(
  body: unknown,
  { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {},
): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { 'x-request-id': 'req_test', ...headers } });
  }) as typeof fetch;
  return { fetch: fetchFn, sent };
}

export function request(
  overrides: Partial<CompletionRequest<'openai'>> = {},
): CompletionRequest<'openai'> {
  return {
    provider: 'openai',
    credentials: { apiKey: 'sk-test' },
    model: 'gpt-6.1-sol',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    ...overrides,
  } as CompletionRequest<'openai'>;
}

/** A completed response, shaped as the API reference documents it. */
export function responseBody(
  output: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1_760_000_000,
    completed_at: 1_760_000_003,
    status: 'completed',
    error: null,
    incomplete_details: null,
    model: 'gpt-6.1-sol',
    output,
    usage: {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 600, cache_write_tokens: 100 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 150 },
      total_tokens: 1200,
    },
    service_tier: 'default',
    reasoning: { effort: 'medium', summary: null, context: 'all_turns' },
    instructions: 'Be brief.',
    tools: [{ type: 'function', name: 'read', parameters: {}, strict: true }],
    tool_choice: 'auto',
    parallel_tool_calls: true,
    temperature: 1,
    top_p: 1,
    text: { format: { type: 'text' }, verbosity: 'medium' },
    store: false,
    metadata: {},
    prompt_cache_key: null,
    prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    prompt_cache_diagnostics: { type: 'cache_hit' },
    safety_identifier: null,
    access_programs: null,
    moderation: null,
    frequency_penalty: 0,
    presence_penalty: 0,
    billing: { payer: 'openai' },
    tool_usage: { web_search: { num_requests: 0 } },
    ...extra,
  };
}

export const finalMessage = {
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  phase: 'final_answer',
  content: [{ type: 'output_text', text: 'Hi there.', annotations: [] }],
};

export const reasoning = {
  type: 'reasoning',
  id: 'rs_1',
  summary: [{ type: 'summary_text', text: 'Thinking about greetings.' }],
  encrypted_content: 'gAAAA-opaque',
};

export function assistant(content: unknown[]): AssistantMessage<'openai'> {
  return {
    role: 'assistant',
    provider: 'openai',
    api: 'openai-responses',
    model: 'gpt-6.1-sol',
    id: 'resp_0',
    content,
  } as AssistantMessage<'openai'>;
}
