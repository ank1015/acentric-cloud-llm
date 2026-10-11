# Fireworks

Provider ID `fireworks`, API format `openai-responses` (Fireworks' Responses
API, `POST https://api.fireworks.ai/inference/v1/responses`). Verified against
the Fireworks docs and with live calls on 2026-10-11. The research, with
sources and every recorded exchange, is in
[`../research/fireworks/`](../research/fireworks/).

Fireworks is a profile on the base Responses adapter, like
[OpenAI](openai.md). This page records what differs. Where the Fireworks docs
and the live API disagree, the live API wins, and the docs contradict each
other in places (the OpenAPI spec is older than the guide).

## Credentials

`{ apiKey }`, sent as `Authorization: Bearer`.

## Request

As for OpenAI, except:

| Ours                    | Fireworks                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `system` message        | `{type:"message", role:"system", content}` (`developer` also works)                               |
| `providerOptions.tools` | appended after our tools: remote `mcp` and `sse` servers, `web_search` (needs account enablement) |
| image, file ID          | refused: Fireworks has no file storage                                                            |
| file part, any source   | refused: Fireworks drops `input_file` without an error                                            |
| custom tool             | refused: Fireworks accepts custom tools, but its models never call them                           |
| `tool_result`, custom   | refused, for the same reason                                                                      |

Images go as `input_image` with a URL or a `data:` URL; `detail` passes through
the part's `providerOptions`. Tool results are `function_call_output` with a
string or a list of parts. `item_reference` works for stored items.

### Refused

Everything refused for OpenAI (`stream: true`, `background: true`, owned
fields in `providerOptions`, `providerOptions` on instruction blocks), plus
the rows above.

### Not sent

`isError` on a tool result, as for OpenAI.

### Worth knowing

- **Unknown fields are ignored without an error.** A misspelled option, or
  one Fireworks does not support on this endpoint, returns 200 and does
  nothing; even `reasoning_effort: "banana"` at the top level is accepted.
  `FireworksOptions` lists only what the docs or live calls confirm: that type
  is the only check. Some invalid values are accepted and echoed too
  (`tool_choice`, `truncation`).
- **`store` defaults to `true`**: Fireworks keeps the response for 30 days. We
  pass it through untouched. Zero-data-retention accounts must send
  `store: false`.
- **`previous_response_id`** works, including chaining a tool loop with only
  the tool results. Instructions and tools are not inherited: send them on
  every request. An unknown, deleted or unstored ID is a bare
  `404 {"detail":"Previous response not found"}`, which arrives as
  `not_found` with `providerParam: "previous_response_id"`, the same as for
  OpenAI. A `store: false` response still has an ID; it cannot be chained on.
- **Stateless replay** (`store: false`) works with every output item sent
  back verbatim, IDs included. Replay without the IDs or without the reasoning
  items also works.
- **Reasoning is plain text.** Reasoning items carry the model's reasoning in
  `summary[].text`, never `encrypted_content`, even when
  `include: ["reasoning.encrypted_content"]` asks for it. The summary is not
  configurable. Replayed histories carry that text, so they grow faster than
  with encrypted reasoning; chaining with `previous_response_id` avoids
  resending it.
- **Reasoning effort is per model.** `reasoning: { effort }` (the nested field;
  top-level `reasoning_effort` is ignored). gpt-oss takes `low`, `medium` and
  `high`, and refuses `none`. GLM 5.3 always reasons and refuses `none`.
  DeepSeek V4.1 and Kimi K3 map `medium` and `xhigh` to their nearest tier and
  turn reasoning off with `none`. Inkling accepts `none` and reasons anyway.
- **Structured output** (`text.format` with a JSON schema) is enforced. It
  turns reasoning off on some models, and is reportedly refused together with
  tools.
- **Prompt caching** is automatic and per replica. `prompt_cache_key` routes a
  session to the same replica. The `x-session-affinity` and
  `x-prompt-cache-isolation-key` headers are not supported: we have no way to
  send provider headers yet.
- **Incomplete responses** can hold items marked `completed`, no output at
  all, or raw control tokens (gpt-oss at a tiny output limit). The response
  status decides the stop reason, not the items.
- **Instructions** may be ignored by some models: Inkling ignored both
  `instructions` and a system message in our checks.

## Response

As for OpenAI: the assistant message is `response.output`, verbatim, and the
stop reason is derived the same way. Fireworks messages have no `phase`.

| Ours              | Responses                                    |
| ----------------- | -------------------------------------------- |
| `usage.cacheRead` | `input_tokens_details.cached_tokens`         |
| `usage.reasoning` | not reported                                 |
| `usage.output`    | `output_tokens`, reasoning included          |
| `native`          | `status`, `created_at`, `incomplete_details` |

Fireworks echoes nearly every request field, including the requested
`reasoning`; all of them are left out of `native`. Function `call_id`s vary by
model (`call_...`, `chatcmpl-tool-...`).

### Errors

Fireworks answers errors in five shapes: the format's `{error:{...}}`, a
`{detail:"..."}` string, a `{detail:{...}}` object, FastAPI's 422
`{detail:[{loc, msg}]}` list (read into a message and the field at fault), and
an empty body on a 502.

| Signal                                                                      | Kind               |
| --------------------------------------------------------------------------- | ------------------ |
| 401 (`UNAUTHORIZED`), 403, 412 (suspended account)                          | `auth`             |
| 402 (plan or spending limit)                                                | `quota_exceeded`   |
| 429                                                                         | `rate_limited`     |
| a message with "prompt is too long" or "exceeds maximum context length"     | `context_overflow` |
| 404 "Previous response not found" (`providerParam: "previous_response_id"`) | `not_found`        |
| 404 (`NOT_FOUND`, `providerParam: "model"`)                                 | `not_found`        |
| 503 (load shed, or a deployment scaled to zero)                             | `overloaded`       |
| 500, 502 and other 5xx                                                      | `provider_error`   |
| 400 and 422                                                                 | `invalid_request`  |

`requestId` comes from `x-request-id`. No `Retry-After` or rate-limit headers
were seen.

## Usage cost

Tokens at the catalog's standard rates, with each model's own cached-input
rate. Fireworks has no long-context tiers and no cache-write charge. The
response does not say which tier served it, so a request that sets a
`service_tier` other than `default` gets no estimate. The "fast" routers
(`accounts/fireworks/routers/*-fast`) are their own catalog entries with their
own rates. Dedicated deployments bill per GPU-hour and get no estimate.

## Models

Any model ID works: serverless models (`accounts/fireworks/models/<id>`),
routers (`accounts/fireworks/routers/<id>`), dedicated deployments
(`accounts/<account>/deployments/<id>`) and LoRA addons. The catalog holds
the serverless models listed by `GET /v1/models` on 2026-10-11. Fireworks
retires serverless models often; the catalog is metadata and a retired model
fails with `not_found`.

## Extractors

The Responses extractors, unchanged. `reasoningSummary(message)` returns the
reasoning text.

## Not supported

- Streaming, background mode (also refused by Fireworks for the models
  tested), retrieval, deletion and listing of stored responses.
- Provider request headers (`x-session-affinity`,
  `x-prompt-cache-isolation-key`).
- Files of any kind, custom tools, and file IDs (refused, above).
