# OpenAI

Provider ID `openai`, API format `openai-responses` (the Responses API,
`POST https://api.openai.com/v1/responses`). Verified against the API
reference, the official OpenAPI spec (v2.3.0) and openai-node (v7.32.0) on
2026-10-11. The detailed research, with sources, is in
[`../research/openai/`](../research/openai/).

The Responses format is shared with other providers (Open Responses, Fireworks,
xAI). The base adapter implements the format; OpenAI is a profile on it. This
page records what the base does and what is OpenAI's own.

## Credentials

`{ apiKey, organization?, project? }`, sent as `Authorization: Bearer`,
`OpenAI-Organization` and `OpenAI-Project`.

## Request

| Ours                    | Responses                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `model`                 | `model`                                                                                                           |
| `instructions`          | `instructions`. Text blocks are joined with a blank line. Instructions cannot carry `providerOptions` (see below) |
| `user` message          | `{type:"message", role:"user", content}`                                                                          |
| `system` message        | `{type:"message", role:"developer", content}` (the profile's system role)                                         |
| `assistant` message     | its output items, verbatim, except the output-only field `created_by`                                             |
| `tool_result`, function | `{type:"function_call_output", call_id, output}`, plus the result's `providerOptions`                             |
| `tool_result`, custom   | `{type:"custom_tool_call_output", call_id, output}`, plus the result's `providerOptions`                          |
| `native` message        | its items, verbatim                                                                                               |
| `custom` message        | refused; the SDK strips them                                                                                      |
| function tool           | `{type:"function", name, description, parameters, strict?}`; an omitted `strict` stays omitted                    |
| custom tool             | `{type:"custom", name, description, format?}`                                                                     |
| `providerOptions.tools` | appended after our tools: hosted tools, namespaces, tool search, MCP, shell, apply_patch, computer                |
| other `providerOptions` | passed through                                                                                                    |

A tool result's `output` is a string when the content is a single text part
without `providerOptions`, and otherwise a list of parts.

Content parts:

| Ours           | Responses                                                               |
| -------------- | ----------------------------------------------------------------------- |
| text           | `{type:"input_text", text}`                                             |
| image, URL     | `{type:"input_image", image_url}`                                       |
| image, base64  | `{type:"input_image", image_url:"data:<type>;base64,<data>"}`           |
| image, file ID | `{type:"input_image", file_id}`                                         |
| file, URL      | `{type:"input_file", file_url, filename?}`                              |
| file, base64   | `{type:"input_file", file_data:"data:<type>;base64,<data>", filename?}` |
| file, file ID  | `{type:"input_file", file_id, filename?}`                               |

A part's `providerOptions` is merged into the block: `detail`
(`low`, `high`, `auto`, `original`), `prompt_cache_breakpoint`. A key the
adapter sets (`type`, the source fields) is refused.

### Refused

- `stream: true`: `complete` returns one finished response.
- `background: true`: it answers with a queued response. Background runs may
  become their own routes later.
- `model`, `input` or `instructions` in `providerOptions`: set them through the
  request.
- `providerOptions` on instruction blocks: OpenAI's `instructions` is a single
  string and cannot hold a cache breakpoint. Send a `system` message with the
  breakpoint instead.

### Not sent

- `isError` on a tool result. OpenAI has no error flag on tool results; the
  result's content must say that the tool failed.

### Worth knowing

- **`store` defaults to `true` at OpenAI**: OpenAI keeps the response for at
  least 30 days unless the request says `store: false`. We pass it through
  untouched, either way.
- **`previous_response_id`** carries the whole earlier chain (inputs, outputs,
  reasoning, compaction) but not `instructions` or tools: send those on every
  request. An unknown or expired ID is a 400 `previous_response_not_found`,
  which arrives as `not_found` with `providerParam: "previous_response_id"`;
  fall back to the full history. Zero-data-retention organizations never
  store, so chaining always fails there.
- **Stateless replay** (`store: false`): send every output item back, in order,
  with its ID. Reasoning items carry `encrypted_content` by default; a
  reasoning item without the item that followed it is refused. Reasoning is
  reused only within a model family.
- **`phase`** (`commentary` or `final_answer`) must be kept on replay; verbatim
  replay does that. Commentary is not the answer.
- **Server-side compaction** (`context_management`) works inside `complete`:
  the output then has a `compaction` item, replayed like any other.
- **Prompt caching** is automatic. Keep instructions, tools and their order,
  `reasoning.effort` and `text.verbosity` stable; append to the history, never
  rewrite it. `prompt_cache_key` and `prompt_cache_options` pass through.
- **Secrets in tools**: MCP `authorization` and `headers` and shell
  `domain_secrets` are in `providerOptions.tools`. OpenAI does not keep them,
  so send them on every request. The gateway never logs them.

## Response

The assistant message is `response.output`, verbatim.

| Ours                 | Responses                                                                 |
| -------------------- | ------------------------------------------------------------------------- |
| `id`                 | `id`                                                                      |
| `responseModel`      | `model`, when it differs from the requested ID                            |
| `providerStopReason` | `incomplete_details.reason`                                               |
| `usage.totalInput`   | `input_tokens`                                                            |
| `usage.cacheRead`    | `input_tokens_details.cached_tokens`                                      |
| `usage.cacheWrite`   | `input_tokens_details.cache_write_tokens`                                 |
| `usage.input`        | `input_tokens` minus cache reads and writes                               |
| `usage.output`       | `output_tokens`, reasoning included                                       |
| `usage.reasoning`    | `output_tokens_details.reasoning_tokens`                                  |
| `native`             | the response without `output`, the fields above, and the request's echoes |

The echoed request fields left out of `native` are `instructions`, `tools`,
`tool_choice`, `parallel_tool_calls`, `max_output_tokens`, `max_tool_calls`,
`temperature`, `top_p`, `top_logprobs`, `text`, `truncation`, `store`,
`background`, `previous_response_id`, `conversation`, `prompt`,
`prompt_cache_key`, `prompt_cache_retention`, `prompt_cache_options`,
`safety_identifier`, `user`, `metadata`, `include`, `frequency_penalty` and
`presence_penalty`. Fields that are `null` are left out too. What remains is
what the response says that the caller did not: `status`, `created_at`,
`completed_at`, the `service_tier` actually used, the effective `reasoning`,
`billing`, `tool_usage` (hosted tool counts), `prompt_cache_diagnostics`,
`moderation`, `access_programs`, and anything new.

### Stop reason

OpenAI has no stop reason. In order:

| Condition                                                   | `stopReason`                |
| ----------------------------------------------------------- | --------------------------- |
| `status: "failed"` (also on HTTP 200)                       | an `LlmError`               |
| `status: "cancelled"`                                       | an `LlmError` (`cancelled`) |
| `incomplete`, reason `content_filter`                       | `content_filter`            |
| `incomplete`, any other reason (`max_output_tokens`, …)     | `length`                    |
| a call the caller must answer has no output in the response | `tool_use`                  |
| a message has a refusal part                                | `refusal`                   |
| no message except commentary, after hosted work             | `pause_turn`                |
| otherwise                                                   | `stop`                      |

Calls the caller answers: `function_call`, `custom_tool_call`, `computer_call`,
`shell_call`, `apply_patch_call`, `local_shell_call`, client `tool_search_call`,
and `mcp_approval_request`. A call is answered within the response when an
output item with its `call_id` (for an approval, a response with its
`approval_request_id`) follows it, as for hosted shell. Async calls
(`async: true`) stay pending even next to a final message.

`pause_turn` means: send the output back (or chain with
`previous_response_id`) and the model continues.

### Errors

| Signal                                                                                          | Kind               |
| ----------------------------------------------------------------------------------------------- | ------------------ |
| 401, or 403 without a policy code                                                               | `auth`             |
| 429 with `insufficient_quota`, `credit_balance_exhausted` or a spend or usage limit code        | `quota_exceeded`   |
| other 429, failed response `rate_limit_exceeded`                                                | `rate_limited`     |
| `context_length_exceeded`, or a 400 whose message says the input exceeds the context window     | `context_overflow` |
| `previous_response_not_found`, 404                                                              | `not_found`        |
| `bio_policy`, `cyber_policy`, `misalignment_policy_violation`, `image_content_policy_violation` | `policy_violation` |
| 503, 529                                                                                        | `overloaded`       |
| 500 and other 5xx, failed response `server_error`                                               | `provider_error`   |
| failed response `vector_store_timeout`                                                          | `timeout`          |
| other 4xx, failed response `invalid_prompt` and image codes                                     | `invalid_request`  |

`retryAfterMs` comes from `Retry-After`, `requestId` from `x-request-id`.

## Usage cost

Tokens at the catalog's standard rates, with the long-context rates above
272K input tokens for the models that have them. The `service_tier` actually
used decides: `default` at standard rates, `flex` at half. Any other tier
(`priority`, `scale`, `ultrafast`), or a token bucket the catalog has no rate
for, leaves the cost out. Hosted tool fees are not estimated.

## Extractors

Pure functions over an OpenAI assistant message:

- `outputText(message)`: the text of final messages, without commentary;
  `{ phase: "all" }` includes it.
- `toolCalls(message)` and `pendingToolCalls(message)`: calls the caller
  answers, as `function`, `custom` or `native` calls. Each keeps its raw
  item, its namespace, and the fields its result must echo.
- `reasoningSummary(message)`, `refusals(message)`.

## Not supported

- Streaming, WebSocket mode and steering.
- Background mode, retrieval, cancellation, the standalone `/responses/compact`
  and Conversations management routes. `conversation` itself passes through.
- Multi-agent (beta; a separate path and header).
- Estimating hosted tool fees.
