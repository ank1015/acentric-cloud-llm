# Anthropic Messages API: live basics

Observed **2026-10-11/12** (server `date` header: 2026-10-11 ~20:16–20:40 GMT) against `https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, default model `claude-haiku-5-5`. Scope: message structure, inputs, parameters, errors, limits, headers. Thinking, caching, tools and cross-model replay are covered in a separate record. Credentials are redacted throughout; raw records (request, status, all response headers, full body) are in the scratchpad `anthropic-probe/basics/`, scripts in `anthropic-probe/scripts-basics/`. Approximate spend: ~$0.22 (one ~200K-token Haiku 4.5 request dominates).

Error kind column uses ours: `invalid_request`, `auth`, `rate_limited`, `quota_exceeded`, `context_overflow`, `policy_violation`, `not_found`, `overloaded`, `provider_error`.

## Summary

### Headers, auth, versions

| Question                                                                       | Observed                                                                                                                                                                                                                                                                                                                                                                                                     | Adapter                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Response headers (001)                                                         | `request-id` (`req_011…`), `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}` (reset is RFC 3339), `anthropic-organization-id`, `anthropic-workspace-id`, `traceresponse`, Cloudflare `cf-ray`. Errors add `x-should-retry: false`; no `retry-after` seen. `count_tokens` and `GET /v1/models` carry **no** rate-limit headers; nor did the `prompt is too long` 400 | Take request id from the `request-id` header (the body's `request_id` is missing on 413/405) |
| `Authorization: Bearer <key>` (002)                                            | 200, works like `x-api-key`                                                                                                                                                                                                                                                                                                                                                                                  | Either works; we send `x-api-key`                                                            |
| Both `x-api-key` (valid) and a bogus Bearer (009)                              | 200; `x-api-key` wins                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                            |
| Bad key, either header (010/011); no auth (012)                                | 401 `authentication_error` "invalid x-api-key" (also for Bearer) / "x-api-key header is required"; `x-should-retry: false`                                                                                                                                                                                                                                                                                   | `auth`                                                                                       |
| Missing / old (`2023-01-01`) / unknown / garbage `anthropic-version` (003–006) | 400 `invalid_request_error`: "header is required" / "not allowed for this endpoint" / "is not a valid version"                                                                                                                                                                                                                                                                                               | `invalid_request`; always send `2023-06-01`                                                  |
| Unknown `anthropic-beta` value, alone or mixed with a valid one (007/008)      | 400 "Unexpected value(s) `banana-…` for the `anthropic-beta` header" — whole request rejected                                                                                                                                                                                                                                                                                                                | Never forward unvetted beta names; `invalid_request`                                         |

### Message structure

| Question                                                                                     | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Adapter                                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| First message `assistant` (020)                                                              | 200                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass through                                                                        |
| Two consecutive `user` / `assistant` messages (021/022)                                      | 200; merged server-side                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Pass through (or merge ourselves)                                                   |
| `messages: []` (023)                                                                         | 400 "at least one message is required"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Refuse early / `invalid_request`                                                    |
| User content `""` or `[]` (024/028)                                                          | 400 "user messages must have non-empty content"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Refuse                                                                              |
| Empty text block / whitespace-only text (string or block) (025–027)                          | 400 "text content blocks must be non-empty" / "must contain non-whitespace text"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Refuse; never emit empty or whitespace-only text blocks                             |
| Assistant content `""` or `[]` **mid-conversation** (029, 066, 071)                          | 200; turn kept (count_tokens 20 vs 17 for merged user-user)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pass through, or drop the turn ourselves                                            |
| Whitespace-only assistant mid-conversation (041)                                             | 400 non-whitespace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Refuse / strip                                                                      |
| **Final assistant `""` or `[]`** on a no-prefill model (064/065) and on Haiku 4.5 (063, 070) | 200, **silently ignored** (same input tokens as no prefill)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Silent drop: strip it ourselves (harmless) or refuse                                |
| Prefill (final assistant text) (040, 060)                                                    | Accepted: `claude-haiku-4-5-20251001`, `claude-opus-4-5-20251101`. Rejected 400 "This model does not support assistant message prefill. The conversation must end with a user message.": `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-opus-4-6`, `claude-sonnet-4-6`                                                                                                                                                                                                                                                                                                                                                                                               | Per-model capability; refuse prefill on 4.6+                                        |
| Prefill with trailing space / newline (061/062)                                              | 400 "final assistant content cannot end with trailing whitespace"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Refuse (or rstrip, but that changes output)                                         |
| `role: "system"` as **first** message (030)                                                  | 400 "use the top-level 'system' parameter for the initial system prompt; the directive-only form (content: [] with output_config) is accepted at any position"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Map leading system messages to top-level `system`                                   |
| `role: "system"` mid-conversation (042–054, 260/261)                                         | **Native** on newer models. Placement rules: must follow a `user` (or an assistant ending in a server tool result) — else 400 "messages.N: role 'system' must follow a 'user' message or an 'assistant' message ending in a server tool result; …"; and must precede an `assistant` or end the array — else 400 "messages.N: role 'system' must precede an 'assistant' message or end the array; …". Valid: `user, system, assistant, user` (054, French answer) and `user, system` (044). Content: text, `tool_addition`, `tool_removal` only (047: "role 'system' supports text, tool_addition, and tool_removal blocks only"); `[]` → "system content must contain at least one block" | Emit only in valid positions; refuse other placements before sending                |
| Which models accept mid-conversation system (050/051/056/057/260)                            | Accept: `claude-haiku-5-5`, `claude-sonnet-5`. Reject 400 "role 'system' is not supported on this model": `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-7`. **Placement is validated before model support** (261: misplaced system on Opus 4.7 gets the placement error, not the unsupported-model one)                                                                                                                                                                                                                                                                                                               | Capability flag per model; refuse on older models (or fold into top-level `system`) |
| `output_config` on a system message (055)                                                    | 400 "messages.2.output_config: Extra inputs are not permitted" despite the hint in the error text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Don't emit                                                                          |
| `role: "developer"` / `"tool"` (031/039)                                                     | 400 "Unexpected role … Allowed roles are "user", "assistant" or "system""                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Refuse                                                                              |
| `system` string vs blocks (032/033)                                                          | Both work; multiple blocks honored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass through                                                                        |
| `system: ""` / `system: []` (034/035)                                                        | 200, identical to no system (13 input tokens)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Treat as absent (omit)                                                              |
| `system: [{text:""}]`, `system: "  "`, `system: null`, image block in system (036–038, 100)  | 400 (non-empty / non-whitespace / "Input should be a valid array" / "Input should be 'text'")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Refuse; never send `null`                                                           |
| Default thinking on Haiku 5.5 (044, 053)                                                     | Adaptive thinking is on by default; with small `max_tokens` the response can be only `[{type:"thinking", thinking:"", signature}]`, `stop_reason: max_tokens`, no text (`thinking_tokens` = all output)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Expect empty-text `max_tokens` results; budget `max_tokens` accordingly             |

### Unknown fields and types

| Question                                                                                                                                                                 | Observed                                                                                                                                       | Adapter                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Unknown top-level field / misspelling (`banana`, `temprature`, `stop`, `max_completion_tokens`) (080–083)                                                                | 400 "<path>: Extra inputs are not permitted"                                                                                                   | **Strict** — nothing is silently ignored; `invalid_request` with the path |
| Unknown field in message (`name`), text block, image source, metadata (084/085/103/104)                                                                                  | 400 with full path, e.g. `messages.0.content.0.text.banana`                                                                                    | Same                                                                      |
| Replay `citations: null` / `[]` on text; `cache_control: null` (086/087/089)                                                                                             | 200                                                                                                                                            | Safe to replay as returned                                                |
| Replay a whole response message (`id`, `type`, `model`, `stop_reason`) (088)                                                                                             | 400 `messages.1.id: Extra inputs…`                                                                                                             | Strip to `{role, content}`                                                |
| Unknown block type (090)                                                                                                                                                 | 400 lists accepted tags, incl. undocumented `mid_conv_system`, `connector_text`, `tool_search_tool_result`, `container_upload`                 | —                                                                         |
| Wrong types: `max_tokens` `"16"`, `16.0`, `16.5`; temperature `"0.5"`; content number; messages object; stop_sequences string; system number; stream `"false"` (091–101) | 400 "Input should be a valid integer/number/array/boolean". **`16.0` rejected.** `null` for optional fields (`temperature`, `system`) rejected | Serialize ints as ints; omit, never `null`                                |
| `model` missing / `""` (102, 210-EMPTY)                                                                                                                                  | 400 "Field required" / "String should have at least 1 character"                                                                               | Refuse                                                                    |
| Body content-type `text/plain` (244)                                                                                                                                     | 200 (body parsed as JSON anyway)                                                                                                               | —                                                                         |
| Duplicate JSON keys (245)                                                                                                                                                | Last wins                                                                                                                                      | —                                                                         |

### Parameters

| Question                                                                                    | Observed                                                                                                                                                                                                                                                                                                                                                              | Adapter                                                       |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `max_tokens` missing / negative (110/112)                                                   | 400 "Field required" / "must be greater than or equal to 0"                                                                                                                                                                                                                                                                                                           | Always send                                                   |
| `max_tokens: 0` (111)                                                                       | **200**, `content: []`, `stop_reason: max_tokens`, `output_tokens: 0`, input billed                                                                                                                                                                                                                                                                                   | Refuse 0 (useless, billed)                                    |
| `max_tokens` above model max (113/114)                                                      | 400 "max_tokens: 128001 > 128000, which is the maximum allowed number of output tokens for claude-haiku-5-5" (Haiku 4.5: 64000)                                                                                                                                                                                                                                       | Clamp or refuse from catalog                                  |
| `temperature` 1.5 / 2.1 / −0.1 (116–118, 125)                                               | 400 "temperature: range: 0..1"                                                                                                                                                                                                                                                                                                                                        | Range is **0..1**, not 0..2                                   |
| `temperature` on 4.7+ (`haiku-5-5`, `sonnet-5-5`, `opus-5-5`, `opus-4-8`, `opus-4-7`) (127) | 400 "`temperature` is deprecated for this model." — **except `temperature: 1` is accepted** (128); `0` rejected                                                                                                                                                                                                                                                       | Refuse sampling params on these models                        |
| `temperature` alone on `sonnet-4-6`, `opus-4-6`, `haiku-4-5` (127)                          | 200                                                                                                                                                                                                                                                                                                                                                                   | Pass through                                                  |
| `temperature` + `top_p` (119/136)                                                           | `opus-4-6`, `haiku-4-5`, `sonnet-4-5`: 400 "`temperature` and `top_p` cannot both be specified for this model. Please use only one." (even 1 and 1). New models: deprecated error first                                                                                                                                                                               | Refuse the pair                                               |
| `top_p` on Haiku 5.5 (120/130/135)                                                          | 400 "`top_p` is deprecated for this model." (also for `top_p: 1`); `-1` → "`top_p` cannot be set to -1 for this model"; 1.5 → "range: 0..1"                                                                                                                                                                                                                           | Refuse                                                        |
| `top_k` on Haiku 5.5 (122–124, 134)                                                         | 5 and 0 → "`top_k` is deprecated"; **`-1` accepted** (sentinel); −5 → "range: -1..100,000,000"                                                                                                                                                                                                                                                                        | Refuse; `-1` is a no-op                                       |
| `top_p` / `top_k` on Opus 4.6, `top_k` on Haiku 4.5 (131/132/126/133)                       | 200                                                                                                                                                                                                                                                                                                                                                                   | Pass through                                                  |
| `stop_sequences` hit (140/141/147)                                                          | `stop_reason: "stop_sequence"`, `stop_sequence: "5"`; the matched text is **excluded** from content (`"1,2,3,4,"`); with several, the first to occur wins                                                                                                                                                                                                             | Map to our stop reason + matched sequence                     |
| `stop_sequences` `[""]`, `[" "]`, `[]`, 9000 entries (142–146)                              | 400 non-empty / non-whitespace; `[]` ok; 400 "stop_sequences: total length: 0..2,500"                                                                                                                                                                                                                                                                                 | Refuse empty/whitespace; enforce 2,500 chars total            |
| `metadata.user_id` (148–152)                                                                | Plain id ok; **email-looking value 400** "user_id appears to contain an email address. Please send a uuid or hash value instead."; >512 chars 400; `null` and `{}` ok                                                                                                                                                                                                 | Hash user ids; cap 512                                        |
| `service_tier` (153)                                                                        | `auto`, `standard_only` → 200 (`usage.service_tier: "standard"`); `priority`, `banana` → 400 "Input should be 'auto' or 'standard_only'"                                                                                                                                                                                                                              | Enum of two                                                   |
| `inference_geo` (154–157)                                                                   | `global`, `us` → 200, echoed in `usage.inference_geo`; `eu`/`banana` → 400 "must be one of ['global', 'us']"; Haiku 4.5 / Sonnet 4.5 → 400 "'<model>' does not support inference_geo." (Opus 4.6 ok). No price/usage change visible (same tokens; no cost field) — the only signal is `usage.inference_geo`. Old models report `usage.inference_geo: "not_available"` | Per-model flag; pricing multiplier must come from our catalog |

### Inputs

| Question                                                                                   | Observed                                                                                                                                                                                                                                                                                                  | Adapter                                                     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Image base64 PNG (160)                                                                     | 200 ("Red")                                                                                                                                                                                                                                                                                               | Pass through                                                |
| Image URL (161/169/170/171/173)                                                            | Google-hosted PNG 200. Wikimedia (and a 404 URL) → 400 "Unable to download the file. Please verify the URL and try again." (host blocks the fetcher); HTML page → 400 `…image.source.base64.data: The file format is invalid or unsupported`; `data:` URL in `url` → 400 "Only HTTPS URLs are supported." | `invalid_request`; convert `data:` URLs to base64 ourselves |
| Declared media type wrong (jpeg/webp for PNG bytes) (162/163)                              | 400 "The image was specified using the image/jpeg media type, but the image appears to be a image/png image"                                                                                                                                                                                              | Sniff and correct, or refuse                                |
| `image/bmp`, `image/svg+xml` (164/165)                                                     | 400 "Input should be 'image/jpeg', 'image/png', 'image/gif' or 'image/webp'"                                                                                                                                                                                                                              | Refuse others                                               |
| Garbage bytes / invalid base64 / `data:` prefix in base64 (166–168)                        | 400 "Could not process image" / "invalid base64 data"                                                                                                                                                                                                                                                     | Strip `data:` prefix                                        |
| Image in assistant turn (172)                                                              | 400 "'image' blocks are not permitted within assistant turns."                                                                                                                                                                                                                                            | Refuse                                                      |
| PDF base64 / PDF URL (180/181/196)                                                         | 200; 1-page PDF ≈ 1,580–1,630 input tokens (page image + text)                                                                                                                                                                                                                                            | Pass through                                                |
| Non-PDF bytes declared `application/pdf`; other doc media type (186/187)                   | 400 "The PDF specified was not valid." / "Input should be 'application/pdf'"                                                                                                                                                                                                                              | —                                                           |
| Plain-text document; `text/markdown` (182b/185)                                            | 200; `text/markdown` → 400 "Input should be 'text/plain'"                                                                                                                                                                                                                                                 | Map all text docs to `text/plain`                           |
| Document `title` + `context` (183b)                                                        | Both reach the model (it echoed "Memo 7                                                                                                                                                                                                                                                                   | Internal memo, trusted.")                                   | Pass through |
| `content`-source document; empty text document (188b/197b)                                 | 200 both                                                                                                                                                                                                                                                                                                  | —                                                           |
| Document in an **assistant** turn (195b, 199)                                              | **200**, tokens counted (86 vs 36 empty), model ignores it                                                                                                                                                                                                                                                | Refuse (images and search results are rejected there)       |
| Citations, text document (184)                                                             | `text.citations: [{type:"char_location", cited_text, document_index, document_title, start_char_index, end_char_index}]`                                                                                                                                                                                  | —                                                           |
| `search_result` block (193b/194c)                                                          | 200; with citations: `{type:"search_result_location", cited_text, source, title, search_result_index, start_block_index, end_block_index}`. In assistant turn → 400 "`search_result` blocks can only be in `user` messages"                                                                               | —                                                           |
| **search_result + citations overrides `thinking: disabled`** on Haiku 5.5 (194c, 200)      | Returns a thinking block (161–185 thinking tokens) despite `{"type":"disabled"}`; text-document citations do not. Haiku 4.5 unaffected                                                                                                                                                                    | Silent override — flag to the thinking work                 |
| `file` source with bogus id, with/without `anthropic-beta: files-api-2025-04-14` (189–191) | 404 `not_found_error` "File `file_…` not found." both ways (beta header not needed to reference). Malformed id `banana` → 400 "Invalid file source id"                                                                                                                                                    | `not_found` with param                                      |

### Errors and limits

| Question                                                                                              | Observed                                                                                                                                                                                                                                                                                | Adapter                                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Error body shape                                                                                      | `{"type":"error","error":{"type","message"},"request_id":"req_…"}`; `request-id` header equals `request_id`                                                                                                                                                                             | Parse `error.type`; id from header                                                                |
| Unknown model; retired (`claude-3-haiku-20240307`, `claude-2.1`, 3.5/3.7, Opus 4/4.1, Sonnet 4) (210) | All 404 `not_found_error` "model: <id>" — retired and unknown are indistinguishable. IDs are case-sensitive                                                                                                                                                                             | `not_found`                                                                                       |
| Model the key lacks access to                                                                         | Not found: every catalog model worked (incl. `claude-fable-5-1`) and unlisted names are plain 404                                                                                                                                                                                       | —                                                                                                 |
| Aliases (`claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-opus-4-5`) (210)                            | 200; response `model` is the **dated** id (`claude-haiku-4-5-20251001`)                                                                                                                                                                                                                 | Record returned model                                                                             |
| 413 (34 MB body) (248)                                                                                | 413, body **without** top-level `type` or `request_id`: `{"error":{"type":"request_too_large","message":"Request exceeds the maximum allowed size of 32 MB"}}`; `request-id` header present; 15 s (full upload)                                                                         | Pre-check 32 MB; `invalid_request`                                                                |
| Malformed / empty / non-object JSON (240–243)                                                         | 400 "The request body is not valid JSON: EOF while parsing a list at line 1 column 61" / "must be a JSON object, got list."                                                                                                                                                             | `invalid_request`                                                                                 |
| GET on `/v1/messages`, unknown path (246/247)                                                         | 405 from the edge with **no** `request-id` and no `request_id`; 404 "Not found"                                                                                                                                                                                                         | `provider_error` / `not_found`                                                                    |
| Context overflow (Haiku 4.5, 200K) (251/252)                                                          | 400 `invalid_request_error` "prompt is too long: 205024 tokens > 200000 maximum" (also at 200017). Error counts are **+16** vs `count_tokens` (205008)                                                                                                                                  | `context_overflow` by message match (`prompt is too long`)                                        |
| Input fits but input + `max_tokens` > window (254: 199,974 + 64)                                      | **200**, no validation; model ended on its own (`end_turn`, 32 tokens). `model_context_window_exceeded` not triggered (needs the output to actually fill the window)                                                                                                                    | Don't pre-reject input+max>window; map `model_context_window_exceeded` → length-type stop if seen |
| `count_tokens` (226–236, 250, 158)                                                                    | `{"input_tokens": N}` only. Does **not** enforce the window (205,008 → 200) or the prefill rule; rejects `max_tokens`, `temperature`, `metadata`, `service_tier`, `stop_sequences`, `stream`, `inference_geo` ("Extra inputs are not permitted"); accepts `system`, `tools`, `thinking` | Build a separate whitelist body                                                                   |
| `GET /v1/models/{id}` (220–224)                                                                       | Object with `id, display_name, created_at, line, max_input_tokens, max_tokens, capabilities{…}, lifecycle, deprecated_at, retires_at`; alias resolves to dated id; retired → 404; list has `data, has_more, first_id, last_id`                                                          | Catalog source                                                                                    |

### Response fields and stop reasons

| Question                                            | Observed                                                                                                                                                                                                                                                                                                                       | Adapter                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Top-level message fields (001)                      | `model, id, type, role, content, container, stop_reason, stop_sequence, stop_details, usage, diagnostics`                                                                                                                                                                                                                      | —                      |
| `usage`                                             | `input_tokens, cache_creation_input_tokens, cache_read_input_tokens, cache_creation{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}, output_tokens, output_tokens_details{thinking_tokens}, service_tier, inference_geo`. On Haiku/Sonnet/Opus 4.5: `output_tokens_details` **absent**, `inference_geo: "not_available"` | Treat both as optional |
| `container`, `stop_details`, `diagnostics`          | Present and `null` in every response here (all models)                                                                                                                                                                                                                                                                         | Optional, pass through |
| Stop reasons triggered                              | `end_turn`, `max_tokens` (incl. thinking-only output, and `max_tokens: 0`), `stop_sequence`. **Not triggered:** `refusal` (skipped by design), `model_context_window_exceeded` (see 254)                                                                                                                                       | —                      |
| Undocumented user block `mid_conv_system` (105/106) | `{type:"mid_conv_system", content:[…]}` accepted in user content (200)                                                                                                                                                                                                                                                         | Don't emit             |
| Sonnet 5.5 `thinking: {type:"disabled"}` (201)      | 400: 'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}…'                                                                                                                                                                                                         | For the thinking work  |

## Exchanges (269)

Request headers are shown only where they differ from the default (`x-api-key: <key>`, `anthropic-version: 2023-06-01`, `content-type: application/json`). Response headers are trimmed to `request-id`, `x-should-retry`, `retry-after`; full header sets are in probe 001 and in the raw files. Long strings, base64 and signatures are elided.

### 001-basic-text

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw4mY2D75r3pFzwM2JtY"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4mYMYsDu5mUQkjtMZ1",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 002-bearer-auth

`POST /v1/messages` → **200** · request headers: `{"authorization": "Bearer <key>"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw4n9brZEVMJpoCR5sr8"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4n9wCUYuVvCVNFX9dF",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 003-no-version

`POST /v1/messages` → **400** · request headers: `{"anthropic-version": "(omitted)"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4nEDAvdPiaeh7MPN1U"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "anthropic-version: header is required" },
  "request_id": "req_011Cfw4nEDAvdPiaeh7MPN1U"
}
```

### 004-old-version-2023-01-01

`POST /v1/messages` → **400** · request headers: `{"anthropic-version": "2023-01-01"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4nGKS8aRA6PjQKDChJ"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "anthropic-version: \"2023-01-01\" not allowed for this endpoint"
  },
  "request_id": "req_011Cfw4nGKS8aRA6PjQKDChJ"
}
```

### 005-unknown-version-2026-01-01

`POST /v1/messages` → **400** · request headers: `{"anthropic-version": "2026-01-01"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4nJWtjxZ546Bp7jG8Z"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "anthropic-version: \"2026-01-01\" is not a valid version"
  },
  "request_id": "req_011Cfw4nJWtjxZ546Bp7jG8Z"
}
```

### 006-garbage-version

`POST /v1/messages` → **400** · request headers: `{"anthropic-version": "banana"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4nLK38HJB1pZGxUkxd"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "anthropic-version: \"banana\" is not a valid version"
  },
  "request_id": "req_011Cfw4nLK38HJB1pZGxUkxd"
}
```

### 007-unknown-beta

`POST /v1/messages` → **400** · request headers: `{"anthropic-beta": "banana-2026-01-01"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4nNN54ppYheKCE8J2o"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Unexpected value(s) `banana-2026-01-01` for the `anthropic-b...<166 chars>"
  },
  "request_id": "req_011Cfw4nNN54ppYheKCE8J2o"
}
```

### 008-unknown-beta-plus-known

`POST /v1/messages` → **400** · request headers: `{"anthropic-beta": "files-api-2025-04-14,banana-2026-01-01"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4nQZ2WGnFHnk1TkMQh"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Unexpected value(s) `banana-2026-01-01` for the `anthropic-b...<166 chars>"
  },
  "request_id": "req_011Cfw4nQZ2WGnFHnk1TkMQh"
}
```

### 009-both-auth-headers

`POST /v1/messages` → **200** · request headers: `{"authorization": "Bearer <bogus-key>"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw4nSoD1o54MotQqiDEn"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4nTAHdSncA4hjyX4GE",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 010-bad-key

`POST /v1/messages` → **401** · request headers: `{"x-api-key": "<bogus>"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw4nXvHkDZRgpUYCvLKq", "x-should-retry": "false"}`

```json
{
  "type": "error",
  "error": { "type": "authentication_error", "message": "invalid x-api-key" },
  "request_id": "req_011Cfw4nXvHkDZRgpUYCvLKq"
}
```

### 011-bad-key-bearer

`POST /v1/messages` → **401** · request headers: `{"authorization": "Bearer <key>"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw4nZaWTQ5zNoitYdoMG", "x-should-retry": "false"}`

```json
{
  "type": "error",
  "error": { "type": "authentication_error", "message": "invalid x-api-key" },
  "request_id": "req_011Cfw4nZaWTQ5zNoitYdoMG"
}
```

### 012-no-auth

`POST /v1/messages` → **401** · request headers: `{"auth": "(none)"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4nbWLrb2tPowUKLrgk"}`

```json
{
  "type": "error",
  "error": { "type": "authentication_error", "message": "x-api-key header is required" },
  "request_id": "req_011Cfw4nbWLrb2tPowUKLrgk"
}
```

### 020-first-assistant

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "assistant", "content": "Hello, how can I help?" },
    { "role": "user", "content": "Say hi in two words." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4of5RtcM9P3N3qgKhb"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4ofSWSo6uzPggGFpfd",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 48,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 021-two-users

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "My name is Zed." },
    { "role": "user", "content": "What is my name? One word." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4ojqRaXHhkeFLcP7gL"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4okAkyhLx1hMmehk1R",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Zed" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 24,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 5,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 022-two-assistants

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Count." },
    { "role": "assistant", "content": "One." },
    { "role": "assistant", "content": "Two." },
    { "role": "user", "content": "Next number? One word." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4opDLpwPv1gC8hELyy"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4opZRqZVangWRQ2eV6",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Three." }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 28,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 5,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 023-empty-messages

`POST /v1/messages` → **400**

```json
{ "model": "claude-haiku-5-5", "max_tokens": 16, "messages": [] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4otqfQoBh5Cr5u6SS2"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: at least one message is required"
  },
  "request_id": "req_011Cfw4otqfQoBh5Cr5u6SS2"
}
```

### 024-empty-string-content

`POST /v1/messages` → **400**

```json
{ "model": "claude-haiku-5-5", "max_tokens": 16, "messages": [{ "role": "user", "content": "" }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4ovpUP7n2EKcaJhQNp"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0: user messages must have non-empty content"
  },
  "request_id": "req_011Cfw4ovpUP7n2EKcaJhQNp"
}
```

### 025-empty-text-block

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "" }] }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4oyCb3yPGwPc16uRwd"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: text content blocks must be non-empty"
  },
  "request_id": "req_011Cfw4oyCb3yPGwPc16uRwd"
}
```

### 026-whitespace-only

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "   \n " }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4p1NpAtsbzomx2W4QU"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: text content blocks must contain non-whitespace text"
  },
  "request_id": "req_011Cfw4p1NpAtsbzomx2W4QU"
}
```

