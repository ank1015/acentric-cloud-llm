# OpenRouter

Provider ID `openrouter`, API format `openai-responses` (OpenRouter's
Responses API, `POST https://openrouter.ai/api/v1/responses`). Verified
against the OpenRouter docs, its OpenAPI spec and with live calls on
2026-10-12, on `meta/muse-spark-1.3-contributor`. The research, with sources
and every recorded exchange, is in [`../research/openrouter/`](../research/openrouter/).

OpenRouter is a gateway in front of hundreds of models from many upstream
providers. We use it for models that have no provider of their own here, not
for OpenAI, Anthropic or Gemini models. It is a profile on the base Responses
adapter, like [OpenAI](openai.md) and [Fireworks](fireworks.md); this page
records what differs. Its output is OpenRouter's translation of the
upstream's, so what holds for one model may not hold for another: check a
new model live before relying on it.

## Credentials

`{ apiKey, appUrl?, appTitle? }`. The key is sent as `Authorization: Bearer`;
`appUrl` and `appTitle` as `HTTP-Referer` and `X-OpenRouter-Title`, for
OpenRouter's app attribution.

## Models

The catalog is curated, not OpenRouter's whole list: the models we use, with
their limits and list prices for reference. Any other model ID, alias
(`~author/model-latest`), variant (`:nitro`, `:floor`, `:free`) or router
(`openrouter/auto`) is accepted (D11). The canonical slug
(`meta/muse-spark-1.3-contributor-20260902`) also works; the response then
names the ordinary ID.

## Request

As for OpenAI, except:

| Ours                    | OpenRouter                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `system` message        | `{type:"message", role:"system", content}` (`developer` also works)                          |
| `providerOptions.tools` | appended after our tools: OpenRouter's server tools (`openrouter:web_search`, ...)           |
| file part               | `input_file` with `file_url`, or `file_data` as a `data:` URL                                |
| image, file ID          | refused: OpenRouter's Files API is not verified yet                                          |
| custom tool and result  | refused: not verified yet                                                                    |
| assistant items         | replayed exactly as returned; nothing is stripped (`created_by` is never sent, and accepted) |

Routing, fallbacks and plugins are OpenRouter's own request fields, so they
are `providerOptions`: `provider` (`order`, `only`, `ignore`,
`allow_fallbacks`, `require_parameters`, `zdr`, `data_collection`, `sort`,
`max_price`, ...), `models` (fallback models), `plugins`, `session_id`,
`trace`, `user`.

### Refused

Everything refused for OpenAI (`stream: true`, `background: true`, owned
fields in `providerOptions`), plus the rows above. OpenRouter turns
`background: true` into a normal call without saying so; we refuse it first.
`store: true` and any `previous_response_id` are not allowed by the types and
are a 400 from OpenRouter, which arrives as `invalid_request` with
`providerParam` naming the field: OpenRouter keeps nothing, so every request
sends the full history.

### Worth knowing

- **OpenRouter may ignore what it is sent.** A parameter the serving endpoint
  does not support can be dropped without an error, by design.
  `provider.require_parameters: true` only narrows the endpoints to those
  listing every sent parameter; live, it still accepted `presence_penalty`,
  which Muse Spark does not list. Unknown fields inside items and parts are
  accepted silently; an unknown top-level field reached the upstream and was
  refused. We pass everything through and add no routing flags of our own;
  callers who want strict routing set `provider` themselves.
- **The model's own limits apply, whatever the catalog says.** Muse Spark
  advertises `tool_choice` `required`, `none` and named functions, but refuses
  all except `auto`; its `max_output_tokens` must be at least 16.
- **Reasoning is encrypted and bound to the model.** Reasoning items carry
  `encrypted_content` and a `format` (`meta-responses-v1`) without
  `include`. Replayed verbatim, they are used (input grows by the reasoning
  tokens). Corrupted or foreign ciphertext is **accepted without an error and
  ignored**, as are plain reasoning items without ciphertext: nothing warns
  when reasoning is lost. So switch models with `convert`, which drops it.
- **The assistant message records the model that answered**, not the one
  requested, since `models` fallbacks, aliases and routers can pick another
  model and the reasoning belongs to that one. The envelope keeps the
  requested `model` and the answering `responseModel` when they differ.
- **Mid-conversation system messages work** (both roles), and the model
  follows them.
- **Images** by URL or base64, **PDFs** by `data:` URL or public URL. A URL
  OpenRouter cannot fetch is a 400 `invalid_request`.
