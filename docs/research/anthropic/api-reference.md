# Anthropic Messages API: exact shapes inventory

Research date: 2026-10-12. Scope: `POST https://api.anthropic.com/v1/messages` (non-streaming), as input to the
"Anthropic Messages" API-format adapter. Docs research only; nothing here was probed live. Items marked
**PROBE** are uncertain or contradictory and should be verified with a real key.

## 0. Sources, versions, method

| Source                                                                                                                                                              | Version / date                       | Notes                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `github.com/anthropics/anthropic-sdk-typescript` `src/resources/messages/messages.ts`                                                                               | v0.133.0, HEAD `2979ed5`, 2026-10-09 | Generated from the OpenAPI spec. Most precise shape reference for the GA surface. Cited below as **SDK GA**.                                                                                     |
| same repo, `src/resources/beta/messages/messages.ts`                                                                                                                | same                                 | The `?beta=true` / `client.beta` surface, a superset of GA. Cited as **SDK beta**.                                                                                                               |
| same repo, `src/resources/beta/beta.ts`, `src/resources/shared.ts`, `src/client.ts`, `src/core/error.ts`, `src/resources/models.ts`, `src/resources/beta/models.ts` | same                                 | Beta flag list, error types, auth and retry behaviour, Models API.                                                                                                                               |
| API reference `https://platform.claude.com/docs/en/api/messages/create.md`                                                                                          | fetched 2026-10-12                   | Same schema as SDK GA, plus constraints (`minLength`, `pattern`, `maximum`) the SDK types omit.                                                                                                  |
| API reference `https://platform.claude.com/docs/en/api/beta/messages/create.md`                                                                                     | fetched 2026-10-12                   | Beta schema.                                                                                                                                                                                     |
| Guides under `https://platform.claude.com/docs/en/...` (each page has a `.md` twin)                                                                                 | fetched 2026-10-12                   | Behaviour, per-model rules, error message texts. Index: `https://platform.claude.com/llms.txt`. Pages carry `featureMetadata` front matter with `status: ga/beta` and `betaHeader`, used in 1.5. |
| Release notes `https://platform.claude.com/docs/en/release-notes/overview.md`                                                                                       | latest entry 2026-10-09              | GA transitions of former betas, behaviour changes.                                                                                                                                               |

**Scope: Claude 5-generation models only**: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`,
`claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5` (Mythos 5 / 5.1 are limited-availability
siblings of Fable and behave like them). The API also still serves Opus 4.8/4.7/4.6/4.5, Sonnet 4.6/4.5, Haiku 4.5
and Mythos Preview; their differences are mentioned in at most one line where they explain a field.

---

## 1. Endpoint, authentication, headers

### 1.1 Endpoint

`POST https://api.anthropic.com/v1/messages`, JSON body (`content-type: application/json`). Max request size 32 MB
(413 `request_too_large`, returned by Cloudflare in front of the API before the request reaches Anthropic's servers).
Sources: `api/overview`, `api/errors#request-size-limits`.

The same request shape is served by other platforms (Claude Platform on AWS, Claude in Amazon Bedrock at
`/anthropic/v1/messages`, Google Cloud, Microsoft Foundry) with different auth, different beta availability and
smaller size limits (Bedrock 20 MB, Google Cloud 30 MB). Out of scope here except where noted.

### 1.2 Authentication

| Header                      | Value                                                                                                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer <t>` | `<t>` is an API key (`sk-ant-api...`), a Workload Identity Federation access token (from `POST /v1/oauth/token`), or an App Attest token. | **Now documented as the primary method** ("Yes, unless `x-api-key` is set"). API keys work as bearer tokens. App Attest tokens expire after 1 h and authorize only Messages API calls.                                                                                                                                                                                                                              |
| `x-api-key: <key>`          | API key                                                                                                                                   | "Legacy fallback for `Authorization`, still supported." All curl samples in the docs still use it.                                                                                                                                                                                                                                                                                                                  |
| `anthropic-workspace-id`    | `wrkspc_...`                                                                                                                              | **Required** with a multi-workspace (identity-linked personal or service-account) key; omitted for single-workspace keys (if sent it must match). Missing: 400 `invalid_request_error` "anthropic-workspace-id is required when authenticating with an identity-linked API key; ...". Malformed: 400. Unknown or inaccessible: **404** `not_found_error` ``Workspace `<id>` not found.``. Not used with WIF tokens. |
| `anthropic-user-profile-id` | user profile ID                                                                                                                           | Attribute the request to a third party; requires the `user-profiles-*` beta header. SDK exposes it as `user_profile_id` on params, moved to the header.                                                                                                                                                                                                                                                             |

Key types: personal key, service-account key, workspace key (legacy). Expired key: 401 `authentication_error`.
Sources: `api/overview#authentication`, `manage-claude/authentication`, SDK `src/client.ts` (sends `X-Api-Key` for
`apiKey`, `Authorization: Bearer` for `authToken` / token providers; `apiKey` wins when both are set).

Claude.ai consumer OAuth tokens (`sk-ant-oat...`) are not mentioned anywhere in the platform docs. **PROBE** only if
we ever care; our credentials should be `{ apiKey, workspaceId? }` plus optionally a bearer token.

### 1.3 `anthropic-version`

Required on every request ("Yes" in the header table; the reference marks it `optional string` in the per-endpoint
header list, **PROBE** what a request without it returns). Versions:

| Version      | Status                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `2023-06-01` | Current and only recommended. SDK hard-codes it (`src/client.ts`). Changed SSE format, removed legacy `exception`/`truncated` values. |
| `2023-01-01` | Initial release. "Previous versions are considered deprecated and may be unavailable for new users."                                  |

Versioning policy: within a version Anthropic keeps existing input and output parameters but may add optional
inputs, add output values, add enum variants (stop reasons, block types, error types), and change error conditions.
Source: `api/versioning`. Consequence for us: unknown output block types, stop reasons, usage fields and error types
must pass through.

### 1.4 `anthropic-beta` mechanics

- Comma-separated list in one header, or the header repeated (the Claude API reads every occurrence; Google Cloud
  reads only one, so always use one comma-separated header).
- Unknown beta name, or a beta the org has no access to: **400** `invalid_request_error`, message
  ``Unexpected value(s) `invalid-beta-name` for the `anthropic-beta` header. ...``.
- Names follow `feature-YYYY-MM-DD`. Some features accept only an exact date (for example `server-side-fallback-*`
  must be `2026-07-01` or `2026-06-01`; any other date makes `fallbacks` a 400).
- A beta-only body field sent without its header is a 400 with a pydantic-style message, for example
  `block_binding: Extra inputs are not permitted`, `messages.3.clear_at: Extra inputs are not permitted`,
  `messages.N.output_config: Extra inputs are not permitted`. Beta-only content blocks sent without the header fail
  as "not one of the expected content block types" (compaction on-demand page).
- The SDK sends beta flags as the `anthropic-beta` header from `betas: [...]`; `client.beta.messages.create` posts to
  `/v1/messages?beta=true` (the query string is an SDK convention; the header is what matters).

Sources: `api/beta-headers`, `build-with-claude/errors`, `mid-conversation-system-messages`, `effort`,
`refusals-and-fallback`.

### 1.5 Beta flags relevant to Messages (as of 2026-10-12)

The SDK `AnthropicBeta` union (`src/resources/beta/beta.ts`) lists every name it knows; the API rejects unknown ones.

**Currently beta (header required for the feature):**

| Header value                                                                                                                  | Enables                                                                                                                                                             | Source                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `context-management-2025-06-27`                                                                                               | `context_management.edits` with `clear_tool_uses_20250919`, `clear_thinking_20251015`                                                                               | `build-with-claude/context-editing`                |
| `compact-2026-01-12`                                                                                                          | Threshold compaction: `context_management.edits[{type:"compact_20260112"}]`, `compaction` output blocks, `stop_reason:"compaction"` (with `pause_after_compaction`) | `build-with-claude/compaction-threshold`           |
| `compact-2026-09-04`                                                                                                          | On-demand compaction: top-level `compaction: {type:"summarize"}`; must also be sent on every later request that carries the signed block                            | `build-with-claude/compaction-on-demand`           |
| `mcp-client-2025-11-20`                                                                                                       | MCP connector: `mcp_servers`, `mcp_toolset` tool, `mcp_tool_use`/`mcp_tool_result` blocks                                                                           | `agents-and-tools/mcp-connector`                   |
| `mcp-client-2026-09-15`                                                                                                       | Superset of the above plus `mcp_tool_listing` output blocks and pinned `mcp_toolset.tools`; must be sent on every request carrying a listing block                  | `mid-conversation-system-messages`                 |
| `inline-tools-2026-09-15`                                                                                                     | `tool_addition` / `tool_removal` blocks in `role:"system"` messages, including tools defined by value                                                               | `mid-conversation-system-messages`                 |
| `mid-conversation-tool-changes-2026-07-01`                                                                                    | Older header for tool changes by reference only                                                                                                                     | same                                               |
| `mid-conversation-system-clear-at-2026-08-21`                                                                                 | `clear_at` on `role:"system"` messages (turn-scoped)                                                                                                                | same                                               |
| `mid-conversation-output-config-2026-07-01`                                                                                   | per-message `output_config.effort` on `role:"system"` messages                                                                                                      | `build-with-claude/effort`                         |
| `thinking-binding-controls-2026-08-01`                                                                                        | `thinking.block_binding.prefix_mismatch_behavior` and response `input_transformations`                                                                              | `build-with-claude/preserved-thinking`             |
| `thinking-display-updates-2026-08-18`                                                                                         | `thinking.display: "updates"`                                                                                                                                       | `build-with-claude/thinking`                       |
| `thinking-token-count-2026-05-13`                                                                                             | `estimated_tokens` on streaming `thinking_delta` (streaming only, irrelevant to us)                                                                                 | SDK beta                                           |
| `server-side-fallback-2026-07-01` (or `-2026-06-01`, list form only)                                                          | `fallbacks` parameter; `fallback` output block; `stop_details.recommended_model`                                                                                    | `build-with-claude/refusals-and-fallback`          |
| `fallback-credit-2026-07-01` (`-2026-06-01`)                                                                                  | `fallback_credit_token` (object form needs `2026-07-01`), `usage.fallback_credit`; refusal `stop_details.fallback_credit_token`                                     | `build-with-claude/fallback-credit`                |
| `fast-mode-2026-02-01`                                                                                                        | `speed: "fast"` (research preview, Opus 5.5 / Opus 5 / Opus 4.8 only); `usage.speed`                                                                                | `build-with-claude/fast-mode`                      |
| `task-budgets-2026-03-13`                                                                                                     | `output_config.task_budget`                                                                                                                                         | `build-with-claude/task-budgets`                   |
| `advisor-tool-2026-03-01`                                                                                                     | `advisor_20260301` tool, `advisor_tool_result` blocks, `advisor_message` usage iterations                                                                           | SDK beta, `agents-and-tools/tool-use/advisor-tool` |
| `user-profiles-2026-09-04` (also `-2026-03-24`, `-2026-08-18`)                                                                | `anthropic-user-profile-id` header                                                                                                                                  | SDK                                                |
| `model-context-window-exceeded-2025-08-26`                                                                                    | `stop_reason:"model_context_window_exceeded"` on models **before** Claude 4.5 (default on 4.5 and newer)                                                            | `handling-stop-reasons`                            |
| `interleaved-thinking-2025-05-14`                                                                                             | interleaved thinking under manual extended thinking on Opus 4.5, Sonnet 4.5 and earlier Claude 4 (automatic with adaptive thinking)                                 | `extended-thinking`                                |
| `computer-use-2025-11-24` / `computer-use-2025-01-24` / `computer-use-2024-10-22`                                             | legacy `computer_20251124` / `computer_20250124` / `computer_20241022` tools (rejected on Opus 5.5, Sonnet 5.5, Haiku 5.5 on the Claude API)                        | `api/errors`                                       |
| `output-300k-2026-03-24`                                                                                                      | Batches only: raises `max_tokens` ceiling to 300K                                                                                                                   | `thinking#output-limits`                           |
| `managed-agents-2026-04-01`, `agent-memory-2026-07-22`, `mcp-tunnels-2026-06-22`, `dreaming-*`, `ce-*`, `spend-limit-reads-*` | other endpoints, not Messages                                                                                                                                       | `api/beta-headers`                                 |