### 027-whitespace-only-block

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "  " }] }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4p3UpQeTYFYnPSVhh7"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: text content blocks must contain non-whitespace text"
  },
  "request_id": "req_011Cfw4p3UpQeTYFYnPSVhh7"
}
```

### 028-empty-content-array

`POST /v1/messages` → **400**

```json
{ "model": "claude-haiku-5-5", "max_tokens": 16, "messages": [{ "role": "user", "content": [] }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4p5hWYZ2ASk3UD1jqC"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0: user messages must have non-empty content"
  },
  "request_id": "req_011Cfw4p5hWYZ2ASk3UD1jqC"
}
```

### 029-empty-text-in-middle-assistant

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "" },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4p7rkFg2RjjT4pETXF"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4p8B6V5HJfxxUZpVNY",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Ok." }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 20,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 030-system-role-in-messages

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "system", "content": "Be terse." },
    { "role": "user", "content": "Say hi." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4pCToU5KbdAENwEbuC"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0: use the top-level 'system' parameter for the ini...<164 chars>"
  },
  "request_id": "req_011Cfw4pCToU5KbdAENwEbuC"
}
```

### 031-developer-role

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "developer", "content": "Be terse." },
    { "role": "user", "content": "Say hi." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4pEiVbhxz6wm7K1HqC"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: Unexpected role \"developer\". Allowed roles are \"user\", \"assistant\" or \"system\""
  },
  "request_id": "req_011Cfw4pEiVbhxz6wm7K1HqC"
}
```

### 032-system-string

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "What is your name? One word." }],
  "system": "Your name is Quill."
}
```

