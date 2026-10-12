# Anthropic Messages API research: thinking, effort, prompt caching, models and pricing

Research date: 2026-10-12. Scope: what the Anthropic adapter (stateless, non-streaming `complete`, caller-supplied key) needs to know about thinking, effort, prompt caching, the model catalog and cost.

## Method and caveats

- Sources are the official docs at platform.claude.com, fetched as raw Markdown (`<page>.md`) on 2026-10-12, not summaries. Code samples were skipped; prose, tables and the API reference were read in full for the pages listed below.
- The model list is the test key's `GET /v1/models` response (M1). Claude Mythos 5.1 / Mythos 5 / Mythos Preview are documented but not visible to the test key; they are mentioned only where they change a rule.
- Where a sibling agent's live probe (scratchpad `anthropic-probe/`) already shows the behavior, it is marked **OBSERVED** with the probe file name. No new live calls were made for this note.
- Where docs contradict each other, both readings are given and the item is listed under open questions.
- Prices are USD per million tokens (MTok).

### Source key

| ID  | URL (all `https://platform.claude.com/docs/en/...`)                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | build-with-claude/thinking                                                                                                                                                             |
| S2  | build-with-claude/extended-thinking                                                                                                                                                    |
| S3  | build-with-claude/thinking-troubleshooting                                                                                                                                             |
| S4  | build-with-claude/thinking-steering-and-cost                                                                                                                                           |
| S5  | build-with-claude/thinking-tool-workflows                                                                                                                                              |
| S6  | build-with-claude/preserved-thinking                                                                                                                                                   |
| S7  | build-with-claude/effort                                                                                                                                                               |
| S8  | build-with-claude/prompt-caching                                                                                                                                                       |
| S9  | agents-and-tools/tool-use/tool-use-with-prompt-caching                                                                                                                                 |
| S10 | build-with-claude/context-windows                                                                                                                                                      |
| S11 | about-claude/pricing                                                                                                                                                                   |
| S12 | models/overview                                                                                                                                                                        |
| S13 | models/{id}/overview (one per model: fable-5-1, fable-5, opus-5-5, opus-5, opus-4-8, opus-4-7, opus-4-6, opus-4-5, sonnet-5-5, sonnet-5, sonnet-4-6, sonnet-4-5, haiku-5-5, haiku-4-5) |
| S14 | about-claude/model-deprecations                                                                                                                                                        |
| S15 | about-claude/models/model-ids-and-versions                                                                                                                                             |
| S16 | api/service-tiers                                                                                                                                                                      |
| S17 | manage-claude/data-residency                                                                                                                                                           |
| S18 | build-with-claude/fast-mode                                                                                                                                                            |
| S19 | build-with-claude/batch-processing                                                                                                                                                     |
| S20 | api/messages/create (GA API reference) and api/beta/messages/create (beta reference)                                                                                                   |
| S21 | build-with-claude/refusals-and-fallback                                                                                                                                                |
| S22 | build-with-claude/compaction-threshold (Understanding usage)                                                                                                                           |
| S23 | agents-and-tools/tool-use/advisor-tool (Usage and billing)                                                                                                                             |
| S24 | release-notes/overview                                                                                                                                                                 |
| S25 | models/{haiku-5-5,opus-5-5,sonnet-5-5,fable-5-1}/whats-new-*                                                                                                                           |
| M1  | scratchpad `anthropic-models.json` (GET /v1/models with the test key)                                                                                                                  |

---

## 1. Thinking

### 1.1 The `thinking` request field

Schema (S20, GA): `thinking` is a tagged union on `type`:

| `type`            | Other fields                                                                                                                    | Notes                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `"adaptive"`      | `display?: "summarized" \| "omitted"`                                                                                           | Model decides whether and how much to think, steered by `output_config.effort`.                                                           |
| `"enabled"`       | `budget_tokens` (required, ≥ 1024, < `max_tokens`), `display?`                                                                  | Legacy "extended thinking" (manual budget).                                                                                               |
| `"disabled"`      | none (`display` is a 400: `thinking.disabled.display: Extra inputs are not permitted`, OBSERVED `t1g-haiku55-disabled-display`) | Thinking off.                                                                                                                             |
| `"between_tools"` | none (any other field is a 400)                                                                                                 | **Claude Sonnet 5.5 only.** Its "thinking off": no up-front thinking, but progress-update blocks still come back between tool calls (S1). |

Beta additions (S1, S6): `display: "updates"` (header `thinking-display-updates-2026-08-18`) and `block_binding: {prefix_mismatch_behavior: "error" | "drop_block"}` (header `thinking-binding-controls-2026-08-01`). Both are rejected as unknown without their header.