**Former betas now GA (header no longer needed; sending it is still accepted):**

| Former header                                                                                                                                                           | GA since                                                                  | Source (release notes)                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `cache-diagnosis-2026-04-07` (request `diagnostics`)                                                                                                                    | 2026-09-23                                                                | "Cache diagnostics is out of beta"                                                        |
| `files-api-2025-04-14` (Files API and `file_id` sources)                                                                                                                | 2026-08-19                                                                | "The Files API is out of beta" (header still selects the old `/v1/files` response format) |
| `skills-2025-10-02` (`container.skills`)                                                                                                                                | 2026-08-19                                                                | "Agent Skills ... out of beta"                                                            |
| computer use as `computer_toolset_20260801` (no header)                                                                                                                 | 2026-08-19                                                                | "computer use tool is out of beta ... as the `computer_toolset_20260801` toolset"         |
| `structured-outputs-2025-11-13` (`output_format` moved to `output_config.format`)                                                                                       | 2026-01-29                                                                | "Structured outputs are out of beta"                                                      |
| effort (`output_config.effort`)                                                                                                                                         | 2026-02-05                                                                | "The effort parameter no longer requires a beta header"                                   |
| fine-grained tool streaming                                                                                                                                             | 2026-02-05                                                                | release notes                                                                             |
| code execution, web fetch, tool search, tool use examples (`input_examples`), memory tool, web search, programmatic tool calling                                        | 2026-02-17                                                                | release notes                                                                             |
| `context-1m-2025-08-07`                                                                                                                                                 | 1M is default on 4.6+ (2026-03-13); retired for Sonnet 4/4.5 (2026-04-30) | release notes                                                                             |
| `extended-cache-ttl-2025-04-11` (1h TTL)                                                                                                                                | 2025-08-13                                                                | release notes                                                                             |
| search result blocks (`search-results-2025-06-09`)                                                                                                                      | 2025-08-08                                                                | release notes                                                                             |
| `token-counting-2024-11-01`, `prompt-caching-2024-07-31`, `pdfs-2024-09-25`, `message-batches-2024-09-24`, `token-efficient-tools-2025-02-19`, `output-128k-2025-02-19` | long ago                                                                  | still in the SDK union for compatibility                                                  |
| mid-conversation `role:"system"` messages (no header ever)                                                                                                              | 2026-05-28 (Opus 4.8), more models 2026-07-15                             | release notes                                                                             |
| `stop_details` on refusals                                                                                                                                              | 2026-05-28                                                                | release notes                                                                             |
| `usage.output_tokens_details.thinking_tokens`                                                                                                                           | 2026-05-27                                                                | release notes                                                                             |
| `mcp-client-2025-04-04`                                                                                                                                                 | deprecated (replaced by `-2025-11-20`)                                    | `mcp-connector`                                                                           |

### 1.6 Other request headers

| Header                                            | Purpose                                                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content-type: application/json`                  | Required.                                                                                                                                                         |
| `anthropic-dangerous-direct-browser-access: true` | SDK sends it only when `dangerouslyAllowBrowser` is set: enables CORS for browser callers. Relevant only to SDK "direct mode" in a browser (SDK `src/client.ts`). |
| `X-Stainless-*`, `User-Agent`                     | SDK telemetry (`X-Stainless-Retry-Count`, `X-Stainless-Timeout`, platform headers). Not needed.                                                                   |
| `x-stainless-helper` style header                 | SDK `stainlessHelperHeader` (tool runner telemetry). Not needed.                                                                                                  |

### 1.7 Response headers

| Header                                                                                     | Notes                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request-id`                                                                               | `req_...`, on every response (success and error). Same value as body `request_id` on errors.                                                                                                 |
| `anthropic-organization-id`                                                                | Org of the credential.                                                                                                                                                                       |
| `anthropic-workspace-id`                                                                   | Workspace the credential resolved to; absent when the request fails before auth.                                                                                                             |
| `retry-after`                                                                              | Seconds. On 429 rate limits (and fast-mode 429s). **Not sent on the monthly spend-cap 429.**                                                                                                 |
| `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}` | `reset` is RFC 3339. `tokens-*` show the most restrictive limit in effect.                                                                                                                   |
| `anthropic-priority-{input,output}-tokens-{limit,remaining,reset}`                         | Priority Tier only.                                                                                                                                                                          |
| `anthropic-fast-{input,output}-tokens-{limit,remaining,reset}`                             | Fast mode.                                                                                                                                                                                   |
| `x-should-retry: true/false`, `retry-after-ms`                                             | **Undocumented in the API docs** but honoured by the SDK retry logic (`src/client.ts`: "If the server explicitly says whether or not to retry, obey"). **PROBE** whether the API sends them. |
| `x-amzn-requestid`                                                                         | Claude Platform on AWS only.                                                                                                                                                                 |

Sources: `api/overview#response-headers`, `api/rate-limits#response-headers`, `fast-mode`, SDK `src/client.ts`.

---

## 2. Request body (Messages create)

### 2.1 Field table, GA (`POST /v1/messages`)

Sources: SDK GA `MessageCreateParamsBase`; `api/messages/create.md`.

