# Anthropic research: summary

Research for the Anthropic adapter (Messages API,
`POST https://api.anthropic.com/v1/messages`), done 2026-10-12 from the docs,
the official TypeScript SDK types (v0.133.0) and about 650 live calls. Scope:
**Claude 5-generation models only** (Haiku 5.5, Sonnet 5.5, Opus 5.5,
Fable 5.1, Opus 5, Sonnet 5, Fable 5). Where the docs and the live API
disagree, the live API wins.

| File                                                     | What it holds                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [api-reference.md](api-reference.md)                     | Every request and response field, block types, stop reasons, headers, errors     |
| [thinking-caching-models.md](thinking-caching-models.md) | Thinking, effort, prompt caching, the model and pricing catalog, cost algorithm  |
| [tools-and-inputs.md](tools-and-inputs.md)               | Client and server tools, structured output, images, documents, files, compaction |
| [live-basics.md](live-basics.md)                         | Live: message structure, parameters, inputs, errors, limits, headers             |
| [live-thinking-tools.md](live-thinking-tools.md)         | Live: thinking per model, replay and signatures, tools, caching, web search      |
| [live-binding.md](live-binding.md)                       | Live: thinking blocks bound to the conversation prefix                           |
| [live-5gen-matrix.md](live-5gen-matrix.md)               | Live: one feature matrix across the seven 5-generation models                    |
| [ecosystem.md](ecosystem.md)                             | How pi-ai, ank, the Vercel AI SDK and LiteLLM adapt to Anthropic                 |

## What fits our design as is

- **Assistant messages replay verbatim.** The response `content` array sent
  back as `{role: "assistant", content}` works on every model, with every
  block type seen (thinking, text, tool_use with `caller`, server tool use and
  results, citations). The whole response object does not: `id` and the rest
  are "Extra inputs".
- **Mid-conversation system messages are native** (`{role: "system",
content}`) on all seven models, no beta header (the docs say not on Sonnet
  5; live it works). D3 maps onto it directly. Content is text only (and beta
  `tool_addition`/`tool_removal`). Placement is checked and refused with a
  clear 400: never first (use top-level `system`), never between a
  `tool_use` and its result, only after a user turn and before an assistant
  turn or at the end.
- **The API is strict.** Unknown fields, misspellings, `null` on optional
  fields and beta fields without their header all get 400 "Extra inputs are
  not permitted" with the path. So passing `providerOptions` through needs no
  allowlist, and typos never vanish silently (unlike Fireworks).
- **`is_error` exists** on `tool_result`, so D5's `isError` is sent.
- **Consecutive same-role messages are merged server-side**, so each of our
  messages can map to one Anthropic message. Tool results must come first in
  a user turn and every `tool_use` must be answered; both are 400s, not
  silent.
- **Per-model rules are enforced with clear 400s**, so the adapter needs no
  capability table (D7): budgeted thinking (`enabled`) is refused on every
  5-generation model; `disabled` is refused on Opus 5.5 and Fable 5/5.1 and
  Sonnet 5.5 turns thinking off with its own `between_tools`; forced
  `tool_choice` is refused on Opus 5.5, Sonnet 5.5 and Fable 5.1; any
  `temperature`, `top_p` or `top_k` other than the default is "deprecated";
  prefill is refused everywhere. See [live-5gen-matrix.md](live-5gen-matrix.md).
- **No server-side state** like `previous_response_id`: every request sends
  the full history. Containers (code execution) and Files are the only
  stored things, and they are the caller's.

## What needs care

1. **Thinking blocks are signed and bound.** The visible thinking text is never
   checked or used; the `signature` carries the reasoning. A corrupted or
   missing signature is a 400 in any assistant message. On Fable 5.1, Opus
   5.5, Sonnet 5.5 and Haiku 5.5 a thinking block is also bound to everything
   before it: changing `system`, a tool definition, or earlier content breaks
   it. Accounts created on or after 2026-08-31 get a 400 that retrying never
   fixes; older accounts keep the block silently.
   `thinking.block_binding.prefix_mismatch_behavior` (`error` or
   `drop_block`, beta header) controls it. The binding compares content, not
   bytes, and ignores `cache_control`, effort, display and `max_tokens`. Our
   mapping must render the same input the same way every turn; it does,
   since it is deterministic.
2. **Thinking from another model is silently ignored for some pairs.**
   Never an error while the signature is intact. Haiku 5.5 thinking replayed
   to Sonnet 5.5 or Opus 5.5 is read; replayed to Fable 5.1 it is dropped
   without a word. Sonnet 5.5 and Haiku 5.5 blocks only work in the account
   that produced them.
3. **Thinking by default.** All 5-generation models think when `thinking` is
   omitted (adaptive), and `display` defaults to `omitted`: thinking blocks
   come back with empty text and a signature. A small `max_tokens` can end a
   response with only an empty thinking block. `output_tokens` includes
   thinking; `output_tokens_details.thinking_tokens` gives the split.
4. **`max_tokens` is required**, up to 128,000 on every model; above the
   limit is a 400 naming it. `max_tokens: 0` is accepted and bills the input.
