# OpenRouter research: summary

Research for an OpenRouter provider, done 2026-10-12 from the docs, the
OpenAPI spec, the official TypeScript SDK (1.4.25), the public model listings
and four other libraries. The first four notes are from documentation;
[live-responses.md](live-responses.md) checks them live. The adapter as built
is described in [`../../providers/openrouter.md`](../../providers/openrouter.md).

| File                                           | What it holds                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [api-formats.md](api-formats.md)               | The three conversation formats, their fields and items, what replay needs, strictness     |
| [routing-and-errors.md](routing-and-errors.md) | Provider routing, variants, plugins, headers, BYOK, caching, every error shape and status |
| [usage-cost-catalog.md](usage-cost-catalog.md) | Usage fields, reported cost, the `/models` catalog and how prices differ per endpoint     |
| [ecosystem.md](ecosystem.md)                   | How the official SDK, the AI SDK provider, pi-ai and LiteLLM adapt OpenRouter; pitfalls   |
| [live-responses.md](live-responses.md)         | Live: 58 calls on Muse Spark 1.3 Contributor, Responses and Chat; what the adapter does   |

## What OpenRouter is, for us

A gateway in front of about 460 text models from many upstream providers. It
speaks three conversation formats, each a translation layer over every model:

| Endpoint                        | Format             | Notes                                                                                                                   |
| ------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/responses`        | OpenAI Responses   | GA since 2026-07-25. Stateless: `store: true` and `previous_response_id` are 400s. Per-block cache TTL not available.   |
| `POST /api/v1/chat/completions` | Chat Completions   | The main documented path and what every other library uses. `reasoning_details` carries signed and encrypted reasoning. |
| `POST /api/v1/messages`         | Anthropic Messages | Works for non-Claude models too (thinking and effort translated).                                                       |

Its "native" output is OpenRouter's output in that format, not the upstream
provider's: replaying it verbatim is still right, but it is a translation.

## What fits our design as is

- **Formats we already have.** Responses and Messages are formats we adapt.
  OpenRouter can be a profile on the Responses adapter, like Fireworks (D10).
- **Native options pass through.** Routing (`provider`, `models`), plugins,
  server tools (`openrouter:web_search` and others), `session_id`, `trace`,
  `reasoning`, caching: all request fields, so all `providerOptions` (D7).
  Router output items (`openrouter:*`) are native items, replayed verbatim.
- **Replay is "send back exactly what came".** Reasoning carries `signature`,
  `format` (`anthropic-claude-v1`, `google-gemini-v1`, `openai-responses-v1`)
  and ciphertext; router state for deferred tools also rides in reasoning.
  D1/D2 already say keep it verbatim.
- **Usage is always reported**, native token counts, with cache reads and
  writes (no split by time to live).
- **Long non-streaming calls are kept open** with whitespace; JSON parsing
  tolerates it.

## What does not fit, and the proposed answer

1. **Cost is reported, not estimated.** `usage.cost` is the real charge in
   USD at the endpoint that served (tier, long context and cache included).
   A catalog estimate cannot match: for 164 models with several endpoints,
   21% differ by 2× or more. Proposal: use the reported cost as `cost.total`,
   never estimate for OpenRouter, and mark where a cost came from (a
   `source: 'reported' | 'estimated'` on `UsageCost`). BYOK: `cost` is only
   OpenRouter's fee; the upstream spend is `cost_details.upstream_inference_cost`.
2. **The catalog is too big and changes too often** to be our source of
   prices. Proposal: a generated snapshot of ids and metadata (limits,
   modalities, tools/reasoning flags, expiry) for autocomplete only, and any
   id accepted (D11 already). A regenerate script, not hand edits.
3. **OpenRouter silently drops and rewrites by default**: unsupported
   parameters are ignored, prompts on small-context endpoints are compressed,
   Anthropic `strict` is stripped without a beta header, account plugins can
   change requests. `provider.require_parameters: true` narrows endpoints
   but is no strictness guarantee. Proposal: pass through and document, never
   inject flags (principle 2); an optional SDK helper returns strict routing
   options (`require_parameters`, no fallbacks, no compression) for callers
   who want them.
4. **The model that answered may not be the one asked for**: aliases
   (`~anthropic/claude-sonnet-latest`), `openrouter/auto`, `models` fallback
   lists. Proposal: the assistant message records the model the response
   reports, so D2 and `convert` compare what actually produced the
   reasoning; the envelope keeps both.
5. **Encrypted reasoning can be bound to the upstream, not just the model.**
   Gemini and OpenAI reasoning fails with a 400 when routing moves the next
   turn of a tool loop to another upstream (AI SDK provider issue #491).
   Proposal: record the serving upstream in `native`; pinning
   (`provider.order` + `allow_fallbacks: false`, or `session_id`) is the
   caller's choice, documented. Live probe first.
6. **Errors come in more places.** HTTP 200 bodies can hold `error` (and
   `choices[].error` in Chat); a canonical `error_type` is better than the
   status; 402 can be a transient in-flight budget, 403 can be a budget.
   Proposal: an OpenRouter `classifyError` that reads `error_type` and
   metadata first, and the Responses reader checks the body before success.
   Mapping table in [routing-and-errors.md](routing-and-errors.md).
7. **Adapter changes the Responses profile needs**: the resolved model (4);
   keep raw usage extras (`cost`, `cost_details`, `is_byok`) in `native`;
   do not strip `created_by` unless OpenRouter refuses it; read `error_type`;
   refuse `store: true` and `previous_response_id` up front or let the 400
   map with `providerParam`.

## Conversion

OpenRouter joins `convert` as one more target. Its reasoning is bound to the
model (and possibly the upstream), so a model change drops it, or keeps it as
text by policy. OpenRouter ↔ OpenAI or Fireworks is the same format (fast
path). OpenRouter output is never treated as direct Anthropic or OpenAI
output, even when it carries their signatures.

## Not in scope now

Streaming-only audio output, embeddings, images, video, batches, Files API
uploads, the Messages endpoint as a second OpenRouter provider ID, presets
and Fusion. All can come later as their own decisions.