OBSERVED: `thinking: {type: "auto"}` is accepted and behaves like adaptive on Haiku 5.5 and Opus 4.6, and is rejected as "adaptive thinking is not supported" on Haiku 4.5 (`t1b-haiku55-bogus-type`, `t1g-opus46-type-auto`, `t1g-haiku45-type-auto`). It is undocumented (the validator's own error lists only `adaptive, between_tools, disabled, enabled`); do not rely on it.

### 1.2 Per-model support matrix

Sources: the "Configuring thinking" table in S1, the "Thinking support, defaults, and rejected configurations" table in S3, the `capabilities.thinking.types` / `effort` objects in M1, and OBSERVED probes `t1-*`, `t1b-*`.

"≤ high" means: accepted at effort `low`/`medium`/`high`, 400 at `xhigh`/`max`.

| Model id                     | No `thinking` field | `adaptive` | `enabled` + budget | `disabled`         | `between_tools` | `display` default | Prior-turn thinking kept in context | Preserved-thinking prefix check | Account-bound blocks | Interleaved thinking                                     |
| ---------------------------- | ------------------- | ---------- | ------------------ | ------------------ | --------------- | ----------------- | ----------------------------------- | ------------------------------- | -------------------- | -------------------------------------------------------- |
| `claude-fable-5-1`           | adaptive            | yes        | 400                | 400                | 400             | omitted           | all turns                           | yes                             | no                   | automatic                                                |
| `claude-fable-5`             | adaptive            | yes        | 400                | 400                | 400             | omitted           | all turns                           | no                              | no                   | automatic                                                |
| `claude-opus-5-5`            | adaptive            | yes        | 400                | 400 (every effort) | 400             | omitted           | all turns                           | yes                             | no                   | automatic                                                |
| `claude-opus-5`              | adaptive            | yes        | 400                | ≤ high             | 400             | omitted           | all turns                           | no                              | no                   | automatic                                                |
| `claude-opus-4-8`            | **off**             | yes        | 400                | yes                | 400             | omitted           | all turns                           | no                              | no                   | automatic                                                |
| `claude-opus-4-7`            | **off**             | yes        | 400                | yes                | 400             | omitted           | all turns                           | no                              | no                   | automatic                                                |
| `claude-opus-4-6`            | **off**             | yes        | yes (deprecated)   | yes                | 400             | summarized        | all turns                           | no                              | no                   | adaptive only; manual mode has none                      |
| `claude-opus-4-5-20251101`   | off                 | 400        | yes (only mode)    | yes                | 400             | summarized        | all turns                           | no                              | no                   | beta header `interleaved-thinking-2025-05-14`            |
| `claude-sonnet-5-5`          | adaptive            | yes        | 400                | 400                | ≤ high          | omitted           | all turns                           | yes                             | **yes**              | automatic                                                |
| `claude-sonnet-5`            | adaptive            | yes        | 400                | yes                | 400             | omitted           | all turns                           | no                              | no                   | automatic                                                |
| `claude-sonnet-4-6`          | **off**             | yes        | yes (deprecated)   | yes                | 400             | summarized        | all turns                           | no                              | no                   | adaptive automatic; manual with beta header (deprecated) |
| `claude-sonnet-4-5-20250929` | off                 | 400        | yes (only mode)    | yes                | 400             | summarized        | **last turn only** (older stripped) | no                              | no                   | beta header                                              |
| `claude-haiku-5-5`           | adaptive            | yes        | 400                | ≤ high             | 400             | omitted           | all turns                           | yes                             | **yes**              | automatic                                                |
| `claude-haiku-4-5-20251001`  | off                 | 400        | yes (only mode)    | yes                | 400             | summarized        | **last turn only**                  | no                              | no                   | not supported (header accepted, ignored)                 |

Notes:

- M1's `capabilities.thinking.types.disabled.supported` is `true` for Opus 5 and Haiku 5.5 even though both reject `disabled` at `xhigh`/`max`; S12 says the flag can be `true` while "the API can still reject a `disabled` request for another reason", such as effort. M1 has no `between_tools` key, so Sonnet 5.5's off-switch is not discoverable from the Models API.
- Adaptive mode can skip thinking: a response may have no thinking block on any turn (S4 "Turn validation"). Conversely, models whose default is adaptive return thinking blocks even when the request never mentions thinking, so pick blocks by `type`, never by position (S25 Haiku 5.5).
- Error strings (S3, all OBSERVED in `t1-*`): `"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.`; the same with `disabled`; Sonnet 5.5's `To turn thinking off on this model, send "thinking": {"type": "between_tools"} ...`; `adaptive thinking is not supported on this model`; `"thinking.type.between_tools" is not supported for this model.`; `output_config.effort 'xhigh' is not supported when thinking is disabled on this model. ...`.

### 1.3 Budget (`type: "enabled"`) rules

S2, S20; OBSERVED `t1b-haiku45-budget-500`, `t1b-*-budget-ge-max`, `t1b-haiku45-enabled-nobudget`:

- `budget_tokens` ≥ 1024 (`thinking.enabled.budget_tokens: Input should be greater than or equal to 1024`), required.
- `budget_tokens` < `max_tokens` (`` `max_tokens` must be greater than `thinking.budget_tokens` ``). Exception: with interleaved thinking (manual mode + `interleaved-thinking-2025-05-14`), the budget spans the whole assistant turn and may exceed `max_tokens`.
- The budget is a target, not a cap; `max_tokens` is the hard ceiling on thinking + text.
- Cannot be combined with `max_tokens: 0` (cache pre-warming).
- Opus 4.5 is the only budget-only model that also takes `effort`; there the two compose (S2, S7).
- Manual mode requires the final assistant turn of a thinking-enabled request to begin with a thinking block; adaptive mode has no such rule (S2, S4).

### 1.4 `display`: summarized, omitted, updates

S1:

- `"summarized"`: the `thinking` field holds a summary written by a different model. The raw chain of thought is never returned by any setting.
- `"omitted"`: thinking blocks come back with `thinking: ""` and a full `signature`. **Default on Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, Opus 4.7, Sonnet 5.5, Sonnet 5, Haiku 5.5** (and Mythos). Default `summarized` on Opus 4.6, Sonnet 4.6 and earlier. OBSERVED: `display: "omitted"` is also accepted on Haiku 4.5 manual mode (`t1b-haiku45-enabled-display-omitted`).
- `"updates"` (beta): reasoning blocks empty, progress-update blocks (Fable 5.1, Mythos 5.1, Opus 5.5, Sonnet 5.5, Fable 5) carry a short summary. Under `between_tools` on Sonnet 5.5 progress updates also carry text.
- Billing is identical under every `display` value (§1.9). The `signature` is identical whatever the display. Switching `display` between turns is supported. Text placed into the empty `thinking` field of a replayed omitted block is ignored, not rejected.
- `display` is invalid with `disabled` and `between_tools`.
- `thinking.display` is not part of the preserved-thinking prefix (S6) but is part of the thinking configuration rendered into the prompt; S8 lists "thinking parameters" as cache-invalidating without singling out `display` (open question Q6).

### 1.5 Interleaved thinking and progress updates

- Adaptive mode interleaves automatically on every model that supports adaptive; no header (S1). On Fable 5.1, Fable 5, Opus 5.5, Opus 5, Sonnet 5.5, Opus 4.8, Opus 4.7, reasoning between tool calls always appears in thinking blocks.
- Manual mode: Opus 4.5 / Sonnet 4.5 need `interleaved-thinking-2025-05-14`; Sonnet 4.6 accepts it (deprecated); Opus 4.6 manual mode never interleaves; Haiku 4.5 does not support it (header accepted and ignored). The Claude API accepts the header on any model (S2).
- Progress updates (Fable 5.1, Mythos 5.1, Opus 5.5, Sonnet 5.5, Fable 5) are separate `thinking` blocks with their own `signature`, placed immediately before the `tool_use`/`server_tool_use` they introduce. They count toward `output_tokens` at full length. When a response stops on `max_tokens`, `model_context_window_exceeded` or `stop_sequence` right after a tool call, the last block may be a progress-update standing in for unfinished work; under summarized/updates its text is exactly `This part of the response was interrupted before it finished.` (S1).

### 1.6 Thinking blocks, `signature`, `redacted_thinking`

S1:

- `{"type": "thinking", "thinking": "<summary or empty>", "signature": "<opaque>"}`. The signature is an encrypted copy of the full reasoning; the server decrypts it to rebuild the prompt. It is opaque; do not parse it. Signatures are portable across the Claude API, Bedrock and Google Cloud, except Sonnet 5.5 and Haiku 5.5 blocks, which work only in the producing account or a linked one.
- `{"type": "redacted_thinking", "data": "<opaque>"}`: safety-redacted reasoning. Pass back exactly like thinking blocks. Filtering assistant content by `type == "thinking"` silently drops these and breaks the round trip.
- With streaming, the signature arrives as one `signature_delta` just before `content_block_stop`; with `display: "omitted"` a single empty `thinking_delta` precedes it. (Gateway is non-streaming; relevant only if streaming is added.)

### 1.7 Passing thinking back

Rules, all from S1 unless noted:

1. **Within a tool-use turn: required.** When you send tool results, the assistant message that issued the `tool_use` must come back with its `thinking`/`redacted_thinking` blocks complete and unmodified. A tool-use loop (assistant tool_use → user tool_result → assistant …) is one assistant turn.
2. **Across turns: recommended; outside tool use: allowed to omit.** "Required: within a tool-use turn ... Recommended: across turns, pass everything back. Allowed: outside tool use, omit prior turns' thinking."
3. **No editing of the latest assistant message's thinking.** "Within the latest assistant message, the sequence of consecutive `thinking` blocks must match what the model generated ... you can't rearrange, edit, or partially drop them," `redacted_thinking` included. Error: 400 `invalid_request_error` containing `` `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified `` (S3). A tampered/truncated/empty signature is a separate 400: ``Invalid `signature` in `thinking` block`` (S3, S6).
4. **What happens to earlier turns' thinking (per model, automatic).**
   - Keep-all models (Opus 4.5 and later Opus, Sonnet 4.6 and later Sonnet, Haiku 5.5, Fable 5/5.1, Mythos): prior turns' thinking stays in context, counts toward the context window, and is billed as input tokens (and cached with the rest of the prefix).
   - Last-turn-only models (Sonnet 4.5, Haiku 4.5, and older): once a user message that is not only tool results arrives, the API strips all earlier thinking blocks; they cost nothing and use no context. You don't have to strip them yourself.
   - Override either way with context editing `clear_thinking_20251015` (beta `context-management-2025-06-27`).
5. **Removing thinking blocks (preserved-thinking models).** You may drop thinking blocks from the start of history (oldest first), from the end, or all of them. Removing one from the middle and keeping later ones invalidates every later block; putting a removed block back invalidates the blocks produced while it was gone (S6).
6. **Replaying thinking from a different model.** Keep passing the blocks; "the API ignores or drops the blocks the target model can't read", silently, unbilled, not counted in `input_tokens` (S1, S6). Readability (S6 "Switching models mid-conversation"):
   - Fable 5.1 and Mythos 5.1 read each other's blocks and all earlier models' blocks (including Opus 5.5's, on the Claude API). Nobody else reads Fable 5.1 / Mythos 5.1 blocks.
   - Opus 5.5 reads Opus 5 and earlier Opus/Sonnet/Haiku blocks, and on the Claude API and Google Cloud also Sonnet 5.5 and Haiku 5.5 blocks; not Fable/Mythos blocks.
   - Sonnet 5.5 reads Sonnet 5, Opus 4.8, Haiku 4.5 and earlier, plus Haiku 5.5 (Claude API, Google Cloud); not Opus 5, Opus 5.5, Fable, Mythos. Only Opus 5.5 reads Sonnet 5.5's blocks.
   - Haiku 5.5 reads Sonnet 5, Opus 4.8, Haiku 4.5 and earlier; not Opus 5, Opus 5.5, Sonnet 5.5, Fable, Mythos. Only Opus 5.5 and Sonnet 5.5 read Haiku 5.5's blocks.
   - For pre-Fable-5.1 pairs the docs do not give a matrix; OBSERVED cross-model replays exist in `t3-xmodel-*` (sibling probe).
   - With `thinking-binding-controls-2026-08-01`, each drop is listed in the top-level `input_transformations` array as `{type: "thinking_dropped", path: "messages.3.content.0", reason: "model_binding_mismatch"}` (or `organization_binding_mismatch` for account-bound blocks). Without the header the drop is silent.
   - "Strip prior `thinking` and `redacted_thinking` blocks yourself only to save input tokens on models that ignore rather than drop them, and never when redeeming a fallback credit."
7. **Preserved thinking (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5): the prefix check** (S6). A replayed thinking block is valid only while the top-level `system`, the set of `tools`, and every message before the block are unchanged. Not part of the check: `effort`, `max_tokens`, `output_config`, `tool_choice`, `metadata`, `thinking.display`, `cache_control` markers. JSON formatting and key order don't matter; values do. For `url` image/document sources the fetched bytes are compared.
   - Enforcement: accounts created on/after 2026-08-31 00:00 UTC get a 400 by default (`messages.N.content.M: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. ...`). Older accounts are enforced only when the request sets `prefix_mismatch_behavior`; otherwise failing blocks pass through (reported as `thinking_mismatch_allowed` under the beta header).
   - `"drop_block"`: failing block and every later thinking block are dropped (unbilled), the cache restarts at the edit, and output tokens rise (Anthropic measured +2.5% to +67% depending on effort and frequency).
   - On Sonnet 5.5 / Haiku 5.5, `block_binding` works only with `adaptive`; with `between_tools` / `disabled` it is a 400.
   - The `count_tokens` endpoint runs the same check.
   - **Gateway guidance from S6 ("Libraries, proxies, and gateways")**: forward the caller's `anthropic-beta` values and `thinking.block_binding` unchanged and return `input_transformations`; leave a `role: "system"` message where the caller put it (moving it into top-level `system` invalidates every thinking block); to turn tools off send `tool_choice: {type: "none"}` rather than removing `tools`; don't hide the 400 by stripping and retrying silently.
8. **Toggling thinking.** Within a turn (between a `tool_use` and its `tool_result`) the API does not error: it silently disables thinking for that request and may strip thinking blocks that would make the turn invalid. Check for thinking blocks in the response to confirm. Between turns, toggling is fine (S1). Changing the thinking configuration invalidates the message cache (§3.6). Adaptive models accept history that has no thinking blocks or came from another configuration (S4).
9. **Forced `tool_choice`** (S1 "Limits and feature compatibility"):
   - Manual `enabled`: `any`/`tool` → 400 (`Thinking may not be enabled when tool_choice forces tool use.`, OBSERVED `t1e-haiku45-enabled-tc-any`). `auto` and `none` are fine.
   - Adaptive: accepted, and the response starts with the tool call with no thinking block (OBSERVED on Haiku 5.5, `thinking_tokens: 0`).
   - **Opus 5.5, Sonnet 5.5, Fable 5.1 (and Mythos 5.1) reject `any`/`tool` on every request**: `tool_choice: type "tool" and "any" are not supported for this model.` (OBSERVED `t1e-sonnet55-tc-any`). Also on `count_tokens` and Batches.
10. **Sampling parameters** (S1, S14, S20):
    - Opus 4.7 and later, Sonnet 5, Sonnet 5.5, Haiku 5.5, Fable 5/5.1: non-default `temperature`, `top_p`, `top_k` → 400 on every request, thinking or not. OBSERVED error text: `` `temperature` is deprecated for this model. `` (thinking disabled or omitted); with adaptive on Haiku 5.5 the message is `` `temperature` may only be set to 1 when thinking is enabled or in adaptive mode ``, and `temperature: 1` is accepted (`t1d-haiku55-adaptive-temp1`).
    - Docs conflict on `top_p`: S1 says the default is 0.99 and `top_p: 1`, or `temperature` + `top_p` together, return 400; the GA reference (S20) says "A value >= 0.99 will be accepted". Q1.
    - Opus 4.6, Sonnet 4.6 and older: allowed, but while thinking is on `temperature` must be 1, `top_k` must be unset, and `top_p` must be in [0.95, 1]. OBSERVED on Haiku 4.5 also: `` `temperature` and `top_p` cannot both be specified for this model. ``
11. **Prefill** (last message is `assistant`): rejected on all 4.6-and-later models with 400 `This model does not support assistant message prefill. The conversation must end with a user message.` (OBSERVED `t1f-*`). On earlier models, docs say you can't prefill while thinking is on, but OBSERVED `t1f-haiku45-enabled-prefill` returned 200 with text only (thinking apparently dropped). Q2.

### 1.8 Thinking and `max_tokens` / context window

S1, S10:

- Current-turn thinking always counts toward `max_tokens`, is billed as output, and occupies context. With adaptive-by-default models a small `max_tokens` can stop after a thinking block with no text (`stop_reason: "max_tokens"`).
- On 4.5-era models and newer, input + `max_tokens` > context window is accepted; generation that hits the window stops with `stop_reason: "model_context_window_exceeded"`. Input alone over the window → 400 "prompt is too long".
- SDKs require streaming above `max_tokens` 21,333 (client-side check only). Requests that think more than ~32k tokens risk system timeouts; docs recommend batch. Relevant to a non-streaming Cloudflare gateway.

### 1.9 Billing of thinking

S4 "Pricing", S20:

- Thinking is billed as **output tokens at the full internal length**, regardless of `display`. Summaries are not billed. "The billed output token count does not match the visible token count."
- Prior-turn thinking kept in context (keep-all models) is billed as input on later requests, including when read from cache.
- `usage.output_tokens_details.thinking_tokens`: raw reasoning tokens (re-tokenized, may differ by a few tokens), always ≤ `output_tokens`; `output_tokens` stays the inclusive, authoritative total. OBSERVED: present (possibly `0`) on 4.6+ responses; present on Haiku 4.5 / Sonnet 4.5 when thinking ran; **absent** on Sonnet 4.5 and Opus 4.6 responses without thinking (`t1-sonnet45-omit`, `t1c-opus46-effort-low-omit`). Treat absent as unknown, not zero, unless thinking was off.
- Dropped blocks (model/prefix/account binding) are not billed.
- Thinking on adds a specialized system prompt (input tokens, already in `usage`).

---

## 2. Effort (`output_config.effort`)

S7, S4, S20, M1, OBSERVED `t1c-*`.

- Location: `output_config.effort`, GA, no header. Values: `low`, `medium`, `high`, `xhigh`, `max` (validator: `output_config.effort: Input should be 'low', 'medium', 'high', 'xhigh' or 'max'`). `adaptive` is not an effort value.
- Affects **all** output tokens (text, tool calls, thinking), with or without thinking. Lower effort = fewer, terser tool calls.
- Soft signal, not a budget. `max_tokens` remains the hard cap. Each request in a tool loop has its own `max_tokens`.
- Setting effort to the model's default equals omitting it (no cache impact). Changing top-level effort invalidates message cache breakpoints and may invalidate tools/system breakpoints (model-specific).

| Model                        | Levels                                                                      | Default    | Per-message effort (beta `mid-conversation-output-config-2026-07-01`)              | Thinking-off constraint       |
| ---------------------------- | --------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| `claude-fable-5-1`           | low, medium, high, xhigh, max                                               | high       | yes                                                                                | can't disable                 |
| `claude-fable-5`             | low … max                                                                   | high       | **no** (400 `output_config.effort requires a model that supports per-turn effort`) | can't disable                 |
| `claude-opus-5-5`            | low … max                                                                   | **medium** | yes                                                                                | can't disable                 |
| `claude-opus-5`              | low … max                                                                   | high       | yes (not on Bedrock)                                                               | `disabled` only ≤ high        |
| `claude-opus-4-8`            | low … max                                                                   | high       | no                                                                                 | none                          |
| `claude-opus-4-7`            | low … max                                                                   | high       | no                                                                                 | none                          |
| `claude-opus-4-6`            | low, medium, high, max (no `xhigh`)                                         | high       | no                                                                                 | none                          |
| `claude-opus-4-5-20251101`   | low, medium, high                                                           | high       | no                                                                                 | composes with `budget_tokens` |
| `claude-sonnet-5-5`          | low … max (recalibrated vs Sonnet 5)                                        | high       | yes, but not with `between_tools`                                                  | `between_tools` only ≤ high   |
| `claude-sonnet-5`            | low … max                                                                   | high       | no                                                                                 | none                          |
| `claude-sonnet-4-6`          | low, medium, high, max (no `xhigh`)                                         | high       | no                                                                                 | none                          |
| `claude-sonnet-4-5-20250929` | **not supported** (400 `This model does not support the effort parameter.`) | —          | —                                                                                  | —                             |
| `claude-haiku-5-5`           | low … max                                                                   | **medium** | yes (Claude API, Google Cloud), not with `disabled`                                | `disabled` only ≤ high        |
| `claude-haiku-4-5-20251001`  | **not supported** (400)                                                     | —          | —                                                                                  | —                             |

- Unsupported level error (OBSERVED `t1c-opus46-effort-xhigh`): `This model does not support effort level 'xhigh'. Supported levels: high, low, max, medium.`
- Per-message effort: a `{role: "system", content: [], output_config: {effort: "low"}}` entry in `messages`. Takes effect from the next user turn with new input. Keeps the prompt cache. Without the beta header: `messages.N.output_config: Extra inputs are not permitted`.
- Interaction with thinking: in adaptive mode effort is the primary depth control; on budget-only models it does nothing to thinking depth (except Opus 4.5 where it composes). On models with `disabled`/`between_tools` restrictions, `xhigh`/`max` + thinking-off → 400.
- At `xhigh`/`max` docs suggest `max_tokens` ≥ 64k.

---

## 3. Prompt caching

### 3.1 How to turn it on

S8:

- **Automatic (top-level) caching**: `cache_control: {type: "ephemeral", ttl?: "5m" | "1h"}` at the request top level. The API puts the breakpoint on the last cacheable block and moves it forward as the conversation grows. It uses one of the 4 breakpoint slots. Edge cases: if the last block already has an explicit breakpoint with the same TTL it is a no-op; a different TTL → 400; 4 explicit breakpoints already → 400; if the last block isn't eligible, it silently walks back to the nearest eligible block or skips caching. Not available on the legacy Bedrock InvokeModel integration.
- **Explicit breakpoints**: `cache_control: {type: "ephemeral", ttl?}` on content blocks. `"ephemeral"` is the only type.

### 3.2 Where breakpoints may go

S8 "What can be cached", S9:

- `tools[]` entries (put it on the last tool to cache all tools; for `mcp_toolset`, computer/browser toolsets put it on the toolset entry), `system` text blocks, and `messages[].content` blocks: text (user and assistant), images and documents (user turns), `tool_use` and `tool_result` (both roles).
- Not cacheable directly: `thinking` blocks (cached implicitly as part of the prefix, and counted as input when read), sub-content blocks such as citations (cache the parent document), **empty text blocks**.
- OBSERVED: `cache_control: null` on a block is accepted (sibling probe `basics/089-cache-control-null-on-block`).

### 3.3 Limits and lookback

- Max **4** breakpoints per request (automatic counts as one).
- Prefix order is `tools` → `system` → `messages`; the hash at a breakpoint covers everything up to and including that block.
- Writes happen **only** at breakpoints. Reads walk back from each breakpoint up to **20 positions** (the breakpoint counts as the first) looking for an entry that an earlier request wrote. On the Claude API a run of consecutive `tool_use` blocks counts as one position, as does a run of `tool_result` blocks. A growing conversation that adds ≥ 20 blocks between writes misses unless a second breakpoint sits closer.
- A cache entry becomes readable only after the first response begins; parallel requests don't hit each other's writes.
- Isolation: per **workspace** on the Claude API, Claude Platform on AWS and Foundry; per organization on Bedrock and Google Cloud.
- Lifetime counts from the **start** of the request that wrote or read the entry; generation time eats into it. Every hit refreshes the TTL at no cost.
- Mixed TTLs: 1h entries must come before 5m entries. Billing positions: A = highest hit (read), B = highest 1h breakpoint after A (1h write for B−A), C = last breakpoint (5m write for C−B).
- No manual cache clearing.
- **Server tool results are cached automatically**: when a request already has at least one `cache_control`, the API puts a 5-minute breakpoint on each server-tool result before the next server-side iteration. These show up as `ephemeral_5m_input_tokens` even if you only asked for 1h (S9).
- Pre-warming: `max_tokens: 0` returns empty `content`, `stop_reason: "max_tokens"`, bills only the cache write/input. Rejected with `stream: true`, `thinking.type: "enabled"`, `output_config.format`, forced `tool_choice`, and inside batches.

### 3.4 Minimum cacheable prompt length

S8 "Cache limitations" (silently not cached below the minimum; both cache fields are 0):

| Minimum      | Models                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| 512 tokens   | Fable 5.1, Fable 5, Opus 5.5, Opus 5, Sonnet 5.5, Haiku 5.5 (and Mythos 5/5.1) |
| 1,024 tokens | Opus 4.8, Sonnet 5, Sonnet 4.6, Sonnet 4.5                                     |
| 2,048 tokens | Opus 4.7 (and Mythos Preview)                                                  |
| 4,096 tokens | Opus 4.6, Opus 4.5, Haiku 4.5                                                  |

### 3.5 TTL pricing multipliers

S8, S11. Relative to the model's base input price:

| Operation          | Multiplier                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| 5-minute write     | 1.25×                                                                                               |
| 1-hour write       | 2×                                                                                                  |
| Read (hit/refresh) | 0.1× on most models; **0.05×** on Opus 5.5 and Sonnet 5.5; **0.025×** on Fable 5.1 (and Mythos 5.1) |

These stack with the batch discount, Haiku 5.5's long-context rates, data residency (1.1×), and fast mode prices.

### 3.6 What invalidates the cache

S8, S9, S1:

| Change                                                 | Tools cache    | System cache   | Messages cache                                                       |
| ------------------------------------------------------ | -------------- | -------------- | -------------------------------------------------------------------- |
| Tool definitions (name, description, schema)           | ✘              | ✘              | ✘                                                                    |
| Web search or citations toggled on/off                 | ✓              | ✘              | ✘                                                                    |
| `speed` fast ↔ standard                                | ✓              | ✘              | ✘                                                                    |
| `tool_choice`                                          | ✓              | ✓              | ✘                                                                    |
| `disable_parallel_tool_use`                            | ✓              | ✓              | ✘                                                                    |
| Images present/absent anywhere                         | ✓              | ✓              | ✘                                                                    |
| Thinking config (mode, `budget_tokens`)                | model-specific | model-specific | ✘                                                                    |
| Top-level `output_config.effort` (non-default change)  | model-specific | model-specific | ✘                                                                    |
| New non-tool-result user turn with thinking in history | ✓              | ✓              | ✓ on keep-all models; ✘ on last-turn-only models (thinking stripped) |
| API drops a thinking block (binding)                   | ✓              | ✓              | ✘ from that block on                                                 |

Also: switching models (caches are per model); any byte change in the prefix; non-deterministic JSON key order in `tool_use.input`; a mid-conversation `role: "system"` message instead of editing top-level `system` keeps the cache (Fable 5/5.1, Opus 5.5, Opus 5, Opus 4.8, Sonnet 5.5, Haiku 5.5; **not** Sonnet 5). Defining tools via `tool_addition` (beta `inline-tools-2026-09-15`) keeps the cache. Cache diagnostics: send `diagnostics: {previous_message_id: ...}` (GA since 2026-09-23); responses now always carry `diagnostics` (null if not requested) (S24).

### 3.7 Usage fields

S8, S20; OBSERVED on every probe response:

```json
"usage": {
  "input_tokens": 16,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 0,
  "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
  "output_tokens": 7,
  "output_tokens_details": { "thinking_tokens": 0 },
  "service_tier": "standard",
  "inference_geo": "global"
}
```

- `input_tokens` = tokens **after the last cache breakpoint** (neither read nor written). It **excludes** cached tokens.
- `cache_creation_input_tokens` = tokens written; equals `cache_creation.ephemeral_5m_input_tokens + ephemeral_1h_input_tokens`.
- `cache_read_input_tokens` = tokens read.
- **Total input = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`** (stated in S8 and in the API reference's `Usage` description). All three count toward the context window.
- Other fields: `server_tool_use: {web_search_requests, web_fetch_requests}` (pricing page examples also show `code_execution_requests`); `service_tier: "standard" | "priority" | "batch"`; `inference_geo` (string; OBSERVED `"not_available"` on pre-4.6 models, not null); beta-only `speed: "standard" | "fast"`, `iterations[]`, `fallback_credit`. The cache fields are typed `number | null`.

---

## 4. Models and pricing catalog

### 4.1 Identity, limits, capabilities

All 14 ids from M1. Every model: input text + images + PDF documents (M1 `image_input`, `pdf_input` all true; S13 "Text and images → text"), output text. `contextWindow` = M1 `max_input_tokens`; `maxOutputTokens` = M1 `max_tokens` (synchronous). Batch max output 300K needs `output-300k-2026-03-24`.

| Model id                     | Display name      | Alias (Claude API)     | Released (S13) | Context | Max out | Batch max out | Tokenizer | Thinking modes                                    | Effort default           | Min cache | Status (S14)              | Retirement (Anthropic platforms)               |
| ---------------------------- | ----------------- | ---------------------- | -------------- | ------- | ------- | ------------- | --------- | ------------------------------------------------- | ------------------------ | --------- | ------------------------- | ---------------------------------------------- |
| `claude-fable-5-1`           | Claude Fable 5.1  | — (id is the snapshot) | 2026-09-01     | 1M      | 128K    | 128K          | new       | adaptive (always on)                              | high                     | 512       | Active (latest)           | not sooner than 2027-09-01                     |
| `claude-fable-5`             | Claude Fable 5    | —                      | 2026-06-09     | 1M      | 128K    | 128K          | new       | adaptive (always on)                              | high                     | 512       | Active (legacy)           | not sooner than 2027-06-09                     |
| `claude-opus-5-5`            | Claude Opus 5.5   | —                      | 2026-09-22     | 1M      | 128K    | 300K          | new       | adaptive (always on)                              | medium                   | 512       | Active (latest)           | not sooner than 2027-09-22                     |
| `claude-opus-5`              | Claude Opus 5     | —                      | 2026-07-24     | 1M      | 128K    | 300K          | new       | adaptive (default), disabled ≤ high               | high                     | 512       | Active (legacy)           | not sooner than 2027-07-24                     |
| `claude-opus-4-8`            | Claude Opus 4.8   | —                      | 2026-05-28     | 1M      | 128K    | 300K          | new       | adaptive (opt-in), disabled                       | high                     | 1,024     | Active (legacy)           | not sooner than 2027-05-28                     |
| `claude-opus-4-7`            | Claude Opus 4.7   | —                      | 2026-04-16     | 1M      | 128K    | 300K          | new       | adaptive (opt-in), disabled                       | high                     | 2,048     | Active (legacy)           | not sooner than 2027-04-16                     |
| `claude-opus-4-6`            | Claude Opus 4.6   | —                      | 2026-02-05     | 1M      | 128K    | 300K          | old       | adaptive (opt-in), enabled (deprecated), disabled | high                     | 4,096     | Active (legacy)           | not sooner than 2027-02-05                     |
| `claude-opus-4-5-20251101`   | Claude Opus 4.5   | `claude-opus-4-5`      | 2025-11-24     | 200K    | 64K     | 64K           | old       | enabled, disabled                                 | high (low/med/high only) | 4,096     | Active (legacy)           | **not sooner than 2026-11-24**                 |
| `claude-sonnet-5-5`          | Claude Sonnet 5.5 | —                      | 2026-09-28     | 1M      | 128K    | 300K          | new       | adaptive (default), between_tools ≤ high          | high                     | 512       | Active (latest)           | not sooner than 2027-09-28                     |
| `claude-sonnet-5`            | Claude Sonnet 5   | —                      | 2026-06-30     | 1M      | 128K    | 300K          | new       | adaptive (default), disabled                      | high                     | 1,024     | Active (legacy)           | not sooner than 2027-06-30                     |
| `claude-sonnet-4-6`          | Claude Sonnet 4.6 | —                      | 2026-02-17     | 1M      | 128K    | 300K          | old       | adaptive (opt-in), enabled (deprecated), disabled | high                     | 1,024     | Active (legacy)           | not sooner than 2027-02-17                     |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 | `claude-sonnet-4-5`    | 2025-09-29     | 200K    | 64K     | 64K           | old       | enabled, disabled                                 | not supported            | 1,024     | **Deprecated 2026-09-30** | **retires 2026-11-30** (→ `claude-sonnet-5-5`) |
| `claude-haiku-5-5`           | Claude Haiku 5.5  | —                      | 2026-10-07     | 1M      | 128K    | 300K          | new       | adaptive (default), disabled ≤ high               | medium                   | 512       | Active (latest)           | not sooner than 2027-10-07                     |
| `claude-haiku-4-5-20251001`  | Claude Haiku 4.5  | `claude-haiku-4-5`     | 2025-10-15     | 200K    | 64K     | 64K           | old       | enabled, disabled                                 | not supported            | 4,096     | Active (legacy)           | **not sooner than 2026-10-15**                 |

- "new" tokenizer (Opus 4.7 and later, Haiku 5.5) produces ~30% more tokens for the same text (S11).
- From 4.6 on, dateless ids are pinned snapshots, not aliases (S15). Pre-4.6 aliases (`claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`) point to the dated snapshot; a catalog keyed by id should map both to the same entry, and the response `model` field reports the dated id (OBSERVED: `claude-haiku-4-5-20251001`).
- M1 `lifecycle` is `"active"` with `deprecated_at: null` and `retires_at: null` for **every** model, including Sonnet 4.5, which S14 lists as deprecated with a 2026-11-30 retirement. Don't trust M1 lifecycle fields; use S14.
- M1 `created_at` differs from the release dates in S13 for Opus 4.7 (04-14 vs 04-16) and Opus 4.6 (02-04 vs 02-05).
- Retired and no longer callable on the Claude API (S14): Opus 4.1 (2026-08-05), Opus 4, Sonnet 4 (2026-06-15), Haiku 3, Haiku 3.5, Sonnet 3.7 and older.

### 4.2 Standard prices (USD / MTok)

S11 "Model pricing" and "Batch processing", confirmed on each S13 page.

| Model id                              | Input | Output | 5m write | 1h write | Cache read                           | Batch input | Batch output |
| ------------------------------------- | ----- | ------ | -------- | -------- | ------------------------------------ | ----------- | ------------ |
| `claude-fable-5-1`                    | 10    | 50     | 12.50    | 20       | **0.25**                             | 5           | 25           |
| `claude-fable-5`                      | 10    | 50     | 12.50    | 20       | 1                                    | 5           | 25           |
| `claude-opus-5-5`                     | 4     | 20     | 5        | 8        | **0.20**                             | 2           | 10           |
| `claude-opus-5`                       | 5     | 25     | 6.25     | 10       | 0.50                                 | 2.50        | 12.50        |
| `claude-opus-4-8`                     | 5     | 25     | 6.25     | 10       | 0.50                                 | 2.50        | 12.50        |
| `claude-opus-4-7`                     | 5     | 25     | 6.25     | 10       | 0.50                                 | 2.50        | 12.50        |
| `claude-opus-4-6`                     | 5     | 25     | 6.25     | 10       | 0.50                                 | 2.50        | 12.50        |
| `claude-opus-4-5-20251101`            | 5     | 25     | 6.25     | 10       | 0.50                                 | 2.50        | 12.50        |
| `claude-sonnet-5-5`                   | 2     | 10     | 2.50     | 4        | **0.10** (was 0.20 until 2026-10-07) | 1           | 5            |
| `claude-sonnet-5`                     | 2     | 10     | 2.50     | 4        | 0.20                                 | 1           | 5            |
| `claude-sonnet-4-6`                   | 3     | 15     | 3.75     | 6        | 0.30                                 | 1.50        | 7.50         |
| `claude-sonnet-4-5-20250929`          | 3     | 15     | 3.75     | 6        | 0.30                                 | 1.50        | 7.50         |
| `claude-haiku-5-5` (prompt ≤ 100,000) | 0.10  | 0.50   | 0.125    | 0.20     | 0.01                                 | 0.05        | 0.25         |
| `claude-haiku-5-5` (prompt > 100,000) | 0.50  | 2.50   | 0.625    | 1        | 0.05                                 | 0.25        | 1.25         |
| `claude-haiku-4-5-20251001`           | 1     | 5      | 1.25     | 2        | 0.10                                 | 0.50        | 2.50         |

Sonnet 5's $2/$10 was "introductory" at launch and became the standard price on 2026-08-10; the planned rise to $3/$15 was cancelled (S11, S24).

### 4.3 Price modifiers

| Modifier                                                                                        | Models                                                                                                                                                    | How it applies                                                                                                                                                                                                                         | Seen in the response?                                                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Long context**                                                                                | **Haiku 5.5 only.** Every other 1M model is flat across the window (S11 "Long context pricing").                                                          | Whole request at the higher row (input, output, both writes, read) when the prompt is **over 100,000 tokens**, prompt length = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. Each request priced on its own. | Derivable from usage.                                                     |
| **Batch**                                                                                       | All (sync gateway doesn't use it)                                                                                                                         | 50% off input and output; cache multipliers stack on top.                                                                                                                                                                              | `service_tier: "batch"`                                                   |
| **Data residency** (`inference_geo: "us"`)                                                      | Claude 4.6 and later (Opus 4.6+, Sonnet 4.6+, Haiku 5.5, Fable). Older models: the parameter is a 400.                                                    | **1.1×** on every category (input, output, cache writes, reads), including Haiku 5.5's long-context row; stacks with fast mode and caching. If omitted, the workspace's `default_inference_geo` applies, which may be `us`.            | `usage.inference_geo: "us" \| "global"` (older models: `"not_available"`) |
| **Fast mode** (`speed: "fast"`, beta `fast-mode-2026-02-01`, research preview, Claude API only) | Opus 5.5 ($8 / $40), Opus 5 and Opus 4.8 ($10 / $50), i.e. **2×** input and output. Opus 4.7: error. Opus 4.6: silently runs standard and bills standard. | Replaces the base input/output rates across the full window; caching multipliers and the geo multiplier apply on top. Not with Batch or Priority Tier.                                                                                 | beta `usage.speed: "fast" \| "standard"`                                  |
| **Priority Tier** (`service_tier: "auto" \| "standard_only"`)                                   | Only for orgs with an existing commitment (no longer sold). Not supported on Fable 5.1, Haiku 5.5, Opus 5.5, Opus 5, Sonnet 5.5, Sonnet 5.                | No per-token price published; it's a capacity contract (burndown counts cache reads 0.1, 5m writes 1.25, 1h writes 2, US geo 1.1).                                                                                                     | `usage.service_tier: "priority"`                                          |
| **Partner clouds**                                                                              | Bedrock / Google Cloud price separately (regional endpoints +10%); Foundry and Claude Platform on AWS bill first-party rates via CCUs.                    | Not relevant to the first-party adapter.                                                                                                                                                                                               | —                                                                         |

### 4.4 Server tool fees (not in token usage)

S11:

- **Web search**: $10 per 1,000 searches, plus tokens for results. Count: `usage.server_tool_use.web_search_requests`. Failed searches are not billed.
- **Web fetch**: no fee beyond tokens. Count: `web_fetch_requests`.
- **Code execution**: free when the request includes `web_search_20260209`+ or `web_fetch_20260209`+. Otherwise billed by container time: 1,550 free hours per org per month, then $0.05 per container-hour, 5-minute minimum, and billed even if not called when files are attached. The response shows only a request count, so the fee can't be computed per response.
- Tool definitions and the tool-use system prompt (for example 286 tokens on Opus 5.5 / Sonnet 5.5 / Haiku 5.5 with `auto`), bash (+325 / +244), text editor (+974 / +745), computer toolset (~4,500), browser toolset (~6,600) are ordinary input tokens already in `usage`.
- The advisor tool's sub-inference is billed at the advisor model's rates (§5).

### 4.5 Draft catalog entries

`ModelCost` today has a single `cacheWrite`. Anthropic has two write rates, and `Usage` has a single `cacheWrite` count. Options: (a) add `cacheWrite1h` to `ModelCost` and split `Usage.cacheWrite`, or (b) keep `cacheWrite` as the 5m rate and price 1h writes at `2 × input` in the Anthropic profile. The 1h rate is exactly 2× base input on every model in the table, and the 5m rate exactly 1.25×. Either way, the adapter needs `cache_creation.ephemeral_1h_input_tokens` to price correctly. Shape with option (a):

```ts
const ANTHROPIC_1M = { contextWindow: 1_000_000, maxOutputTokens: 128_000 } as const;
const ANTHROPIC_200K = { contextWindow: 200_000, maxOutputTokens: 64_000 } as const;
const INPUT = ['text', 'image', 'file'] as const;

// { input, output, cacheWrite (5m), cacheWrite1h, cacheRead }
{ id: 'claude-fable-5-1',  name: 'Claude Fable 5.1',  ...ANTHROPIC_1M, input: INPUT,
  pricing: { base: { input: 10, output: 50, cacheWrite: 12.5, cacheWrite1h: 20, cacheRead: 0.25 } } },
{ id: 'claude-haiku-5-5',  name: 'Claude Haiku 5.5',  ...ANTHROPIC_1M, input: INPUT,
  pricing: {
    base: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01 },
    tiers: [{ aboveInputTokens: 100_000,
              cost: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheWrite1h: 1, cacheRead: 0.05 } }],
  } },