5. **Many features need `anthropic-beta`**, some for as long as the history
   holds their blocks: compaction, context editing, block binding, fast mode
   (`speed`), MCP connector, advisor, fallbacks, per-turn tool changes. An
   unknown beta value rejects the whole request. The header is not a body
   field, so `providerOptions` alone cannot carry it today.
6. **Long requests without streaming.** The official SDKs refuse non-streaming
   calls over about 21,333 `max_tokens` (expected over 10 minutes) because idle
   connections get dropped; the API itself allows them and may answer 504
   `timeout_error`. High effort with large `max_tokens` can run that long.
7. **Silent behavior to know about** (the API accepts these and does
   something other than expected):
   - a final assistant message that is `""` or `[]` is ignored;
   - `system: ""` or `[]` means no system prompt;
   - a document block inside an assistant turn is counted but ignored;
   - forcing a tool on Haiku 5.5, Opus 5, Sonnet 5 or Fable 5 turns thinking
     off for that turn;
   - prompts below the minimum cacheable length (512 to 1,024 tokens) are
     not cached, with no error;
   - search results with citations make Haiku 5.5 think even with thinking
     `disabled`;
   - without `container` on a follow-up, code execution starts a new
     container.
8. **Tool call IDs** must match `^[a-zA-Z0-9_-]+$`; IDs from other providers
   (e.g. `functions.x:0`) need remapping. That is conversion's job (D13).
9. **Server-side fallback (beta)** can answer with another model and add a
   `fallback` block; the response `model` then differs from the request.

## Errors

The body is `{type: "error", error: {type, message, details?}, request_id}`;
the `request-id` header is always there (the body has none on 413 and edge
errors). Errors carry `x-should-retry`; no `retry-after` was seen.
Validation messages start with the field path (`messages.1.content.0: …`),
which can give `providerParam`.

| Signal                                                                 | Kind               |
| ---------------------------------------------------------------------- | ------------------ |
| 401 `authentication_error`, 403 `permission_error`                     | `auth`             |
| 402 `billing_error`; 400 or 429 with a spend-limit message or code     | `quota_exceeded`   |
| 429 `rate_limit_error`                                                 | `rate_limited`     |
| 400 "prompt is too long: N tokens > M maximum" (no code; message only) | `context_overflow` |
| 404 `not_found_error` ("model: <id>", unknown or retired; bad file ID) | `not_found`        |
| 413 `request_too_large` (over 32 MB; different body shape)             | `invalid_request`  |
| 529 `overloaded_error`                                                 | `overloaded`       |
| 504 `timeout_error`                                                    | `timeout`          |
| 500 `api_error` and other 5xx                                          | `provider_error`   |
| other 400 `invalid_request_error`                                      | `invalid_request`  |

A monthly tier spend cap arrives as 429 `rate_limit_error` with
`error.details.error_code: "enforced_spend_limit_reached"` and no
`retry-after`: it must be `quota_exceeded`, or a harness retries forever.
Stop reason `refusal` (with `stop_details.category`) is a 200, not an error.
`model_context_window_exceeded` was never produced: input that fits with
input + `max_tokens` over the window simply runs.

## Usage and cost

- `input_tokens` excludes cached tokens. Total input =
  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
- Cache writes have two prices: 1.25× input for 5 minutes, 2× for 1 hour,
  split in `usage.cache_creation.ephemeral_5m/1h_input_tokens`. Our `Usage`
  and `ModelCost` have a single `cacheWrite`.
- Cache reads are 0.1× input on most models, 0.05× on Opus 5.5 and Sonnet 5.5,
  0.025× on Fable 5.1.
- Haiku 5.5 alone has long-context pricing: over 100,000 prompt tokens the
  whole request (output too) costs 5×. Our pricing `tiers` fit this.
- `usage.inference_geo: "us"` is 1.1×; `usage.service_tier` says which tier
  served (Priority has no public price, so no estimate); beta fast mode is 2×
  and shows in `usage.speed`.
- With beta compaction, advisor or fallback, `usage.iterations` lists the
  real bill per model and the top-level numbers leave part of it out.

| Model             | Input | Output | 5m write | 1h write | Read |
| ----------------- | ----- | ------ | -------- | -------- | ---- |
| claude-fable-5-1  | 10    | 50     | 12.50    | 20       | 0.25 |
| claude-fable-5    | 10    | 50     | 12.50    | 20       | 1    |
| claude-opus-5-5   | 4     | 20     | 5        | 8        | 0.20 |
| claude-opus-5     | 5     | 25     | 6.25     | 10       | 0.50 |
| claude-sonnet-5-5 | 2     | 10     | 2.50     | 4        | 0.10 |
| claude-sonnet-5   | 2     | 10     | 2.50     | 4        | 0.20 |
| claude-haiku-5-5  | 0.10  | 0.50   | 0.125    | 0.20     | 0.01 |
| over 100K prompt  | 0.50  | 2.50   | 0.625    | 1        | 0.05 |

USD per million tokens. All seven: 1M context, 128K output, text, image and
PDF input.