- **Long calls stay open.** Without streaming, OpenRouter sends whitespace
  every ~0.4 s until the JSON is ready; a 40-second reasoning call worked.
- **An output limit can leave no output.** With a small `max_output_tokens`
  the response is `incomplete` with an empty `output`: the budget went to
  reasoning. That is a `length` stop, and it is still charged.

## Response

| OpenRouter                          | Ours                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| `id` (`gen-...`)                    | `id`; also the `X-Generation-Id` header              |
| `model`                             | `message.model`, and `responseModel` when it differs |
| `output`                            | `message.content`, verbatim                          |
| `status`, `incomplete_details`      | `stopReason` as for OpenAI                           |
| `usage.cost`                        | `usage.cost.total`, `source: "reported"`             |
| `usage.is_byok`, `cost_details`     | `native.usage`                                       |
| `completed_at`, `service_tier`, ... | `native`                                             |

OpenRouter echoes most request fields; those are left out of `native`. With
the `X-OpenRouter-Metadata: enabled` header (not sent by us) a response also
names the endpoint that served it.

### Usage and cost

Token counts are the upstream's own. `input_tokens` includes cache reads
(`cached_tokens`); `output_tokens` includes reasoning. Cache writes appear as
`cache_write_tokens` for upstreams that charge them.

**Cost is what OpenRouter reports it charged**, not an estimate: the price
depends on the endpoint that served the request, and for models served by
several endpoints those prices differ, often by 2x or more. `usage.cost`
holds `{ source: "reported", total }` with no buckets, since OpenRouter does
not split the charge the way our buckets do. With the caller's own upstream
key (BYOK), OpenRouter's `cost` is only its fee and the upstream bills the
rest (`cost_details.upstream_inference_cost`); `total` is both, and is left
out when the upstream part is not reported. BYOK is not verified live.

## Errors

OpenRouter's errors carry a numeric `code` mirroring the status, a canonical
`error_type` where it has one (beside a failed response, or in `metadata`),
and `metadata` with the upstream's own error as a JSON string (`raw`),
routing filters, budgets and moderation results. The profile reads them in
that order of specificity.

| Signal                                                                          | Kind               | `providerParam`        |
| ------------------------------------------------------------------------------- | ------------------ | ---------------------- |
| 401                                                                             | `auth`             |                        |
| 400 "... is not a valid model ID"                                               | `not_found`        | `model`                |
| 400 `invalid_prompt`, `store` / `previous_response_id`                          | `invalid_request`  | the field              |
| 400 "Provider returned error" with an upstream `raw` error                      | `invalid_request`  | the upstream's `param` |
| 404 with `failed_routing_step` (no endpoint after `provider` filters)           | `not_found`        | `provider`             |
| `metadata.limit_source`: in-flight budget                                       | `rate_limited`     |                        |
| `metadata.limit_source`: credits, key, guardrail or workspace budget (402, 403) | `quota_exceeded`   |                        |
| `metadata.reasons` / `flagged_input` (moderation)                               | `policy_violation` |                        |
| `error_type`: canonical categories (`context_length_exceeded`, `timeout`, ...)  | as named           |                        |
| 402                                                                             | `quota_exceeded`   |                        |
| 429                                                                             | `rate_limited`     |                        |
| 502                                                                             | `provider_error`   |                        |
| 503, 529                                                                        | `overloaded`       |                        |
| 504, 524                                                                        | `timeout`          |                        |

When the upstream refused the request, its message replaces OpenRouter's
generic "Provider returned error" ("Meta returned an error: only `auto` is
supported for `tool_choice` ..."). A failure after OpenRouter has started
answering arrives with HTTP 200, as a failed response or a bare error body;
both are errors, with any usage attached. There is no request ID header; the
generation ID (`X-Generation-Id`) is used instead. `Retry-After` is read where
sent. Live, the 401, 400, 404 rows were seen; the budget, moderation and
canonical rows are from the docs.

## Conversion

OpenRouter takes the Responses format, so moving between it and OpenAI or
Fireworks is the fast path. Its reasoning is dropped on any model change, or
kept as assistant text with `reasoning: 'text'` (it ignores plain reasoning
items). Options it does not take on parts (`cache_control`, `caller`,
`namespace`, ...) are stripped; `detail` and `prompt_cache_breakpoint` are
kept. See [conversion.md](../conversion.md).