Response headers: `{"request-id": "req_011Cfw4pGsyFKHKuF719uvBG"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4pHD48mcE8Vu6DMdb9",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Quill" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 25,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 5,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 033-system-blocks

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "What is your name? One word." }],
  "system": [
    { "type": "text", "text": "Your name is Quill." },
    { "type": "text", "text": "Answer in lowercase." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4pMWmZ6qAt6FbqacEt"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4pMqsaiVRDA743xzrk",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "quill" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 34,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 034-system-empty-string

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi." }],
  "system": ""
}
```

Response headers: `{"request-id": "req_011Cfw4pREFm3zRVQ2CWLFsB"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4pRa6c8zxYwVQhqxtm",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there! How can I help you today?" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 14,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 035-system-empty-array

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi." }],
  "system": []
}
```

Response headers: `{"request-id": "req_011Cfw4pVahrXxTs7AyKSgM6"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4pVvo1vcVNiMiA1JC4",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there! How can I help you today?" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 14,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 036-system-empty-block

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi." }],
  "system": [{ "type": "text", "text": "" }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4paFEdCH2fjQw323aH"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "system: text content blocks must be non-empty"
  },
  "request_id": "req_011Cfw4paFEdCH2fjQw323aH"
}
```

### 037-system-whitespace

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi." }],
  "system": "  "
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4pcPEQ8fKc8mEmt2bV"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "system: text content blocks must contain non-whitespace text"
  },
  "request_id": "req_011Cfw4pcPEQ8fKc8mEmt2bV"
}
```

### 038-system-image-block

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi." }],
  "system": [
    {
      "type": "image",
      "source": {
        "type": "url",
        "url": "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png"
      }
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4peagxt1np87Autxb9"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "system.0.type: Input should be 'text'" },
  "request_id": "req_011Cfw4peagxt1np87Autxb9"
}
```

### 039-unknown-role

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "tool", "content": "x" },
    { "role": "user", "content": "Say hi." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4pgo9HDtEJvBkGxfT4"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: Unexpected role \"tool\". Allowed roles are \"user\", ...<198 chars>"
  },
  "request_id": "req_011Cfw4pgo9HDtEJvBkGxfT4"
}
```

### 040-assistant-only

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "assistant", "content": "Hello" }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4pj25qaimY6scAhwD5"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support assistant message prefill. The conversation must end with a user message."
  },
  "request_id": "req_011Cfw4pj25qaimY6scAhwD5"
}
```

### 041-whitespace-only-assistant-middle

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "  " },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4pmG2p2Z6ULiiUmJEW"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: text content blocks must contain non-whitespace text"
  },
  "request_id": "req_011Cfw4pmG2p2Z6ULiiUmJEW"
}
```

### 042-system-mid-conversation

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": "From now on answer only in French." },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4qrkSvE2ReqxqQsWkw"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw4qrkSvE2ReqxqQsWkw"
}
```

### 043-system-after-user-before-user

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "system", "content": "Answer only with the word BANANA." },
    { "role": "user", "content": "What is 2+2?" }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4qu4Mfspwa2YUCvQf3"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1: role 'system' must precede an 'assistant' messag...<164 chars>"
  },
  "request_id": "req_011Cfw4qu4Mfspwa2YUCvQf3"
}
```

### 044-system-last

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "What is 2+2?" },
    { "role": "system", "content": "Answer only with the word BANANA." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4qwPVqCC4mCNfUUKiu"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4qwibmXd7audTWGZjs",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 28,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 16,
    "output_tokens_details": { "thinking_tokens": 16 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 045-system-mid-with-top-level

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "user", "content": "Say good morning." }
  ],
  "system": "You are terse."
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4r21ZWKsRm3Pq9kB4q"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw4r21ZWKsRm3Pq9kB4q"
}
```

### 046-system-mid-blocks

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": [{ "type": "text", "text": "Answer only in French." }] },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4r47pmxLbCAKc5FPZc"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw4r47pmxLbCAKc5FPZc"
}
```

### 047-system-mid-image

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    {
      "role": "system",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "url",
            "url": "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png"
          }
        }
      ]
    },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4r6PVXAkQbomj6UQ6J"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' supports text, tool_addition, and tool_removal blocks only"
  },
  "request_id": "req_011Cfw4r6PVXAkQbomj6UQ6J"
}
```

### 048-system-first-empty-directive

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "system", "content": [] },
    { "role": "user", "content": "Say hi." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4rAqP2hLanEztv2asB"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0: system content must contain at least one block"
  },
  "request_id": "req_011Cfw4rAqP2hLanEztv2asB"
}
```

### 049-system-mid-empty

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": [] },
    { "role": "user", "content": "Say hi." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4rD65QBvsFWuot3YZB"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: system content must contain at least one block"
  },
  "request_id": "req_011Cfw4rD65QBvsFWuot3YZB"
}
```

### 050-system-mid-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4rFJX9k1JB1ZNaGXUA"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw4rFJX9k1JB1ZNaGXUA"
}
```

### 051-system-mid-opus46

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4rHWEUUwaSshNBNboo"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw4rHWEUUwaSshNBNboo"
}
```

### 052-two-systems-consecutive

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "system", "content": "Answer in French." },
    { "role": "system", "content": "Answer in one word." },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4rLZXpC8inqnbJ1n5F"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must precede an 'assistant' messag...<164 chars>"
  },
  "request_id": "req_011Cfw4rLZXpC8inqnbJ1n5F"
}
```

### 053-system-last-200

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 200,
  "messages": [
    { "role": "user", "content": "What is 2+2?" },
    { "role": "system", "content": "Answer only with the word BANANA." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4sWVcMHmbx7H5p3ufx"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4sWrC5qkU15yt8Mgwf",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 28,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 200,
    "output_tokens_details": { "thinking_tokens": 200 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 054-system-between-user-assistant

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 200,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "assistant", "content": "Bonjour!" },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4sedkUSXn2cBEj6eGH"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4seyaZJ62Qyc3DG1Gf",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Bonjour ! Bonne journée !" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 36,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 16,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 055-system-directive-output-config

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 32,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": [], "output_config": { "effort": "low" } },
    { "role": "user", "content": "Say hi." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4sjGoYawSfrg6r3zct"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2.output_config: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw4sjGoYawSfrg6r3zct"
}
```

### 056-system-last-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 32,
  "messages": [
    { "role": "user", "content": "What is 2+2?" },
    { "role": "system", "content": "Answer only with the word BANANA." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4snV2CqiE95gDs7kf2"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "role 'system' is not supported on this model"
  },
  "request_id": "req_011Cfw4snV2CqiE95gDs7kf2"
}
```

### 057-system-last-sonnet45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 32,
  "messages": [
    { "role": "user", "content": "What is 2+2?" },
    { "role": "system", "content": "Answer only with the word BANANA." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4spN8a2xVMGsdPhcx9"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "role 'system' is not supported on this model"
  },
  "request_id": "req_011Cfw4spN8a2xVMGsdPhcx9"
}
```

### 058-system-last-thinking-disabled

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 32,
  "thinking": { "type": "disabled" },
  "messages": [
    { "role": "user", "content": "What is 2+2?" },
    { "role": "system", "content": "Answer only with the word BANANA." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4tvE9QPyMGWXPMVU2u"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4tvayPdRQPSRbbNgZK",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I can't do that one, since I'd be giving you a made-up answer instead of the real one. 2+2"
    }
  ],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 26,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 32,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 060-prefill-claude-haiku-4-5-20251001

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors as JSON array." },
    { "role": "assistant", "content": "[\"" }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4u72n4r8FG8a5RDLiT"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw4u7Z2AYx82MXBwzDPx",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Red\", \"Blue\", \"Yellow\"]" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 11,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 060-prefill-claude-haiku-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors as JSON array." },
    { "role": "assistant", "content": "[\"" }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4tzTdby4BGpXsxQ3iX"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support assistant message prefill. The conversation must end with a user message."
  },
  "request_id": "req_011Cfw4tzTdby4BGpXsxQ3iX"
}
```

### 060-prefill-claude-opus-4-5-20251101

`POST /v1/messages` → **200**

```json
{
  "model": "claude-opus-4-5-20251101",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors as JSON array." },
    { "role": "assistant", "content": "[\"" }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4uFDQ6Y2SsW4khg35H"}`

```json
{
  "model": "claude-opus-4-5-20251101",
  "id": "msg_011Cfw4uFXWFggEL3rKF5Wor",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "red\", \"yellow\", \"blue\"]" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 11,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 060-prefill-claude-opus-4-6

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors as JSON array." },
    { "role": "assistant", "content": "[\"" }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4u4sYmbJ6hTiXc8CEh"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support assistant message prefill. The conversation must end with a user message."
  },
  "request_id": "req_011Cfw4u4sYmbJ6hTiXc8CEh"
}
```

### 060-prefill-claude-opus-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors as JSON array." },
    { "role": "assistant", "content": "[\"" }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4uAqDuzb6py1LL9FNz"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support assistant message prefill. The conversation must end with a user message."
  },
  "request_id": "req_011Cfw4uAqDuzb6py1LL9FNz"
}
```

### 060-prefill-claude-sonnet-4-6

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors as JSON array." },
    { "role": "assistant", "content": "[\"" }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4uD1wGwAgj5RutSnSz"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support assistant message prefill. The conversation must end with a user message."
  },
  "request_id": "req_011Cfw4uD1wGwAgj5RutSnSz"
}
```

### 060-prefill-claude-sonnet-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors as JSON array." },
    { "role": "assistant", "content": "[\"" }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4u2f67VgZCx8Perhsw"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support assistant message prefill. The conversation must end with a user message."
  },
  "request_id": "req_011Cfw4u2f67VgZCx8Perhsw"
}
```

### 061-prefill-trailing-ws-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors as JSON array." },
    { "role": "assistant", "content": "Sure: " }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4uKqD7qgvU35w7BZoW"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: final assistant content cannot end with trailing whitespace"
  },
  "request_id": "req_011Cfw4uKqD7qgvU35w7BZoW"
}
```

### 062-prefill-trailing-newline-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "List three primary colors." },
    { "role": "assistant", "content": "Sure:\n" }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4uN6eCzs9EjfcEsxj4"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: final assistant content cannot end with trailing whitespace"
  },
  "request_id": "req_011Cfw4uN6eCzs9EjfcEsxj4"
}
```

### 063-prefill-empty-haiku45

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Say hi." },
    { "role": "assistant", "content": "" }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4uQKas4NuytB3NcTkj"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw4uQegYwhYd6spH2xWH",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi! 👋 How can I help you today?" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 10,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 16,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 064-empty-final-assistant-haiku55

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Say hi." },
    { "role": "assistant", "content": "" }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4vCFq7feyNDJMmPm6Y"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4vCcQLfLe77b6yzuHQ",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there! How can I help you today?" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 14,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 065-empty-final-assistant-blocks-haiku55

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Say hi." },
    { "role": "assistant", "content": [] }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4vHBFRZxSNamM9pkK3"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4vHTrQ4upeB4qZhy6r",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there! How can I help you today?" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 14,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 066-ct-user-assistant-empty-user

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "" },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4vN3vqio2BVBXdXFRo"}`

