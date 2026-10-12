# Anthropic Messages: how other libraries adapt to it

Research date: 2026-10-12. Read-only: library sources and public issue reports.
No API calls were made. Whatever a library _claims_ about API behaviour is
reported as its claim, with the evidence it gives. Where two libraries disagree
it says so. Anything we rely on still needs a live probe.

## Sources

| Alias   | Library and version                                                                                   | Files read                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pi**  | `@earendil-works/pi` `packages/ai` 1.1.0, commit `96abe9a` (2026-10-11), github.com/earendil-works/pi | `src/api/anthropic-messages.ts`, `src/api/transform-messages.ts`, `src/api/simple-options.ts`, `src/utils/{transcript,text,overflow,provider-retry,sanitize-unicode}.ts`, `src/models.ts` (`calculateCost`), `src/auth/oauth/anthropic.ts`, `src/providers/anthropic.ts`, `scripts/generate-models.ts` (model gates), `test/anthropic-*.test.ts`, `CHANGELOG.md` |
| **ank** | `@ank1015/providers` 0.0.39, commit `aaa615f` (2026-01-28)                                            | `src/providers/anthropic/{utils,complete,types}.ts`, `src/models.ts`, `CHANGELOG.md`                                                                                                                                                                                                                                                                             |
| **VC**  | Vercel AI SDK `@ai-sdk/anthropic` 4.0.78 (`main`, fetched 2026-10-12)                                 | `packages/anthropic/src/{convert-to-anthropic-prompt,anthropic-language-model,anthropic-language-model-options,anthropic-prepare-tools,get-cache-control,anthropic-error,map-anthropic-stop-reason,convert-anthropic-usage,anthropic-provider}.ts`, `CHANGELOG.md`                                                                                               |
| **LL**  | LiteLLM 1.106.0 (`main`, fetched 2026-10-12)                                                          | `litellm/llms/anthropic/chat/transformation.py`, `litellm/llms/anthropic/common_utils.py`, `litellm/llms/anthropic/cost_calculation.py`, `litellm/litellm_core_utils/prompt_templates/{factory,mid_conversation_system}.py`, `litellm/litellm_core_utils/exception_mapping_utils.py`, `litellm/constants.py`                                                     |

Local copies: pi and ank under the session scratchpad (`scratchpad/pi/repo/packages/ai`,
`scratchpad/ankproviders`); VC and LL raw files downloaded to `scratchpad/eco/{vercel,litellm}`.
Line numbers below refer to those copies.

Issue reports found on the web are mostly mirrors of `anthropics/claude-code`
issues on claudeissues.com; they are cited as such and are weaker evidence
than library code.

Our adapter differs from all four in one basic way: they normalize the
assistant message and rebuild Anthropic blocks from it, while we replay the
native `content` array verbatim (D1). So a whole class of their bugs (block
order, lost `signature`, lost `redacted_thinking`, lost citations, empty text
blocks _they_ created) cannot happen on our same-model path. Those bugs matter
for D13 conversion and for the user/system/tool-result shapes we still build.

---

## 1. Library by library, topic by topic

### 1.1 System messages

**Top-level `system`.**

- **pi**: the leading system message becomes one `system` text block with
  `cache_control` (`anthropic-messages.ts:1183`). With an OAuth token it is
  prefixed by a Claude Code identity block (see 1.15).
- **ank**: the same, always with `cache_control: {type: "ephemeral"}` (`utils.ts:150`).
- **VC**: the first block of consecutive system messages becomes `system`, one
  text block per message, each with optional `cache_control` from
  providerOptions (`convert-to-anthropic-prompt.ts:157-260`).
- **LL**: only the _leading run_ of system messages goes into `system`
  (`transformation.py:2048`). Empty system texts are skipped because "Anthropic
  API raises errors for empty text" (`transformation.py:1777`). Claude Code
  `x-anthropic-billing-header:` system blocks are kept for first-party Anthropic
  and stripped only for providers that reject them, such as Bedrock (`transformation.py:1752`).

**Mid-conversation system messages.** Anthropic now accepts `role: "system"`
inside `messages` on some models. All three active libraries have caught up
with this, in different ways.

- **pi** gates on the model. `supportsMidConvoSystemMessages` is true for
  `claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5`, `claude-{sonnet,haiku}-5-5`
  and `claude-{fable,mythos}-5(.1)` (`scripts/generate-models.ts:614-620`).
  - _Supported model:_ later system messages go on the wire as
    `{role: "system", content: [text, tool_addition…, tool_removal…]}`. They are
    **held back and emitted directly before the next assistant message**, or at
    the end of the transcript, because "Anthropic requires `tool_result` blocks
    to immediately follow their `tool_use`, so a system message between them is
    rejected". The source admits a side effect: "an update placed before a user
    message in the transcript lands after it on the wire"
    (`anthropic-messages.ts:1319-1328`). `transform-messages.ts:189` also holds
    a system message back until the pending tool results have been emitted.
  - _Unsupported model:_ every system message is folded into one leading prompt
    (later content is appended and named sections are patched), and the later
    messages are removed from their positions (`transcript.ts` `collapseSystemMessages`).
  - pi sends no `mid-conversation-system-*` beta header. VC does (below), so
    the API may need the header on some models and not on others. Probe this.
- **VC**: a system block anywhere after the first becomes a wire
  `role: "system"` message with beta `mid-conversation-system-2026-04-07`. The
  `anthropic` providerOptions on such a message add:
  - `clearAt: "next_user_message"`, sent as `clear_at`, with beta
    `mid-conversation-system-clear-at-2026-08-21`;
  - `effort`, sent as `output_config.effort`, with beta
    `mid-conversation-output-config-2026-07-01`;
  - `toolChanges`, sent as `tool_addition`/`tool_removal` blocks, with beta
    `mid-conversation-tool-changes-2026-07-01`.

  VC does not gate this on the model; the API is left to reject it.
  - **Silent move:** a later system block is still hoisted into the top-level
    `system` when no top-level system exists yet and it carries no tool changes
    or inline options (`:212-214`).
  - Tool changes, `clearAt` or `effort` on the _initial_ system message are
    dropped with a warning (`:216-256`).