// pre-4.6 models: register the dated id and the alias, same pricing.
```

The existing `estimateCost` tier rule (`totalInput > aboveInputTokens`) matches Haiku 5.5's "over 100,000 tokens" with `totalInput` = input + cache write + cache read.

---

## 5. Summing usage and computing cost

### 5.1 Mapping to the contract's `Usage`

| Contract field | Anthropic source                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`        | `usage.input_tokens` (uncached remainder)                                                                                                             |
| `cacheRead`    | `usage.cache_read_input_tokens` (null → unknown)                                                                                                      |
| `cacheWrite`   | `usage.cache_creation_input_tokens` (split 5m/1h from `usage.cache_creation`)                                                                         |
| `totalInput`   | `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`                                                                                |
| `output`       | `usage.output_tokens` (includes thinking)                                                                                                             |
| `reasoning`    | `usage.output_tokens_details.thinking_tokens`. Omit when the object is absent and thinking might have run. It is part of `output`, never added to it. |

### 5.2 Cost algorithm

1. **Pick the per-model token records.**
   - If `usage.iterations` is absent: one record, the top-level `usage`, at the response's `model` rates.
   - If present (beta features: compaction, advisor tool, server-side fallback, and also seen on GA pre-warm responses): the top-level fields cover only the executor/serving model's non-compaction iterations. Compaction entries are **not** in the top level (S22). Advisor entries are **not** in the top level and are billed at the advisor `model` (S23). For fallback, top level covers only the attempt that produced the message; declined attempts are separate `message` entries with their own `model` (S21). The safe rule: when `iterations` exists, price **every entry** by its own `model` (null → the request's model; compaction entries carry no `model` field, so assume the request model, Q4) and don't add the top-level numbers on top.
   - Server-tool loops (`message` iterations of one model) are already summed into the top-level fields (S23: "Every top-level usage field is the sum of that field across all executor iterations").