```json
{ "input_tokens": 20 }
```

### 067-ct-user-user

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4vPnc63QbtGZYhbwaY"}`

```json
{ "input_tokens": 17 }
```

### 068-ct-user-assistant-x-user

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "x" },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4vRdEz8hRKd53NapoF"}`

```json
{ "input_tokens": 21 }
```

### 069-ct-say-hi

`POST /v1/messages/count_tokens` → **200**

```json
{ "model": "claude-haiku-4-5-20251001", "messages": [{ "role": "user", "content": "Say hi." }] }
```

Response headers: `{"request-id": "req_011Cfw4vTbor7FKMkzGom1i3"}`

```json
{ "input_tokens": 10 }
```

### 070-ct-say-hi-empty-prefill

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "messages": [
    { "role": "user", "content": "Say hi." },
    { "role": "assistant", "content": "" }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4vVjYbbAhhrD8MgPz8"}`

```json
{ "input_tokens": 10 }
```

### 071-ct-assistant-empty-array-mid

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": [] },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4vbkhDie7g43TwTmdc"}`

```json
{ "input_tokens": 20 }
```

### 080-unknown-top-level

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "banana": 1
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4wj9UarXJuAMPs7YHm"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "banana: Extra inputs are not permitted" },
  "request_id": "req_011Cfw4wj9UarXJuAMPs7YHm"
}
```

### 081-misspelled-temperature

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temprature": 0.2
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4wm7YAKxwm9cS1GHp5"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "temprature: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw4wm7YAKxwm9cS1GHp5"
}
```

### 082-misspelled-stop

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "stop": ["x"]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4woLF11vo2v1em6Ws1"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "stop: Extra inputs are not permitted" },
  "request_id": "req_011Cfw4woLF11vo2v1em6Ws1"
}
```

### 083-openai-max-completion

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "max_completion_tokens": 5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4wqWDZjbSicRT7mHKh"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_completion_tokens: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw4wqWDZjbSicRT7mHKh"
}
```

### 084-unknown-field-in-text-block

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Say hi.", "banana": 1 }] }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4wsgw1CGQb7Zi9Uysv"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.text.banana: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw4wsgw1CGQb7Zi9Uysv"
}
```

### 085-unknown-field-in-message

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi.", "name": "bob" }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4wuuse1QVr8BmS8PTa"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.name: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw4wuuse1QVr8BmS8PTa"
}
```

### 086-replay-text-citations-null

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": [{ "type": "text", "text": "Hello!", "citations": null }] },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4wxPCL2dUc82cR3nvT"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4wxm2fCtfJUnjhthKK",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Ok." }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 24,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 087-replay-text-citations-empty

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": [{ "type": "text", "text": "Hello!", "citations": [] }] },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4x2uZLAd8ZokKeok3e"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4x3Fu7nUnfqfoUAtHv",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Ok." }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 24,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 088-replay-full-message-object

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "Hi" },
    {
      "role": "assistant",
      "id": "msg_x",
      "type": "message",
      "model": "claude-haiku-5-5",
      "stop_reason": "end_turn",
      "content": [{ "type": "text", "text": "Hello!" }]
    },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4x7iHTBpWNVBorf7J2"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.id: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw4x7iHTBpWNVBorf7J2"
}
```

### 089-cache-control-null-on-block

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": [{ "type": "text", "text": "Say hi.", "cache_control": null }] }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4x9cshtqn5YMmgCnpC"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4x9wyno19vBA95fPzz",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there! How can I help you today?" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 14,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 090-unknown-block-type

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": [{ "type": "banana", "text": "Say hi." }] }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xE4XADFfm6yamfN4r"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0: Input tag 'banana' found using 'type' ...<466 chars>"
  },
  "request_id": "req_011Cfw4xE4XADFfm6yamfN4r"
}
```

### 091-wrong-type-max-tokens-string

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": "16",
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xGAH9rmv6QKqqa6rV"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens: Input should be a valid integer"
  },
  "request_id": "req_011Cfw4xGAH9rmv6QKqqa6rV"
}
```

### 092-wrong-type-max-tokens-float

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16.0,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xJNEGNH5TqeFGJCUu"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens: Input should be a valid integer"
  },
  "request_id": "req_011Cfw4xJNEGNH5TqeFGJCUu"
}
```

### 093-wrong-type-max-tokens-float-frac

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16.5,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xLavok8Z2ntqgBTkr"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens: Input should be a valid integer"
  },
  "request_id": "req_011Cfw4xLavok8Z2ntqgBTkr"
}
```

### 094-wrong-type-temperature-string

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": "0.5"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xNp8rtcvaXTB83RBG"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "temperature: Input should be a valid number"
  },
  "request_id": "req_011Cfw4xNp8rtcvaXTB83RBG"
}
```

### 095-wrong-type-content-number

`POST /v1/messages` → **400**

```json
{ "model": "claude-haiku-5-5", "max_tokens": 16, "messages": [{ "role": "user", "content": 5 }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xR6J8bMv1wtEK4yk4"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content: Input should be a valid array"
  },
  "request_id": "req_011Cfw4xR6J8bMv1wtEK4yk4"
}
```

### 096-wrong-type-messages-object

`POST /v1/messages` → **400**

```json
{ "model": "claude-haiku-5-5", "max_tokens": 16, "messages": { "role": "user", "content": "hi" } }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xTszC1cksJnTZ9hNm"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: Input should be a valid array"
  },
  "request_id": "req_011Cfw4xTszC1cksJnTZ9hNm"
}
```

### 097-wrong-type-stop-sequences-string

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "stop_sequences": "x"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xVjMNyPNUcn5nSxmw"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "stop_sequences: Input should be a valid array"
  },
  "request_id": "req_011Cfw4xVjMNyPNUcn5nSxmw"
}
```

### 098-wrong-type-system-number

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "system": 5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xXtqTDyhbBdbYJqhq"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "system: Input should be a valid array" },
  "request_id": "req_011Cfw4xXtqTDyhbBdbYJqhq"
}
```

### 099-null-temperature

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": null
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xaBEynN6F2vYm9w32"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "temperature: Input should be a valid number"
  },
  "request_id": "req_011Cfw4xaBEynN6F2vYm9w32"
}
```

### 100-null-system

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "system": null
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xcRvrMVQEojoTgQyA"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "system: Input should be a valid array" },
  "request_id": "req_011Cfw4xcRvrMVQEojoTgQyA"
}
```

### 101-wrong-type-stream-string

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "stream": "false"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xebfJAtUXaokUMLBE"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "stream: Input should be a valid boolean"
  },
  "request_id": "req_011Cfw4xebfJAtUXaokUMLBE"
}
```

### 102-model-missing

`POST /v1/messages` → **400**

```json
{ "max_tokens": 16, "messages": [{ "role": "user", "content": "hi" }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xguZ4fDU2MFKBzukp"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "model: Field required" },
  "request_id": "req_011Cfw4xguZ4fDU2MFKBzukp"
}
```

### 103-unknown-field-in-image-source

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "hi" },
        {
          "type": "image",
          "source": {
            "type": "url",
            "url": "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png",
            "banana": 1
          }
        }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xjHgBnnUgTyRiQkcd"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.1.image.source.url.banana: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw4xjHgBnnUgTyRiQkcd"
}
```

### 104-metadata-unknown-field

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "metadata": { "banana": "x" }
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4xmLTaDViTiNt1xegi"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "metadata.banana: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw4xmLTaDViTiNt1xegi"
}
```

### 105-mid-conv-system-block-in-user

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 32,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Say good morning." },
        { "type": "mid_conv_system", "text": "Answer in French." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4yVsov4BczMJnZRUdh"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.1.mid_conv_system.content: Field required"
  },
  "request_id": "req_011Cfw4yVsov4BczMJnZRUdh"
}
```

### 106-mid-conv-system-block-content

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 32,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Say good morning." },
        { "type": "mid_conv_system", "content": [{ "type": "text", "text": "Answer in French." }] }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw4yY9EixZ5U3jKvfvLD"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4yYVaRsLyWh4G6rZFz",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 21,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 32,
    "output_tokens_details": { "thinking_tokens": 32 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 107-connector-text-block

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 32,
  "messages": [
    { "role": "user", "content": [{ "type": "connector_text", "text": "Say good morning." }] }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4yd7PPJMaR9wXu83G4"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.connector_text.connector_text: Field required"
  },
  "request_id": "req_011Cfw4yd7PPJMaR9wXu83G4"
}
```

### 110-max-tokens-missing

`POST /v1/messages` → **400**

```json
{ "model": "claude-haiku-5-5", "messages": [{ "role": "user", "content": "Say hi in two words." }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zHrnQYcJ21pPFT4GB"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "max_tokens: Field required" },
  "request_id": "req_011Cfw4zHrnQYcJ21pPFT4GB"
}
```

### 111-max-tokens-0

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 0,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw4zKmcvTvvrVtXRb6Qo"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4zLBBqH6SYkkbBumgn",
  "type": "message",
  "role": "assistant",
  "content": [],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 0,
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 112-max-tokens-negative

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": -1,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zPWMsVhQn4N6jv5Ud"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens: must be greater than or equal to 0"
  },
  "request_id": "req_011Cfw4zPWMsVhQn4N6jv5Ud"
}
```

### 113-max-tokens-128001

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 128001,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zRh4qPFj5JyiheZJy"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens: 128001 > 128000, which is the maximum allowed number of output tokens for claude-haiku-5-5"
  },
  "request_id": "req_011Cfw4zRh4qPFj5JyiheZJy"
}
```

### 114-max-tokens-64001-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 64001,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zUrZrxnceZsVLZ16M"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens: 64001 > 64000, which is the maximum allowed number of output tokens for claude-haiku-4-5-20251001"
  },
  "request_id": "req_011Cfw4zUrZrxnceZsVLZ16M"
}
```

### 115-max-tokens-1

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw4zWjgfCoC37EXbhj1w"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4zX9Vds8CMzuFE6aAh",
  "type": "message",
  "role": "assistant",
  "content": [],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 1,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 116-temperature-1.5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 1.5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zaa88e6uRE5j4YDWD"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "temperature: range: 0..1" },
  "request_id": "req_011Cfw4zaa88e6uRE5j4YDWD"
}
```

### 117-temperature-2.1

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 2.1
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zcpJdAvQjv9ty7iLR"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "temperature: range: 0..1" },
  "request_id": "req_011Cfw4zcpJdAvQjv9ty7iLR"
}
```

### 118-temperature-neg

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": -0.1
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zf9CCGZRijfbc8dR1"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "temperature: range: 0..1" },
  "request_id": "req_011Cfw4zf9CCGZRijfbc8dR1"
}
```

### 119-temp-and-top-p-claude-haiku-4-5-20251001

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5,
  "top_p": 0.9
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zpNqAbqBb2Drz4KoG"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` and `top_p` cannot both be specified for this model. Please use only one."
  },
  "request_id": "req_011Cfw4zpNqAbqBb2Drz4KoG"
}
```

### 119-temp-and-top-p-claude-haiku-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5,
  "top_p": 0.9
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zhTMnDSwKEmAWuqmd"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw4zhTMnDSwKEmAWuqmd"
}
```

### 119-temp-and-top-p-claude-opus-4-6

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5,
  "top_p": 0.9
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zn2Sp2iDZfxEH5nSJ"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` and `top_p` cannot both be specified for this model. Please use only one."
  },
  "request_id": "req_011Cfw4zn2Sp2iDZfxEH5nSJ"
}
```

### 119-temp-and-top-p-claude-sonnet-4-5-20250929

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5,
  "top_p": 0.9
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zrV5wSRyUDdVDzNWx"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` and `top_p` cannot both be specified for this model. Please use only one."
  },
  "request_id": "req_011Cfw4zrV5wSRyUDdVDzNWx"
}
```

### 119-temp-and-top-p-claude-sonnet-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5,
  "top_p": 0.9
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zjfKRUjE1UczvS8fL"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw4zjfKRUjE1UczvS8fL"
}
```

### 120-top-p-only

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_p": 0.9
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zuAozgkq4XFXZHh6U"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "`top_p` is deprecated for this model." },
  "request_id": "req_011Cfw4zuAozgkq4XFXZHh6U"
}
```

### 121-top-p-1.5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_p": 1.5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zwD5ysmVEeF84bjeL"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "top_p: range: 0..1" },
  "request_id": "req_011Cfw4zwD5ysmVEeF84bjeL"
}
```

### 122-top-k-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_k": 5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw4zy5hSWQDMN97GGmAf"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "`top_k` is deprecated for this model." },
  "request_id": "req_011Cfw4zy5hSWQDMN97GGmAf"
}
```

### 123-top-k-0

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_k": 0
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw511VJzZ2YXFdZWBNvc"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "`top_k` is deprecated for this model." },
  "request_id": "req_011Cfw511VJzZ2YXFdZWBNvc"
}
```