| Field            | Type                                                                                                                                                    | Req. | Default / constraints                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`          | string                                                                                                                                                  | yes  | Any model ID (`Model` union is open: `(string & {})`).                                                                                                                                                                                                                                                                                                                    |
| `max_tokens`     | integer                                                                                                                                                 | yes  | `minimum: 0`. `0` = cache pre-warm (no output, empty `content`, `stop_reason:"max_tokens"`; rejected in batches and with manual extended thinking). Per-model ceiling: 128K on all 4.6+ models and Mythos Preview, 64K on Opus 4.5, Sonnet 4.5, Haiku 4.5 (`thinking#output-limits`). Exceeding the ceiling: 400 (**PROBE** exact message). Includes all thinking tokens. |
| `messages`       | `MessageParam[]`                                                                                                                                        | yes  | Max 100,000 messages. See section 3.                                                                                                                                                                                                                                                                                                                                      |
| `system`         | `string \| TextBlockParam[]`                                                                                                                            | no   | Text blocks: `text` `minLength: 1`, optional `cache_control`, `citations`. No image/document blocks allowed in `system`.                                                                                                                                                                                                                                                  |
| `metadata`       | `{ user_id?: string \| null }`                                                                                                                          | no   | `user_id` maxLength 512; opaque ID only (no PII).                                                                                                                                                                                                                                                                                                                         |
| `stop_sequences` | `string[]`                                                                                                                                              | no   | No documented count or length limits. **PROBE**. Not allowed on compaction requests.                                                                                                                                                                                                                                                                                      |
| `temperature`    | number                                                                                                                                                  | no   | Deprecated. `0..1`, default `1.0`. See 2.3.                                                                                                                                                                                                                                                                                                                               |
| `top_p`          | number                                                                                                                                                  | no   | Deprecated. `0..1`, default `0.99` (changed from 0.999 on 2025-05-22). See 2.3.                                                                                                                                                                                                                                                                                           |
| `top_k`          | integer                                                                                                                                                 | no   | Deprecated. `minimum: 0`. See 2.3.                                                                                                                                                                                                                                                                                                                                        |
| `thinking`       | `{type:"adaptive",display?} \| {type:"enabled",budget_tokens,display?} \| {type:"disabled"} \| {type:"between_tools"}`                                  | no   | Per-model rules in 2.4. `display`: `"summarized" \| "omitted"` (`"updates"` beta). `budget_tokens >= 1024` and `< max_tokens` (except interleaved thinking).                                                                                                                                                                                                              |
| `output_config`  | `{ effort?, format? }`                                                                                                                                  | no   | `effort`: `low \| medium \| high \| xhigh \| max \| null`. `format`: `{type:"json_schema", schema}`. See 2.5.                                                                                                                                                                                                                                                             |
| `tools`          | `ToolUnion[]`                                                                                                                                           | no   | Custom tools and Anthropic-defined tool versions. See 2.6.                                                                                                                                                                                                                                                                                                                |
| `tool_choice`    | `{type:"auto",disable_parallel_tool_use?} \| {type:"any",disable_parallel_tool_use?} \| {type:"tool",name,disable_parallel_tool_use?} \| {type:"none"}` | no   | Default `auto`. `disable_parallel_tool_use` default `false` ("at most one" for auto, "exactly one" for any/tool). Forced types refused on some models (2.7).                                                                                                                                                                                                              |
| `service_tier`   | `"auto" \| "standard_only"`                                                                                                                             | no   | Default `auto` (use Priority Tier capacity if the org has a commitment). Priority Tier commitments are no longer sold.                                                                                                                                                                                                                                                    |
| `inference_geo`  | `string \| null`                                                                                                                                        | no   | `"global"` (default unless the workspace sets `default_inference_geo`) or `"us"`. Supported on 4.6+ models only; on Opus 4.5, Sonnet 4.5, Haiku 4.5 and earlier: 400. Not in workspace `allowed_inference_geos`: error. `"us"` costs 1.1x. (`manage-claude/data-residency`)                                                                                               |
| `container`      | `string \| { id?: string \| null, skills?: SkillParams[] \| null } \| null`                                                                             | no   | Container ID to reuse (code execution, programmatic tool calling, skills). `skills` maxItems 20; each `{type:"anthropic"\|"custom", skill_id (1..64), version? (1..64, or "latest")}`.                                                                                                                                                                                    |
| `cache_control`  | `{type:"ephemeral", ttl?: "5m" \| "1h"} \| null`                                                                                                        | no   | **Top-level automatic caching** (GA 2026-02-19): puts a breakpoint on the last cacheable block. Counts as one of the 4 breakpoint slots; 400 if 4 explicit breakpoints already exist or the last block has an explicit breakpoint with a different TTL.                                                                                                                   |
| `diagnostics`    | `{ previous_message_id?: string \| null } \| null`                                                                                                      | no   | Cache diagnostics (GA 2026-09-23). `previous_message_id` maxLength 256; `null` on the first turn opts in. Response then carries `diagnostics.cache_miss_reason`.                                                                                                                                                                                                          |
| `stream`         | boolean                                                                                                                                                 | no   | We refuse `true`.                                                                                                                                                                                                                                                                                                                                                         |

Header params that the SDK takes as body-level params and strips: `workspace_id` -> `anthropic-workspace-id`,
`user_profile_id` -> `anthropic-user-profile-id`, (beta) `betas` -> `anthropic-beta`.

### 2.2 Field table, beta-only (`client.beta.messages.create`)

Source: SDK beta `MessageCreateParamsBase`; `api/beta/messages/create.md`. Each needs its beta header (1.5).

| Field                       | Type                                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context_management`        | `{ edits?: Array<ClearToolUses20250919 \| ClearThinking20251015 \| Compact20260112> } \| null`            | `clear_tool_uses_20250919`: `trigger` (`{type:"input_tokens"\|"tool_uses", value}`), `keep` (`{type:"tool_uses",value}`), `clear_at_least` (`{type:"input_tokens",value}`), `clear_tool_inputs` (bool or names), `exclude_tools`. `clear_thinking_20251015`: `keep` (`{type:"thinking_turns",value}` or `"all"`). `compact_20260112`: `trigger` (input_tokens, default 150,000, min 50,000), `pause_after_compaction` (default false), `instructions`. Cannot be combined with `compaction`. |
| `compaction`                | `{ type: "summarize", instructions?: string \| null } \| null`                                            | Makes the request a compaction request: returns only one `compaction` block with `stop_reason:"compaction"`. Rejects `stop_sequences`, `output_config.format`, forced `tool_choice`, and `output_config.task_budget.remaining`. count_tokens accepts and ignores it.                                                                                                                                                                                                                         |
| `mcp_servers`               | `Array<{ type:"url", name, url, authorization_token?, tool_configuration?: {allowed_tools?, enabled?} }>` | `url` must be `https://`. Tool calls only (no MCP prompts/resources). Not ZDR-eligible. Secrets: never log.                                                                                                                                                                                                                                                                                                                                                                                  |
| `fallbacks`                 | `"default" \| Array<{ model, max_tokens?, thinking?, output_config?, speed? }>`                           | Server-side refusal fallback, up to 3 entries; each must be in the model's `allowed_fallback_models` (beta Models API). Not on Haiku 5.5 (list form is a 400), not in batches.                                                                                                                                                                                                                                                                                                               |
| `fallback_credit_token`     | `string \| { token, mode?: "strict" \| "best_effort" } \| null`                                           | From a prior refusal's `stop_details.fallback_credit_token`; 5-minute validity, exact body match.                                                                                                                                                                                                                                                                                                                                                                                            |
| `speed`                     | `"standard" \| "fast" \| null`                                                                            | Fast mode. Unsupported model: error (Opus 4.7) or silently standard (Opus 4.6, reported in `usage.speed`).                                                                                                                                                                                                                                                                                                                                                                                   |
| `output_format`             | `{type:"json_schema", schema} \| null`                                                                    | Deprecated alias of `output_config.format`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `output_config.task_budget` | `{ type:"tokens", total, remaining? }`                                                                    | Task budgets beta.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `thinking.block_binding`    | `{ prefix_mismatch_behavior?: "error" \| "drop_block" \| null }`                                          | Only on `adaptive` / `enabled`; with `between_tools` it is a 400.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `thinking.display`          | adds `"updates"`                                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| message `clear_at`          | `"next_user_message" \| "never" \| null`                                                                  | Only on `role:"system"` messages.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| message `output_config`     | `{ effort? }`                                                                                             | Only on `role:"system"` messages; `format` stays top-level only.                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 2.3 Sampling parameters (`temperature`, `top_p`, `top_k`)

| Source                            | Rule for every 5-generation model                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `thinking#sampling-parameters`    | Non-default values return 400 on every request. `top_p` default is `0.99`, so `top_p: 1` is a 400. **A request with both `temperature` and `top_p` is a 400 even at their defaults.**                                    |
| SDK / reference deprecation notes | "Models released after Claude Opus 4.6": `temperature` 1.0 accepted, everything else 400; `top_p >= 0.99` accepted; `top_k` any value 400. "`top_p >= 0.99` accepted" contradicts "`top_p: 1` returns a 400". **PROBE.** |

(Opus 4.6 / Sonnet 4.6 and older restrict these only while thinking is on.) In practice: the adapter should never
send them; callers who pass them in `providerOptions` get the provider's 400.

### 2.4 `thinking` per model

Source: `build-with-claude/thinking#configuring-thinking` (table reproduced), `api/errors`, `thinking-troubleshooting`.

| Model                                    | field omitted | `adaptive` | `enabled`+budget | `between_tools`                       | `disabled`                             | `display` default |
| ---------------------------------------- | ------------- | ---------- | ---------------- | ------------------------------------- | -------------------------------------- | ----------------- |
| Opus 5.5                                 | adaptive      | adaptive   | 400              | 400                                   | 400                                    | `omitted`         |
| Sonnet 5.5                               | adaptive      | adaptive   | 400              | up-front thinking off, effort <= high | 400 (message says use `between_tools`) | `omitted`         |
| Haiku 5.5                                | adaptive      | adaptive   | 400              | 400                                   | off, effort <= high                    | `omitted`         |
| Fable 5.1, Mythos 5.1, Fable 5, Mythos 5 | adaptive      | adaptive   | 400              | 400                                   | 400                                    | `omitted`         |
| Opus 5                                   | adaptive      | adaptive   | 400              | 400                                   | off, effort <= high                    | `omitted`         |
| Sonnet 5                                 | adaptive      | adaptive   | 400              | 400                                   | off                                    | `omitted`         |

(4.x models: thinking is off when the field is omitted, and 4.5 and older accept only `enabled`+`budget_tokens`;
`budget_tokens` and `display: "summarized"` defaults belong to that generation.)

Other rules:

- `display: "omitted"` returns `thinking` blocks with `thinking: ""` and a full `signature`; billing is identical.
  `display` is invalid with `disabled` and with `between_tools` (which takes no other field).
- Adaptive thinking may produce no thinking block at all on simple requests.
- Thinking mode cannot change inside a tool-use turn; if it does, the API **silently disables thinking for that
  request** and may strip thinking blocks (documented graceful degradation, not an error).
- Under manual extended thinking the final assistant turn of a thinking-enabled request must begin with a thinking
  block; adaptive relaxes this.
- Changing the thinking config or the effort level changes the cached prefix (cache miss).

### 2.5 `output_config`

**`effort`** (GA, `build-with-claude/effort`): all five levels (`low`, `medium`, `high`, `xhigh`, `max`) on every
5-generation model. Defaults: `medium` on Opus 5.5 and Haiku 5.5, `high` on Sonnet 5.5, Fable 5.1, Fable 5, Opus 5,
Sonnet 5. (Sonnet 4.5 and Haiku 4.5 have no effort.) With thinking off (`disabled`/`between_tools`),
`xhigh`/`max` is a 400:
`output_config.effort 'xhigh' is not supported when thinking is disabled on this model. Use effort 'high' or below, or enable thinking.`
Setting effort to the default is identical to omitting it (cache-wise too).

**`format`** (structured outputs, GA): `{ type: "json_schema", schema }`. JSON Schema subset; unsupported features
return 400. Limits per request: at most 20 tools with `strict: true`, at most 24 optional parameters across all strict
schemas and the format schema, plus internal grammar-size limits. Incompatible with citations (400 if any document or
search result has citations enabled) and with prefill. A refusal can produce output that violates the schema; enum
values can come back with different case. Grammar applies only to the final text, not thinking or tool calls.
Source: `build-with-claude/structured-outputs`.