2. **Rates per record.** Choose the catalog row for the record's model. For Haiku 5.5 choose the >100K row when that record's prompt (input + writes + reads) is over 100,000 (Q3: for multi-iteration server-tool loops the summed top-level input can exceed 100K even if no single prompt does).
3. **Price buckets.** `input × in + ephemeral_5m × write5m + ephemeral_1h × write1h + cache_read × read + output × out`. If `cache_creation` is missing but `cache_creation_input_tokens > 0`, the write split is unknown. Either treat it as 5m (that is the default TTL) or return no estimate, and document the choice.
4. **Multipliers** (product of all that apply):
   - `inference_geo == "us"` → × 1.1 (models 4.6+ only).
   - `speed == "fast"` → use fast rates (= 2× base input/output on all three supported models; cache multipliers apply to the fast base). Since `speed` is beta, the gateway only sees it if the caller passed the beta header and `speed` in `providerOptions`. If the request asked for fast and the response has no `usage.speed`, no estimate.
   - `service_tier == "batch"` → × 0.5 (not expected on the sync route).
   - `service_tier == "priority"` → **cost unknown, omit the estimate** (contract pricing).
   - `inference_geo` missing on a 4.6+ model while the workspace default could be `us` → unknown. In practice the field is always present (OBSERVED).