### 124-top-k-neg

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_k": -1
}
```

Response headers: `{"request-id": "req_011Cfw513eHjSQS83GFfGfof"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw513x9br6btozJxozix",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 125-temperature-1.5-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 1.5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw518J6LLv1jTSCdsDDf"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "temperature: range: 0..1" },
  "request_id": "req_011Cfw518J6LLv1jTSCdsDDf"
}
```

### 126-top-k-haiku45

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_k": 5
}
```

Response headers: `{"request-id": "req_011Cfw51AU4v6KuKjHNYtggS"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw51AnfXU3qnSe9cgEeA",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hey there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 127-temperature-0.5-only-claude-haiku-4-5-20251001

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5
}
```

Response headers: `{"request-id": "req_011Cfw52T7xYcsm2BiWjhzgE"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw52TTJ9zMJLWXPaFjSC",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hey there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 127-temperature-0.5-only-claude-haiku-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw523o19dNL1RyLijzZd"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw523o19dNL1RyLijzZd"
}
```

### 127-temperature-0.5-only-claude-opus-4-6

`POST /v1/messages` → **200**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5
}
```

Response headers: `{"request-id": "req_011Cfw52KWJqhCQmwnidqNrZ"}`

```json
{
  "model": "claude-opus-4-6",
  "id": "msg_011Cfw52KpfQdnVCFsCLiGp2",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 127-temperature-0.5-only-claude-opus-4-7

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-7",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw52CxQgn7qRbo5fpV7C"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw52CxQgn7qRbo5fpV7C"
}
```

### 127-temperature-0.5-only-claude-opus-4-8

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-8",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw52AgjYwgewWTg269wA"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw52AgjYwgewWTg269wA"
}
```

### 127-temperature-0.5-only-claude-opus-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw528THobNAgizDQpNQ6"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw528THobNAgizDQpNQ6"
}
```

### 127-temperature-0.5-only-claude-sonnet-4-6

`POST /v1/messages` → **200**

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5
}
```

Response headers: `{"request-id": "req_011Cfw52F6eLy8sgBeBWoyPx"}`

```json
{
  "model": "claude-sonnet-4-6",
  "id": "msg_011Cfw52FRVGGPeFjmVn8qU6",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 127-temperature-0.5-only-claude-sonnet-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0.5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw526A8sMLnmhcEd5m2H"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw526A8sMLnmhcEd5m2H"
}
```

### 128-temperature-1-haiku55

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 1
}
```

Response headers: `{"request-id": "req_011Cfw52WeHNNQBsDmsrFm3t"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw52Wz7YAL2N99JwV7eP",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 129-temperature-0-haiku55

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 0
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw52bG6rxgVTXgZCNZR1"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw52bG6rxgVTXgZCNZR1"
}
```

### 130-top-p-1-haiku55

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_p": 1
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw52dTJZp3oKpUTQPxSx"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "`top_p` is deprecated for this model." },
  "request_id": "req_011Cfw52dTJZp3oKpUTQPxSx"
}
```

### 131-top-p-0.9-opus46

`POST /v1/messages` → **200**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_p": 0.9
}
```

Response headers: `{"request-id": "req_011Cfw52fg14wH9zHiprUkEk"}`

```json
{
  "model": "claude-opus-4-6",
  "id": "msg_011Cfw52fz6voPe62NxqACGg",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 132-top-k-5-opus46

`POST /v1/messages` → **200**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_k": 5
}
```

Response headers: `{"request-id": "req_011Cfw52pbnAqKF7zPEarmnW"}`

```json
{
  "model": "claude-opus-4-6",
  "id": "msg_011Cfw52px7RtfX1nBuukxLd",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 133-top-k-neg-haiku45

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_k": -1
}
```

Response headers: `{"request-id": "req_011Cfw52x3FZ1E3EQtyRyL6j"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw52xNMMPt9n3RWm38Hu",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hey there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 134-top-k-neg5-haiku55

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_k": -5
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw531GinULJEoqTMQbaR"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "top_k: range: -1..100,000,000" },
  "request_id": "req_011Cfw531GinULJEoqTMQbaR"
}
```

### 135-top-p-neg1-haiku55

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "top_p": -1
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5336br5jRmLHVeSVir"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`top_p` cannot be set to -1 for this model."
  },
  "request_id": "req_011Cfw5336br5jRmLHVeSVir"
}
```

### 136-temp-1-top-p-1-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "temperature": 1,
  "top_p": 1
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw534u14qaDLY11LhDqn"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` and `top_p` cannot both be specified for this model. Please use only one."
  },
  "request_id": "req_011Cfw534u14qaDLY11LhDqn"
}
```

### 140-stop-sequence-hit

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 40,
  "messages": [
    { "role": "user", "content": "Count from 1 to 10 separated by commas, nothing else." }
  ],
  "stop_sequences": ["5"]
}
```

Response headers: `{"request-id": "req_011Cfw53tXCAD5AJanX6AiJy"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw53ttHAW3L9dK1p7sEw",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "1,2,3,4," }],
  "container": null,
  "stop_reason": "stop_sequence",
  "stop_sequence": "5",
  "stop_details": null,
  "usage": {
    "input_tokens": 29,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 9,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 141-stop-sequence-multi

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 40,
  "messages": [
    { "role": "user", "content": "Count from 1 to 10 separated by commas, nothing else." }
  ],
  "stop_sequences": ["7", "4,"]
}
```

Response headers: `{"request-id": "req_011Cfw53wkfwrfAxuTqqQ7Uk"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw53x7F6boKNNtdEbTcg",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "1,2,3," }],
  "container": null,
  "stop_reason": "stop_sequence",
  "stop_sequence": "4,",
  "stop_details": null,
  "usage": {
    "input_tokens": 29,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 8,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 142-stop-sequence-empty-string

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "stop_sequences": [""]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5418pbVhFaBN6J7wGU"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "stop_sequences: each stop sequence must be non-empty"
  },
  "request_id": "req_011Cfw5418pbVhFaBN6J7wGU"
}
```

### 143-stop-sequence-whitespace

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "stop_sequences": [" "]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw542wiPTp8Vha54rP2w"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "stop_sequences: each stop sequence must contain non-whitespace"
  },
  "request_id": "req_011Cfw542wiPTp8Vha54rP2w"
}
```

### 144-stop-sequences-empty-array

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "stop_sequences": []
}
```

Response headers: `{"request-id": "req_011Cfw544sJ3XyuiDSXhTsgb"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw545F7ueppZ5VMC2D8b",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 145-stop-sequences-many

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "stop_sequences": ["zz0", "zz1", "zz2", "...<20 items>"]
}
```

Response headers: `{"request-id": "req_011Cfw549a55xgaeNhew2oxW"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw549vu8RYK3G5pRpDfm",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 146-stop-sequences-very-many

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "stop_sequences": ["zz0", "zz1", "zz2", "...<9000 items>"]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw54EPJ7hMQPw5YftcEu"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "stop_sequences: total length: 0..2,500" },
  "request_id": "req_011Cfw54EPJ7hMQPw5YftcEu"
}
```

### 147-stop-sequence-haiku45

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 40,
  "messages": [
    { "role": "user", "content": "Count from 1 to 10 separated by commas, nothing else." }
  ],
  "stop_sequences": ["5"]
}
```

Response headers: `{"request-id": "req_011Cfw54GP6TNSjQ4Nco5Ztc"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw54GigY3c91SJGbDPTB",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "1, 2, 3, 4, " }],
  "container": null,
  "stop_reason": "stop_sequence",
  "stop_sequence": "5",
  "stop_details": null,
  "usage": {
    "input_tokens": 24,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 14,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 148-metadata-user-id

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "metadata": { "user_id": "user-1234" }
}
```

Response headers: `{"request-id": "req_011Cfw54LB3LL4KGkY9FxhXS"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw54LWPVKPjigE2N135i",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 149-metadata-user-id-email

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "metadata": { "user_id": "bob@example.com" }
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw54TWKRtEcnQRrikxMD"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "metadata.user_id: user_id appears to contain an email address. Please send a uuid or hash value instead."
  },
  "request_id": "req_011Cfw54TWKRtEcnQRrikxMD"
}
```

### 150-metadata-user-id-long

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "metadata": {
    "user_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...<600 chars>"
  }
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw54VZ6ygQSvJgWTFMYV"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "metadata.user_id: String should have at most 512 characters"
  },
  "request_id": "req_011Cfw54VZ6ygQSvJgWTFMYV"
}
```

### 151-metadata-null-user-id

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "metadata": { "user_id": null }
}
```

Response headers: `{"request-id": "req_011Cfw54XSxckog6AchRi1q3"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw54XmonYjNcjA5Xvzc9",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 152-metadata-empty

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "metadata": {}
}
```

Response headers: `{"request-id": "req_011Cfw54c61g7KHbphKZ1REu"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw54cKeueHe4UycHcwho",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 153-service-tier-auto

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "service_tier": "auto"
}
```

Response headers: `{"request-id": "req_011Cfw54gYedYtZEMQJMATJJ"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw54gtEM4FFx9zAFnSkR",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 153-service-tier-banana

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "service_tier": "banana"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw54siMKcYj5BS95826G"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "service_tier: Input should be 'auto' or 'standard_only'"
  },
  "request_id": "req_011Cfw54siMKcYj5BS95826G"
}
```

### 153-service-tier-priority

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "service_tier": "priority"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw54qfqFysC6QqshGRSG"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "service_tier: Input should be 'auto' or 'standard_only'"
  },
  "request_id": "req_011Cfw54qfqFysC6QqshGRSG"
}
```

### 153-service-tier-standard_only

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "service_tier": "standard_only"
}
```

Response headers: `{"request-id": "req_011Cfw54mCgmyE73y6FKwU9s"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw54mY2mbFLfujRzfPnn",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 154-inference-geo-banana

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "inference_geo": "banana"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw55714guuMMfAhKcFjF"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "inference_geo: must be one of ['global', 'us']"
  },
  "request_id": "req_011Cfw55714guuMMfAhKcFjF"
}
```

### 154-inference-geo-eu

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "inference_geo": "eu"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5554jNHiRy88PbzrWT"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "inference_geo: must be one of ['global', 'us']"
  },
  "request_id": "req_011Cfw5554jNHiRy88PbzrWT"
}
```

### 154-inference-geo-global

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "inference_geo": "global"
}
```

Response headers: `{"request-id": "req_011Cfw54um8YUB6o6mj99FfB"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw54v6jJdNy9aZ8RCgPB",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 154-inference-geo-us

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "inference_geo": "us"
}
```

Response headers: `{"request-id": "req_011Cfw54zHkYFrXzHo2mKSh1"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw54zdakeT2THVUEstLf",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "us"
  },
  "diagnostics": null
}
```

### 155-inference-geo-us-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "inference_geo": "us"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw55oeKAEa7g5j62tpSH"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "'claude-haiku-4-5-20251001' does not support inference_geo."
  },
  "request_id": "req_011Cfw55oeKAEa7g5j62tpSH"
}
```

### 156-inference-geo-us-opus46

`POST /v1/messages` → **200**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "inference_geo": "us"
}
```

Response headers: `{"request-id": "req_011Cfw55qXR6D84VaqR1PRWE"}`

```json
{
  "model": "claude-opus-4-6",
  "id": "msg_011Cfw55qs23mpNhDCngWPZQ",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "us"
  },
  "diagnostics": null
}
```

### 157-inference-geo-us-sonnet45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }],
  "inference_geo": "us"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw55yEXP17DVMixjU1vt"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "'claude-sonnet-4-5-20250929' does not support inference_geo."
  },
  "request_id": "req_011Cfw55yEXP17DVMixjU1vt"
}
```

### 158-ct-inference-geo-us

`POST /v1/messages/count_tokens` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [{ "role": "user", "content": "hi" }],
  "inference_geo": "us"
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5612RZj6wftom8P3x5"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "inference_geo: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw5612RZj6wftom8P3x5"
}
```

### 160-image-base64-png

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
          }
        },
        { "type": "text", "text": "What color is this square? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw57YY2GFu73dNCJpKWv"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw57YscYjJrXWB668YMM",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Red" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 24,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 161-image-url

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "url",
            "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png"
          }
        },
        { "type": "text", "text": "Describe in 5 words." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57dJGNDWfCVjfXAMja"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Unable to download the file. Please verify the URL and try again."
  },
  "request_id": "req_011Cfw57dJGNDWfCVjfXAMja"
}
```

### 162-image-wrong-media-type-jpeg

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
          }
        },
        { "type": "text", "text": "What color? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57g5hHanVyXjudBbFM"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.image.source.base64: The image was specified using the image/jpeg media type, but the image appears to be a image/png image"
  },
  "request_id": "req_011Cfw57g5hHanVyXjudBbFM"
}
```

### 163-image-wrong-media-type-webp

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/webp",
            "data": "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
          }
        },
        { "type": "text", "text": "What color? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57i5WCiB8T9j16wyQu"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.image.source.base64: The image was specified using the image/webp media type, but the image appears to be a image/png image"
  },
  "request_id": "req_011Cfw57i5WCiB8T9j16wyQu"
}
```

