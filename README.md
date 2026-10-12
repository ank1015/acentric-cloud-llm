# acentric-llm-providers

Open-source libraries and Cloudflare Workers for calling LLM providers from
[acentric-cloud](https://cloud.acentric.dev) agents.

Start with [docs/design.md](docs/design.md): what we are building and why.

## Layout

```
docs/                 design, provider notes, research
packages/contracts    shared types and LlmError
packages/providers    adapters per API format, provider profiles, extractors, catalog
packages/sdk          the client: gateway mode, and direct mode in-process
workers/gateway       the Cloudflare Worker: one /v1/complete for every provider
```

Providers: OpenAI ([notes](docs/providers/openai.md)), Fireworks
([notes](docs/providers/fireworks.md)), Anthropic
([notes](docs/providers/anthropic.md)), OpenRouter
([notes](docs/providers/openrouter.md)).
Moving a conversation between them: [docs/conversion.md](docs/conversion.md).

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm build
pnpm check
pnpm test
pnpm format
```

Run the gateway locally with `pnpm --filter @acentric-llm/gateway dev`. Live
checks against each provider, direct or through a running gateway:

```sh
cd packages/sdk
OPENAI_API_KEY=... node --conditions=source scripts/live-openai.ts
FIREWORKS_API_KEY=... node --conditions=source scripts/live-fireworks.ts
FIREWORKS_API_KEY=... GATEWAY_URL=http://localhost:8787 node --conditions=source scripts/live-fireworks.ts
ANTHROPIC_API_KEY=... node --conditions=source scripts/live-anthropic.ts
ANTHROPIC_API_KEY=... GATEWAY_URL=http://localhost:8787 node --conditions=source scripts/live-anthropic.ts
OPENROUTER_API_KEY=... node --conditions=source scripts/live-openrouter.ts
OPENROUTER_API_KEY=... GATEWAY_URL=http://localhost:8787 node --conditions=source scripts/live-openrouter.ts
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... FIREWORKS_API_KEY=... OPENROUTER_API_KEY=... node --conditions=source scripts/live-convert.ts
```