5. **Refusals** (S21): `stop_reason: "refusal"` with empty `content` (declined before output) is billed only when `stop_details.category` ∈ {`bio`, `frontier_llm`, `reasoning_extraction`} (since 2026-09-24, list "may change"). Other categories and `null` are not billed, but `usage` still reports tokens. Mid-stream refusals bill input + output streamed so far. So for a refusal in a non-billed category the true cost is 0 while `usage` is non-zero. Safest: return no estimate (or 0 with a flag) for refusals outside the billed list, and price billed ones normally. Batch refusals never carry fallback credits.
6. **Hosted tool fees** are outside token cost (design D15 says they're not estimated). Web search could be priced exactly from `web_search_requests × $0.01` if wanted; code execution can't be priced from the response.

### 5.3 What the response does and does not reveal

| Pricing input                                    | Revealed by                                             | Gap                                                     |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------- |
| Model                                            | top-level `model` (serving model), `iterations[].model` | aliases resolve to dated ids                            |
| Cache write TTL                                  | `usage.cache_creation.ephemeral_5m/1h_input_tokens`     | auto 5m writes for server tools show here too (correct) |
| Geo                                              | `usage.inference_geo`                                   | —                                                       |
| Tier                                             | `usage.service_tier`                                    | priority has no public rate                             |
| Speed                                            | `usage.speed` (beta responses)                          | absent on GA responses                                  |
| Long-context tier (Haiku 5.5)                    | computed from usage                                     | multi-iteration ambiguity (Q3)                          |
| Refusal billing                                  | `stop_reason`, `stop_details.category`                  | rules are policy and change over time                   |
| Negotiated discounts / Priority / partner clouds | nothing                                                 | never computable                                        |

---

## 6. Gotchas

1. **Cache read multiplier varies by model**: 0.025× (Fable 5.1), 0.05× (Opus 5.5, Sonnet 5.5), 0.1× (all others). Never derive read prices from a global 0.1×.
2. **Prices change after launch.** Sonnet 5.5 cache reads dropped from $0.20 to $0.10 on 2026-10-07, ten days after launch; Sonnet 5's introductory price became permanent. Bundled references (including the claude-api skill's cached table, which still says $0.20) go stale. Re-verify against S11 before each catalog release and record the verification date.
3. **Haiku 5.5 long-context pricing raises output too**, and the threshold is 100K (not 200K or 272K), counting cache reads and writes.
4. **`input_tokens` excludes cached tokens.** Total input is the sum of three fields.
5. **Two cache-write rates** (5m 1.25×, 1h 2×). The current `ModelCost`/`Usage` contract can't represent this.
6. **Server-tool auto-caching** writes 5m entries whenever any `cache_control` is present.
7. **Top-level `cache_control` exists** (automatic caching) and takes one of the 4 breakpoint slots. With 4 explicit breakpoints it is a 400, and a mismatched TTL on the last block is a 400.
8. **Below the minimum cacheable length nothing caches, silently**; minimums range 512–4,096 by model, and Haiku 4.5's is 4,096.
9. **Thinking config, top-level effort, `tool_choice`, `disable_parallel_tool_use`, image presence, `speed`, web search/citations toggles all invalidate parts of the cache.** Explicitly sending the default effort is fine.
10. **Thinking text is empty by default on the newest models** (`display: "omitted"`). The block is still complete and must be replayed. Thinking is billed in full either way.
11. **Responses can start with thinking blocks even when the request has no `thinking` field** (Opus 5/5.5, Sonnet 5/5.5, Haiku 5.5, Fable). Small `max_tokens` can end before any text.
12. **Omitting `thinking` means different things**: adaptive on the 5.x models and Haiku 5.5, off on Opus 4.6–4.8 / Sonnet 4.6, off on 4.5-era.
13. **`disabled` is rejected on Opus 5.5, Sonnet 5.5, Fable 5/5.1**, and on Opus 5 / Haiku 5.5 only at `xhigh`/`max`. Sonnet 5.5's off-switch is `between_tools`, which M1 does not advertise.
14. **`enabled` + `budget_tokens` is rejected on Opus 4.7+ / Sonnet 5+ / Haiku 5.5 / Fable**, and **`adaptive` is rejected on Opus 4.5 / Sonnet 4.5 / Haiku 4.5.** No single thinking config works across the catalog.
15. **Effort is unsupported on Sonnet 4.5 and Haiku 4.5** (400), `xhigh` is unsupported on Opus 4.6 / Sonnet 4.6, and Opus 4.5 supports only low/medium/high.
16. **Forced `tool_choice` (`any`/`tool`) is a 400 on Opus 5.5, Sonnet 5.5, Fable 5.1.** Elsewhere it's a 400 with manual thinking, and with adaptive it suppresses thinking.
17. **Sampling params are a 400 on Opus 4.7+ / Sonnet 5+ / Haiku 5.5 / Fable** even without thinking. The docs disagree on `top_p` (Q1). The API reference's "released after Opus 4.6" wording would include Sonnet 4.6, but the narrative docs say 4.7+ (Sonnet 4.6 allows them).
18. **Prefill is a 400 on every 4.6+ model.**
19. **Preserved thinking (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5)**: any change to `system`, `tools` or earlier messages invalidates later thinking. New accounts (≥ 2026-08-31) get a 400 that retrying can't fix. The gateway must never rewrite history, reorder content, move mid-conversation `role: "system"` messages, drop/re-add tools, or re-encode images. It should pass through `anthropic-beta`, `thinking.block_binding`, and return `input_transformations`.
20. **Account-bound thinking (Sonnet 5.5, Haiku 5.5)**: a conversation replayed under a different organization's API key silently loses its reasoning (blocks dropped, request succeeds). That matters if callers rotate keys across orgs or a hosted key replaces theirs.
21. **Cross-model replay silently drops unreadable thinking blocks** (unbilled). That is correct; the gateway should not strip them, since the same history may go back to a model that can read them. Removing them when converting to a non-Anthropic provider is the client-side `convert` step's job (design D13), not the adapter's.
22. **Last-turn-only models (Sonnet 4.5, Haiku 4.5) strip old thinking server-side; keep-all models bill it as input forever** unless context editing clears it. Migrating from Haiku 4.5 to 5.5 raises input tokens for both reasons (keep-all plus a ~30% tokenizer increase).
23. **`usage.iterations`**: compaction and advisor tokens are excluded from top-level `usage`, and fallback reports only the serving attempt at top level. Cost from top-level fields alone undercounts.
24. **Refusals before output are billed only in some categories** (bio, frontier_llm, reasoning_extraction as of 2026-09-24), yet `usage` is populated for all. HTTP 200 with empty `content`.
25. **`inference_geo` on models before 4.6 is a 400**, and the response reports `"not_available"` (a string, not null).
26. **Fast mode on Opus 4.6 silently runs standard**; on Opus 4.7 it's an error. `speed` needs the beta header and shows up only on beta-shaped usage.
27. **Priority Tier responses can't be priced**, and Priority isn't available on the newest six models.
28. **The Models API lifecycle fields are unreliable** (Sonnet 4.5 shows `active`, `deprecated_at: null`). M1 also omits `between_tools`, and `disabled.supported: true` doesn't mean every effort level works.
29. **Retirement dates are close for 4.5-era models**: Haiku 4.5 is "not sooner than 2026-10-15" (three days from now), Sonnet 4.5 retires 2026-11-30, Opus 4.5 is "not sooner than 2026-11-24". Requests to retired ids fail; the catalog should not hard-fail on an id it lists but the provider has retired (D11 already accepts any id).
30. **Long non-streaming thinking requests** (high effort, 128K `max_tokens`) can run many minutes. SDKs refuse non-streaming above 21,333 `max_tokens`, but the API doesn't. Plan the gateway's timeout and Cloudflare limits accordingly.
31. **`diagnostics` is now always present** on Messages responses (null unless requested); `container` and `stop_details` are also always present (OBSERVED). Treat them as known keys, not as `native` news, unless non-null.
32. **Undocumented `thinking.type: "auto"`** is accepted as adaptive (OBSERVED). Don't build on it; don't map anything to it.