### 164-image-bmp

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/bmp",
            "data": "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
          }
        },
        { "type": "text", "text": "What color? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57k5JbTFVc139b1vzS"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.image.source.base64.media_type: Input should be 'image/jpeg', 'image/png', 'image/gif' or 'image/webp'"
  },
  "request_id": "req_011Cfw57k5JbTFVc139b1vzS"
}
```

### 165-image-svg

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/svg+xml",
            "data": "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJyZWQiLz48L3N2Zz4="
          }
        },
        { "type": "text", "text": "What color? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57mtTG52U26oZcvALi"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.image.source.base64.media_type: Input should be 'image/jpeg', 'image/png', 'image/gif' or 'image/webp'"
  },
  "request_id": "req_011Cfw57mtTG52U26oZcvALi"
}
```

### 166-image-garbage-data

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "bm90IGFuIGltYWdlIGF0IGFsbA=="
          }
        },
        { "type": "text", "text": "What color? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57otFW3LkwxKPcXnqs"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "Could not process image" },
  "request_id": "req_011Cfw57otFW3LkwxKPcXnqs"
}
```

### 167-image-invalid-base64

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": { "type": "base64", "media_type": "image/png", "data": "!!!not base64!!!" }
        },
        { "type": "text", "text": "What color? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57rCAF82UCiG6DhTap"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.image.source.base64: invalid base64 data"
  },
  "request_id": "req_011Cfw57rCAF82UCiG6DhTap"
}
```

### 168-image-data-url-prefix

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
          }
        },
        { "type": "text", "text": "What color? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57tMdf7S4XqmGpT8Ku"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.image.source.base64: invalid base64 data"
  },
  "request_id": "req_011Cfw57tMdf7S4XqmGpT8Ku"
}
```

### 169-image-url-404

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": { "type": "url", "url": "https://upload.wikimedia.org/does-not-exist-xyz.png" }
        },
        { "type": "text", "text": "Describe." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw57z7QUHiffTxFAASrc"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Unable to download the file. Please verify the URL and try again."
  },
  "request_id": "req_011Cfw57z7QUHiffTxFAASrc"
}
```

### 170-image-url-not-image

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "image", "source": { "type": "url", "url": "https://www.example.com/" } },
        { "type": "text", "text": "Describe." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw583ATxQosFqdLojgHW"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.image.source.base64.data: The file format is invalid or unsupported"
  },
  "request_id": "req_011Cfw583ATxQosFqdLojgHW"
}
```

### 171-image-data-url-as-url

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "url",
            "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
          }
        },
        { "type": "text", "text": "What color? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw585zsr6DaiemUwAeXC"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "Only HTTPS URLs are supported." },
  "request_id": "req_011Cfw585zsr6DaiemUwAeXC"
}
```

### 172-image-in-assistant

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "hi" },
    {
      "role": "assistant",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
          }
        }
      ]
    },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5882uzDTYC4ZFZHVqv"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content: 'image' blocks are not permitted within assistant turns."
  },
  "request_id": "req_011Cfw5882uzDTYC4ZFZHVqv"
}
```

### 173-image-url-0

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "url",
            "url": "https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png"
          }
        },
        { "type": "text", "text": "Describe in 5 words." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw58jbK598kg8PJowgqM"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw58jvfJa3MSXjze5TKc",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Colorful, playful, bold, rounded, recognizable sans-serif" }
  ],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 60,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 24,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 180-pdf-base64

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAw...<804 chars>"
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5A37YwwWNYYiVVn5xA"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5A3Vcy1VNVVh8XABmu",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "PELICAN" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 1589,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 181-pdf-url

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "url",
            "url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
          }
        },
        { "type": "text", "text": "What text is in this PDF? Five words max." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5A7K4U26ENBdXtdGpV"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5A7bRC4rCKzTiyyNRo",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Dummy PDF file" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 1629,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 10,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 182-text-document

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN."
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5AC2LDYibDKsezezow"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5ACPetfzGLDxyxVvnD",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 69,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 24,
    "output_tokens_details": { "thinking_tokens": 24 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 182b-text-document-nothink

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 48,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN."
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"request-id": "req_011Cfw5CBY7a7VcbfRBKqLyx"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5CBrTa4Jz9rQvdsVqn",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "PELICAN" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 67,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 183-text-document-title-context

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "title": "Memo 7",
          "context": "Internal memo, trusted.",
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN."
          }
        },
        {
          "type": "text",
          "text": "What is the title of the document and the secret word? Answer: title, word."
        }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5AHMJU6SjkBaKwvPAL"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5AHfeMWnkVBdoes4VT",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 121,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 24,
    "output_tokens_details": { "thinking_tokens": 24 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 183b-text-document-title-context-nothink

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 48,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "title": "Memo 7",
          "context": "Internal memo, trusted.",
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN."
          }
        },
        {
          "type": "text",
          "text": "Reply exactly as: <document title> | <context string> | <secret word>"
        }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"request-id": "req_011Cfw5CFvnN5ZYjLp2tXHEy"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5CGEdYDYnHbNF8fs1a",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Memo 7 | Internal memo, trusted. | PELICAN" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 121,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 25,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 184-text-document-citations

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 64,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "title": "Memo 7",
          "citations": { "enabled": true },
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN. The sky is green."
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5AMGCR3PNHdSEBxhoG"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5AMeG6ANk9cb43oWvf",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "citations": [
        {
          "type": "char_location",
          "cited_text": "The secret word is PELICAN. ",
          "document_index": 0,
          "document_title": "Memo 7",
          "start_char_index": 0,
          "end_char_index": 28
        }
      ],
      "type": "text",
      "text": "PELICAN"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 845,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 26,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 185-text-document-wrong-media

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "text",
            "media_type": "text/markdown",
            "data": "# Hi\nThe secret word is PELICAN."
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5ASKoG6LVidPeKnAHf"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.document.source.text.media_type: Input should be 'text/plain'"
  },
  "request_id": "req_011Cfw5ASKoG6LVidPeKnAHf"
}
```

### 186-pdf-wrong-media

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/msword",
            "data": "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAw...<804 chars>"
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5AUZVkSmmYQvGoQHem"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.document.source.base64.media_type: Input should be 'application/pdf'"
  },
  "request_id": "req_011Cfw5AUZVkSmmYQvGoQHem"
}
```

### 187-pdf-base64-declared-but-png

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5AWkwgMgFCd4NuWpKN"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.pdf.source.base64.data: The PDF specified was not valid."
  },
  "request_id": "req_011Cfw5AWkwgMgFCd4NuWpKN"
}
```

### 188-content-document-source

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "content",
            "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5AYwB6YGE3ZDiuRyiF"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5AZGmFW2GcdzvHGuFC",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 60,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 24,
    "output_tokens_details": { "thinking_tokens": 24 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 188b-content-document-source-nothink

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 48,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "content",
            "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"request-id": "req_011Cfw5CLYbSD5n1S694aQyP"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5CM5MEfYLc1fhBjnTr",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "PELICAN" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 58,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 189-file-bogus-no-beta

`POST /v1/messages` → **404**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": { "type": "file", "file_id": "file_011CNha8iCJcU1wXNR6q4V8w" }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5AdxJHWFjne1zemyx9"}`

```json
{
  "type": "error",
  "error": {
    "type": "not_found_error",
    "message": "File `file_011CNha8iCJcU1wXNR6q4V8w` not found."
  },
  "request_id": "req_011Cfw5AdxJHWFjne1zemyx9"
}
```

### 190-file-bogus-with-beta

`POST /v1/messages` → **404** · request headers: `{"anthropic-beta": "files-api-2025-04-14"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": { "type": "file", "file_id": "file_011CNha8iCJcU1wXNR6q4V8w" }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5AgCUtkyoYRimKoy48"}`

```json
{
  "type": "error",
  "error": {
    "type": "not_found_error",
    "message": "File `file_011CNha8iCJcU1wXNR6q4V8w` not found."
  },
  "request_id": "req_011Cfw5AgCUtkyoYRimKoy48"
}
```

### 191-image-file-bogus-with-beta

`POST /v1/messages` → **404** · request headers: `{"anthropic-beta": "files-api-2025-04-14"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": { "type": "file", "file_id": "file_011CNha8iCJcU1wXNR6q4V8w" }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5Aie5dzMbPgAiXkZX1"}`

```json
{
  "type": "error",
  "error": {
    "type": "not_found_error",
    "message": "File `file_011CNha8iCJcU1wXNR6q4V8w` not found."
  },
  "request_id": "req_011Cfw5Aie5dzMbPgAiXkZX1"
}
```

### 192-file-garbage-id-with-beta

`POST /v1/messages` → **400** · request headers: `{"anthropic-beta": "files-api-2025-04-14"}`

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "document", "source": { "type": "file", "file_id": "banana" } },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5AkvjxzkrSA4pVxevD"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.0.content.0.source: Invalid file source id `banana`"
  },
  "request_id": "req_011Cfw5AkvjxzkrSA4pVxevD"
}
```