### 2.6 `tools`

**Custom tool** (`Tool`, SDK GA):

| Field                   | Type                                                                                                     | Notes                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `name`                  | string                                                                                                   | `^[a-zA-Z0-9_-]{1,128}$`                                     |
| `input_schema`          | `{ type: "object", properties?, required?, ...any }`                                                     | JSON Schema 2020-12. `type:"object"` mandatory.              |
| `description`           | string                                                                                                   | optional, no documented limit                                |
| `type`                  | `"custom" \| null`                                                                                       | optional                                                     |
| `strict`                | boolean                                                                                                  | grammar-constrained inputs (20 strict tools max per request) |
| `input_examples`        | `object[]`                                                                                               | GA since 2026-02-17                                          |
| `defer_loading`         | boolean                                                                                                  | withheld until surfaced by tool search or `tool_addition`    |
| `allowed_callers`       | `Array<"direct" \| "code_execution_20250825" \| "code_execution_20260120" \| "code_execution_20260521">` | programmatic tool calling                                    |
| `eager_input_streaming` | `boolean \| null`                                                                                        | streaming only                                               |
| `cache_control`         | CacheControlEphemeral                                                                                    | breakpoint after the tools array prefix                      |

There is no OpenAI-style "custom (free-form text) tool" in Anthropic; every custom tool has a JSON `input_schema`.

**Anthropic-defined tools** (fixed `name`, versioned `type`). GA (SDK GA `ToolUnion`):

| `type`                                                             | `name`                                                              | Executed by                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------- |
| `bash_20250124`                                                    | `bash`                                                              | client (`tool_use`/`tool_result`) |
| `text_editor_20250124`                                             | `str_replace_editor`                                                | client                            |
| `text_editor_20250429`, `text_editor_20250728`                     | `str_replace_based_edit_tool`                                       | client                            |
| `memory_20250818`                                                  | `memory`                                                            | client                            |
| `computer_toolset_20260801`                                        | (toolset; members like `left_click` with `toolset_name:"computer"`) | client                            |
| `browser_toolset_20260801`                                         | (toolset; members with `toolset_name:"browser"`)                    | client                            |
| `code_execution_20250522`, `_20250825`, `_20260120`, `_20260521`   | `code_execution`                                                    | server                            |
| `web_search_20250305`, `_20260209`, `_20260318`                    | `web_search`                                                        | server                            |
| `web_fetch_20250910`, `_20260209`, `_20260309`, `_20260318`        | `web_fetch`                                                         | server                            |
| `tool_search_tool_bm25_20251119` (alias `tool_search_tool_bm25`)   | `tool_search_tool_bm25`                                             | server                            |
| `tool_search_tool_regex_20251119` (alias `tool_search_tool_regex`) | `tool_search_tool_regex`                                            | server                            |

Beta-only: `bash_20241022`, `text_editor_20241022`, `computer_20241022`/`_20250124`/`_20251124` (`name:"computer"`),
`advisor_20260301` (`name:"advisor"`, server, has its own `model`, `max_tokens`, `max_uses`, `caching`),
`mcp_toolset` (`{ mcp_server_name, default_config?, configs?, tools?, cache_control? }`).
An Anthropic-defined tool type the model doesn't support: 400 `'<model>' does not support tool types: <type>. Did you mean one of ...`.
Sources: SDK GA/beta tool interfaces; `api/errors#computer-use-tool-version-not-supported`.

### 2.7 `tool_choice` restrictions

- Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1: `any` and `tool` are a 400 on every request (also on count_tokens):
  `tool_choice: type "tool" and "any" are not supported for this model.`
- Manual extended thinking (`enabled`): only `auto` and `none`.
- Where forced tool use is accepted, the response starts with the tool call and has no thinking block.

---

## 3. Message structure rules

Sources: SDK GA `MessageParam` and its doc comment; `api/messages/create.md`; `mid-conversation-system-messages`;
`handle-tool-calls`; `api/errors`.