---

## 7. Open questions for live probing

- **Q1. Sampling defaults on 4.7+ / Haiku 5.5 / Sonnet 5.5**: is `top_p: 0.99` accepted, and are `top_p: 1` or `temperature: 1` + `top_p: 0.99` rejected? (S1 vs S20 disagree.) `temperature: 1` with adaptive is already OBSERVED as accepted on Haiku 5.5.
- **Q2. Prefill with manual thinking on Haiku 4.5 / Sonnet 4.5**: docs say not allowed; probe `t1f-haiku45-enabled-prefill` returned 200 with only text. Was thinking silently disabled (check `thinking_tokens`)?
- **Q3. Haiku 5.5 >100K threshold with server-tool loops**: is it judged per iteration or on the summed top-level `input_tokens`? Expensive to probe; may need to ask Anthropic or compare against the Usage & Cost API.
- **Q4. Compaction iteration pricing**: which model's rates (no `model` field on `compaction` entries), and does it get cache multipliers?
- **Q5. `usage.speed` on GA-shaped responses**: absent, or `"standard"`? Only matters if `speed` is passed through.
- **Q6. Does changing only `thinking.display` invalidate the cache?** S6 says it's outside the preserved-thinking prefix; S8 says "thinking parameters" invalidate the message cache without separating `display`.
- **Q7. Refusal before output in a non-billed category**: does `usage` show non-zero tokens (S21 says counts appear), and does the Usage & Cost API agree that they cost 0?
- **Q8. Automatic `cache_control` edge cases**: confirm the 400 for 4 explicit breakpoints plus top-level, and for a mismatched TTL on the last block; confirm whether `ttl: "5m"` is accepted explicitly.
- **Q9. `cache_creation` object**: is it ever null/absent when `cache_creation_input_tokens > 0` (for example on older models or batch)? OBSERVED present with zeros on all probes so far.
- **Q10. Minimum cacheable length** on Haiku 5.5 (512) and Haiku 4.5 (4,096): confirm a 600-token prefix caches on 5.5 and not on 4.5.
- **Q11. `inference_geo: "us"`** on a 4.6+ model: does `usage.inference_geo` echo `"us"`, and does an older model return a 400 (and with what message)?
- **Q12. `thinking_mismatch_allowed` on the test key**: is the test account pre- or post-2026-08-31 (S6 "To find out which group your account is in" gives a one-request test on Fable 5.1)? This decides whether edited-history probes see 400s by default.