### 193-search-result

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 64,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5AoKMSfyRSndYPHub7"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5AogC26Lwn1r7wC2Fq",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 137,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 64,
    "output_tokens_details": { "thinking_tokens": 64 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 193b-search-result-nothink

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 48,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"request-id": "req_011Cfw5CRJqTTZ7NpzpXSFGK"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5CRegTWFEthgonZJi8",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "PELICAN" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 135,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 194-search-result-citations

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 64,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "citations": { "enabled": true },
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5Au8cAWjAwYv7KDuGm"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5AuXfncDH2ecJSUV4h",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 934,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 64,
    "output_tokens_details": { "thinking_tokens": 64 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 194b-search-result-citations-nothink

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 64,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "citations": { "enabled": true },
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"request-id": "req_011Cfw5CUDxPG3a3QnEbLxWr"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5CUZJTjJVdyZNGXLUh",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 933,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 64,
    "output_tokens_details": { "thinking_tokens": 64 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 194c-search-result-citations-nothink-200

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 300,
  "thinking": { "type": "disabled" },
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "citations": { "enabled": true },
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5Dh97SwdhxqjZctUvx"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5DhZRLB9EBbJzfK1SM",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "", "signature": "<sig>" },
    {
      "citations": [
        {
          "type": "search_result_location",
          "cited_text": "The secret word is PELICAN.",
          "source": "https://example.com/memo",
          "title": "Memo",
          "search_result_index": 0,
          "start_block_index": 0,
          "end_block_index": 1
        }
      ],
      "type": "text",
      "text": "PELICAN"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 933,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 187,
    "output_tokens_details": { "thinking_tokens": 161 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 195-document-in-assistant

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [
    { "role": "user", "content": "hi" },
    {
      "role": "assistant",
      "content": [
        {
          "type": "document",
          "source": { "type": "text", "media_type": "text/plain", "data": "x" }
        }
      ]
    },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5AzpAogfFLeTbdWNAm"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5B1DEFCfvwWKuDHaym",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 59,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 16,
    "output_tokens_details": { "thinking_tokens": 16 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 195b-document-in-assistant-nothink

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 48,
  "thinking": { "type": "disabled" },
  "messages": [
    { "role": "user", "content": "Remember a document for me." },
    {
      "role": "assistant",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN."
          }
        }
      ]
    },
    { "role": "user", "content": "What is the secret word in the document you showed? One word." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5CZvFyNW9cM8cN8wvB"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5CaENAjhmHWaZUs8Jr",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I can't actually remember anything between conversations, an...<175 chars>"
    }
  ],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 86,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 48,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 196-pdf-haiku45

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAw...<804 chars>"
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5B5NWEsJRtrhaXh81z"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw5B5grkMqURmFMpExAf",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "PELICAN" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 1580,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 197-text-document-empty

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 24,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": { "type": "text", "media_type": "text/plain", "data": "" }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5B8eT8FvhJxgqghE2Q"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5B8x4HxkwUaorNT4Kj",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 57,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 24,
    "output_tokens_details": { "thinking_tokens": 24 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 197b-text-document-empty-nothink

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 48,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": { "type": "text", "media_type": "text/plain", "data": "" }
        },
        { "type": "text", "text": "Is the document empty? yes/no" }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"request-id": "req_011Cfw5CfJx6g9TavoJJdZnL"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5Cfd4SN6vdU2k3HjBi",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Yes" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 56,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 5,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 198-search-result-in-assistant

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "thinking": { "type": "disabled" },
  "messages": [
    { "role": "user", "content": "hi" },
    {
      "role": "assistant",
      "content": [
        {
          "type": "search_result",
          "source": "s",
          "title": "t",
          "content": [{ "type": "text", "text": "x" }]
        }
      ]
    },
    { "role": "user", "content": "Say ok." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5CjumiXrTqjnDG7Snf"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages: `search_result` blocks can only be in `user` messages. Found in assistant messages at: messages.1.content.0"
  },
  "request_id": "req_011Cfw5CjumiXrTqjnDG7Snf"
}
```

### 199a-ct-doc-in-assistant

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "Remember a document for me." },
    {
      "role": "assistant",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN."
          }
        }
      ]
    },
    { "role": "user", "content": "What is the secret word in the document you showed? One word." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5DpaLwG1r8URzcXZU2"}`

```json
{ "input_tokens": 86 }
```

### 199b-ct-doc-in-assistant-long

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "Remember a document for me." },
    {
      "role": "assistant",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN. The secret word is PELICAN. The ...<1400 chars>"
          }
        }
      ]
    },
    { "role": "user", "content": "What is the secret word in the document you showed? One word." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5DrHnLVrytFJNkF5rV"}`

```json
{ "input_tokens": 625 }
```

### 199c-ct-empty-assistant

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "Remember a document for me." },
    { "role": "assistant", "content": "" },
    { "role": "user", "content": "What is the secret word in the document you showed? One word." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5E1B5GWfLbMFcMyvU1"}`

```json
{ "input_tokens": 36 }
```

### 199d-ct-text-assistant

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "Remember a document for me." },
    { "role": "assistant", "content": "The secret word is PELICAN." },
    { "role": "user", "content": "What is the secret word in the document you showed? One word." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5E2tX2k7eU32MaRmaC"}`

```json
{ "input_tokens": 47 }
```

### 200-citations-doc-thinking-None

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 300,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "title": "Memo 7",
          "citations": { "enabled": true },
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN. The sky is green."
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5FDMq2FYgx1f35sceM"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5FDgvMAzmzEjMr7Cgi",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "citations": [
        {
          "type": "char_location",
          "cited_text": "The secret word is PELICAN. ",
          "document_index": 0,
          "document_title": "Memo 7",
          "start_char_index": 0,
          "end_char_index": 28
        }
      ],
      "type": "text",
      "text": "PELICAN"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 845,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 26,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 200-citations-doc-thinking-disabled

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 300,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "title": "Memo 7",
          "citations": { "enabled": true },
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "The secret word is PELICAN. The sky is green."
          }
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"request-id": "req_011Cfw5F8ZMitzkFnHEdjzga"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5F8tCwjYDZY5CZcYAD",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "citations": [
        {
          "type": "char_location",
          "cited_text": "The secret word is PELICAN. ",
          "document_index": 0,
          "document_title": "Memo 7",
          "start_char_index": 0,
          "end_char_index": 28
        }
      ],
      "type": "text",
      "text": "PELICAN"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 844,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 26,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 200-citations-sr-thinking-None

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 300,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "citations": { "enabled": true },
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5Ez5coYFi1ENr5LixV"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5EzUC8kTLHAMw9kyWN",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "", "signature": "<sig>" },
    {
      "citations": [
        {
          "type": "search_result_location",
          "cited_text": "The secret word is PELICAN.",
          "source": "https://example.com/memo",
          "title": "Memo",
          "search_result_index": 0,
          "start_block_index": 0,
          "end_block_index": 1
        }
      ],
      "type": "text",
      "text": "PELICAN"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 934,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 204,
    "output_tokens_details": { "thinking_tokens": 178 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 200-citations-sr-thinking-disabled

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 300,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "citations": { "enabled": true },
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"request-id": "req_011Cfw5Er6QgoB49c9gLFpSj"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5ErUDz7QsZpSCfkS3d",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "", "signature": "<sig>" },
    {
      "citations": [
        {
          "type": "search_result_location",
          "cited_text": "The secret word is PELICAN.",
          "source": "https://example.com/memo",
          "title": "Memo",
          "search_result_index": 0,
          "start_block_index": 0,
          "end_block_index": 1
        }
      ],
      "type": "text",
      "text": "PELICAN"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 933,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 211,
    "output_tokens_details": { "thinking_tokens": 185 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 201-citations-sr-claude-haiku-4-5-20251001

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 300,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "citations": { "enabled": true },
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5FybdCkAyDqcPpT39Q"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw5FyzSQDqgXki8bNr4t",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "citations": [
        {
          "type": "search_result_location",
          "cited_text": "The secret word is PELICAN.",
          "source": "https://example.com/memo",
          "title": "Memo",
          "search_result_index": 0,
          "start_block_index": 0,
          "end_block_index": 1
        }
      ],
      "type": "text",
      "text": "PELICAN"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 591,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 23,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 201-citations-sr-claude-sonnet-5-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 300,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "search_result",
          "source": "https://example.com/memo",
          "title": "Memo",
          "citations": { "enabled": true },
          "content": [{ "type": "text", "text": "The secret word is PELICAN." }]
        },
        { "type": "text", "text": "What is the secret word? One word." }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5G3VXVEuUvd7d4zAn3"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "To turn thinking off on this model, send \"thinking\": {\"type\"...<232 chars>"
  },
  "request_id": "req_011Cfw5G3VXVEuUvd7d4zAn3"
}
```

### 210-model-CLAUDE-HAIKU-5-5

`POST /v1/messages` → **404**

```json
{
  "model": "CLAUDE-HAIKU-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5JAY19SMujcatiTk7M"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: CLAUDE-HAIKU-5-5" },
  "request_id": "req_011Cfw5JAY19SMujcatiTk7M"
}
```

### 210-model-EMPTY

`POST /v1/messages` → **400**

```json
{
  "model": "",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5J8PX9tH48gEgJChmK"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "model: String should have at least 1 character"
  },
  "request_id": "req_011Cfw5J8PX9tH48gEgJChmK"
}
```

### 210-model-claude-2.1

`POST /v1/messages` → **404**

```json
{
  "model": "claude-2.1",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5HUtY4seQgDqNMmJ77"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-2.1" },
  "request_id": "req_011Cfw5HUtY4seQgDqNMmJ77"
}
```

### 210-model-claude-3-5-haiku-20241022

`POST /v1/messages` → **404**

```json
{
  "model": "claude-3-5-haiku-20241022",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5HWjuA9Gfm9yf8gyvh"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-3-5-haiku-20241022" },
  "request_id": "req_011Cfw5HWjuA9Gfm9yf8gyvh"
}
```

### 210-model-claude-3-7-sonnet-20250219

`POST /v1/messages` → **404**

```json
{
  "model": "claude-3-7-sonnet-20250219",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5HYmC2C5h1azKyFmdB"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-3-7-sonnet-20250219" },
  "request_id": "req_011Cfw5HYmC2C5h1azKyFmdB"
}
```

### 210-model-claude-3-haiku-20240307

`POST /v1/messages` → **404**

```json
{
  "model": "claude-3-haiku-20240307",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5HT2f3d9maqs15Gb97"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-3-haiku-20240307" },
  "request_id": "req_011Cfw5HT2f3d9maqs15Gb97"
}
```

### 210-model-claude-3-opus-20240229

`POST /v1/messages` → **404**

```json
{
  "model": "claude-3-opus-20240229",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5HawuqNty4L6UqxRaF"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-3-opus-20240229" },
  "request_id": "req_011Cfw5HawuqNty4L6UqxRaF"
}
```

### 210-model-claude-banana-9

`POST /v1/messages` → **404**

```json
{
  "model": "claude-banana-9",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5HR65M3JDjvcgyokyR"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-banana-9" },
  "request_id": "req_011Cfw5HR65M3JDjvcgyokyR"
}
```

### 210-model-claude-fable-5-1

`POST /v1/messages` → **200**

```json
{
  "model": "claude-fable-5-1",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw5HzZyi2PEbubVFGzpa"}`

```json
{
  "model": "claude-fable-5-1",
  "id": "msg_011Cfw5Hzv45N3snjPojLAXJ",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 210-model-claude-haiku-4-5

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw5HiVq1ujuR6UisUk7R"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw5HiqvA45CbrthApV9G",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hey there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 210-model-claude-mythos-1

`POST /v1/messages` → **404**

```json
{
  "model": "claude-mythos-1",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5HxjbBKbfa3ZWTgEne"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-mythos-1" },
  "request_id": "req_011Cfw5HxjbBKbfa3ZWTgEne"
}
```

### 210-model-claude-opus-4-1-20250805

`POST /v1/messages` → **404**

```json
{
  "model": "claude-opus-4-1-20250805",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5HesoU5JuLah46QrHU"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-opus-4-1-20250805" },
  "request_id": "req_011Cfw5HesoU5JuLah46QrHU"
}
```

### 210-model-claude-opus-4-20250514

`POST /v1/messages` → **404**

```json
{
  "model": "claude-opus-4-20250514",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5Hd3B8ANax3nLRdqVq"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-opus-4-20250514" },
  "request_id": "req_011Cfw5Hd3B8ANax3nLRdqVq"
}
```

### 210-model-claude-opus-4-5

`POST /v1/messages` → **200**

```json
{
  "model": "claude-opus-4-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw5HrjgodbPPiu1398Ub"}`

```json
{
  "model": "claude-opus-4-5-20251101",
  "id": "msg_011Cfw5Hs5GVuHAguAnw8mug",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there." }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 210-model-claude-sonnet-4-20250514

`POST /v1/messages` → **404**

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5Hgm9k9mU5zuBr761P"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-sonnet-4-20250514" },
  "request_id": "req_011Cfw5Hgm9k9mU5zuBr761P"
}
```

### 210-model-claude-sonnet-4-5

`POST /v1/messages` → **200**

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"request-id": "req_011Cfw5HnBqcGoo81ngu5oaa"}`

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "id": "msg_011Cfw5HnWvyQirepaMHsWnN",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 6,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 210-model-gpt-4o

`POST /v1/messages` → **404**

```json
{
  "model": "gpt-4o",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5J6KzXS62ju5UABWR2"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: gpt-4o" },
  "request_id": "req_011Cfw5J6KzXS62ju5UABWR2"
}
```

### 220-get-model-haiku55

`GET /v1/models/claude-haiku-5-5` → **200**

Response headers: `{"request-id": "req_011Cfw5KMDU5jZRKQfr1Mw6h"}`

```json
{
  "type": "model",
  "id": "claude-haiku-5-5",
  "display_name": "Claude Haiku 5.5",
  "created_at": "2026-10-07T18:00:00Z",
  "line": "haiku",
  "max_input_tokens": 1000000,
  "max_tokens": 128000,
  "capabilities": {
    "batch": { "supported": true },
    "citations": { "supported": true },
    "code_execution": { "supported": true },
    "context_management": {
      "supported": true,
      "clear_tool_uses_20250919": { "supported": true },
      "clear_thinking_20251015": { "supported": true },
      "compact_20260112": { "supported": true }
    },
    "effort": {
      "supported": true,
      "low": { "supported": true },
      "medium": { "supported": true },
      "high": { "supported": true },
      "xhigh": { "supported": true },
      "max": { "supported": true }
    },
    "image_input": { "supported": true },
    "pdf_input": { "supported": true },
    "server_tools": {
      "supported": true,
      "code_execution": { "supported": true },
      "web_search": { "supported": true }
    },
    "structured_outputs": { "supported": true },
    "thinking": {
      "supported": true,
      "types": {
        "enabled": { "supported": false },
        "adaptive": { "supported": true },
        "disabled": { "supported": true }
      }
    }
  },
  "lifecycle": "active",
  "deprecated_at": null,
  "retires_at": null
}
```

### 221-get-model-alias

`GET /v1/models/claude-haiku-4-5` → **200**

Response headers: `{"request-id": "req_011Cfw5KP9JaAdbZWiMznJVM"}`

```json
{
  "type": "model",
  "id": "claude-haiku-4-5-20251001",
  "display_name": "Claude Haiku 4.5",
  "created_at": "2025-10-15T00:00:00Z",
  "line": "haiku",
  "max_input_tokens": 200000,
  "max_tokens": 64000,
  "capabilities": {
    "batch": { "supported": true },
    "citations": { "supported": true },
    "code_execution": { "supported": false },
    "context_management": {
      "supported": true,
      "clear_tool_uses_20250919": { "supported": true },
      "clear_thinking_20251015": { "supported": true },
      "compact_20260112": { "supported": false }
    },
    "effort": {
      "supported": false,
      "low": { "supported": false },
      "medium": { "supported": false },
      "high": { "supported": false },
      "xhigh": { "supported": false },
      "max": { "supported": false }
    },
    "image_input": { "supported": true },
    "pdf_input": { "supported": true },
    "server_tools": {
      "supported": true,
      "code_execution": { "supported": true },
      "web_search": { "supported": true }
    },
    "structured_outputs": { "supported": true },
    "thinking": {
      "supported": true,
      "types": {
        "enabled": { "supported": true },
        "adaptive": { "supported": false },
        "disabled": { "supported": true }
      }
    }
  },
  "lifecycle": "active",
  "deprecated_at": null,
  "retires_at": null
}
```

### 222-get-model-retired

`GET /v1/models/claude-3-haiku-20240307` → **404**

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5KR8cawB6vUZVe859m"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-3-haiku-20240307" },
  "request_id": "req_011Cfw5KR8cawB6vUZVe859m"
}
```

### 223-get-model-unknown

`GET /v1/models/claude-banana-9` → **404**

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5KT2iNZkzxcn1yjDed"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-banana-9" },
  "request_id": "req_011Cfw5KT2iNZkzxcn1yjDed"
}
```

### 224-get-models-limit2

`GET /v1/models?limit=2` → **200**

Response headers: `{"request-id": "req_011Cfw5KV9xMHYUUxzXQEBpF"}`

