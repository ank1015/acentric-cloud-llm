# @acentric-cloud/llm

One `complete()` for many LLM providers (OpenAI, Anthropic, Fireworks,
OpenRouter), with each provider's native features. Bring your own keys: they
travel with each request and are never stored.

```sh
npm install @acentric-cloud/llm
```

## Through the gateway

```ts
import { createClient, outputText } from '@acentric-cloud/llm';

const llm = createClient({
  credentials: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! } },
});

const response = await llm.complete({
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello!' }] }],
});
console.log(outputText(response.message));
```

The client calls the gateway at `https://llm.cloud.acentric.dev` (`DEFAULT_BASE_URL`); pass
`baseUrl` to use another one, such as `http://localhost:8787`.

Credentials saved on the client are used for their provider; any request can
pass its own `credentials` instead. `llm.models()` lists the model catalog.

## Directly, without the gateway

```ts
import { createDirectClient } from '@acentric-cloud/llm/direct';

const llm = createDirectClient({ credentials: { openai: { apiKey: '...' } } });
```

The same client, calling providers from your process with the adapters the
gateway runs. It bundles every adapter.

## Without fetch: `@acentric-cloud/llm/core`

```ts
import { toolCalls, toolResult, type AssistantMessage } from '@acentric-cloud/llm/core';
```

Everything but the clients: the types, `LlmError` and the message helpers
(`outputText`, `toolCalls`, `pendingToolCalls`, `toolResult`, ...). It needs
only ECMAScript, so it loads where `fetch` and the DOM are absent, such as the
pure half of an acentric-cloud agent.

## Tools

Pass `tools` (`{ type: 'function', name, description, parameters }`) on the
request. `pendingToolCalls(response.message)` lists the calls to run, and
`toolResult(call, output)` builds the message that answers one. Add the
assistant message and the results to `messages` and call `complete` again.

## Errors

Every failure is an `LlmError` with a `kind` (`auth`, `rate_limited`,
`invalid_request`, `timeout`, ...) and `retryable`. Calls are never retried.
