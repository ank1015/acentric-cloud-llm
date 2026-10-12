# Anthropic

Provider ID `anthropic`, API format `anthropic-messages` (the Messages API,
`POST https://api.anthropic.com/v1/messages`). Verified against the Anthropic
docs, the TypeScript SDK v0.133.0 and about 650 live calls on 2026-10-12. The
research, with sources and the recorded exchanges, is in
[`../research/anthropic/`](../research/anthropic/); its
[summary](../research/anthropic/README.md) is the place to start.

Scope: **Claude 5 models** (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5,
Fable 5, Opus 5, Sonnet 5). Older models may work but are not checked or
catalogued. Where the docs and the live API disagree, the live API wins.

## Credentials

`{ apiKey, workspaceId? }`. The key goes as `x-api-key`; `workspaceId` as
`anthropic-workspace-id`, which keys that span workspaces require. Every
request also carries `anthropic-version: 2023-06-01`.

## Request

| Ours                       | Messages API                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `instructions`, a string   | `system`, a string                                                                                        |
| `instructions`, text parts | `system` text blocks; a part's `providerOptions` (e.g. `cache_control`) merge into its block              |
| user message               | `{role: "user", content}`                                                                                 |
| `system` message           | `{role: "system", content}`, native on every Claude 5 model (text parts only)                             |
| assistant message          | `{role: "assistant", content}`, the blocks verbatim; see [Replay](#replay)                                |
| tool result                | `{role: "user", content: [{type: "tool_result", tool_use_id, content, is_error?}]}`                       |
| `native` message           | `{role: "user", content}`, the blocks verbatim (search results, documents with citations, uploads)        |
| text part                  | `text` block                                                                                              |
| image part                 | `image` block; source `base64`, `url` or `file` (a Files API ID)                                          |
| file part                  | `document` block; `filename` becomes `title`. `text/plain` base64 is decoded into a `text` source         |
| function tool              | `{name, description, input_schema, strict?}`                                                              |
| `providerOptions.tools`    | appended after our tools: server tools (`web_search_*`, `code_execution_*`, ...), Anthropic-defined tools |
| `providerOptions.betas`    | the `anthropic-beta` header, comma-joined; not sent in the body                                           |
| `providerOptions` (rest)   | the request body as is: `max_tokens`, `thinking`, `output_config`, `tool_choice`, `cache_control`, ...    |

Each of our messages becomes one Anthropic message, so the indexes in
Anthropic's errors (`messages.3.content.0`) are the request's. Anthropic
merges consecutive turns of the same role itself. A tool result with one plain
text part is sent as a string; anything else as blocks.

**`max_tokens`** is required by Anthropic. When `providerOptions` leaves it
out, the adapter sends the model's maximum from the catalog: 128,000 for every
Claude 5 model, and for models outside the catalog. Anthropic counts
`max_tokens` against the output-token rate limit when the request starts, and
long generations without streaming risk a dropped connection (the official
SDKs refuse non-streaming calls above about 21,333 tokens). Set it lower when
either matters.

### Refused

- `stream: true`, and owned fields (`model`, `messages`, `system`) in
  `providerOptions`.
- Custom (free-form) tools and results for them: Anthropic has none.
- Assistant or `native` messages from another provider.
- A system message with anything but text parts.
- `betas` that is not a list of beta names.
- A `text/plain` file whose base64 data is not UTF-8.

Anthropic itself refuses unknown fields, misspellings and `null` on optional
fields with a 400 that names the path ("Extra inputs are not permitted"),
including beta fields sent without their beta name. Nothing in
`providerOptions` is silently ignored.

### Rules Anthropic enforces per model

Every case below is a clear 400; the adapter keeps no capability table.

- **Thinking.** Claude 5 models think by default (adaptive) and refuse
  budgeted thinking (`enabled`). Turning it off: `disabled` on Haiku 5.5,
  Opus 5 and Sonnet 5 (at effort `high` or below), `between_tools` on Sonnet
  5.5, not at all on Opus 5.5, Fable 5.1 and Fable 5.
- **Thinking text.** `display` defaults to `omitted`: thinking blocks come back
  with empty text and a signature. Send `display: "summarized"` for text.
- **Forced tool choice** (`any`, `tool`) is refused by Opus 5.5, Sonnet 5.5 and
  Fable 5.1, and turns thinking off for the turn elsewhere.
- **Sampling.** `temperature`, `top_p` and `top_k` other than the defaults are
  "deprecated" (400).
- **Prefill.** A conversation that ends with an assistant message is refused.
- **System message placement.** Never first (use `instructions`), never
  between a `tool_use` and its result; after a user turn, before an assistant
  turn or at the end.

The full matrix is in
[`live-5gen-matrix.md`](../research/anthropic/live-5gen-matrix.md).

### Worth knowing

- **Silently accepted:** a final assistant message that is `""` or `[]` is
  ignored, as is an empty assistant message mid-conversation; `system: ""`
  means no system prompt; prompts below the minimum cacheable length (512 to
  1,024 tokens) are not cached, with no error; search results with citations
  make Haiku 5.5 think even with thinking `disabled`.
- **Prompt caching** is opt-in: `cache_control` on a block, tool or system
  part (in its `providerOptions`), or top-level `providerOptions.cache_control`
  for automatic caching. At most four breakpoints.
- **Code execution containers** are reused only when `providerOptions.container`
  sends back the ID from `native.container`; otherwise a new one starts.
- **Tool call IDs** must match `^[a-zA-Z0-9_-]+$`; IDs from other providers
  need converting.

## Replay

The assistant message is the response `content`, verbatim, and is sent back
as `{role: "assistant", content}`. That works for every block type seen:
thinking, text with citations, tool use with `caller`, server tool use and
results (with encrypted content), compaction.

**Thinking is signed and bound.** The thinking text is never checked; the
reasoning travels in the `signature`, which is checked in every assistant
message. On Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 a thinking block is
also bound to everything before it: `system`, tool definitions and earlier
content. Changing any of them between turns invalidates the thinking blocks
before the change. Accounts created on or after 2026-08-31 get a 400 that
retrying never fixes; older accounts keep the block silently.
`thinking.block_binding.prefix_mismatch_behavior` (`"error"` or
`"drop_block"`, with beta `thinking-binding-controls-2026-08-01`) chooses.
The binding compares content, not bytes, and ignores `cache_control`, effort,
`display` and `max_tokens`; the adapter renders the same input the same way
every turn. See [`live-binding.md`](../research/anthropic/live-binding.md).

**Another model's thinking is left out.** When an assistant message's `model`
differs from the request's, the adapter drops its `thinking` and
`redacted_thinking` blocks and replays the rest; a message left empty is not
sent. Anthropic never errors on another model's signed thinking, but some
models read it and others ignore it without a word (Haiku 5.5's thinking is
read by Sonnet 5.5 and ignored by Fable 5.1), and Sonnet 5.5 and Haiku 5.5
blocks only work in the account that produced them. This is the only change
the adapter makes to a replayed message.

## Response

| Ours                 | Messages API                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `message.id`   | `id` (`msg_...`)                                                                                                                                              |
| `message.content`    | `content`, verbatim                                                                                                                                           |
| `responseModel`      | `model`, when it differs from the request's (aliases, beta fallbacks)                                                                                         |
| `stopReason`         | from `stop_reason`, below                                                                                                                                     |
| `providerStopReason` | `stop_reason`, when it says more than `stopReason`                                                                                                            |
| `usage.input`        | `input_tokens` (uncached only)                                                                                                                                |
| `usage.cacheRead`    | `cache_read_input_tokens`                                                                                                                                     |
| `usage.cacheWrite`   | `cache_creation_input_tokens` (five-minute and one-hour writes together)                                                                                      |
| `usage.totalInput`   | the three above, summed                                                                                                                                       |
| `usage.output`       | `output_tokens`, thinking included                                                                                                                            |
| `usage.reasoning`    | `output_tokens_details.thinking_tokens`                                                                                                                       |
| `native`             | `stop_sequence`, `stop_details`, `container`, `context_management`, `diagnostics`                                                                             |
| `native.usage`       | the usage fields not mapped above: `service_tier`, `inference_geo`, `speed`, `server_tool_use`, `iterations`, and `cache_creation` when something was written |

| `stop_reason`                   | `stopReason` |
| ------------------------------- | ------------ |
| `end_turn`, `stop_sequence`     | `stop`       |
| `max_tokens`                    | `length`     |
| `model_context_window_exceeded` | `length`     |
| `tool_use`                      | `tool_use`   |
| `pause_turn`                    | `pause_turn` |
| `compaction` (beta, paused)     | `pause_turn` |
| `refusal`                       | `refusal`    |

A refusal is a 200 with `stop_reason: "refusal"` and the category in
`native.stop_details`. With beta features that add sampling iterations
(compaction, advisor, fallback), the top-level counts leave some tokens out;
`usage` then sums `usage.iterations`, which is the whole bill.

### Errors

The body is `{type: "error", error: {type, message, details?}, request_id}`;
a 413 and errors from Anthropic's edge have other shapes or a text body.
`requestId` comes from the `request-id` header. `x-should-retry` sets
`retryable`; `retry-after` sets `retryAfterMs`. A validation message starts
with the field at fault (`max_tokens: …`, `messages.1.content.0: …`,
`model: …`), which becomes `providerParam`.

| Signal                                                                                        | Kind               |
| --------------------------------------------------------------------------------------------- | ------------------ |
| 401 `authentication_error`, 403 `permission_error`                                            | `auth`             |
| 402 `billing_error`                                                                           | `quota_exceeded`   |
| 400 "You have reached your specified API usage limits", "credit balance is too low"           | `quota_exceeded`   |
| 429 with `details.error_code: "enforced_spend_limit_reached"` (a tier's monthly cap)          | `quota_exceeded`   |
| 429 `rate_limit_error`                                                                        | `rate_limited`     |
| 400 "prompt is too long: N tokens > M maximum" (no code)                                      | `context_overflow` |
| 404 `not_found_error` ("model: <id>" for unknown or retired models, `providerParam: "model"`) | `not_found`        |
| 413 `request_too_large` (over 32 MB)                                                          | `invalid_request`  |
| 504 `timeout_error`                                                                           | `timeout`          |
| 529 `overloaded_error`                                                                        | `overloaded`       |
| 500 `api_error`, other 5xx                                                                    | `provider_error`   |
| other 400 `invalid_request_error`                                                             | `invalid_request`  |

## Usage cost

Tokens at the catalog's standard rates. Cache writes are priced by time to
live from `usage.cache_creation`: 1.25x the input rate for five minutes, 2x
for an hour (`cacheWrite1h` in the catalog); `cost.cacheWrite` is both
together. Reads are priced per model (0.1x input on most, 0.05x on Opus 5.5
and Sonnet 5.5, 0.025x on Fable 5.1). Haiku 5.5 alone has a long-context
rate: over 100,000 prompt tokens the whole request costs 5x. Multipliers from
the response: `inference_geo: "us"` 1.1x, beta fast mode (`speed: "fast"`)
2x, batch 0.5x. No estimate when it cannot be known: Priority Tier (no
public rate), fast mode requested without `usage.speed` in the answer, cache
writes not split by time to live, a model outside the catalog in any
iteration, or a refusal before any output outside the billed categories
(`bio`, `frontier_llm`, `reasoning_extraction`). Server tool fees (web search
at $10 per 1,000) are not estimated.

## Models

Any model ID works. The catalog holds the seven Claude 5 models: 1M context,
128K output, text, image and PDF input. Prices are those of 2026-10-12
(Sonnet 5.5 cache reads fell to $0.10 on 2026-10-07).

## Extractors

- `outputText(message)`: the text blocks joined as written (citations split a
  text into several blocks).
- `reasoningSummary(message)`: the non-empty thinking texts.
- `toolCalls(message)` and `pendingToolCalls(message)`: the `tool_use`
  blocks, with `arguments` as a JSON string of `input`. A toolset member's
  `toolset_name` is in `resultOptions`, so `toolResult` echoes it. Server
  tool calls run at Anthropic and are not listed.
- `refusals(message)`: always empty; a refusal is the stop reason.

## Not supported

- Streaming, the Batches API, token counting and the Files API endpoints.
- Assistant prefill (Claude 5 models refuse it).
- OAuth subscription tokens (`sk-ant-oat…`); only API keys.