```json
{"data": [{"type": "model", "id": "claude-haiku-5-5", "display_name": "Claude Haiku 5.5", "created_at": "2026-10-07T18:00:00Z", "line": "haiku", "max_input_tokens": 1000000, "max_tokens": 128000, "capabilities": {"batch": {"supported": true}, "citations": {"supported": true}, "code_execution": {"supported": true}, "context_management": {"supported": true, "clear_tool_uses_20250919": {"supported": true}, "clear_thinking_20251015": {"supported": true}, "compact_20260112": {"supported": true}}, "effort": {"supported": true, "low": {"supported": true}, "medium": {"supported": true}, "high": {"supported": true}, "xhigh": {"supported": true}, "max": {"supported": true}}, "image_input": {"supported": true}, "pdf_input": {"supported": true}, "server_tools": {"supported": true, "code_execution": {"supported": true}, "web_search": {"supported": true}}, "structured_outputs": {"supported": true}, "thinking": {"supported": true, "types": {"enabled": {"supported": false}, "adaptive": {"supported": true}, "disabled": {"supported": true}}}}, "lifecycle": "active", "deprecated_at": null, "retires_at": null}, {"type": "model", "id": "claude-sonnet-5-5", "display_name": "Claude Sonnet 5.5", "created_at": "2026-09-28T00:00:00Z", "line": "sonnet", "max_input_tokens": 1000000, "max_tokens": 128000, "capabilities": {"batch": {"supported": true}, "citations": {"supported": true}, "code_execution": {"supported": true}, "context_management": {"supported": true, "clear_tool_uses_20250919": {"supported"...(trimmed)
```

### 225-get-model-no-version

`GET /v1/models/claude-haiku-5-5` → **400** · request headers: `{"anthropic-version": "(omitted)"}`

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5KX1aZ1ozGth7UavN5"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "anthropic-version: header is required" },
  "request_id": "req_011Cfw5KX1aZ1ozGth7UavN5"
}
```

### 226-count-tokens-basic

`POST /v1/messages/count_tokens` → **200**

```json
{ "model": "claude-haiku-5-5", "messages": [{ "role": "user", "content": "Say hi in two words." }] }
```

Response headers: `{"request-id": "req_011Cfw5KYa63xLgXQQqAL98c"}`

```json
{ "input_tokens": 16 }
```

### 227-count-tokens-with-system-tools

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "system": "Be terse.",
  "messages": [{ "role": "user", "content": "hi" }],
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather",
      "input_schema": { "type": "object", "properties": { "city": { "type": "string" } } }
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5KaBac46Cj4iR59ocQ"}`

```json
{ "input_tokens": 360 }
```

### 228-count-tokens-with-max-tokens

`POST /v1/messages/count_tokens` → **400**

```json
{ "model": "claude-haiku-5-5", "max_tokens": 16, "messages": [{ "role": "user", "content": "hi" }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5Kbrny147gj4AwC2Gy"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw5Kbrny147gj4AwC2Gy"
}
```

### 229-count-tokens-with-temperature

`POST /v1/messages/count_tokens` → **400**

```json
{ "model": "claude-haiku-5-5", "temperature": 1, "messages": [{ "role": "user", "content": "hi" }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5KdcCfY4YxUZchPqkj"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "temperature: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw5KdcCfY4YxUZchPqkj"
}
```

### 230-count-tokens-with-metadata

`POST /v1/messages/count_tokens` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "metadata": { "user_id": "u1" },
  "messages": [{ "role": "user", "content": "hi" }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5Kf8zBsve1ZAnVfkZc"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "metadata: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw5Kf8zBsve1ZAnVfkZc"
}
```

### 231-count-tokens-with-service-tier

`POST /v1/messages/count_tokens` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "service_tier": "auto",
  "messages": [{ "role": "user", "content": "hi" }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5KgcHXynY5pRLaYY2Z"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "service_tier: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw5KgcHXynY5pRLaYY2Z"
}
```

### 232-count-tokens-with-stop-sequences

`POST /v1/messages/count_tokens` → **400**

```json
{
  "model": "claude-haiku-5-5",
  "stop_sequences": ["x"],
  "messages": [{ "role": "user", "content": "hi" }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5KiUuKArkg2mceEB24"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "stop_sequences: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw5KiUuKArkg2mceEB24"
}
```

### 233-count-tokens-with-thinking

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "thinking": { "type": "disabled" },
  "messages": [{ "role": "user", "content": "hi" }]
}
```

Response headers: `{"request-id": "req_011Cfw5Kkir1M7jeZQ37HXZN"}`

```json
{ "input_tokens": 8 }
```

### 234-count-tokens-with-stream

`POST /v1/messages/count_tokens` → **400**

```json
{ "model": "claude-haiku-5-5", "stream": false, "messages": [{ "role": "user", "content": "hi" }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5KnjPmsGNQF4MrAjBV"}`

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "stream: Extra inputs are not permitted" },
  "request_id": "req_011Cfw5KnjPmsGNQF4MrAjBV"
}
```

### 235-count-tokens-unknown-model

`POST /v1/messages/count_tokens` → **404**

```json
{ "model": "claude-banana-9", "messages": [{ "role": "user", "content": "hi" }] }
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5KppQALNrS7fcn8wem"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "model: claude-banana-9" },
  "request_id": "req_011Cfw5KppQALNrS7fcn8wem"
}
```

### 236-count-tokens-prefill-haiku55

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-5-5",
  "messages": [
    { "role": "user", "content": "hi" },
    { "role": "assistant", "content": "Hello" }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5Ks26o9H5s11hCj1Kk"}`

```json
{ "input_tokens": 13 }
```

### 240-malformed-json

`POST /v1/messages` → **400**

```json
"{\"model\": \"claude-haiku-5-5\", \"max_tokens\": 16, \"messages\": ["
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5LiqkdHHWJUDLKa12u"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "The request body is not valid JSON: EOF while parsing a list at line 1 column 61"
  },
  "request_id": "req_011Cfw5LiqkdHHWJUDLKa12u"
}
```

### 241-not-json

`POST /v1/messages` → **400**

```json
"hello"
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5LkisCHaDMZh5RGmYM"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "The request body is not valid JSON: expected value at line 1 column 1"
  },
  "request_id": "req_011Cfw5LkisCHaDMZh5RGmYM"
}
```

### 242-empty-body

`POST /v1/messages` → **400**

```json
""
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5LnvKM1ogKDvhtdNU4"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "The request body is not valid JSON: EOF while parsing a value at line 1 column 0"
  },
  "request_id": "req_011Cfw5LnvKM1ogKDvhtdNU4"
}
```

### 243-json-array-body

`POST /v1/messages` → **400**

```json
"[]"
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5Lq44aPAfFD64DWRCC"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "The request body must be a JSON object, got list."
  },
  "request_id": "req_011Cfw5Lq44aPAfFD64DWRCC"
}
```

### 244-wrong-content-type

`POST /v1/messages` → **200** · request headers: `{"content-type": "text/plain"}`

```json
"{\"model\": \"claude-haiku-5-5\", \"max_tokens\": 16, \"messages\": [{\"role\": \"user\", \"content\": \"Say hi in two words.\"}]}"
```

Response headers: `{"request-id": "req_011Cfw5LrsTMJUC8YbGLWTUt"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5LsCYSMwJETYj8YMe3",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello there!" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 16,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 7,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 245-duplicate-keys

`POST /v1/messages` → **200**

```json
"{\"model\": \"claude-banana-9\", \"model\": \"claude-haiku-5-5\", \"max_tokens\": 16, \"messages\": [{\"role\":\"user\",\"content\":\"Say hi.\"}]}"
```

Response headers: `{"request-id": "req_011Cfw5LwP5AuSES6jApW4vN"}`

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5LwkPKpnQNvfYEZRHT",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hi there! How can I help you today?" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 14,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 246-get-on-messages

`GET /v1/messages` → **405**

Response headers: `{}`

```json
{ "type": "error", "error": { "type": "invalid_request_error", "message": "Method Not Allowed" } }
```

### 247-unknown-path

`POST /v1/banana` → **404**

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 16,
  "messages": [{ "role": "user", "content": "Say hi in two words." }]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5M2Lxd8hYBfNX4QMTA"}`

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "Not found" },
  "request_id": "req_011Cfw5M2Lxd8hYBfNX4QMTA"
}
```

### 248-request-too-large-34MB

`POST /v1/messages` → **413**

```json
"<raw 35651678 bytes>"
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5M4gc85CoBz8CvVAup"}`

```json
{
  "error": {
    "type": "request_too_large",
    "message": "Request exceeds the maximum allowed size of 32 MB"
  }
}
```

### 250-ct-hello-x10000

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "messages": [
    {
      "role": "user",
      "content": "hello hello hello hello hello hello hello hello hello hello ...<60000 chars>"
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5PD3hybpWsms7RQyHy"}`

```json
{ "input_tokens": 10008 }
```

### 250-ct-hello-x100000

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "messages": [
    {
      "role": "user",
      "content": "hello hello hello hello hello hello hello hello hello hello ...<600000 chars>"
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5PFmuyQg2AxJGzZZRZ"}`

```json
{ "input_tokens": 100008 }
```

### 250-ct-hello-x205000

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "messages": [
    {
      "role": "user",
      "content": "hello hello hello hello hello hello hello hello hello hello ...<1230000 chars>"
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5PKcqTF13S6xHLAobc"}`

```json
{ "input_tokens": 205008 }
```

### 251-overflow-205k-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [
    {
      "role": "user",
      "content": "hello hello hello hello hello hello hello hello hello hello ...<1230000 chars>"
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5QHztbfysuvntwwveu"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "prompt is too long: 205024 tokens > 200000 maximum"
  },
  "request_id": "req_011Cfw5QHztbfysuvntwwveu"
}
```

### 252-overflow-200001-haiku45

`POST /v1/messages` → **400**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 16,
  "messages": [
    {
      "role": "user",
      "content": "hello hello hello hello hello hello hello hello hello hello ...<1199958 chars>"
    }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw5QPTJ9eaEuBvEJ6fyp"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "prompt is too long: 200017 tokens > 200000 maximum"
  },
  "request_id": "req_011Cfw5QPTJ9eaEuBvEJ6fyp"
}
```

### 253-ct-near-window

`POST /v1/messages/count_tokens` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "messages": [
    {
      "role": "user",
      "content": "hello hello hello hello hello hello hello hello hello hello ...<1199773 chars>"
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5QW4RaH5SxMMJDmeiY"}`

```json
{ "input_tokens": 199974 }
```

### 254-near-window-input-plus-max-exceeds-haiku45

`POST /v1/messages` → **200**

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 64,
  "messages": [
    {
      "role": "user",
      "content": "hello hello hello hello hello hello hello hello hello hello ...<1199773 chars>"
    }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw5RPd19GAtehZN3UY4E"}`

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw5RSGzn1pofSFxfaNtG",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I appreciate the creativity, but I'll just respond naturally to your greeting!\n\nHello! 👋 How can I help you today?"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 199974,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 32,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### 260-system-valid-placement-claude-opus-4-6

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 24,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "assistant", "content": "Bonjour!" },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw6T8gjvmMqW7ksrHSUN"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "role 'system' is not supported on this model"
  },
  "request_id": "req_011Cfw6T8gjvmMqW7ksrHSUN"
}
```

### 260-system-valid-placement-claude-opus-4-7

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-7",
  "max_tokens": 24,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "assistant", "content": "Bonjour!" },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw6Syi19o674KVBDrGqF"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "role 'system' is not supported on this model"
  },
  "request_id": "req_011Cfw6Syi19o674KVBDrGqF"
}
```

### 260-system-valid-placement-claude-sonnet-4-6

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 24,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "assistant", "content": "Bonjour!" },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw6T4BP631D5UNByjfDW"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "role 'system' is not supported on this model"
  },
  "request_id": "req_011Cfw6T4BP631D5UNByjfDW"
}
```

### 260-system-valid-placement-claude-sonnet-5

`POST /v1/messages` → **200**

```json
{
  "model": "claude-sonnet-5",
  "max_tokens": 24,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "assistant", "content": "Bonjour!" },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"request-id": "req_011Cfw6Sqj2HttXydes12h9C"}`

```json
{
  "model": "claude-sonnet-5",
  "id": "msg_011Cfw6SrqFdkDYxBXhoyJwt",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "thinking", "thinking": "", "signature": "<sig>" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 34,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 24,
    "output_tokens_details": { "thinking_tokens": 24 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### 261-system-misplaced-claude-opus-4-6

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 24,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw6TAthT7eASNnQoNQQU"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw6TAthT7eASNnQoNQQU"
}
```

### 261-system-misplaced-claude-opus-4-7

`POST /v1/messages` → **400**

```json
{
  "model": "claude-opus-4-7",
  "max_tokens": 24,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw6T1xRkR4gqhq1McPZ7"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw6T1xRkR4gqhq1McPZ7"
}
```

### 261-system-misplaced-claude-sonnet-4-6

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 24,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw6T6U3n1PW4RMYpLK6A"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw6T6U3n1PW4RMYpLK6A"
}
```

### 261-system-misplaced-claude-sonnet-5

`POST /v1/messages` → **400**

```json
{
  "model": "claude-sonnet-5",
  "max_tokens": 24,
  "messages": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" },
    { "role": "system", "content": "Answer only in French." },
    { "role": "user", "content": "Say good morning." }
  ]
}
```

Response headers: `{"x-should-retry": "false", "request-id": "req_011Cfw6SwUYtVZbzVcZCSrjZ"}`

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: role 'system' must follow a 'user' message or an...<197 chars>"
  },
  "request_id": "req_011Cfw6SwUYtVZbzVcZCSrjZ"
}
```