| Rule                         | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles                        | `"user" \| "assistant" \| "system"` (GA type and GA reference). The prose in the same reference still says "there is no `system` role for input messages"; that sentence is stale.                                                                                                                                                                                                                                                                                   |
| `role:"system"` availability | No beta header. Fable 5.1, Mythos 5.1, Fable 5, Mythos 5, Opus 5.5, Opus 5, Opus 4.8, Sonnet 5.5, Haiku 5.5. **Not** Sonnet 5 ("Use the top-level `system` field there"), nor 4.7 and older. **PROBE** the error on unsupported models.                                                                                                                                                                                                                              |
| `role:"system"` placement    | A system message with content must immediately follow a `user` turn (including a tool-result user turn) or an `assistant` turn ending in a server tool result, and must either be last or be followed by an `assistant` turn. Never first in `messages`; never between a `tool_use` and its `tool_result`. Consecutive system messages are judged as one. An effort-only system message (empty `content`, `output_config.effort`) may sit anywhere. Violations: 400. |
| `role:"system"` content      | string or `text` blocks; with betas also `tool_addition` / `tool_removal` blocks. Later system messages override earlier ones and the top-level `system`. Don't put untrusted content there (operator authority). On Sonnet 5.5 and Haiku 5.5 a system message right after tool results may be treated as untrusted; relay user input as a text block after the tool results instead.                                                                                |
| Alternation                  | "Consecutive `user` or `assistant` turns in your request will be combined into a single turn." So alternation is not required; same-role runs are merged server-side.                                                                                                                                                                                                                                                                                                |
| First message                | Not documented as required to be `user` (only "system message cannot be first"). Compaction docs show a conversation starting with an `assistant` message holding a `compaction` block. **PROBE** a plain assistant-first request.                                                                                                                                                                                                                                   |
| Content                      | `string` (shorthand for one text block) or `ContentBlockParam[]`. Text blocks: `text` minLength 1. Empty string content, `[]`, and whitespace-only text are not documented. **PROBE.**                                                                                                                                                                                                                                                                               |
| Final assistant = prefill    | The response continues from it. **Rejected (400) on Claude 4.6 and later and Mythos Preview**: `This model does not support assistant message prefill. The conversation must end with a user message.` Earlier models: not allowed while thinking is on; incompatible with `output_config.format`. A refusal's `fallback_credit_token` can authorize one prefill continuation.                                                                                       |
| Tool results                 | `tool_result` blocks must be in the `user` message immediately after the assistant message with the `tool_use`, and must come **first** in that message's content; text only after all results. Otherwise 400 `tool_use ids were found without tool_result blocks immediately after`. Every `tool_use` needs a result.                                                                                                                                               |
| Pending server tool          | If the assistant turn has a `server_tool_use` (or `mcp_tool_use`) without a result block (stop_reason `tool_use`), the next user message must contain **only** `tool_result` blocks and the same `tools`; extra text ends the turn and yields 400 ``... `web_search` tool use with id `srvtoolu_...` was found without a corresponding `web_search_tool_result` block``.                                                                                             |
| Thinking blocks              | Must be sent back unmodified, in original order, including empty ones and `redacted_thinking`, at least within a tool-use turn. Modified blocks in the latest assistant message: 400 ``... `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified ...``. Text in an omitted block's empty `thinking` field is ignored.                                                                                                          |
| Prefix binding (new)         | On Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 a replayed thinking block is valid only while `system`, `tools` and every earlier message are byte-identical to when it was produced. Enforced by default for accounts created on or after 2026-08-31 (400 `messages.{i}.content.{j}: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. ...`); older accounts only when `block_binding` is set. See 4.3.                    |
| Limits                       | 100,000 messages; 600 images or PDF pages per request (100 on 200k-context models); request <= 32 MB.                                                                                                                                                                                                                                                                                                                                                                |

---

## 4. Input content blocks

Sources: SDK GA `ContentBlockParam`, SDK beta `BetaContentBlockParam`, `api/messages/create.md` (constraints).
"Where" = role it normally appears in.

### 4.1 Block table

| `type`                                   | Where                                                                    | Fields                                                                                                                                                                                                                                                                                                                              | GA/beta |
| ---------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `text`                                   | any                                                                      | `text` (minLength 1), `cache_control?`, `citations?: TextCitationParam[] \| null`                                                                                                                                                                                                                                                   | GA      |
| `image`                                  | user, tool_result                                                        | `source` (4.2), `cache_control?`, `transformations?: { oversized_image?: "downsize" \| "error" }`                                                                                                                                                                                                                                   | GA      |
| `document`                               | user, tool_result                                                        | `source` (4.2), `cache_control?`, `citations?: { enabled?: boolean }`, `context?` (minLength 1), `title?` (1..500)                                                                                                                                                                                                                  | GA      |
| `search_result`                          | user, tool_result                                                        | `source: string`, `title: string`, `content: TextBlockParam[]`, `cache_control?`, `citations?: {enabled?}`                                                                                                                                                                                                                          | GA      |
| `tool_use`                               | assistant                                                                | `id` (`^[a-zA-Z0-9_-]+$`), `name` (1..200), `input: object`, `cache_control?`, `caller?: {type:"direct"} \| {type:"code_execution_20250825"\|"code_execution_20260120", tool_id: "srvtoolu_..."}`, `toolset_name?` (1..64)                                                                                                          | GA      |
| `tool_result`                            | user                                                                     | `tool_use_id`, `content?: string \| Array<text \| image \| search_result \| document \| tool_reference \| browser_state>`, `is_error?: boolean`, `cache_control?`, `toolset_name?` (must echo the `tool_use`'s `toolset_name` for computer/browser toolset members, whose results may only hold text/image and one `browser_state`) | GA      |
| `thinking`                               | assistant                                                                | `thinking: string`, `signature: string`                                                                                                                                                                                                                                                                                             | GA      |
| `redacted_thinking`                      | assistant                                                                | `data: string`                                                                                                                                                                                                                                                                                                                      | GA      |
| `server_tool_use`                        | assistant                                                                | `id` (`^srvtoolu_[a-zA-Z0-9_]+$`), `name: web_search \| web_fetch \| code_execution \| bash_code_execution \| text_editor_code_execution \| tool_search_tool_regex \| tool_search_tool_bm25` (beta adds `advisor`), `input`, `caller?`, `cache_control?`                                                                            | GA      |
| `web_search_tool_result`                 | assistant                                                                | `tool_use_id`, `content: WebSearchResult[] \| {type:"web_search_tool_result_error", error_code}`, `caller?`, `cache_control?`. Result: `{type:"web_search_result", url, title, encrypted_content, page_age?}`                                                                                                                       | GA      |
| `web_fetch_tool_result`                  | assistant                                                                | `tool_use_id`, `content: {type:"web_fetch_result", url, content: DocumentBlockParam, retrieved_at?} \| {type:"web_fetch_tool_result_error", error_code}`, `caller?`                                                                                                                                                                 | GA      |
| `code_execution_tool_result`             | assistant                                                                | `content: code_execution_result {stdout, stderr, return_code, content:[{type:"code_execution_output", file_id}]} \| encrypted_code_execution_result {encrypted_stdout, stderr, return_code, content} \| code_execution_tool_result_error {error_code}`                                                                              | GA      |
| `bash_code_execution_tool_result`        | assistant                                                                | `content: bash_code_execution_result {stdout, stderr, return_code, content:[{type:"bash_code_execution_output", file_id}]} \| ..._error`                                                                                                                                                                                            | GA      |
| `text_editor_code_execution_tool_result` | assistant                                                                | `content: ..._view_result {content, file_type, num_lines?, start_line?, total_lines?} \| ..._create_result {is_file_update} \| ..._str_replace_result {lines?, new_lines?, new_start?, old_lines?, old_start?} \| ..._error {error_code, error_message?}`                                                                           | GA      |
| `tool_search_tool_result`                | assistant                                                                | `content: {type:"tool_search_tool_search_result", tool_references:[{type:"tool_reference", tool_name}]} \| ..._error`                                                                                                                                                                                                               | GA      |
| `container_upload`                       | user                                                                     | `file_id`, `cache_control?` (file into the code-execution container)                                                                                                                                                                                                                                                                | GA      |
| `tool_reference`                         | inside tool_result                                                       | `tool_name` (`^[a-zA-Z0-9_-]{1,256}$`), `cache_control?`                                                                                                                                                                                                                                                                            | GA      |
| `browser_state`                          | inside tool_result                                                       | `tabs: [{tab_id, title, url, active?}]` (max 100), `state_changes?` (tab_opened, download_started/completed/failed; 1..200), `cache_control?`                                                                                                                                                                                       | GA      |
| `compaction`                             | assistant (first block of history for on-demand; in place for threshold) | `content?: string \| null`, `encrypted_content?`, `signature?`, `tool_changes?`, `cache_control?`                                                                                                                                                                                                                                   | beta    |
| `mcp_tool_use`                           | assistant                                                                | `id`, `name`, `server_name`, `input`, `cache_control?`                                                                                                                                                                                                                                                                              | beta    |
| `mcp_tool_result`                        | assistant                                                                | `tool_use_id`, `content?: string \| TextBlockParam[]`, `is_error?`, `cache_control?`                                                                                                                                                                                                                                                | beta    |
| `mcp_tool_listing`                       | assistant                                                                | `mcp_server_name`, `tools: [{name, input_schema, description?}]`                                                                                                                                                                                                                                                                    | beta    |
| `advisor_tool_result`                    | assistant                                                                | `tool_use_id`, `content: advisor_result {text, stop_reason?} \| advisor_redacted_result {encrypted_content, stop_reason?} \| advisor_tool_result_error {error_code}`                                                                                                                                                                | beta    |
| `fallback`                               | assistant                                                                | `from: {model}`, `to: {model}`, `trigger?` (ignored). Must stay in its original position when thinking blocks flank it.                                                                                                                                                                                                             | beta    |
| `tool_addition` / `tool_removal`         | system                                                                   | `tool: {type:"tool_reference", name} \| {type:"mcp_tool_reference", server_name, name} \| {type:"mcp_toolset_reference", server_name} \| {type:"tool_definition", definition}` (definition only on addition), `cache_control?`                                                                                                      | beta    |
| `connector_text`                         | assistant                                                                | Mentioned in docs ("narration text ... between tool calls") and in `input_transformations` comments; **no type in the SDK**. Pass through unknown.                                                                                                                                                                                  | ?       |

All block params accept `cache_control` except `thinking`/`redacted_thinking` (cannot be cached directly; cached as
part of the prefix) and the nested result payloads. Empty text blocks cannot be cached.

### 4.2 Sources

| Block      | `source.type` | Fields                                                                                                               |
| ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `image`    | `base64`      | `data`, `media_type: image/jpeg \| image/png \| image/gif \| image/webp`                                             |
| `image`    | `url`         | `url`                                                                                                                |
| `image`    | `file`        | `file_id` (Files API, GA since 2026-08-19)                                                                           |
| `document` | `base64`      | `data`, `media_type: "application/pdf"`                                                                              |
| `document` | `text`        | `data`, `media_type: "text/plain"` (inline plain text)                                                               |
| `document` | `content`     | `content: string \| Array<TextBlockParam \| ImageBlockParam>` (custom-chunked document; citations use block indices) |
| `document` | `url`         | `url` (PDF only)                                                                                                     |
| `document` | `file`        | `file_id` (PDF or `text/plain` uploads)                                                                              |

Limits (`build-with-claude/vision`, `pdf-support`): images JPEG/PNG/GIF/WebP (GIF: first frame only), max 8000x8000
px, max 10 MB per image (base64) on the Claude API; with more than 20 image (and on partner platforms document)
blocks in a request, every image must be <= 2000x2000 or the request is rejected (`invalid_request_error`
mentioning "many-image requests"). PDFs: no encryption, 600 pages (100 under a sub-1M context). No `.docx`/`.xlsx`
documents (convert first). No audio or video input at all. Oversized images are silently downscaled unless
`transformations.oversized_image: "error"`, which turns that into a 400. Files uploaded to the Files API are visible
to the whole workspace.

### 4.3 Replay and binding rules for assistant content (critical for verbatim replay)

From `build-with-claude/thinking`, `preserved-thinking`, `refusals-and-fallback`, `api/errors`:

1. Send every assistant turn back exactly as returned. Within the latest assistant message the run of thinking
   blocks must match the original.
2. **Model binding.** A thinking block is readable only by the model that produced it and a fixed set of others.
   Blocks the target model cannot read are **dropped silently** (not billed, not an error). Examples: Fable 5.1 and
   Mythos 5.1 read earlier models' blocks, nobody else reads theirs; Opus 5.5 reads Opus 5 and earlier
   Opus/Sonnet/Haiku blocks (and Haiku 5.5 on Claude API/Google Cloud) but not Fable/Mythos; only Opus 5.5 reads
   Sonnet 5.5 blocks (Claude API/Google Cloud).
3. **Account binding.** Sonnet 5.5 and Haiku 5.5 blocks work only in the producing account (or a linked one);
   elsewhere they are dropped and the request succeeds.
4. **Prefix binding.** On Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5: a block is valid only while `system`, `tools`
   and all messages before it are unchanged (byte-identical; a URL source returning different bytes counts as a
   change). Allowed changes: appending messages, adding a `defer_loading` tool, removing thinking blocks from the very
   start or end of history (or all), changing any parameter outside `system`/`tools`/`messages` (effort, max_tokens,
   tool_choice, metadata, thinking.display, cache_control placement). Invalid: editing/reordering/deleting earlier
   messages (including system messages and cleared turn-scoped ones), changing `system`, changing `tools`, removing a
   thinking block from the middle. Default `prefix_mismatch_behavior` is `"error"` for accounts created on or after
   2026-08-31, otherwise "let through" unless the beta field is set. With the beta header the response lists dropped
   or let-through blocks in `input_transformations` (`thinking_dropped` / `thinking_mismatch_allowed`, with `path`
   `messages.{i}.content.{j}` and `reason` `model_binding_mismatch | prefix_binding_mismatch |
organization_binding_mismatch | end_user_binding_mismatch`).
5. `fallback` blocks must stay where they were; after a mid-output fallback, thinking, redacted_thinking,
   connector_text and client `tool_use` blocks **before** the final `fallback` block should be dropped on the next
   turn, and unpaired `server_tool_use` before it dropped too (`refusals-and-fallback#continuing-the-conversation`).
   This is the one documented case where verbatim replay is not the recommended path.
6. Compaction blocks must be sent back exactly as returned (signature included). Sending extra fields such as
   `citations: null` is a 400 `messages.0.content.0.compaction.citations: Extra inputs are not permitted`.
   Exactly one compaction block per request; on-demand: first in `messages`.
7. Response blocks carry fields the param types do not declare (for example citations' `file_id`, `caller` on result
   blocks, `page_age` nullability). The docs say "pass back as received"; **PROBE** that responses replay verbatim
   without 400 "Extra inputs are not permitted" (the SDK serialises responses as params all the time, so this almost
   certainly works for GA blocks).

### 4.4 Citations (`build-with-claude/citations`)

Enable with `citations: {enabled: true}` on `document` or `search_result` blocks; must be enabled on all or none of
the documents in a request. Output text blocks then carry `citations` (4.6). Incompatible with `output_config.format`
(400). `cited_text` is free (not counted as output or later input tokens). Scanned PDFs without text are not citable.

---

## 5. The response

### 5.1 `Message` object (non-streaming)

Sources: SDK GA `Message`, SDK beta `BetaMessage`, `api/messages/create.md#returns`.