- **LL**: `mid_conversation_system.py` is the most complete statement of the
  placement rules. Quoting its docstring, a mid-conversation system message
  "must directly follow a user turn, must be the last entry or be followed by
  an assistant turn, and must not sit next to another system message".
  LL places each run by its neighbours:
  - a run after a user turn stays with that turn;
  - a run after an assistant turn slides behind the next user turn;
  - a run at the end, or one that precedes an assistant turn, becomes a user
    turn in place;
  - runs that land in the same slot merge.

  On models without the flag, system messages become _user turns_ prefixed with
  "Operator note (not from the user): the following was originally a
  mid-conversation system-role reminder." A run caught between a tool call and
  its result moves after the result. LL also states why it never hoists: doing
  so "rewrites the cached prefix and re-bills the whole history at cache-write
  pricing" (LiteLLM issue #36559).

- **ank**: system lives only in `context.systemPrompt`. No mid-conversation support.

### 1.2 Consecutive same-role messages

- **VC**: `groupIntoBlocks` merges consecutive `user` and `tool` messages into
  one user message and consecutive assistant messages into one assistant
  message (`convert-to-anthropic-prompt.ts:1556`). Changelog `04800838`:
  "combine tool and user messages, combine system messages".
- **LL**: `anthropic_messages_pt` merges consecutive user/tool/function
  messages and consecutive assistant messages (`factory.py:2490+`).
  - Docstring: "Each message must alternate between user and assistant".
  - With an empty message list and `modify_params` on, LL appends a
    `"Please continue."` user message; without it, LL raises an error.
