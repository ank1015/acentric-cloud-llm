# OpenAI Responses API research: caching, service tiers, errors, inputs, models

Research date: 2026-10-11. Scope: five topics for the stateless, non-streaming gateway/SDK (caller-supplied OpenAI key).

## Method and caveats

- Sources were read with a web fetch tool that returns a model-written summary of each page, not the raw page. Field names and enum values quoted below were cross-checked where possible against the OpenAI Node SDK type definitions (S15). Before coding against any literal string, re-check it against the live page or the SDK version you pin.
- Several OpenAI pages are very long (the Responses create reference is about 500K characters). Slices were read by offset. Anything in a slice that was not read is marked UNVERIFIED.
- Prices are per 1M tokens. The pricing page uses "$" without naming a currency; USD is assumed (S7).
- openai.com/api-priority-processing returned HTTP 403 and was not read (S16).
- Where a fact comes only from a community forum, a third-party gateway, or a search snippet, it is labelled SECONDARY.

### Source key

| ID  | URL                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | https://developers.openai.com/api/docs/guides/prompt-caching                                                                            |
| S2  | https://developers.openai.com/api/reference/resources/responses/methods/create                                                          |
| S3  | https://developers.openai.com/api/docs/guides/error-codes                                                                               |
| S4  | https://developers.openai.com/api/docs/guides/rate-limits                                                                               |
| S5  | https://developers.openai.com/api/docs/guides/flex-processing                                                                           |
| S6  | https://developers.openai.com/api/docs/guides/fast-mode                                                                                 |
| S7  | https://developers.openai.com/api/docs/pricing                                                                                          |
| S8  | https://developers.openai.com/api/docs/models                                                                                           |
| S9  | https://developers.openai.com/api/docs/models/all                                                                                       |
| S10 | https://developers.openai.com/api/docs/models/{model-id} (one page per model; ids cited per row)                                        |
| S11 | https://developers.openai.com/api/docs/guides/images-vision                                                                             |
| S12 | https://developers.openai.com/api/docs/guides/pdf-files (file inputs)                                                                   |
| S13 | https://developers.openai.com/api/docs/guides/batch                                                                                     |
| S14 | https://developers.openai.com/api/docs/guides/function-calling                                                                          |
| S15 | https://raw.githubusercontent.com/openai/openai-node/master/src/resources/responses/responses.ts (openai-node SDK types, master branch) |
| S16 | https://openai.com/api-priority-processing/ (403, not read)                                                                             |
| S17 | https://community.openai.com/t/responses-api-how-to-manage-context-size/1357722 (SECONDARY)                                             |

---

## 1. Prompt caching

### How it works

- Caching is on by default for supported models. It reuses processed KV state for a shared prefix; the cache stores KV tensors, not tokens. [S1]
- A hit needs the whole rendered prefix to match up to a breakpoint. The cached prefix covers instructions, developer messages, tool definitions and conversation history. [S1]
- Breakpoints are implicit by default. On GPT-5.6 and later, they can be set explicitly with `prompt_cache_options.mode` and `prompt_cache_breakpoint`. [S1][S15]
- `prompt_cache_options` (GPT-5.6+): `mode` is `"implicit" | "explicit"` (default implicit); `prewarm` prepares the cache without generating output; `ttl` is currently only `"30m"`; `comparison_response_id` is used to request cache diagnostics. [S15]
- Cache reads refresh the lifetime. [S1]
- Caching does not change output generation; identical requests are not guaranteed identical outputs. [S1]
- Cached input tokens still count toward tokens-per-minute rate limits. [S1]
- Manual cache clearing is not available. [S1]

### Minimum prompt length

- GPT-5.6 and later: 1,024 visible input tokens. Hidden OpenAI system tokens do not count. [S1]
- Earlier models: the minimum "varies by request settings" (tools, images, output schemas, reasoning effort, verbosity). It is not given as a single number. [S1]

### `prompt_cache_key` and `prompt_cache_retention`

| Parameter                | Behaviour                                                                                                                                                                                                                                                                                                                         | Source  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `prompt_cache_key`       | Optional string. Groups similar requests to improve hit rate; replaces the `user` field. On earlier models, OpenAI suggests roughly 15 requests/min per key for busy groups. It does not pin requests to a machine or guarantee a hit. On GPT-5.6+ it is optional and used for separate cache accounting (e.g. per customer).     | S2, S1  |
| `prompt_cache_retention` | Allowed: `"in_memory"` and `"24h"`. Deprecated in favour of `prompt_cache_options.ttl` on GPT-5.6+. `in_memory`: about 5-10 min idle, up to 1 h. `24h`: about 30 min typical, up to 24 h. Default: non-ZDR orgs default to `24h`; ZDR orgs default to `in_memory`. `gpt-5.5`, `gpt-5.5-pro` and future models support only `24h`. | S2, S1  |
| Extended caching         | `24h` retention (above) is the extended option. On GPT-5.6+ the only TTL is `"30m"`, which is also the default.                                                                                                                                                                                                                   | S1, S15 |