| Field                   | Type                                                                      | Notes                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                    | string                                                                    | `msg_...`; "format and length may change".                                                                                                                                                                                                                                                 |
| `type`                  | `"message"`                                                               |                                                                                                                                                                                                                                                                                            |
| `role`                  | `"assistant"`                                                             |                                                                                                                                                                                                                                                                                            |
| `content`               | `ContentBlock[]`                                                          | 5.3. Can be empty (refusal before output, pre-warm `max_tokens:0`, compaction failures, empty `end_turn` responses).                                                                                                                                                                       |
| `model`                 | string                                                                    | The model that produced the returned message. **Differs from the requested model after a server-side fallback** (and with sticky fallback routing). **PROBE** whether aliases (`claude-sonnet-4-5`) come back dated.                                                                       |
| `stop_reason`           | `StopReason \| null`                                                      | Always non-null when not streaming. 5.4.                                                                                                                                                                                                                                                   |
| `stop_sequence`         | `string \| null`                                                          | The matched stop sequence.                                                                                                                                                                                                                                                                 |
| `stop_details`          | `RefusalStopDetails \| null`                                              | Null for every stop reason except `refusal`. 5.5.                                                                                                                                                                                                                                          |
| `usage`                 | `Usage`                                                                   | 5.2.                                                                                                                                                                                                                                                                                       |
| `container`             | `{ id, expires_at, skills: [{skill_id, type, version}] \| null } \| null` | Non-null when a container tool ran. Reuse `id` via request `container`.                                                                                                                                                                                                                    |
| `diagnostics`           | `{ cache_miss_reason: CacheMissReason \| null } \| null`                  | **Always present** since 2026-09-23 (null unless requested). `cache_miss_reason`: `{type:"model_changed"\|"system_changed"\|"tools_changed"\|"messages_changed", cache_missed_input_tokens}` \| `{type:"previous_message_not_found"}` \| `{type:"unavailable"}`; null = diagnosis pending. |
| `context_management`    | `{ applied_edits: [...] } \| null`                                        | **Beta response only.** `clear_tool_uses_20250919 {cleared_input_tokens, cleared_tool_uses}`, `clear_thinking_20251015 {cleared_input_tokens, cleared_thinking_turns}`.                                                                                                                    |
| `input_transformations` | `InputTransformation[] \| null`                                           | **Beta** (`thinking-binding-controls-2026-08-01`); `[]` on every thinking-capable model's response when the beta is on.                                                                                                                                                                    |

### 5.2 `usage`

| Field                         | Type                                                                                       | Notes                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input_tokens`                | number                                                                                     | **Uncached input after the last cache breakpoint only.** Total input = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.                                                                  |
| `cache_creation_input_tokens` | `number \| null`                                                                           | Tokens written to cache (all TTLs).                                                                                                                                                                             |
| `cache_read_input_tokens`     | `number \| null`                                                                           |                                                                                                                                                                                                                 |
| `cache_creation`              | `{ ephemeral_5m_input_tokens, ephemeral_1h_input_tokens } \| null`                         | Split of cache writes by TTL (priced 1.25x and 2x).                                                                                                                                                             |
| `output_tokens`               | number                                                                                     | Inclusive of thinking; non-zero even for an empty response. Billed thinking is the full raw reasoning, not the summary.                                                                                         |
| `output_tokens_details`       | `{ thinking_tokens } \| null`                                                              | `thinking_tokens <= output_tokens`, approximate (re-tokenised).                                                                                                                                                 |
| `server_tool_use`             | `{ web_search_requests, web_fetch_requests } \| null`                                      | Billable web searches ($10 / 1000).                                                                                                                                                                             |
| `service_tier`                | `"standard" \| "priority" \| "batch" \| null`                                              | Tier actually used.                                                                                                                                                                                             |
| `inference_geo`               | `string \| null`                                                                           | Where inference ran (`"us"` means 1.1x pricing on 4.6+).                                                                                                                                                        |
| `speed`                       | `"standard" \| "fast" \| null`                                                             | **Beta only** in the SDK.                                                                                                                                                                                       |
| `fallback_credit`             | `{ status: {type:"redeemed"} \| {type:"not_applied", reason, remove_to_redeem?} } \| null` | Beta.                                                                                                                                                                                                           |
| `iterations`                  | `Array<message \| compaction \| advisor_message \| fallback_message> \| null`              | **Beta.** Per sampling iteration: `{type, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cache_creation, model}`. Present on every response when the compaction beta is on. |

**Cost consequence:** the top-level counts are not always the whole bill. Compaction iterations are excluded from
the top-level fields ("sum across `usage.iterations`"); with server-side fallback "the top-level `usage` counts
describe only the attempt that produced the returned message" and declined attempts are billed separately (some
refusal categories only); advisor sub-inferences are `advisor_message` iterations on another model. Each iteration
carries its own `model` for pricing. Sources: SDK beta `BetaUsage`, `compaction-threshold#understanding-usage`,
`compaction-on-demand#understanding-usage`, `refusals-and-fallback#billing-and-rate-limits`.

### 5.3 Output content block types

GA (`ContentBlock`): `text {text, citations: TextCitation[] | null}`, `thinking {thinking, signature}`,
`redacted_thinking {data}`, `tool_use {id, name, input, caller (required in GA type, optional in beta), toolset_name?}`,
`server_tool_use {id, name, input, caller}`, `web_search_tool_result {tool_use_id, content, caller}`,
`web_fetch_tool_result {tool_use_id, content, caller}`, `code_execution_tool_result`,
`bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`, `tool_search_tool_result`,
`container_upload {file_id}`.

Beta adds: `mcp_tool_use`, `mcp_tool_result {tool_use_id, is_error, content: string | TextBlock[]}`,
`advisor_tool_result`, `compaction {content: string|null, encrypted_content, signature?, tool_changes?}` (`content: null`
= failed compaction, round-trips as a no-op), `fallback {from, to, trigger: {type:"refusal", category}}`,
`mcp_tool_listing`. Docs also mention `connector_text`.

Computer/browser toolset members come back as `tool_use` blocks with `name` = member (`left_click`, `screenshot`,
`navigate`, ...) and `toolset_name: "computer" | "browser"`.

Response citation variants (on `text` blocks):

| `type`                       | Fields                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `char_location`              | `cited_text, document_index, document_title, start_char_index, end_char_index, file_id`   |
| `page_location`              | `cited_text, document_index, document_title, start_page_number, end_page_number, file_id` |
| `content_block_location`     | `cited_text, document_index, document_title, start_block_index, end_block_index, file_id` |
| `web_search_result_location` | `cited_text, url, title, encrypted_index`                                                 |
| `search_result_location`     | `cited_text, search_result_index, source, title, start_block_index, end_block_index`      |

(Param variants are identical minus `file_id`.)

Thinking-block content notes: on Fable 5.1, Mythos 5.1, Opus 5.5, Sonnet 5.5 and Fable 5 a turn can contain
**progress-update** thinking blocks (separate `thinking` blocks right before a `tool_use`/`server_tool_use`). After a
`max_tokens`/`model_context_window_exceeded`/`stop_sequence` stop near a tool call, the last block may be a progress
update whose text is exactly `This part of the response was interrupted before it finished.` (under `summarized` or
`updates`).

### 5.4 `stop_reason`

| Value                           | Meaning                                                                                                                                                                                                                                                                             | GA/beta |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `end_turn`                      | Natural stop. Can come with an **empty** content (2-3 output tokens), typically after tool results when text was appended after them, or when a finished turn is resent.                                                                                                            | GA      |
| `max_tokens`                    | Hit `max_tokens` (or the model max). Also the stop reason of a `max_tokens: 0` pre-warm. A truncated `tool_use` must be retried with more tokens.                                                                                                                                   | GA      |
| `stop_sequence`                 | `stop_sequence` holds the match.                                                                                                                                                                                                                                                    | GA      |
| `tool_use`                      | Client tool call(s) pending. May also contain a `server_tool_use`/`mcp_tool_use` **without** result (deferred until the client results arrive; detect by unmatched `id`). With programmatic tool calling, the `tool_use` comes from code (`caller` names the code_execution block). | GA      |
| `pause_turn`                    | Server-tool loop hit its iteration limit (default 10; higher in batches). Send the content back as-is with the same tools to continue. Never leaves a client `tool_use` pending.                                                                                                    | GA      |
| `refusal`                       | Safety classifier declined. HTTP 200. Content may be empty (before output) or partial (mid-stream; non-streaming fallback discards partials). `stop_details` explains.                                                                                                              | GA      |
| `model_context_window_exceeded` | Generation reached the context window (input + output). Default on Claude 4.5 and newer (earlier: beta header, else a 400 up front). Treat as truncated.                                                                                                                            | GA      |
| `compaction`                    | Compaction request finished (on-demand), or threshold compaction with `pause_after_compaction: true`. Only in the beta `BetaStopReason`.                                                                                                                                            | beta    |

On-demand compaction failures come back as 200 with empty content and the summarizer's own stop reason
(`max_tokens`, `model_context_window_exceeded`, `tool_use`, `refusal`, ...).

### 5.5 `stop_details` (refusal)

| Field                        | Type                                                                                      | Notes                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `type`                       | `"refusal"`                                                                               |                                                                                                                  |
| `category`                   | `"cyber" \| "bio" \| "frontier_llm" \| "reasoning_extraction" \| "general_harms" \| null` | `null` is a normal permanent value.                                                                              |
| `explanation`                | `string \| null`                                                                          | Human-readable, unstable; display, don't parse.                                                                  |
| `fallback_credit_token`      | `string \| null`                                                                          | Beta (fallback-credit). 5-minute validity.                                                                       |
| `fallback_has_prefill_claim` | `boolean \| null`                                                                         | Beta.                                                                                                            |
| `recommended_model`          | `string \| null`                                                                          | Beta (server-side fallback): set when the fallback attempt was skipped (fallback model rate limited/overloaded). |

Refusals before any output are billed only for `bio`, `frontier_llm`, `reasoning_extraction` (since 2026-09-24);
mid-stream refusals bill input and the partial output. Refusals always count against rate limits. Classifier
refusals exist on Fable 5.1, Fable 5, Opus 5.5, Opus 5, Sonnet 5.5, Haiku 5.5 (and Sonnet 4.5 / Opus 4.1 safety
filters). `reasoning_extraction` is triggered by prompts asking for reasoning in the output text (a `reasoning`
field in a JSON schema, a `<thinking>` section): change the prompt, no fallback model exists for it.
Source: `refusals-and-fallback#refusal-response`.