- **pi**: consecutive tool results become one user message ("needed for z.ai
  Anthropic endpoint", `anthropic-messages.ts:1463`). User messages are not
  merged, and a user message after tool results stays a separate user message.
- **ank**: nothing is merged. Each tool result is its own `user` message (`utils.ts:226`).
- pi and ank therefore depend on Anthropic merging consecutive same-role turns
  itself. VC and LL merge on the client because other Anthropic-compatible
  endpoints (z.ai, MiniMax, Bedrock) are stricter.

### 1.3 Tool results

- **Grouping.** VC, LL and pi put all results of one turn into a single user
  message. ank sends one user message per result. VC fix `cd458a8` (vercel/ai
  #8318) moves `tool_result` parts _before_ user text inside a merged user
  message to meet "Claude API validation requirements". LL moves system runs
  out from between a call and its result for the same reason ("so the
  `tool_result` block stays first in the merged user turn").
- **`is_error`.**
  - pi passes `isError` through.
  - VC sets `is_error: true` only for `error-text` and `error-json` outputs.
  - LL never sets it ("We can't determine from openai message format whether
    it's a successful or error call result", `factory.py:1767`).
  - ank sets `is_error` and **also prefixes every text with `[TOOL ERROR] `**
    (`utils.ts:211-218`), which rewrites the content.
- **Content.**
  - pi: a text-only result becomes one `"\n"`-joined string. An image-only
    result gets a `"(see attached image)"` text block prepended (`anthropic-messages.ts:174-181`).
  - VC: JSON results become `JSON.stringify(value)`; `execution-denied` becomes
    its reason or `"Tool call execution denied."`. Unsupported part types are
    dropped with a warning.
  - LL: images, documents (PDF data URIs become `document` blocks, since
    "wrapping a PDF in `type: "image"` is rejected by the API") and `tool_reference`.
- **Orphans and duplicates.**
  - pi inserts a synthetic `"No result provided"` result (`isError: true`) for
    every tool call left unanswered before the next user/assistant turn or at
    the end. It also **drops whole assistant messages whose `stopReason` is
    `error` or `aborted`** (`transform-messages.ts:156-209`).
  - LL, only when `modify_params` is on, adds dummy results for orphaned calls,
    removes orphaned results, and de-duplicates results with the same
    `tool_call_id`, keeping the last ("Anthropic requires exactly one
    tool_result per tool_use and rejects with: 'each tool_use must have a
    single result'", `factory.py:2327-2420`).
- **Tools param required.** LL: "Anthropic requires `tools` when messages
  include tool blocks; LiteLLM injects a dummy tool if omitted"
  (`transformation.py:1976`). pi's changelog mentions the same "LiteLLM/Anthropic-proxy
  workaround" when it stopped sending `tools: []`.

### 1.4 Images and documents

- **pi**: base64 images only. For a model without image input, every image is
  replaced by `"(image omitted: model does not support images)"`
  (`transform-messages.ts:12-55`). No documents.
- **ank**: images only, and **images are dropped silently** when the model
  catalog says the model has no image input (`utils.ts:192`). No documents.
- **VC**:
  - images from a URL (`source.type: "url"`) or base64;
  - PDFs as `document` blocks with beta `pdfs-2024-09-25` and optional
    `citations`, `title` and `context`;
  - `text/plain` as a `document` with a text source;
  - file IDs through a `reference` file part;
  - any other media type **throws** `UnsupportedFunctionalityError` (`:483`).
- **LL**: images (base64, or URL except on Vertex and Bedrock invoke, which
  need base64), documents and files. Only `application/pdf` and `text/plain`
  are accepted as base64 document sources (`factory.py:1639-1650`).

### 1.5 Empty and whitespace text, trailing whitespace

- API errors that libraries quote:
  - `text content blocks must be non-empty` (LL `factory.py:2449`; many Claude
    Code reports, e.g. claudeissues.com #55283, #59294, #60009);
  - `cache_control cannot be set for empty text blocks` (claudeissues #62379).
- **pi**: a whitespace-only user string is dropped, and so are whitespace-only
  text blocks in user and assistant messages. If nothing is left, the whole
  user or assistant message is dropped (`anthropic-messages.ts:1356-1448`).
  Unpaired UTF-16 surrogates are stripped from all text (`sanitize-unicode.ts`).
- **LL**: an empty or whitespace text becomes
  `"[System: Empty message content sanitised to satisfy protocol]"`. This
  happens _always_, not only under `modify_params`, because "there is no way to
  'pass through' an empty text block — the request will always 400"
  (`factory.py:2076, 2445-2456`). Empty assistant text and thinking blocks are
  skipped.
- **VC**: only empty _compaction_ blocks are dropped (`3733d6e`). Empty text is
  passed through.
- **Trailing whitespace on the final assistant message (prefill).** VC trims
  the last text part of a final assistant block, because "Anthropic does not
  allow trailing whitespace in pre-filled assistant responses" (`:758-762`;
  changelog `7e86b45e`). LL `rstrip`s every text block of a final assistant
  message (`factory.py` end of `anthropic_messages_pt`). Newer models reject
  prefill outright, per VC's capability table and its "jsonTool" fallback
  (1.11). The exact error text was not found.

### 1.6 Tool call IDs and tool names

- Pattern: `^[a-zA-Z0-9_-]+$`. pi also caps the length at 64 ("OpenAI Responses
  API generates IDs that are 450+ chars with special characters like `|`",
  `transform-messages.ts:58`).
- **pi**: `id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)`, applied _only to
  tool calls from a different provider, API or model_. The tool result's
  `toolCallId` is rewritten through a map (`anthropic-messages.ts:1290`,
  `transform-messages.ts:120-136`). There is no collision handling: two IDs
  that differ only in replaced characters, or after character 64, collapse into one.
- **LL**: replaces invalid characters with `_`, with no length cap for Anthropic
  and `"tool_use_id"` if the result is empty (`factory.py:1609-1622`). Bedrock
  gets a 64-character cap plus an 8-character SHA-256 suffix to avoid collisions (`:1625`).
- **VC**: IDs pass through unchanged. A non-object tool input is wrapped as
  `{rawInvalidInput: …}` because "Anthropic requires it to be an object" (`:1690`).
- **ank**: passes IDs through.
- **Tool names**: LL sanitizes names to `^[a-zA-Z0-9_-]{1,128}$` with a
  per-request forward/reverse map that resolves collisions
  (`transformation.py:193, 2022-2046`).
- Related issue: openai/openai-agents-python #1147. Generated tool IDs broke
  Claude through LiteLLM and OpenAI-compatible clients with a 400 on the pattern.

### 1.7 Thinking blocks

- **Same-model replay.**
  - **pi** keeps signed `thinking` and turns `redacted` thinking back into
    `redacted_thinking` (its `data` is stored in `thinkingSignature`).
  - Changelog #6457: a thinking block with **empty text and a valid signature**
    must be kept. Dropping it caused "thinking-block errors on newer Claude
    models"; with `display: "omitted"` the text is empty by design.
  - A block with an empty or missing signature (an aborted stream) is sent as
    a plain **text** block instead (`anthropic-messages.ts:1413-1431`).
  - The opt-in `allowEmptySignature` flag is for compatible providers (Kimi,
    Xiaomi, Vercel AI Gateway) that emit `signature: ""`.
- **Cross-model** (pi `transform-messages.ts:99-118`):
  - thinking becomes plain text;
  - `redacted_thinking` is dropped;
  - Gemini `thoughtSignature` is removed from tool calls.

  pi changelog #302: wrapping old thinking in `<thinking>` tags made Claude
  start writing literal `</thinking>` tags, so pi stopped adding them. ank
  still wraps cross-provider thinking in `<thinking>…</thinking>` (`utils.ts:245`).

- **Position matters.** LL issue #23047: "Anthropic verifies thinking block
  signatures based on position", so thinking, `server_tool_use` and
  `*_tool_result` blocks must be replayed in their original interleaved order
  (`factory.py` "INTERLEAVED MODE"). VC moves `tool_use` blocks to the end of
  each run between thinking blocks (`moveToolUseBlocksToEnd`, changelog
  `19c5ee2` "reorder assistant content b/w client and provider tool use"). This
  rewrites the assistant's own order, but it does not move anything across a
  thinking block.
- **Relays break signatures.** pi #9188: an Anthropic-compatible relay that
  reports a different response `model` broke signed thinking replay, because
  pi decided "same model" from the reported model.
- **Prefix binding (new, important).** On Fable 5.1, Opus 5/5.5 and
  Sonnet/Haiku 5.5, pi's "managed effort" mode does three things:
  - it inserts `{role: "system", content: [], output_config: {effort}}` before
    every historical assistant message, carrying the effort that message was
    produced with, plus one trailing marker for the current effort;
  - it sends `thinking: {type: "adaptive", display, block_binding:
{prefix_mismatch_behavior: "drop_block"}}`;
  - it sends betas `mid-conversation-output-config-2026-07-01` and
    `thinking-binding-controls-2026-08-01`.

  The live e2e test `test/anthropic-thinking-binding-e2e.test.ts` forces
  `prefix_mismatch_behavior: "error"`, removes the historical effort marker,
  and expects the error `Invalid \`signature\``. **A signed thinking block is
bound to the exact prefix it was generated with, including per-message
effort markers.** With `drop_block`, the API drops mismatched blocks instead
of failing. VC exposes the same thing as
`thinking.blockBinding.prefixMismatchBehavior` (`'error' | 'drop_block'`),
changelog `e4292e7`.

- **Thinking on vs. history.** LL quotes two errors:
  - "Expected thinking or redacted_thinking, but found tool_use", when
    thinking is on and the last assistant tool-call turn has no thinking;
  - "When thinking is disabled, an assistant message cannot contain thinking".

  Under `modify_params` it drops the `thinking` param (LL #18926,
  `transformation.py:1980-1998`).

- **Display.** pi and LL both default to `display: "summarized"`. Per LL,
  "without display, Anthropic defaults adaptive thinking to display='omitted'
  and returns a blank thinking block". pi says the omitted default applies to
  Opus 4.7 and Mythos Preview.
- **Session-resume failures** in Claude Code itself: claudeissues #21726
  (signatures not persisted after switching backends; 534 of 537 thinking
  blocks unsigned), #10627, #42373. The usual workaround is a new session,
  because retries cannot fix a bad signature in history.

### 1.8 `cache_control`

- **Limit: 4 breakpoints per request.** VC's `CacheControlValidator` counts
  them and **drops the fifth and later with a warning** (`get-cache-control.ts`).
  LL capped its _auto-injected_ breakpoints at 4 (PR #30480, release v1.84.9).
- **Not allowed on thinking or `redacted_thinking`.** VC warns and ignores
  ("They are cached implicitly when in previous assistant turns").
- **TTL ordering.** A `1h` breakpoint may not come after a `5m` breakpoint.
  Breakpoints are processed in the order tools, system, messages (claudeissues
  #38320, "Invalid cache_control TTL ordering").
- **Placement.**
  - **pi** places them automatically, on by default: the system block (two with
    OAuth), the last tool (changelog #3260, so the tool list caches separately
    from the transcript), and the last block of the last user or system message.
  - Retention is `short` (5m) by default; `long` maps to `ttl: "1h"` and is
    gated by `supportsLongCacheRetention`.
  - With native tool changes, pi sends a deferred placeholder tool from the
    first request, because "Anthropic adds hidden prompt scaffolding for
    mid-conversation tool changes … (measured: full miss without it)"
    (`anthropic-messages.ts:197-209`).
- **VC**: explicit only, from part, message or tool providerOptions (it was
  "default cache-control on" in a much older version, `858f934`).
- **LL**: passes the caller's `cache_control` through and rebuilds it to the
  only shape Anthropic accepts: `{type: "ephemeral"}`, optionally with `ttl`
  `"5m"` or `"1h"` (`mid_conversation_system.py` `_cache_control`). It never
  sends `cache_control: null`, which "breaks some API channels" (`factory.py:1700`).
- **ank**: always marks the system block. Nothing else.

### 1.9 `max_tokens`

- **pi**: `max_tokens = options.maxTokens ?? model.maxTokens`, and
  `streamSimple` clamps it to `contextWindow - estimatedInput - 4096`.
  Budget thinking uses budgets of 1024/2048/8192/16384 for
  minimal/low/medium/high, capped at `max_tokens - 1024`.
- **VC**: `maxOutputTokens ?? modelMax`. The model table gives 128000 for 4.6+
  and the 5.x family, 64000 for 4.5, 32000 for Opus 4.1, and 4096 for Claude 3
  Haiku and for unknown non-`claude-` IDs. An unknown `claude-*` ID gets 128000
  with a warning.
  - With budget thinking it sends `max_tokens = maxOutputTokens + budget`.
  - For known models it **clamps** to the model maximum with a warning.
  - Thinking `enabled` without a budget gets **1024 by default**, with a warning.
  - Changelog `21f378c`: "do not limit maxTokens when model id is unknown".
- **LL**: catalog `max_tokens`, else `DEFAULT_ANTHROPIC_CHAT_MAX_TOKENS = 4096`
  (env-overridable, `constants.py:584`).
  - `budget_tokens` must be below `max_tokens`. LL caps it to `max_tokens - 1`,
    and drops thinking when `max_tokens <= 1024` (`transformation.py:1380`).
  - `reasoning_effort` maps to budgets of 1024/2048/4096/8192/16384 for
    low/medium/high/xhigh/max.
- **ank**: `max_tokens || model.maxTokens`.

### 1.10 `temperature`, `top_p`, `top_k`

Libraries claim three API constraints:

1. Sampling parameters are rejected while thinking is on.
2. Opus 4.7+, Opus 5/5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.x reject sampling
   parameters entirely.
3. `temperature` and `top_p` together are rejected on 4.5-era and later Claude
   models. Reports: n8n #18304, BrowserOS #208, Drupal AI #3580249; the
   Anthropic docs inconsistency is claudeissues #18928.

What each library does:

- **pi**: sends `temperature` only when thinking is off and the model supports
  it (`supportsTemperature: false` for opus-4-7/4-8/5/5-5, sonnet-5-5,
  haiku-5-5, per `generate-models.ts:643`). Otherwise it is **dropped
  silently** (`anthropic-messages.ts:1194-1202`, changelog #5251 and #1665).
  pi has no `top_p` option.
- **VC**:
  - clamps `temperature` to [0, 1] with a warning (`1d15673`);
  - drops temperature, topK and topP for models with
    `rejectsSamplingParameters` and when thinking is on;
  - drops `topP` when both are set on `claude-*` models (`2231e84`), but not on
    other models behind the Anthropic API, such as MiniMax, which need both (`f57c702`).

  Every drop comes with a warning, but the request is still sent.

- **LL**: routes `top_k` through `_apply_sampling_param` with `drop_params`
  gating (`transformation.py:2120`).

### 1.11 Effort and adaptive thinking

Model facts as claimed by the libraries. They disagree, so probe them.

| Claim                                                              | VC `getModelCapabilities`                                                                                                 | pi / LL                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rejects `thinking.type: "disabled"`                                | sonnet-5-5, opus-5-5, fable-5, fable-5-1                                                                                  | pi: omit `disabled` for Fable 5 and managed-effort models (`thinkingLevelMap.off = null`). LL: Fable 5 / Mythos 5 "400 on it; omission is the API-documented remedy" (`common_utils.py:899`) |
| Rejects budget thinking (`enabled` + `budget_tokens`)              | sonnet-5-5, opus-5-5, haiku-5-5, fable-5, fable-5-1; **not** opus-4-7/4-8/5                                               | LL: "the adaptive-thinking models that reject it (4.7+ and the 5 families)"; 4.6 still accepts the legacy shape (`common_utils.py:922`)                                                      |
| `disabled` rejected above `high` effort                            | haiku-5-5, sonnet-5-5, opus-5-5, opus-5                                                                                   | not modelled                                                                                                                                                                                 |
| `thinking.type: "between_tools"` (lowest setting) only at ≤ `high` | sonnet-5-5                                                                                                                | not modelled                                                                                                                                                                                 |
| Rejects forced tool choice (`any` / named tool)                    | sonnet-5-5, opus-5-5, fable-5-1                                                                                           | not modelled                                                                                                                                                                                 |
| `xhigh` effort                                                     | 4.7+ and 5.x                                                                                                              | pi: `max` on every adaptive model; native `xhigh` only on Opus 4.7/4.8, Sonnet 5, Fable 5, and the 5.5 family                                                                                |
| Thinking on by default when omitted                                | Sonnet 5 (`0aa0ff3`: a dropped `disabled` "left thinking enabled and could consume a small `max_tokens` budget entirely") | —                                                                                                                                                                                            |

The libraries rewrite around these limits:

- **VC**:
  - `disabled` becomes `between_tools`, or the thinking setting is removed;
  - `enabled` becomes `adaptive`;
  - effort `xhigh`/`max` becomes `high` when thinking is disabled or `between_tools`;
  - a forced `toolChoice` becomes `auto`, and for a named tool **every other
    tool is removed** (`anthropic-prepare-tools.ts:490-540`).

  Each rewrite is reported as a warning.

- **LL**: removes `thinking: disabled` for always-on models and converts legacy
  `enabled` into adaptive thinking plus an effort derived from the budget.
- **pi**: maps a thinking level to `output_config.effort` on adaptive models
  (minimal/low → `low`, then medium, high, and `xhigh`/`max` through the
  model's level map). Other models get budget thinking with the
  `interleaved-thinking-2025-05-14` beta.

**Effort beta.** VC changelog `e5c4f40` removed the stale `effort-2025-11-24`
beta header: effort is GA, and Vertex AI's strict validator was rejecting the
header.

### 1.12 Errors and context overflow

- **Error body**: `{type: "error", error: {type, message}}` (VC `anthropic-error.ts`).
- **Error types to statuses** (VC `anthropic-language-model.ts:98-123`, used
  for mid-stream error events):

  | Error type              | Status | Retryable |
  | ----------------------- | ------ | --------- |
  | `api_error`             | 500    | yes       |
  | `overloaded_error`      | 529    | yes       |
  | `rate_limit_error`      | 429    | yes       |
  | `request_too_large`     | 413    | no        |
  | `authentication_error`  | 401    | no        |
  | `permission_error`      | 403    | no        |
  | `not_found_error`       | 404    | no        |
  | `billing_error`         | 400    | no        |
  | `invalid_request_error` | 400    | no        |

- **Context overflow**:
  - **pi** (`overflow.ts`) matches `/prompt (?:is )?too long/i`, whose example
    message is `prompt is too long: 213462 tokens > 200000 maximum`, and
    `/request_too_large/i` (an HTTP 413 on byte size, changelog #2734:
    oversized images got stuck in a loop until 413 counted as overflow).
    Matches that also hit `/rate limit/i` or `/too many requests/i` are
    excluded first.
  - **LL** (`exception_mapping_utils.py:565-574`) checks
    `"prompt is too long" in error_str or "prompt: length" in error_str`, plus
    a generic substring list. LL maps 413 to `BadRequestError` (not overflow)
    unless the text matches.
- **Overflow without an error.** VC maps the stop reason
  `model_context_window_exceeded` to `length` (`map-anthropic-stop-reason.ts`).
  pi does not know this stop reason, and its `mapStopReason` **throws on any
  unknown stop reason** (`anthropic-messages.ts:1637`), so the request fails.
- **Other classification**:
  - LL: `"overloaded_error" or "Overloaded"` → InternalServerError;
    `"Invalid API Key"` → auth; `"content filtering policy"` →
    ContentPolicyViolation; 500 and 529 → InternalServerError; 413 → BadRequest.
  - ank: none (it returns the message string).
- **Refusals** are a successful response with `stop_reason: "refusal"`, not an
  error.
  - pi turns it into an error with `stop_details.explanation` (#5666).
  - VC maps it to `content-filter`.
  - pi also handles `stop_reason: "sensitive"`, which is "not yet in SDK types" (#978).
- **Server-side fallback** (`fallbacks` param, beta
  `server-side-fallback-2026-07-01`; pi #8017 and #8285):
  - The response `model` can differ from the requested model, and cost must use
    the served model.
  - A `fallback` content block that arrives after output has begun makes pi
    fail on purpose ("unsupported mid-output model fallback").
  - VC: when a `fallback_message` usage iteration is present, the top-level
    usage already reflects the served answer.
- **`input_transformations`** on `message_start` or `message_delta` (`type`,
  `path`, `reason`): the API reports what it changed in the input. pi records
  these as a diagnostic.

### 1.13 Retries and 529

- **pi** turns the SDK's retries off (`maxRetries: 0`) and runs its own retry
  loop, so that waits can be aborted (`provider-retry.ts`, #6980).
  - It honours `x-should-retry: true/false` first.
  - It retries 408, 409, 429 and all 5xx (529 included) and network errors.
  - Delay comes from `retry-after-ms`, then `retry-after` (seconds or a date),
    else `min(0.5·2^n, 8)` seconds with up to 25 % jitter.
  - A server-requested delay above `maxRetryDelayMs` (60 s by default) fails at once.
  - Default `maxRetries` is 0. History: the SDK retries were disabled because
    "the SDK's built-in retries were interfering with coding-agent's retry
    logic" (#157), re-enabled (#252), then replaced by pi's own loop.
- **VC**: provider-utils `APICallError.isRetryable`. Mid-stream error events
  are classified by type, as in the table above.
- **Overload inside a stream.** With streaming, an overload can arrive as an
  `event: error` _after_ an HTTP 200. Code that checks only for status 529
  misses it (third-party write-ups: medium.com/@reshtei, particula.tech).
  pi throws on an SSE `error` event, and on a stream that ends without
  `message_stop` (#3936). This is less relevant to us because we never stream.

### 1.14 Usage and cost

- **Input tokens.** `input_tokens` excludes cache reads and cache writes, so
  total input = `input_tokens + cache_read_input_tokens +
cache_creation_input_tokens` (VC, LL and pi all add them).
- **Cache-write TTL breakdown.** `usage.cache_creation.ephemeral_5m_input_tokens`
  and `.ephemeral_1h_input_tokens` split the cache writes by TTL.
  - **pi** prices 5m writes at the model's cache-write rate (1.25× input) and
    1h writes at **2× base input** (#5738). It falls back to the 5m rate when
    no breakdown is reported (test `anthropic-cache-write-1h-cost.test.ts`).
  - pi #9210: Vercel AI Gateway sends the 1h breakdown in `message_delta`
    rather than `message_start`.
- **Long-context pricing tier.** pi switches rates when input + cacheRead +
  cacheWrite exceeds the tier threshold (`models.ts:1200-1218`). Its changelog
  records wrong costs "for long prompts on models such as Claude Haiku 5.5".
- **`usage.iterations`** (compaction, advisor, fallback). Top-level
  `input_tokens`/`output_tokens` _exclude_ compaction iterations, and advisor
  sub-inferences are billed at the advisor model's rates.
  - **VC** sums the `compaction` and `message` iterations, excludes
    `advisor_message`, and uses top-level usage when a `fallback_message` is
    present (`convert-anthropic-usage.ts`).
  - **LL** sums _all_ iterations, including advisor (`transformation.py:2459-2466`).
  - The two disagree.
- **Thinking tokens.** `output_tokens_details.thinking_tokens` is a subset of
  `output_tokens` (pi, VC `e29788d`).
- **Price multipliers.** LL multiplies cost for a `service_tier` such as
  priority, for `speed == "fast"`, and for geography (data residency), all from
  its model map (`cost_calculation.py`).
- **ank** prices all cache writes at a single rate and has no 1h or tier logic.

### 1.15 OAuth / Claude Code subscription tokens (`sk-ant-oat…`)

**Flag: pi and ank impersonate Claude Code.** Detection is a substring check
for `sk-ant-oat`.

What pi sends on an OAuth request:

- `Authorization: Bearer <token>` with `apiKey: null`;
- `user-agent: claude-cli/2.1.280` and `x-app: cli`;
- `anthropic-dangerous-direct-browser-access: true`;
- betas `claude-code-20250219` and `oauth-2025-04-20`;
- a mandatory first system block, `"You are Claude Code, Anthropic's official
CLI for Claude."` ("For OAuth tokens, we MUST include Claude Code identity");
- **tool names renamed to Claude Code's canonical names** ("Stealth mode:
  Mimic Claude Code's tool naming exactly", `anthropic-messages.ts:95-132,
1013-1034, 1167-1182`).

pi's OAuth login also uses Claude Code's OAuth client ID, stored base64-encoded
in the source (`auth/oauth/anthropic.ts:14`).

ank does the same (identity system block plus the oauth beta header) without
the tool renaming.

**LL** forwards the token as a Bearer credential with the `oauth-2025-04-20`
beta. It is a pass-through for real Claude Code clients sent through the proxy
(`common_utils.py:286-356`) and injects no Claude Code identity.

Third-party docs report that Anthropic began enforcing this on the server in
January 2026, with the error `This credential is only authorized for use with
Claude Code`, and wrote the restriction into its terms in February 2026
(docs.moltis.org/anthropic-oauth.html). The Anthropic terms themselves were
not checked here.

**Recommendation:** do not support `sk-ant-oat` tokens, and do not add a
Claude Code identity, Claude Code headers or tool renaming. The gateway should
refuse an `sk-ant-oat` credential with `auth` and a clear message rather than
forward it.

### 1.16 Other behaviour worth knowing

- **Stop reasons**: `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`,
  `pause_turn`, `refusal`, `model_context_window_exceeded`, `compaction` (VC),
  and `sensitive` (pi). Keep the set open (D12 `providerStopReason`).
- **Strict tools** reject `minimum`, `maximum`, `exclusiveMinimum`,
  `exclusiveMaximum`, `multipleOf`, `maxItems`, `uniqueItems`, `minContains`,
  `maxContains`, `minProperties` and `maxProperties`. They also reject
  `minItems` other than 0 or 1, and any `format` outside a fixed list
  (`anthropic-messages.ts:1541-1574`, #9953).
- **Tool schemas.** pi and ank rebuild every `input_schema` as `{type: "object",
properties, required}` and **drop every other top-level schema keyword**
  ($defs, additionalProperties, …) unless the tool is strict. VC sanitizes JSON
  schemas for structured output (`sanitize-json-schema.ts`).
- **Metadata.** LL keeps only `metadata.user_id`, the only documented field (`transformation.py:2102`).
- **Advisor blocks.** LL strips advisor blocks from history when the advisor
  tool is absent: "advisor_tool_result in history requires advisor tool".
- **Programmatic tool-call `caller` metadata.** VC removes `caller` when the
  code-execution call it references has been pruned from history, with a
  warning (`convert-to-anthropic-prompt.ts:1490-1535`).

---

## 2. Edge cases, ranked by how likely they are to bite us

Likelihood is judged for our design: native assistant replay, shared
user/system/tool-result shapes, non-streaming, and no rewrites.

1. **Mid-conversation system placement.** The shared format allows a system
   message anywhere. The API, as LL describes it, allows one only directly
   after a user turn, followed by an assistant turn or at the end, and never
   next to another system message. pi says one between `tool_use` and
   `tool_result` is rejected. The model gate is a list of model IDs (pi
   `generate-models.ts:614`), and the beta header question is open: VC sends
   `mid-conversation-system-2026-04-07`, pi sends nothing.
   _We must decide:_ refuse misplaced system messages with `invalid_request`,
   or emit them where the caller put them and let the API reject. Never move
   them silently (pi and LL move them) and never hoist them (VC does; LL #36559
   on the cost).
2. **Thinking signatures bound to the prefix, including effort markers.** pi's
   e2e test shows `Invalid \`signature\``when a historical`{role: "system", output_config: {effort}}`marker is missing. Callers who
change`output_config.effort`between turns on 5.x models need those
markers replayed. They are request-side, not assistant output, so they do
not survive in our D1 assistant message.
*Decide:* carry them as a`native`message (D4), or record the effort on
the assistant envelope and let the SDK re-emit it. Also pass`thinking.block_binding` through as a native option.
   Related: claudeissues #21726, #42373 (signatures lost on resume); LL #23047
   (position).
3. **Empty or whitespace text blocks** (`text content blocks must be
non-empty`; `cache_control cannot be set for empty text blocks`). Our
   shared user, system and tool-result parts can carry `""`. Every library
   does something here: pi drops, LL substitutes a placeholder, VC passes it
   through. _Refuse_ empty text parts in shared content with `invalid_request`
   and name the path. Native assistant content is the API's own output and
   needs no check.
4. **Tool result grouping and order.** All results for one assistant turn must
   be in the next user message, with `tool_result` blocks first (VC
   `cd458a8`/#8318, LL). Consecutive tool-result messages in our shape must
   therefore be combined into one user message. Mixing user text into that
   message must put the results first. That is a reordering, so refuse it or
   document it.
   Related: missing results ("each tool_use must have a corresponding
   tool_result", claudeissues #7691) and duplicates ("each tool_use must have
   a single result", LL). Do not synthesize results the way pi and LL do;
   refuse instead.
5. **Context overflow without a code.** It arrives as a 400
   `invalid_request_error` with `prompt is too long: N tokens > M maximum`
   (pi), sometimes `prompt: length` (LL), or a 413 `request_too_large` on
   request byte size (pi #2734). It can also arrive as a _successful_ response
   with `stop_reason: "model_context_window_exceeded"` (VC). Write
   adapter-local regexes with tests (D14). Decide whether a 413 counts as
   `context_overflow` (pi says yes) or `invalid_request` (LL says no).
6. **529 `overloaded_error` and the other error types.** Map `overloaded_error`
   / 529 → `overloaded` (retryable), `rate_limit_error` / 429 → `rate_limited`,
   `billing_error` → `quota_exceeded`, `not_found_error` → `not_found`,
   `permission_error` → `auth`, `api_error` / 500 → `provider_error`.
   - Honour `retry-after` and `retry-after-ms` for `retryAfterMs`.
   - `x-should-retry` is a provider hint for our `retryable` flag (pi).
   - A 200 response is never an overload, because we do not stream.
7. **Unknown stop reasons and content block types.** pi throws on unknown stop
   reasons. New ones keep appearing: `model_context_window_exceeded`,
   `compaction`, `sensitive`, and `fallback` content blocks. Pass them through (D1, D12).
8. **Sampling and thinking options rejected per model.** Examples: temperature
   on 4.7+/5.x, temperature+top_p together, `thinking.type: "disabled"` on
   Fable/5.5, budget thinking on 5.5/Fable, forced `tool_choice` on
   Sonnet/Opus 5.5 and Fable 5.1, `xhigh` with thinking disabled. VC and LL
   rewrite all of these, and their capability tables already disagree (budget
   thinking on Opus 4.7/4.8 and Opus 5).
   _Our rule (D7) is already right:_ pass the caller's options through and let
   Anthropic's 400 come back as `invalid_request` with `providerParam` when
   the message names it. Keep no capability table in the adapter.
9. **Cache breakpoint limits.** At most 4 breakpoints; none on thinking blocks;
   none on empty text; TTL order (1h before 5m, in tools → system → messages
   order). The caller owns `cache_control` through providerOptions. Let the
   API reject; never drop the fifth the way VC does.
10. **Tool call IDs from other providers.** These only arise through D13
    conversion, since D2 refuses cross-provider assistant messages. The
    converter must map IDs to `^[a-zA-Z0-9_-]+$` and at most 64 characters,
    _collision-free_: pi's `slice(0,64)` and LL's plain replace both collide.
    Use a hash suffix like LL's Bedrock path, apply it to the tool result IDs
    too, and report the mapping.
11. **Trailing whitespace and prefill.** If the last message is an assistant
    message (prefill), trailing whitespace is rejected (VC, LL), and newer
    models reject prefill entirely. A native assistant message replayed last
    only triggers this when the caller sends it without a following user turn.
    Let the API decide; do not trim.
12. **Usage and cost details.**
    - Total input = input + cache read + cache write.
    - Price 1h cache writes at 2× input and 5m writes at 1.25× input, using
      `cache_creation.ephemeral_{5m,1h}_input_tokens`.
    - Apply the long-context tier above the threshold.
    - Sum `usage.iterations` for compaction, but not advisor iterations (they
      bill at the advisor model's rate); VC and LL disagree on advisor.
    - When a server-side fallback served the turn, price at the served
      `model` from the response.
    - `service_tier`, `inference_geo` and `speed: "fast"` multipliers: estimate
      only where documented (D15).
13. **Images and documents.** Base64 documents accept only `application/pdf`
    and `text/plain` (LL). PDFs needed a beta (`pdfs-2024-09-25`) in VC's
    history; check whether it is still needed. URL sources are refused by
    Vertex and Bedrock but fine on first-party Anthropic. Refuse any other
    media type, as VC does. A model without image input: refuse, never drop
    (ank) or placeholder (pi).
14. **A `tools` definition is required when history contains tool blocks**
    (LL injects a dummy tool). This can bite a harness that removes tools
    mid-conversation. Do not inject anything; the error comes back as `invalid_request`.
15. **Unpaired UTF-16 surrogates** in text break the JSON body (pi strips them
    silently). This is unlikely with our callers. Refuse with `invalid_request`
    rather than strip.
16. **OAuth `sk-ant-oat` tokens.** Out of scope; refuse (1.15).

---

## 3. What these libraries do that breaks our principles

Each item is a silent rewrite or drop, or a "warned" one: VC's warnings are
returned to the caller but the request is still sent. For each, whether we
**refuse** (`invalid_request` before sending) or **pass through** (let Anthropic
decide) is noted.

| Behaviour                                                                                          | Library    | Our handling                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moves later system messages (to before next assistant / after next user / after tool result)       | pi, LL     | Refuse misplaced system messages; never move                                                                                                                                                             |
| Hoists a mid-conversation system message into top-level `system`                                   | VC         | Never; `instructions` and `system` messages stay distinct (D3)                                                                                                                                           |
| Collapses all system messages into one leading prompt for models without support                   | pi         | Refuse (D3); conversion helper may do it explicitly                                                                                                                                                      |
| Converts system messages into user turns with an "Operator note" prefix                            | LL         | Helper-only, explicit, reported                                                                                                                                                                          |
| Drops tool changes / `clearAt` / `effort` on the initial system message (warning)                  | VC         | Not applicable (native options); refuse if shared shape cannot express it                                                                                                                                |
| Drops empty / whitespace user text and empty messages                                              | pi         | Refuse empty text parts                                                                                                                                                                                  |
| Replaces empty text with `"[System: Empty message content sanitised…]"`                            | LL         | Refuse                                                                                                                                                                                                   |
| Trims trailing whitespace of final assistant text                                                  | VC, LL     | Pass through (native assistant is verbatim)                                                                                                                                                              |
| Strips unpaired surrogates                                                                         | pi, ank    | Refuse                                                                                                                                                                                                   |
| Synthesizes `"No result provided"` / dummy tool results for orphaned calls                         | pi, LL     | Refuse (missing result)                                                                                                                                                                                  |
| Removes orphaned tool results; de-duplicates results (keeps last)                                  | LL         | Refuse                                                                                                                                                                                                   |
| Drops whole errored / aborted assistant messages from history                                      | pi         | Caller's choice; gateway sends what it receives                                                                                                                                                          |
| Prefixes error tool output with `[TOOL ERROR]`                                                     | ank        | Send `is_error` only                                                                                                                                                                                     |
| Never sends `is_error`                                                                             | LL         | Send `is_error` (Anthropic has the field, D5)                                                                                                                                                            |
| Prepends `"(see attached image)"` to image-only tool results                                       | pi         | Send as given                                                                                                                                                                                            |
| Replaces images with placeholder text for non-vision models                                        | pi         | Pass through; provider refuses                                                                                                                                                                           |
| Silently drops images for non-vision models                                                        | ank        | Pass through; provider refuses                                                                                                                                                                           |
| Converts unsigned thinking to text; converts cross-model thinking to text; drops redacted thinking | pi         | Same-model: verbatim (D1/D2). Cross-model: only in `convert`, reported                                                                                                                                   |
| Wraps cross-provider thinking in `<thinking>` tags                                                 | ank        | Never (pi #302: the model starts emitting the tags)                                                                                                                                                      |
| Drops reasoning without metadata, or when `sendReasoning: false` (warning)                         | VC         | Not applicable (native)                                                                                                                                                                                  |
| Reorders `tool_use` blocks to the end of each segment                                              | VC         | Never reorder native output                                                                                                                                                                              |
| Rebuilds thinking / tool-call order from normalized fields                                         | LL         | Not applicable (native)                                                                                                                                                                                  |
| Sanitizes tool call IDs (with collisions) and tool names                                           | pi, LL     | Only in `convert`, collision-free, reported                                                                                                                                                              |
| Wraps non-object tool input as `{rawInvalidInput}`                                                 | VC         | Not applicable (native)                                                                                                                                                                                  |
| Drops `temperature` silently (thinking on, or unsupported model)                                   | pi         | Pass through; provider 400 → `invalid_request`                                                                                                                                                           |
| Clamps `temperature`; drops temperature / topP / topK (warning)                                    | VC         | Pass through                                                                                                                                                                                             |
| Rewrites `thinking` (`disabled` → `between_tools` / removed; `enabled` → `adaptive`)               | VC, LL     | Pass through                                                                                                                                                                                             |
| Lowers effort `xhigh` / `max` → `high`                                                             | VC         | Pass through                                                                                                                                                                                             |
| Forced `tool_choice` → `auto` and **removes all other tools**                                      | VC         | Pass through                                                                                                                                                                                             |
| Drops the `thinking` param when the last tool-call turn lacks thinking blocks                      | LL         | Pass through                                                                                                                                                                                             |
| Clamps `max_tokens` to a catalog maximum; adds thinking budget to `max_tokens`                     | VC, pi     | `max_tokens` is the caller's native field. No defaults: the gateway "injects no defaults", so a missing `max_tokens` (required by Anthropic) is the provider's 400. Or refuse early with a clear message |
| Defaults `max_tokens` (4096 / model max) and thinking budget (1024)                                | VC, LL, pi | No defaults (principle 2)                                                                                                                                                                                |
| Drops the fifth+ `cache_control` breakpoint (warning)                                              | VC         | Pass through; provider rejects                                                                                                                                                                           |
| Auto-inserts `cache_control` breakpoints                                                           | pi, ank    | Never; caller places them via providerOptions                                                                                                                                                            |
| Injects a dummy tool when history has tool blocks but no tools                                     | LL         | Never                                                                                                                                                                                                    |
| Injects a "Please continue." user message into an empty conversation                               | LL         | Refuse empty `messages`                                                                                                                                                                                  |
| Injects a placeholder deferred tool to keep the cache warm across tool changes                     | pi         | Caller's choice (native tools)                                                                                                                                                                           |
| Strips advisor blocks, or `caller` metadata, from history                                          | LL, VC     | Pass through                                                                                                                                                                                             |
| Keeps only `metadata.user_id`                                                                      | LL         | Pass through (provider rejects unknown fields)                                                                                                                                                           |
| Throws on unknown stop reasons                                                                     | pi         | Pass through in `providerStopReason`                                                                                                                                                                     |
| Impersonates Claude Code for OAuth tokens                                                          | pi, ank    | Refuse `sk-ant-oat` credentials                                                                                                                                                                          |

Three of these still need a deliberate decision rather than a default "refuse":

- **Placement of mid-conversation system messages:** refuse, or send as placed.
- **Carrying effort markers for thinking binding:** a `native` message, or
  metadata on the assistant envelope.
- **A user message whose text precedes tool results:** refuse, or reorder and
  document it.