### Usage fields

- Cached reads: `usage.input_tokens_details.cached_tokens`. [S1]
- Cache writes: `usage.input_tokens_details.cache_write_tokens`. This field appears in the response usage object alongside `cached_tokens`. [S1][S2]
- Uncached input = `input_tokens - cached_tokens - cache_write_tokens` (the docs' cost formula). [S1]
- Granularity: on earlier models `cached_tokens` excludes hidden system tokens and is rounded down to a multiple of 128. On GPT-5.6+ it is reported at the exact eligible boundary. [S1]
- Usage object shape: `input_tokens`, `input_tokens_details.{cached_tokens, cache_write_tokens}`, `output_tokens`, `output_tokens_details.reasoning_tokens`, `total_tokens`. [S2][S15]

### Pricing of cached input (per 1M tokens; from S7)

| Model         | Input | Cached input | Ratio | Cache write (GPT-5.6+) |
| ------------- | ----- | ------------ | ----- | ---------------------- |
| gpt-6-astra   | 10.00 | 1.00         | 0.1x  | 12.50 (1.25x)          |
| gpt-6.1-sol   | 2.00  | 0.10         | 0.05x | 2.50                   |
| gpt-6-luna    | 0.10  | 0.01         | 0.1x  | 0.125                  |
| gpt-6-sol     | 2.00  | 0.20         | 0.1x  | 2.50                   |
| gpt-5.6-sol   | 4.00  | 0.40         | 0.1x  | 5.00                   |
| gpt-5.6-terra | 2.00  | 0.20         | 0.1x  | 2.50                   |
| gpt-5.6-luna  | 0.20  | 0.02         | 0.1x  | 0.25                   |
| gpt-5.5       | 5.00  | 0.50         | 0.1x  | not listed             |
| gpt-5.4       | 2.50  | 0.25         | 0.1x  | not listed             |
| gpt-4.1       | 2.00  | 0.50         | 0.25x | not listed             |
| gpt-4o        | 2.50  | 1.25         | 0.5x  | not listed             |

Source: S7 for all rows. Cache writes are 1.25x the input rate on GPT-5.6+ (S1). Earlier models have no separate cache-write charge (S1). Long-context (>272K input) cache rates are double the short-context rates on the models listed (S7, S10 for gpt-6-astra).

### What breaks the cache (S1)

- Any change before the breakpoint, including: `model`, `tools` (names, descriptions, schemas, ordering), `parallel_tool_calls`, `text.format`, `reasoning.effort`, `text.verbosity`, `context_management` (compaction).
- Rewriting, summarising or truncating earlier messages.
- Editing an earlier message's text (moves the old endpoint inside the message).
- Switching to explicit-only mode without a matching explicit breakpoint.
- Prefixes shorter than the minimum.

### Ordering best practice (S1)

1. Stable `instructions` / developer content and reference material first.
2. Tool definitions: keep names, order and schemas stable. Use `tool_choice: "none"` or `allowed_tools` rather than removing tools.
3. Conversation history: append new messages; do not rewrite earlier turns.
4. Dynamic content (timestamps, per-user text) last. On GPT-5.6+, place an explicit breakpoint after the static block if dynamic content follows.
5. On GPT-6 models, change reasoning effort through a `configuration_update` input item and leave top-level `reasoning.effort` unchanged. [S1]

**Gateway implication:** the SDK should build requests in a canonical order and avoid varying `tools`, `reasoning.effort` or `text.verbosity` per call within the same conversation if caching matters. Expose `cached_tokens` and `cache_write_tokens` as `cacheRead` and `cacheWrite`. Compute `input` (uncached) as `input_tokens - cached_tokens - cache_write_tokens`.

---

## 2. Service tiers and cost/latency knobs

### `service_tier` values

Request field allowed values (S2, S15): `"auto" | "default" | "flex" | "scale" | "priority" | "fast" | "ultrafast"` (or null).

| Value       | Meaning                                                                                                                                                                                        | Source                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `auto`      | Uses the project's configured tier (default `default`).                                                                                                                                        | S2                                                        |
| `default`   | Standard pricing and performance.                                                                                                                                                              | S2                                                        |
| `flex`      | Flex Processing: lower cost, slower, best-effort. Beta, limited model availability (list not given in docs). A 429 `Resource Unavailable` can occur. Requests that return 429 are not charged. | S5                                                        |
| `scale`     | Listed as an allowed value. Meaning and pricing not documented in the fetched pages. Scale Tier is billed separately and does not count against Fast mode.                                     | S2, S6; pricing UNVERIFIED                                |
| `priority`  | Renamed **Fast mode** on 2026-07-30. Same behaviour as `fast` for supported models.                                                                                                            | S6, S2, SECONDARY (search snippet of the openai.com page) |
| `fast`      | Fast mode opt-in on the request.                                                                                                                                                               | S2, S6                                                    |
| `ultrafast` | Access-controlled. Currently only for `gpt-5.6-sol`.                                                                                                                                           | S2                                                        |

- Project default: Settings > General > Project Service Tier. Requests without `service_tier` use it; per-request values override. [S6]
- What the response reports: the response `service_tier` shows the mode actually used, which can differ from the request. For GPT-5.6 and earlier, a request for `fast` or `priority` returns `priority`. A request downgraded under the ramp-rate limit returns `service_tier: "default"` and is charged standard rates. [S2, S6]
- SECONDARY: a LiteLLM test reported `fast` as the returned value for some GPT-6 models. Verify on the live model. [search snippet, secondary]

### Pricing multipliers

| Tier                                    | Multiplier vs standard                                                        | Source  |
| --------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| Batch                                   | 50% of standard (input, cached, output)                                       | S7, S13 |
| Flex                                    | Same as Batch: 50% of standard (e.g. gpt-6-astra flex $5.00 / $0.50 / $25.00) | S5, S7  |
| Fast (priority)                         | Roughly 2x standard on most models; gpt-5.5 is 2.5x. See table below.         | S6, S7  |
| Scale                                   | UNVERIFIED (not on the pricing page)                                          | S7      |
| Regional processing / FedRAMP endpoints | +10% uplift on eligible models                                                | S7      |
| Prompts over 272K input tokens          | 2x input and cache rates, 1.5x output, for the full request (gpt-6-astra)     | S10     |

Fast-mode prices (per 1M; input / cached / output):

| Model                   | Fast price                                       | Standard             | Source                                                       |
| ----------------------- | ------------------------------------------------ | -------------------- | ------------------------------------------------------------ |
| gpt-6-astra             | 20.00 / 2.00 / 100.00                            | 10.00 / 1.00 / 50.00 | S7                                                           |
| gpt-6-astra (Ultrafast) | 60.00 / - / 300.00                               | -                    | S7                                                           |
| gpt-6.1-sol             | 4.00 / 0.20 / 20.00                              | 2.00 / 0.10 / 10.00  | S7                                                           |
| gpt-5.6-sol             | 8.00 / 0.80 / 40.00 (long context 16.00 / 60.00) | 4.00 / 0.40 / 20.00  | S6, S7                                                       |
| gpt-5.6-terra           | 4.25 / 2.125 / 17.00                             | 2.00 / 0.20 / 12.00  | search snippet of openai.com page, SECONDARY; cross-check S7 |
| gpt-5.5                 | 12.50 / 1.25 / 75.00                             | 5.00 / 0.50 / 30.00  | S7                                                           |
| gpt-5.4                 | 5.00 / 0.50 / 30.00                              | 2.50 / 0.25 / 15.00  | S7                                                           |
| gpt-5.2                 | 3.50 / 0.35 / 28.00                              | 1.75 / 0.175 / 14.00 | S7                                                           |
| gpt-5                   | 2.50 / 0.25 / 20.00                              | 1.25 / 0.125 / 10.00 | S7                                                           |

Fast-mode terms (S6): Fast and Standard share one rate limit per model. Ramp limit: once traffic reaches 1M input TPM, increase by no more than 50% every 15 min. Scale Tier is billed separately. Fast mode has no latency SLA on GPT-6 Astra. EU data residency is unavailable for GPT-6 Astra. Promotional GPT-5.6 Sol pricing is valid "at least through November 21, 2026" (S7). Fast mode is unavailable for fine-tuned models and embeddings (S6).

### `text.verbosity`

- Allowed: `"low" | "medium" | "high"`, default `"medium"`. Lives at `text.verbosity`. [S2, S15]
- Changing it breaks the prompt cache. [S1]

### `max_output_tokens`

- Optional number or null. Upper bound on generated tokens, counting visible output and reasoning tokens. [S2]
- When the limit is hit, the response has `status: "incomplete"` with `incomplete_details.reason: "max_output_tokens"`. [S2 (reference summary), S15]
- SECONDARY gotcha: an incomplete response can contain reasoning items but no message item, so `output_text` is empty while `usage.output_tokens` is non-zero. [community report, secondary]

### Batch API (one line)

Batch: 50% discount vs synchronous calls, completion window `24h` only, `/v1/responses` supported, up to 50,000 requests and 200 MB per input file. [S13]

---

## 3. Errors and rate limits

### HTTP status codes (S3 official table)

| HTTP | Documented meaning                                                               | error.code / type given                                       | Our kind                       |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| 400  | Requested or resolved `service_tier` not allowed for the project                 | type `invalid_request_error`, param `service_tier`            | invalid_request                |
| 400  | Input exceeds context window (only when `truncation` is `disabled`, the default) | code not confirmed on official pages (see below)              | context_overflow               |
| 401  | Invalid auth, incorrect API key, no org membership, IP not on allowlist          | no code string listed                                         | auth                           |
| 403  | Unsupported country, region or territory                                         | no code string listed                                         | auth (note: permission-type)   |
| 404  | Not listed in the official error table                                           | UNVERIFIED                                                    | not_found                      |
| 429  | Rate limit, slow-down ramp, credit exhaustion, spend or usage limit              | see table below                                               | rate_limited or quota_exceeded |
| 500  | Server-side error; retry after a brief wait                                      | no code string listed                                         | provider_error                 |
| 503  | Model temporarily overloaded                                                     | type `service_unavailable_error`, code `server_is_overloaded` | overloaded                     |
| 529  | Not listed in the official error table                                           | UNVERIFIED                                                    | overloaded (if seen)           |

Sources: S3 (status table), S4 (429/503 details), S5 (flex 429 Resource Unavailable).

### Error body shape

- Official pages name `error.type`, `error.code`, `error.param` and `error.message`. A full JSON example is not shown. [S3]
- The Responses `error` object (on failed responses) has a `code` (union below, S15 `ResponseError`). An official reference search snippet also shows a `message` field (S2, SECONDARY). Exact shape UNVERIFIED.

### 429 distinctions (required for the gateway)

- Rate limited (`rate_limited`): 429 with `error.code` `slow_down` (type `rate_limit_error`). Also 429 "Rate limit reached for requests" with no code string given. Retry after `Retry-After` with backoff and jitter. [S3, S4]
- Quota (`quota_exceeded`): 429 with `error.code` one of `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded`. Retrying does not restore access; add credit or raise the limit first. [S3]
- `insufficient_quota`: the official billing note says `error.type` "can still be" `insufficient_quota` and to check `error.code`. A forum report shows it on a 429. Treat as quota_exceeded. [S3, SECONDARY for the 429 example]
- Rule: branch on `error.code`, not the HTTP status alone. [S4 says the same]

### Known error codes table

| Code / type                                          | HTTP | Documented?                                                                                                     | Maps to          |
| ---------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| `invalid_request_error` (type)                       | 400  | Yes, S3                                                                                                         | invalid_request  |
| `slow_down` (type `rate_limit_error`)                | 429  | Yes, S3                                                                                                         | rate_limited     |
| `credit_balance_exhausted`                           | 429  | Yes, S3                                                                                                         | quota_exceeded   |
| `organization_spend_limit_exceeded`                  | 429  | Yes, S3                                                                                                         | quota_exceeded   |
| `project_spend_limit_exceeded`                       | 429  | Yes, S3                                                                                                         | quota_exceeded   |
| `organization_usage_limit_exceeded`                  | 429  | Yes, S3                                                                                                         | quota_exceeded   |
| `insufficient_quota`                                 | 429  | Partial (named as a possible type), S3                                                                          | quota_exceeded   |
| `service_unavailable_error` / `server_is_overloaded` | 503  | Yes, S3                                                                                                         | overloaded       |
| `invalid_api_key`                                    | 401  | UNVERIFIED: the 401 row lists no code string                                                                    | auth             |
| `rate_limit_exceeded`                                | 429  | UNVERIFIED as an HTTP error code. It appears as a _failed-response_ code (below)                                | rate_limited     |
| `context_length_exceeded`                            | 400  | UNVERIFIED on official pages. Reported in a community thread with type `invalid_request_error` (S17, SECONDARY) | context_overflow |
| `model_not_found`                                    | 404  | UNVERIFIED                                                                                                      | not_found        |
| `server_error`                                       | 500  | UNVERIFIED as an HTTP code. It appears as a _failed-response_ code (below)                                      | provider_error   |

### Failed-response error codes (`status: "failed"`, `error.code`)

The full union from the SDK type (S15, `ResponseError.code`). Official reference summary confirms `invalid_prompt`, `vector_store_timeout` and the image codes (S2 via search snippet).

| `error.code`                                                                                                                                                                                                                                                                                          | Suggested kind                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `server_error`                                                                                                                                                                                                                                                                                        | provider_error                                                                   |
| `rate_limit_exceeded`                                                                                                                                                                                                                                                                                 | rate_limited                                                                     |
| `invalid_prompt`                                                                                                                                                                                                                                                                                      | invalid_request (use context_overflow if the message says the input is too long) |
| `vector_store_timeout`                                                                                                                                                                                                                                                                                | timeout                                                                          |
| `data_residency_mismatch`                                                                                                                                                                                                                                                                             | invalid_request (SDK only; not on official error page)                           |
| `bio_policy`, `misalignment_policy_violation`, `image_content_policy_violation`                                                                                                                                                                                                                       | invalid_request, flagged as a policy refusal (SDK only)                          |
| `invalid_image`, `invalid_image_format`, `invalid_base64_image`, `invalid_image_url`, `image_too_large`, `image_too_small`, `image_parse_error`, `invalid_image_mode`, `image_file_too_large`, `unsupported_image_media_type`, `empty_image_file`, `failed_to_download_image`, `image_file_not_found` | invalid_request (SDK only, image-related)                                        |

The gateway's kind mapping for these codes is our decision, not an OpenAI mapping.

### `incomplete_details.reason`

- Official reference (via S2 search snippet): `max_output_tokens` or `content_filter`.
- SDK (S15): `"max_output_tokens" | "max_messages" | "content_filter" | "steered"`. `max_messages` and `steered` are not on the official summary and are UNVERIFIED on official docs.
- Suggested handling: `max_output_tokens` is a truncated success (surface as incomplete, not an error). `content_filter` maps to provider_error or a refusal kind. The gateway should decide whether an incomplete response is an invalid_response.

### Response `status` values

`completed | failed | in_progress | cancelled | queued | incomplete` (S2 summary, S15 doc comment).

### Rate-limit tiers (S4, standard limits)

| Tier   | Qualification (credit purchases) | Monthly usage limit | Model group       | RPM    | TPM         |
| ------ | -------------------------------- | ------------------- | ----------------- | ------ | ----------- |
| Free   | allowed geography                | $100                | -                 | -      | -           |
| Build  | $5                               | $500                | Astra, Sol, Terra | 5,000  | 1,000,000   |
| Build  | $5                               | $500                | Luna              | 5,000  | 2,000,000   |
| Launch | $100                             | $5,000              | Astra, Sol, Terra | 10,000 | 4,000,000   |
| Launch | $100                             | $5,000              | Luna              | 10,000 | 10,000,000  |
| Grow   | $500                             | $200,000            | Astra, Sol, Terra | 15,000 | 40,000,000  |
| Grow   | $500                             | $200,000            | Luna              | 30,000 | 180,000,000 |

Limits are per organization and project, vary by model, and long-context models have separate limits. Whichever of RPM/RPD/TPM/TPD/IPM is hit first applies. Hard spend limits return 429 on affected requests. [S4]

### Rate-limit response headers (S4)

- `Retry-After`: minimum seconds to wait, when present.
- `x-ratelimit-limit-requests`, `x-ratelimit-limit-tokens`
- `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`
- `x-ratelimit-reset-requests`, `x-ratelimit-reset-tokens`
- `x-ratelimit-limit-project-tokens`, `x-ratelimit-remaining-project-tokens`, `x-ratelimit-reset-project-tokens`

`x-request-id`: described in OpenAI's API docs as a troubleshooting identifier (search snippet, SECONDARY). It is not in the rate-limit guide. Exact doc location and SDK accessor UNVERIFIED. The SDK exposes it on response objects.

### Retry guidance (S4, S5)

- Follow `Retry-After` when present; otherwise exponential backoff with jitter.
- `slow_down`: once traffic reaches 1M input TPM, raise it by no more than 50% every 15 min.
- Unsuccessful requests count toward per-minute limits; rapid resending does not help.
- The official Python SDK maps 429 to `RateLimitError` and 503 to `InternalServerError`. [S3]
- SDK timeouts: default 10 min with the official SDK; SDKs retry 408 twice. [S5]

### Mapping to our kinds (summary)

| Kind                              | Source                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| invalid_request                   | 400 (non-context), `invalid_prompt`, image codes, `invalid_request_error`                        |
| auth                              | 401, 403                                                                                         |
| rate_limited                      | 429 with `slow_down` or `rate_limit_exceeded` (and no billing code)                              |
| quota_exceeded                    | 429 with a billing or spend code, `insufficient_quota`                                           |
| context_overflow                  | 400 context error (`context_length_exceeded` UNVERIFIED), `invalid_prompt` with a length message |
| not_found                         | 404 (UNVERIFIED for OpenAI)                                                                      |
| overloaded                        | 503 `server_is_overloaded`; 529 (UNVERIFIED); flex 429 `Resource Unavailable` (our choice)       |
| provider_error                    | 500, `server_error`, `content_filter`, policy codes (our choice)                                 |
| invalid_response                  | Successful HTTP body we cannot parse; `incomplete` responses when full output is required        |
| network_error, timeout, cancelled | Client-side. `vector_store_timeout` is the only provider-side timeout code seen.                 |

---

## 4. Input content

### Message content types (Responses)

- `input_text`, `input_image`, `input_file` are the three members of the `ResponseInputContent` union. [S15]
- `input_audio`: `ResponseInputAudio` exists in the SDK types (`input_audio.data` base64, `format: "mp3" | "wav"`) but is **not** a member of the `ResponseInputContent` union. Treat audio input as unsupported in Responses user content. Official docs UNVERIFIED. [S15]
- Message roles accepted: `user`, `assistant`, `system`, `developer`. [S2]

### `input_image`

| Field                       | Detail                                                                      | Source   |
| --------------------------- | --------------------------------------------------------------------------- | -------- |
| `image_url`                 | Fully qualified HTTPS URL or base64 data URL (`data:image/jpeg;base64,...`) | S11, S15 |
| `file_id`                   | Files API upload with `purpose: "vision"`                                   | S11      |
| `detail`                    | `low`, `high`, `auto` (default), `original`. Support varies by model.       | S11, S15 |
| Formats                     | PNG, JPEG (`.jpeg`/`.jpg`), WEBP, non-animated GIF                          | S11      |
| Images per request          | Up to 1,500                                                                 | S11      |
| Payload per request         | Up to 512 MB total                                                          | S11      |
| Patches per image           | Up to 30,000 after resizing; larger images are rejected, not resized        | S11      |
| Max dimension               | 65,535 px on GPT-6 Astra at `high`/`original`                               | S11      |
| `original` not supported on | gpt-5.2, gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini                         | S11      |
| `auto` behaviour            | Astra: matches `original`; gpt-5.4: matches `high`                          | S11      |

Token cost (S11):

- Patch models (e.g. gpt-6-astra): `patch_count = ceil(w/32) * ceil(h/32)`; scale down if over the patch budget; billable tokens = `ceil(patch_count * multiplier)`, multiplier 1.2 for Astra. A 1024x1024 image at `high` costs 1,229 tokens.
- Tile models (gpt-4o, gpt-4.1): 85 base tokens + 170 per 512 px tile; images fit in 2048x2048 with the short side scaled to 768 px.

### `input_file`

| Field               | Detail                                                                                                                                                    | Source   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `file_id`           | Files API upload with `purpose: "user_data"`                                                                                                              | S12      |
| `file_url`          | External HTTPS URL                                                                                                                                        | S12, S15 |
| `file_data`         | Base64 data URI (`data:application/pdf;base64,...`) plus `filename`                                                                                       | S12, S15 |
| Types (Responses)   | PDF; DOC/DOCX/RTF/ODT; PPT/PPTX; CSV/XLS/XLSX; TXT, MD, JSON, HTML, XML and many code formats. Non-PDF types are Responses-only.                          | S12      |
| Size                | Each file under 50 MB; combined 50 MB per request                                                                                                         | S12      |
| Pages / tokens      | No maximum stated                                                                                                                                         | S12      |
| Spreadsheets        | First 1,000 rows per sheet                                                                                                                                | S12      |
| `detail` (PDF only) | `auto` (default), `low`, `high`. `auto` = high on GPT-5.6+, low on earlier models. Affects page-image processing only; extracted text is always included. | S12      |
| Non-PDF             | Embedded images and charts are not extracted; the docs recommend converting to PDF                                                                        | S12      |

### `function_call_output.output`

- SDK type: `string | ResponseFunctionCallOutputItemList`. [S15]
- Docs: the output "should typically be a string"; for functions that return images or files, an array of image or file objects can be passed instead. [S14]
- Member types and their fields (`ResponseInputTextContent`, `ResponseInputImageContent`, `ResponseInputFileContent`) were not found in the SDK slices read. UNVERIFIED whether `input_text` is allowed in the array. Re-check the SDK at the pinned version before relying on it.

---

## 5. Current models for the catalog

### Models with verified specs (S10)

Context window = total; max input is stated where the page gives it.

| Model id        | Context   | Max input | Max output | Knowledge cutoff | Input       | Output | Reasoning effort (default)                                                 | Endpoints                                                          | Snapshot / alias                        |
| --------------- | --------- | --------- | ---------- | ---------------- | ----------- | ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| `gpt-6-astra`   | 1,050,000 | 922,000   | 128,000    | Apr 30, 2026     | text, image | text   | low, medium, high, xhigh, max (default not stated)                         | Responses, Chat Completions, Batch                                 | snapshot `gpt-6-astra` only             |
| `gpt-6.1-sol`   | 1,050,000 | 922,000   | 128,000    | Apr 30, 2026     | text, image | text   | low, medium, high, xhigh, max (medium); `none` and `minimal` not supported | Responses, Chat (no tool calling), Batch                           | snapshot `gpt-6.1-sol`                  |
| `gpt-6-luna`    | 1,050,000 | 922,000   | 128,000    | May 18, 2026     | text, image | text   | none, low, medium, high, xhigh, max (medium)                               | Responses, Chat (function calling only when effort is none), Batch | snapshot `gpt-6-luna`                   |
| `gpt-6-sol`     | 1,050,000 | 922,000   | 128,000    | Apr 20, 2026     | text, image | text   | none, low, medium, high, xhigh, max (medium)                               | Responses, Chat (function calling only when effort is none), Batch | snapshot `gpt-6-sol`                    |
| `gpt-5.6-sol`   | 1,050,000 | 922,000   | 128,000    | Feb 16, 2026     | text, image | text   | none, low, medium, high, xhigh, max (medium)                               | Responses, Chat, Batch                                             | snapshot `gpt-5.6-sol`; alias `gpt-5.6` |
| `gpt-5.6-terra` | 1,050,000 | 922,000   | 128,000    | Feb 16, 2026     | text, image | text   | none, low, medium, high, xhigh, max (medium)                               | Responses, Chat, Batch                                             | snapshot `gpt-5.6-terra`                |
| `gpt-5.6-luna`  | 1,050,000 | 922,000   | 128,000    | Feb 16, 2026     | text, image | text   | none, low, medium, high, xhigh, max (medium)                               | Responses, Chat, Batch                                             | snapshot `gpt-5.6-luna`                 |
| `gpt-5.5`       | 1,050,000 | -         | 128,000    | Dec 1, 2025      | text, image | text   | none, low, medium (default), high, xhigh                                   | Responses, Chat, Batch                                             | snapshot `gpt-5.5-2026-04-23`           |
| `gpt-5.4`       | 1,050,000 | -         | 128,000    | Aug 31, 2025     | text, image | text   | none (default), low, medium, high, xhigh                                   | Responses, Chat, Batch                                             | snapshot `gpt-5.4-2026-03-05`           |
| `gpt-5.4-mini`  | 400,000   | 272,000   | 128,000    | Aug 31, 2025     | text, image | text   | none (default), low, medium, high, xhigh                                   | Responses, Chat, Batch                                             | snapshot `gpt-5.4-mini-2026-03-17`      |
| `gpt-4.1`       | 1,047,576 | -         | 32,768     | Jun 1, 2024      | text, image | text   | not a reasoning model                                                      | Responses, Chat, Assistants, Batch, Fine-tuning                    | snapshot `gpt-4.1-2025-04-14`           |

Sources: S10 for each row (URL pattern `https://developers.openai.com/api/docs/models/{id}`). Flagship summary also in S8 and S9.

Unverified specs: the model pages for gpt-5.2, gpt-5.2-pro, gpt-5.5-pro, gpt-5.4-pro, gpt-5, gpt-5-mini, gpt-5-nano, gpt-5-pro, gpt-4.1-mini, gpt-4o, gpt-4o-mini, o3, o3-pro were not fetched. Their context and max-output values are UNVERIFIED.

### Other current text/reasoning models on the catalog (S9)

From the all-models catalog: `gpt-5.5-pro`, `gpt-5.4-pro`, `gpt-5.2`, `gpt-5.2-pro`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-pro`, `gpt-5.6-cyber` (restricted cyber model, not general), `o3`, `o3-pro`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`, and open-weight `gpt-oss-120b` / `gpt-oss-20b` (not priced on S7 and not checked against the Responses API).

Deprecated per catalog (do not add to new catalog entries): `gpt-5.4-nano`, `gpt-5.1`, `gpt-5.1-codex*`, `gpt-5.2-codex`, `gpt-5.3-codex`, `gpt-5-codex`, `gpt-5-chat-latest`, `o4-mini`, `o4-mini-deep-research`, `o3-mini`, `o1`, `o1-pro`, `o1-mini`, `gpt-4.5-preview`, `gpt-4.1-nano`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`, `chatgpt-4o-latest`, `computer-use-preview`, and others. [S9]

Aliases of note: `gpt-daybreak-red-latest`, `gpt-daybreak-blue-latest` (cyber safeguard aliases; deprecated list). [S9]

### Standard pricing, current text/reasoning models (per 1M, USD; S7)

| Model         | Input | Cached input | Output | Cache write | Long context >272K (in / cached / out) |
| ------------- | ----- | ------------ | ------ | ----------- | -------------------------------------- |
| gpt-6-astra   | 10.00 | 1.00         | 50.00  | 12.50       | 20.00 / 2.00 / 75.00                   |
| gpt-6.1-sol   | 2.00  | 0.10         | 10.00  | 2.50        | 4.00 / 0.20 / 15.00                    |
| gpt-6-luna    | 0.10  | 0.01         | 0.50   | 0.125       | 0.20 / 0.02 / 0.75                     |
| gpt-6-sol     | 2.00  | 0.20         | 10.00  | 2.50        | 4.00 / 0.40 / 15.00                    |
| gpt-5.6-sol   | 4.00  | 0.40         | 20.00  | 5.00        | 8.00 / 0.80 / 30.00                    |
| gpt-5.6-terra | 2.00  | 0.20         | 12.00  | 2.50        | 4.00 / 0.40 / 18.00                    |
| gpt-5.6-luna  | 0.20  | 0.02         | 1.20   | 0.25        | 0.40 / 0.04 / 1.80                     |
| gpt-5.5       | 5.00  | 0.50         | 30.00  | -           | 10.00 / 1.00 / 45.00                   |
| gpt-5.5-pro   | 30.00 | -            | 180.00 | -           | 60.00 / - / 270.00                     |
| gpt-5.4       | 2.50  | 0.25         | 15.00  | -           | 5.00 / 0.50 / 22.50                    |
| gpt-5.4-pro   | 30.00 | -            | 180.00 | -           | 60.00 / - / 270.00                     |
| gpt-5.4-mini  | 0.75  | 0.075        | 4.50   | -           | -                                      |
| gpt-5.2       | 1.75  | 0.175        | 14.00  | -           | -                                      |
| gpt-5.2-pro   | 21.00 | -            | 168.00 | -           | -                                      |
| gpt-5         | 1.25  | 0.125        | 10.00  | -           | -                                      |
| gpt-5-mini    | 0.25  | 0.025        | 2.00   | -           | -                                      |
| gpt-5-nano    | 0.05  | 0.005        | 0.40   | -           | -                                      |
| gpt-5-pro     | 15.00 | -            | 120.00 | -           | -                                      |
| o3            | 2.00  | 0.50         | 8.00   | -           | -                                      |
| o3-pro        | 20.00 | -            | 80.00  | -           | -                                      |
| gpt-4.1       | 2.00  | 0.50         | 8.00   | -           | -                                      |
| gpt-4.1-mini  | 0.40  | 0.10         | 1.60   | -           | -                                      |
| gpt-4o        | 2.50  | 1.25         | 10.00  | -           | -                                      |
| gpt-4o-mini   | 0.15  | 0.075        | 0.60   | -           | -                                      |

Notes:

- "-" means no price was listed on S7.
- S7 mentions GPT-5.6 Sol promotional pricing "at least through November 21, 2026" but the summary did not say which figures are promotional. The gpt-5.6-sol row above is the S7 table value; confirm on the live pricing page whether $4.00 is the promotional rate.
- Deprecated models priced on S7 (do not catalog as current): gpt-5.4-nano ($0.20/$0.02/$1.25), gpt-5.1 ($1.25/$0.125/$10.00), o4-mini ($1.10/$0.275/$4.40), o3-mini ($1.10/$0.55/$4.40), gpt-4.1-nano ($0.10/$0.025/$0.40).
- `gpt-oss-*` are not on S7 and UNVERIFIED for pricing.

---

## Open items / UNVERIFIED list

1. `invalid_api_key`, `model_not_found`, `context_length_exceeded`, `server_error` (as an HTTP code), `rate_limit_exceeded` (as an HTTP code), 529 status: not on the official error table. Re-check before mapping.
2. Scale tier multiplier and pricing: not documented in fetched pages.
3. `function_call_output` array member types: not found in SDK slices read.
4. `incomplete_details.reason` values `max_messages` and `steered` (SDK only).
5. Model specs (context, max output) for about 13 current models were not fetched.
6. Default `reasoning.effort` for gpt-6-astra: not stated on its page.
7. `x-request-id`: exact doc location and SDK accessor.
8. Fast-mode pricing for gpt-5.6-terra and gpt-5.4-mini: from a search snippet of openai.com (SECONDARY).
9. Whether input audio is accepted anywhere in the Responses API.