---

## 6. Errors

### 6.1 Body shape

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "...", "details": { "error_code": "..." } },
  "request_id": "req_011CSHoEeqs5C35K2UUqR7Fy"
}
```

- `error.type` and `error.message` always present; "the `type` values will grow over time".
- `request_id` in the body since 2025-08-19 (`string | null` in the SDK); same as the `request-id` header.
- **`error.details.error_code`** is not in the SDK types but documented for several cases (6.3).
- Errors from Cloudflare (413 `request_too_large`) are produced before the API; **PROBE** whether that body has this
  JSON shape at all.
- Validation messages are pydantic-style and start with a JSON path (`messages.1.content.0: ...`,
  `block_binding: Extra inputs are not permitted`), which gives us a `providerParam`.

Sources: `api/errors#error-shapes`, SDK `src/resources/shared.ts` `ErrorResponse`, `api/rate-limits`, compaction pages.

### 6.2 HTTP status and `error.type`

| Status | `error.type`            | Meaning (docs)                                                                                                                                                                                                                                                                | Suggested kind                                                                                                                          |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_request_error` | Format/content problem; "may also be used for other 4XX status codes not listed". **Also: a spend limit you set** (message begins `You have reached your specified API usage limits` / `... workspace API usage limits`).                                                     | `invalid_request`; `context_overflow` for "prompt is too long"; `quota_exceeded` for the spend-limit message; `not_found`? no (see 404) |
| 401    | `authentication_error`  | Bad, revoked or expired key; bad AWS SigV4.                                                                                                                                                                                                                                   | `auth`                                                                                                                                  |
| 402    | `billing_error`         | Billing or payment problem.                                                                                                                                                                                                                                                   | `quota_exceeded`                                                                                                                        |
| 403    | `permission_error`      | Key not permitted for the resource (model access, workspace settings).                                                                                                                                                                                                        | `auth`                                                                                                                                  |
| 404    | `not_found_error`       | Unknown resource: path, model (**PROBE** that an unknown or retired model is a 404 and not a 400), unknown workspace, unknown `file_id` (``File `file_...` not found.``).                                                                                                     | `not_found`                                                                                                                             |
| 409    | `conflict_error`        | Resource conflict. Documented in `api/errors` but **missing from the SDK `ErrorType` union**; SDK retries 409. Unlikely on Messages.                                                                                                                                          | `provider_error` (retryable)                                                                                                            |
| 413    | `request_too_large`     | Over 32 MB. From Cloudflare. Not in the SDK `ErrorType` union.                                                                                                                                                                                                                | `invalid_request`                                                                                                                       |
| 429    | `rate_limit_error`      | RPM/ITPM/OTPM or acceleration limit, with `retry-after`. **Also the monthly tier spend cap**: no `retry-after`, `error.details.error_code: "enforced_spend_limit_reached"`, keeps failing until the next month. Also Claude Code workspace spend limits (with `retry-after`). | `rate_limited`; `quota_exceeded` when `details.error_code == "enforced_spend_limit_reached"`                                            |
| 500    | `api_error`             | Internal error.                                                                                                                                                                                                                                                               | `provider_error`                                                                                                                        |
| 504    | `timeout_error`         | Request timed out while processing (use streaming/batches for long requests).                                                                                                                                                                                                 | `timeout`                                                                                                                               |
| 529    | `overloaded_error`      | API overloaded across users. Also `compaction_unavailable` (details.error_code) and fast-mode capacity.                                                                                                                                                                       | `overloaded`                                                                                                                            |

SDK classes by status (`src/core/error.ts`): 400 BadRequest, 401 Authentication, 403 PermissionDenied, 404 NotFound,
409 Conflict, 422 UnprocessableEntity, 429 RateLimit, >=500 InternalServer. SDK retries: honours `x-should-retry`;
otherwise retries 408, 409, 429, >=500; delay from `retry-after-ms`, then `retry-after` (seconds or HTTP date), else
exponential backoff 0.5 s to 8 s; 2 retries by default.

### 6.3 Documented `error.details.error_code` values

| `error_code`                                                  | Status / type          | Cause                                                                                                        |
| ------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `enforced_spend_limit_reached`                                | 429 `rate_limit_error` | Monthly tier spend cap.                                                                                      |
| `compaction_unavailable`                                      | 529 `overloaded_error` | Transient, retry.                                                                                            |
| `compaction_block_misplaced`                                  | 400                    | Summarized messages remain before the block.                                                                 |
| `compaction_signature_invalid`, `compaction_content_mismatch` | 400                    | Block was edited.                                                                                            |
| `compaction_nothing_to_summarize`                             | 400                    | No user/assistant content.                                                                                   |
| `tool_reference_unresolved`                                   | 400                    | `tool_addition`/`tool_removal` names an undeclared tool.                                                     |
| `tool_name_conflict`                                          | 400                    | Inline definition reuses the name of a different tool type.                                                  |
| `available_tools_limit_exceeded`                              | 400                    | > 10,000 deferred tools, > 10,000 tools defined after the first user message, or > 4 MB of tool definitions. |

### 6.4 Context overflow

- Input alone exceeds the window: **400 `invalid_request_error` "prompt is too long"** on every model (the exact
  message, historically `prompt is too long: N tokens > M maximum`, is **PROBE**). No error code; match the message.
- Input fits but input + `max_tokens` does not: accepted on Claude 4.5+; generation stops with
  `stop_reason: "model_context_window_exceeded"` (200). Earlier models: 400 validation error up front.
- A Files API document larger than the context: 400.
- Compaction request with no room for the prompt: 200, empty content, `stop_reason: "model_context_window_exceeded"`.

Sources: `context-windows#context-window-overflow-behavior`, `files`.

### 6.5 Policy

Content-policy declines are **not errors**: 200 with `stop_reason: "refusal"` and `stop_details` (5.5). There is no
documented HTTP error type for policy. Billing/spend: 402 `billing_error`, 400 (own spend limit), 429 with
`enforced_spend_limit_reached` (tier cap).

### 6.6 Catalogue of documented 400 messages (useful for classification and tests)

| Message (prefix or exact)                                                                                                  | Trigger                                       |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `This model does not support assistant message prefill. The conversation must end with a user message.`                    | prefill on 4.6+                               |
| ``messages.N.content.M: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. ...`` | edited thinking                               |
| ``messages.{i}.content.{j}: Invalid `signature` in `thinking` block. The block is bound to a different conversation. ...`` | prefix binding                                |
| `"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" ...`     | extended thinking on 4.7+                     |
| `"thinking.type.disabled" is not supported for this model. ...` (two variants)                                             | disabled on always-on models                  |
| `To turn thinking off on this model, send "thinking": {"type": "between_tools"} ...`                                       | disabled on Sonnet 5.5                        |
| `"thinking.type.between_tools" is not supported for this model.`                                                           | between_tools outside Sonnet 5.5              |
| `adaptive thinking is not supported on this model`                                                                         | adaptive on 4.5 and earlier                   |
| `output_config.effort 'xhigh' is not supported when thinking is disabled on this model. ...`                               | effort vs thinking                            |
| `messages.N: output_config.effort 'low' differs from the 'high' in effect before it; ...`                                  | per-message effort with thinking off          |
| `tool_choice: type "tool" and "any" are not supported for this model.`                                                     | forced tools on Opus 5.5 etc.                 |
| `'claude-opus-5-5' does not support tool types: computer_20251124. Did you mean one of ...`                                | unsupported Anthropic tool type               |
| `tool_use ids were found without tool_result blocks immediately after`                                                     | tool result ordering                          |
| ``... `web_search` tool use with id `srvtoolu_...` was found without a corresponding `web_search_tool_result` block``      | text after results for a deferred server tool |
| ``... but no `web_search` tool was provided``                                                                              | deferred server tool missing from `tools`     |
| ``Unexpected value(s) `x` for the `anthropic-beta` header. ...``                                                           | bad beta                                      |
| `<path>: Extra inputs are not permitted`                                                                                   | unknown field / beta field without header     |
| `anthropic-workspace-id is required when authenticating with an identity-linked API key; ...`                              | missing workspace header                      |
| `You have reached your specified API usage limits` / `... workspace API usage limits`                                      | own spend limit (400!)                        |
| `prompt is too long`                                                                                                       | context overflow                              |
| many-image dimension message mentioning "many-image requests"                                                              | >20 images with a >2000 px one                |

The API is strict about unknown fields (pydantic `extra="forbid"`): this matches our "refuse, never silently drop"
principle; passing `providerOptions` through and letting Anthropic reject is safe.

---

## 7. Related endpoints

### 7.1 `POST /v1/messages/count_tokens`

GA body: `model`, `messages`, `system?`, `tools?`, `tool_choice?`, `thinking?`, `output_config?`, `cache_control?`.
Beta adds `context_management`, `compaction` (ignored), `mcp_servers`, `speed`, `output_format`. **No `max_tokens`,
`stop_sequences`, `metadata`, `container`, `inference_geo`, `service_tier`, `diagnostics`, sampling params** (sending
them is presumably a 400 extra-input error; **PROBE**). Response `{ input_tokens }` (beta adds
`context_management: { original_input_tokens } | null`). Estimate only; may include system-added tokens you are not
billed for. Free, separate RPM limit. Same 32 MB limit; same model-specific validation (forced tool_choice is
rejected here too). Fable/Mythos 5.x and Opus 4.7+ use a newer tokenizer (~30% more tokens than pre-4.7).
Source: `build-with-claude/token-counting`, SDK `MessageCountTokensParams`.

### 7.2 Models API

`GET /v1/models` (paginated with `after_id`, `before_id`, `limit`; `lifecycle[]` filter), `GET /v1/models/{model_id}`.
`ModelInfo`: `id`, `type: "model"`, `display_name`, `created_at`, `lifecycle: "active" | "deprecated" | "retired"`,
`deprecated_at`, `retires_at`, `line: "haiku" | "sonnet" | "opus" | "fable" | "mythos" | null`, `max_input_tokens`,
`max_tokens`, `capabilities`:

```
batch, citations, code_execution, image_input, pdf_input, structured_outputs: { supported }
context_management: { supported, clear_thinking_20251015, clear_tool_uses_20250919, compact_20260112 }
effort: { supported, low, medium, high, max, xhigh | null }
server_tools: { supported, web_search, code_execution }          // not web_fetch
thinking: { supported, types: { adaptive, enabled, disabled } }  // disabled.supported=false means a 400
```

Beta (`anthropic-beta` header on the GET) adds `capabilities.compaction` and `allowed_fallback_models`. No
capability flag for prefill, sampling params, `between_tools`, forced tool_choice, mid-conversation system messages,
or `inference_geo`: those per-model rules have to live in our catalog. Sources: SDK `src/resources/models.ts`,
`src/resources/beta/models.ts`, `models/overview#using-the-models-api`.

### 7.3 Files API (GA since 2026-08-19)

`POST /v1/files` (multipart; optional `expires_in_seconds` 3,600..7,776,000), `GET /v1/files` (`page`/`next_page`,
`ids[]`), `GET /v1/files/{id}`, `DELETE /v1/files/{id}`, `GET /v1/files/{id}/content` (only for files created by
skills/code execution: `downloadable: true`). 500 MB per file. Workspace-scoped (not per user). PDFs and `text/plain`
-> `document`; images -> `image`; anything else -> `container_upload`. Sending `files-api-2025-04-14` still works and
returns the old list format. Not ZDR-eligible. Only base64 sources on Bedrock/Google Cloud.

### 7.4 Message Batches

`POST /v1/messages/batches` etc.; 50% price, 256 MB per batch, `service_tier: "batch"` in usage, higher server-tool
iteration limit, `max_tokens: 0` and `fallbacks` rejected, 300K output with `output-300k-2026-03-24`. Out of scope for
`complete`.

---

## 8. Edge cases and gotchas

1. **Assistant prefill is dead on every in-scope model**: a conversation ending in an assistant message is a 400
   (4.5-generation models were the last to accept it).
2. **Mid-conversation `role:"system"` messages exist natively** (no header) on Fable 5.1, Mythos 5.1, Fable 5,
   Mythos 5, Opus 5.5, Opus 5, Opus 4.8, Sonnet 5.5, Haiku 5.5, with strict placement rules (never first, never
   between tool_use and tool_result, must be followed by assistant or be last). This maps directly to our D3 system
   message; models without it (Sonnet 5, 4.7 and older) must be refused by us or by the API.
3. **Same-role turns are merged server-side**, so two user messages in a row are legal (not refused, not an error).
4. **Prefix-bound thinking**: on Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 any byte change to `system`, `tools`
   or earlier messages invalidates later thinking blocks, and new accounts (>= 2026-08-31) get a 400 by default. Our
   adapter must render shared parts (user content, tool results, system text) **deterministically**: the same
   conversation must produce byte-identical earlier messages every turn (same string-vs-array choice for tool result
   content, same key order is irrelevant for JSON semantics but block order and text must match). Stripping D6
   custom messages is fine only if they never reached Anthropic in earlier turns either (they don't).
5. **Thinking blocks cross models silently**: replaying to another model drops unreadable blocks without error
   (Fable 5.1 -> anything else loses reasoning). D2's "pass through and let the provider refuse" never sees a refusal
   here; it just degrades.
6. **`display: "omitted"` is the default on all current models**: thinking blocks come back with `thinking: ""`. An
   extractor for reasoning text will usually return nothing unless the caller sets `display: "summarized"`.
7. **Sampling params are effectively banned** on all 4.7+ models (non-default values 400; `temperature`+`top_p`
   together 400 even at defaults per the thinking page).
8. **`thinking` omitted means adaptive thinking ON** on every 5.x model. `disabled` is a 400 on Opus 5.5, Fable 5.1,
   Fable 5 and Sonnet 5.5 (Sonnet 5.5 uses `between_tools`); accepted on Opus 5 and Haiku 5.5 only at effort <= high,
   and on Sonnet 5. `enabled`+`budget_tokens` is a 400 on all of them.
9. **Forced tool_choice (`any`/`tool`) is a 400** on Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1.
10. **Effort defaults differ**: `medium` on Opus 5.5 and Haiku 5.5, `high` elsewhere; `xhigh`/`max` with thinking off
    is a 400.
11. **`usage.input_tokens` excludes cached tokens**; and with compaction, fallbacks or the advisor, top-level usage
    excludes other iterations (sum `usage.iterations`, each priced by its own `model`). Cache reads on Fable 5.1 /
    Mythos 5.1 are 0.025x, on Opus 5.5 / Sonnet 5.5 0.05x, else 0.1x; 5m writes 1.25x, 1h writes 2x. Haiku 5.5
    switches to a higher price table when the whole prompt (incl. cache) exceeds 100,000 tokens. `inference_geo:"us"`
    is 1.1x on 4.6+. Fast mode has its own rates. Batch 50%. Web search $10 / 1000 (`server_tool_use`).
12. **Refusal is a 200**, can have empty content, may or may not be billed depending on category; with server-side
    fallback the response `model` differs from the request and content may start with a `fallback` block.
13. **`tool_use` stop with an unanswered `server_tool_use`**: the next user message must contain only tool_result
    blocks, and the request must keep the same tools. A D12-style derived stop reason should still be `tool_use`.
14. **`pause_turn`**: resend the assistant content unchanged (plus same tools) to continue; never with a client
    tool pending.
15. **Empty `end_turn` responses** happen when text is appended right after tool results. Don't retry unchanged.
16. **Spend limits use three different signals**: your own limit = 400 `invalid_request_error` with a message;
    tier cap = 429 `rate_limit_error` with `details.error_code: enforced_spend_limit_reached` and no `retry-after`;
    billing problem = 402 `billing_error`. Classifying all 429s as `rate_limited` (retryable) would loop forever on
    the tier cap.
17. **Workspace header**: identity-linked multi-workspace keys need `anthropic-workspace-id` on every call (400
    without it, 404 if wrong). Credentials should carry an optional `workspaceId`.
18. **Bearer auth**: `Authorization: Bearer <api key>` is now the documented primary method; `x-api-key` is legacy
    but still supported. Either works for API keys.
19. **Long non-streaming requests**: the SDK refuses non-streaming calls whose `max_tokens` implies more than ~10
    minutes (> 21,333 tokens with no override) because idle connections get dropped; the API itself has no such
    rule but may 504 `timeout_error`. Thinking above ~32K tokens per request is recommended for batches. Our
    no-streaming design needs TCP keep-alive or long fetch timeouts; **PROBE** how long a Cloudflare Worker fetch can
    wait for a non-streaming response.
20. **Images > 2000 px with more than 20 images** in the request (counting images in history and tool results) are a
    400; images over the model's native resolution are silently downscaled unless `oversized_image: "error"`.
21. **Citations and `output_config.format` are mutually exclusive** (400), and citations must be enabled on all or
    none of the documents.
22. **Unknown fields are rejected** (`Extra inputs are not permitted`), including beta fields without their header,
    and including extra `null` fields on replayed blocks (`compaction.citations: null`). Serialise native items
    without adding nulls.
23. **`diagnostics` is now always present** in responses (null); `container` too (null). `native` filtering should
    drop nulls.
24. **No `"system"` role prose is stale**: the GA reference still says there is no system role while its own schema
    lists it.
25. **Toolset tool_results must echo `toolset_name`** (computer/browser toolsets); member results may hold only text,
    image and one `browser_state`. Analogous to OpenAI's `caller`: belongs in the tool result's `providerOptions`.
26. **Programmatic tool calling** returns client `tool_use` blocks with `caller: {type:"code_execution_2026...",
tool_id}`; the follow-up must also pass `container` with the response's `container.id`.
27. **Anthropic-defined client tools** (bash, text_editor, memory, computer/browser toolsets) use ordinary
    `tool_use`/`tool_result` blocks, unlike OpenAI's dedicated item types.
28. **`max_tokens: 0`** is valid (cache pre-warm) and returns empty content with `stop_reason: "max_tokens"`.
29. **Model IDs**: from the 4.6 generation on, dateless IDs are pinned snapshots; earlier models have alias -> dated
    snapshot. Retired models (Opus 4.1, Opus 4, Sonnet 4, Sonnet 3.7, Haiku 3.5, Haiku 3, ...) "return an error"
    (type unspecified, **PROBE**: probably 404 `not_found_error`).
30. **`count_tokens` takes a narrower body** than create; reusing the full create body will likely 400.

---

## 9. What live probing should verify

| #   | Question                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Authorization: Bearer <api key>` works; missing `anthropic-version` behaviour.                                                                             |
| 2   | Error body for unknown model, retired model (404 vs 400), bad key (401), and the exact "prompt is too long" message.                                        |
| 3   | `temperature: 1` alone, `top_p: 0.99` alone, and both together on Opus 5.5 / Sonnet 5.5 (thinking page vs SDK deprecation note disagree).                   |
| 4   | `role:"system"` on Sonnet 5 / Opus 4.7 (error text), first-position system message, consecutive user messages, assistant-first conversation, empty content. |
| 5   | Verbatim replay of a full response `content` (with `caller`, citations `file_id`, nulls) is accepted.                                                       |
| 6   | Response `model` for the dateless 5.x IDs (expected: echoed unchanged).                                                                                     |
| 7   | Presence of `x-should-retry` / `retry-after-ms` headers; 413 body shape from Cloudflare.                                                                    |
| 8   | `stop_sequences` limits; `max_tokens` above the model ceiling (error text).                                                                                 |
| 9   | Whether our account is enforced for thinking prefix binding (account creation date vs 2026-08-31).                                                          |
| 10  | `thinking: {type:"disabled"}` on Sonnet 5 and Opus 5 (accepted?), `between_tools` on Sonnet 5.5, and the `role:"system"` 400 on Sonnet 5.                   |
