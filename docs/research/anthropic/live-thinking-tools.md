# Anthropic Messages API: live thinking, replay, tools, caching

Observed on **2026-10-12** (server `date` headers show 2026-10-11 ~20:16–20:40 UTC) against `POST https://api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01`, using the temporary key we were given. Credentials and request headers are left out. This is live evidence for this account and these model IDs. It does not promise how other accounts, Bedrock or Vertex, or later model snapshots behave.

Scope: thinking modes, effort, sampling interactions, the shape of thinking blocks, **replaying assistant content verbatim and in altered forms (within one model and across models)**, client tools, structured outputs, prompt caching, server tools (web search, code execution) and context management. Basic message structure, inputs and errors are in the sibling note [tools-and-inputs.md](tools-and-inputs.md).

Method: about 234 billed calls, mostly `claude-haiku-5-5` with tiny prompts. Estimated spend is about $0.65, assuming list-like prices for the 5.x models (not published in the API). Every exchange is saved as `<name>.req.json`, `<name>.resp.json` and `<name>.headers` in the scratchpad `anthropic-probe/thinking/`. The scripts are in `anthropic-probe/scripts-thinking/` (`send.sh`, `lib.py` and `s1_*`…`s9_*`). The probe names below match those files. **Token deltas are the main instrument** for "was it used or silently dropped". Many replay variants return 200, so the only evidence that the server kept or discarded a block is `usage.input_tokens` compared with a baseline that has the block removed.

Model capability claims were read from `GET /v1/models` (the `capabilities` object) before probing. Every claim below was then checked live. The catalog matched the live behavior on all thinking and effort flags we tested, with one exception: the catalog lists `between_tools` for no model, yet Sonnet 5.5 accepts it.

---

## 1. Summary: question → observed → adapter implication

Kinds: **refuse** = the adapter rejects before sending (the provider would 400, or would silently drop the input). **pass** = send through unchanged. **replay** = a rule for history. **error** = how to classify the provider's 400.

### Thinking & request options

| Question                                                | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Adapter implication                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does the model think when `thinking` is omitted?        | **5.x (haiku-5-5, sonnet-5-5, opus-5-5, fable-5-1): yes**, adaptive by default. A `thinking` block is returned with `"thinking": ""` plus a signature. 4.6 (opus, sonnet) and 4.5 (haiku, sonnet): no thinking, no block.                                                                                                                                                                                                                                                                                                                                                                                                    | Treat "omitted" as adaptive on 5.x. Expect thinking blocks, and billed `thinking_tokens`, even when the caller never asked for thinking.                           |
| Default `display`                                       | 5.x: **omitted** (empty text, signature only). 4.6 adaptive and 4.5 enabled: summarized text returned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | pass. Don't infer "no thinking happened" from empty text; use `output_tokens_details.thinking_tokens`.                                                             |
| `display` values                                        | `"summarized"` or `"omitted"`. Anything else gives 400 `thinking.adaptive.display: Input should be 'summarized', 'omitted'`. Works on 4.5 `enabled` too. On `disabled` it gives 400 `thinking.disabled.display: Extra inputs are not permitted`.                                                                                                                                                                                                                                                                                                                                                                             | pass. Refuse with `disabled`.                                                                                                                                      |
| `{type:"disabled"}`                                     | OK on haiku-5-5, opus-4-6, sonnet-4-6, haiku-4-5, sonnet-4-5. **400 on opus-5-5 and fable-5-1**: `"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.` **sonnet-5-5 gives a different 400**: `To turn thinking off on this model, send "thinking": {"type": "between_tools"} …`                                                                                                                                                                                                                                                  | Refuse per a model table (the catalog's `thinking.types.disabled.supported` is accurate). Classify as invalid_request / unsupported-for-model.                     |
| `{type:"enabled", budget_tokens}`                       | 400 on all 5.x (same message as above, "enabled"). OK on 4.6 and 4.5. `budget_tokens < 1024` gives 400 `…Input should be greater than or equal to 1024`. Missing budget gives `Field required`. `budget_tokens >= max_tokens` gives 400 ``"`max_tokens` must be greater than `thinking.budget_tokens`…"``. `budget_tokens` on adaptive gives `Extra inputs are not permitted`.                                                                                                                                                                                                                                               | Refuse per model. Validate `1024 <= budget < max_tokens` locally.                                                                                                  |
| `{type:"adaptive"}`                                     | OK on 5.x and 4.6. 4.5 gives 400 `adaptive thinking is not supported on this model`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Refuse on 4.5.                                                                                                                                                     |
| `{type:"between_tools"}` (new, undocumented in catalog) | **Only sonnet-5-5 accepts it.** It returned no thinking block in our tool loop (`thinking_tokens: 0`). Others give 400 `"thinking.type.between_tools" is not supported for this model.`                                                                                                                                                                                                                                                                                                                                                                                                                                      | Allow only where verified. It is the "off" switch for sonnet-5-5.                                                                                                  |
| Unknown thinking type                                   | `type:"xyz"` gives 400 listing the valid tags: `'adaptive', 'between_tools', 'disabled', 'enabled'`. **`type:"auto"` is silently accepted as an alias for adaptive** (haiku-5-5 and opus-4-6 think; haiku-4-5 answers "adaptive thinking is not supported").                                                                                                                                                                                                                                                                                                                                                                 | Never emit `auto`. Validate our own enum so an alias doesn't hide a typo.                                                                                          |
| `output_config.effort`                                  | Values: `low`, `medium`, `high`, `xhigh`, `max`. `none` and `minimal` give 400 listing those values. opus-4-6 `xhigh` gives 400 `This model does not support effort level 'xhigh'. Supported levels: high, low, max, medium.` haiku-4-5 and sonnet-4-5 (any level, with or without thinking) give 400 `This model does not support the effort parameter.` Effort is accepted with `thinking: disabled` on haiku-5-5 and with thinking omitted on opus-4-6. At `low`, sonnet-5-5 and fable-5-1 did **not** think on our prompt; opus-5-5 still did. `max` on haiku-5-5 gave 347 thinking tokens against 97 at `low`/`medium`. | Refuse per model and level (the catalog's `effort.<level>.supported` is accurate). Effort can switch adaptive thinking off on easy prompts, so it is not a budget. |
| Sampling on 5.x                                         | `temperature`, `top_p` and `top_k` each give 400 `` `temperature` is deprecated for this model. `` (same wording for top_p and top_k), whether thinking is disabled or omitted. With explicit adaptive, the thinking check runs first: `temperature:0.5` gives ``"`temperature` may only be set to 1 when thinking is enabled or in adaptive mode"``, and **`temperature:1` + adaptive is accepted**.                                                                                                                                                                                                                        | Refuse all three on 5.x (temperature=1 is a no-op that we may also refuse).                                                                                        |
| Sampling on 4.x with thinking                           | 4.5 `enabled`: `temperature:0.5` gives 400 (`may only be set to 1`), `top_k` gives 400 (`must be unset`), and **`top_p:0.95` is accepted**. Separately, haiku-4-5 rejects `temperature` + `top_p` together: ``"`temperature` and `top_p` cannot both be specified for this model."``                                                                                                                                                                                                                                                                                                                                         | Refuse locally with these rules.                                                                                                                                   |
| Thinking + forced tool (`tool_choice` any/tool)         | 4.5 enabled gives 400 `Thinking may not be enabled when tool_choice forces tool use.` **haiku-5-5 adaptive gives 200, but thinking is silently skipped** (no block, `thinking_tokens: 0`). **sonnet-5-5 rejects any/tool entirely**: `tool_choice: type "tool" and "any" are not supported for this model.`                                                                                                                                                                                                                                                                                                                  | Refuse any/tool on sonnet-5-5 and on 4.x+thinking. For haiku-5-5, document that forcing a tool turns thinking off.                                                 |
| Assistant prefill                                       | **5.x and opus-4-6 give 400** `This model does not support assistant message prefill. The conversation must end with a user message.` haiku-4-5 accepts it. **With thinking enabled, haiku-4-5 silently skips thinking** (no block, no `output_tokens_details`).                                                                                                                                                                                                                                                                                                                                                             | Refuse a trailing assistant message on those models. Refuse prefill+thinking on 4.5, because the provider silently drops the thinking.                             |
| Unknown fields                                          | Strict at the top level, in `thinking.*`, in `output_config.*` and in tool definitions: `frobnicate: Extra inputs are not permitted`. `output_config: {}` is accepted.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass `providerOptions` through and let 400s surface (no silent drops seen).                                                                                        |

### Thinking block shape and accounting

| Question                             | Observed                                                                                                                                                                                                                                                                                                                                               | Implication                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Block shape                          | `{"type":"thinking","thinking":"<text or empty>","signature":"<base64>"}`. 5.x signatures start with `CAQS…` (600–2300 chars); 4.x signatures start with `E…` (420–3200 chars).                                                                                                                                                                        | Store the block verbatim.                                                                |
| `redacted_thinking`                  | Never produced in these probes. A fabricated block gives 400 ``Invalid `data` in `redacted_thinking` block``. **A real thinking `signature` pasted into `redacted_thinking.data` is accepted**, with the same token count as the original block, so the two use the same envelope.                                                                     | Replay verbatim; never synthesize.                                                       |
| `thinking_tokens` vs `output_tokens` | `output_tokens` **includes** thinking: e.g. 100 = 97 thinking + 3 text. 5.x always sends `output_tokens_details: {thinking_tokens: N}`, including 0. 4.x **omits `output_tokens_details`** when no thinking ran.                                                                                                                                       | Visible output = `output_tokens − thinking_tokens`. Treat a missing details object as 0. |
| Summarized text vs billed            | Visible text is always much shorter than the billed tokens: haiku-5-5 115 chars / 97 tok; opus-5-5 84 chars / 66 tok; opus-4-6 692 chars / 945 tok; haiku-4-5 349 chars / 180 tok.                                                                                                                                                                     | Don't estimate cost from the text.                                                       |
| Truncation mid-thinking              | `max_tokens: 30` gives `stop_reason: "max_tokens"` and a single **signed** thinking block, with all 30 tokens counted as thinking.                                                                                                                                                                                                                     | Truncated blocks are still replayable.                                                   |
| Streaming                            | `content_block_start` with `{"type":"thinking","thinking":"","signature":""}`, then `thinking_delta` events, then one `signature_delta`, then `content_block_stop`. With display omitted there is one empty `thinking_delta` followed by the `signature_delta`. `message_delta.delta` also carries `stop_details` and `container`.                     | Accumulate the signature from `signature_delta`.                                         |
| Other response fields                | Every message has top-level `container` (null unless a code-execution container exists), `stop_details` (null in every probe) and `diagnostics` (null). Usage has `service_tier`, `inference_geo` (`"global"` on 4.6/5.x, `"not_available"` on 4.5) and, with server tools, `server_tool_use`. `tool_use` blocks carry `"caller": {"type": "direct"}`. | Accept unknown fields. Stripping `caller` on replay is accepted.                         |
| Tokenizer                            | The same filler text counts as **≈1.36× more tokens on 5.x** than on 4.x (e.g. 5181 vs ~3800). Thinking system overhead: 5.x adaptive 38 tokens vs disabled 36; 4.x enabled 57 vs plain 28.                                                                                                                                                            | Don't reuse token estimates across generations.                                          |

### Replay rules (most important)

| Variant (tool loop: user → assistant[thinking, text, tool_use] → user[tool_result])                   | haiku-5-5                                                                                                                                                                                                                                                    | Other models tested                                                                                                                                | Implication                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verbatim                                                                                              | 200                                                                                                                                                                                                                                                          | 200 (opus-4-6, haiku-4-5)                                                                                                                          | **replay verbatim**                                                                                                                                      |
| Strip `caller` from tool_use                                                                          | 200                                                                                                                                                                                                                                                          | —                                                                                                                                                  | Fine either way.                                                                                                                                         |
| **Drop the thinking block** (latest turn, thinking on)                                                | 200; next turn thinks normally                                                                                                                                                                                                                               | opus-4-6: 200, thinks. **haiku-4-5 (enabled): 200, but thinking is silently turned off for that response** (no block, no `output_tokens_details`). | Never drop from the latest turn. On 4.5 the provider silently disables thinking.                                                                         |
| Assistant message with only `tool_use` (never had thinking), thinking on                              | 200, thinks                                                                                                                                                                                                                                                  | haiku-4-5: 200, **thinking silently off**                                                                                                          | Same as above.                                                                                                                                           |
| **Modify / blank / lengthen the `thinking` text**                                                     | 200, **identical `input_tokens`** (579 for verbatim, blank and 800-char text alike)                                                                                                                                                                          | Same on opus-4-6 and haiku-4-5                                                                                                                     | The text is neither validated nor used. **The signature carries the content.** Text edits can't break replay, and they don't change what the model sees. |
| Flip one signature char / truncate / empty / garbage                                                  | 400 ``messages.1.content.0: Invalid `signature` in `thinking` block``                                                                                                                                                                                        | Same on opus-4-6 and haiku-4-5                                                                                                                     | error: invalid_request (corrupted history).                                                                                                              |
| Remove `signature` field                                                                              | 400 `messages.1.content.0.thinking.signature: Field required`                                                                                                                                                                                                | —                                                                                                                                                  | Same.                                                                                                                                                    |
| Reorder blocks (tool_use first, or text first)                                                        | 200                                                                                                                                                                                                                                                          | —                                                                                                                                                  | The order is not checked.                                                                                                                                |
| Duplicate the same thinking block, or **two thinking blocks from different responses** in one message | 400 ``messages.1.content.1: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.`` (same message even when that assistant message is not the latest) | —                                                                                                                                                  | Never merge assistant messages that each contain thinking.                                                                                               |
| Signature from a _different_ response of the same model                                               | 200 (counts that other response's tokens)                                                                                                                                                                                                                    | —                                                                                                                                                  | Signatures are not bound to the conversation or position, and the API doesn't detect cross-wiring.                                                       |
| Thinking block inside a `user` message                                                                | 400 ``messages.2.content: thinking blocks may only be in `assistant` messages``                                                                                                                                                                              | —                                                                                                                                                  | —                                                                                                                                                        |
| **Earlier (non-final) turn**, verbatim                                                                | 200. **Kept in context**: 733 vs 665 with the block dropped, a 68-token delta equal to the original `thinking_tokens`                                                                                                                                        | haiku-4-5 (enabled): 848 both ways, so **earlier-turn thinking is stripped server-side**                                                           | 5.x bills old thinking on every later turn. Dropping it from old turns is accepted and saves tokens, but changes what the model sees.                    |
| Earlier turn, corrupted signature / missing / fake redacted                                           | 400 (same messages as for the latest turn)                                                                                                                                                                                                                   | haiku-4-5: 400 even though it strips the block                                                                                                     | **Signatures are validated in every assistant message**, whether or not the block is used.                                                               |
| Earlier turn, dropped                                                                                 | 200                                                                                                                                                                                                                                                          | 200                                                                                                                                                | Allowed anywhere except where noted above.                                                                                                               |
| Thinking now `disabled`, history has thinking                                                         | 200. **Still validated, still counted**: 578 vs 510 dropped                                                                                                                                                                                                  | haiku-4-5 with thinking off: 200                                                                                                                   | Turning thinking off doesn't excuse a corrupted signature.                                                                                               |
| `display` changed between turns (summarized → omitted)                                                | 200, same tokens                                                                                                                                                                                                                                             | —                                                                                                                                                  | Irrelevant to replay.                                                                                                                                    |

**Cross-model replay.** Every case returned 200 when the signature was intact, and every case returned 400 when it was flipped, including targets that then ignore the block. "Used" is measured as the `input_tokens` delta against the same history with the thinking block removed. Changing the text (blank vs 800 chars) never changed the delta.

| Produced by → replayed to       | Result | Δ input_tokens vs dropped                                        | Verdict                                     |
| ------------------------------- | ------ | ---------------------------------------------------------------- | ------------------------------------------- |
| haiku-5-5 → sonnet-5-5          | 200    | +68 (= original thinking_tokens)                                 | used                                        |
| haiku-5-5 → opus-5-5            | 200    | +68                                                              | used                                        |
| haiku-5-5 → fable-5-1           | 200    | 0                                                                | **silently dropped**                        |
| haiku-5-5 → opus-4-6            | 200    | 0                                                                | **silently dropped**                        |
| haiku-5-5 → sonnet-4-6          | 200    | 0                                                                | **silently dropped**                        |
| haiku-5-5 → haiku-4-5 (enabled) | 200    | +23 for both a 68-token and a 59-token block, regardless of text | **content dropped** (constant wrapper only) |
| opus-4-6 → haiku-5-5            | 200    | +44 (original 41)                                                | used                                        |
| opus-4-6 → sonnet-4-6           | 200    | +44                                                              | used                                        |
| haiku-4-5 → haiku-5-5           | 200    | +160 (original 109, different tokenizer)                         | used                                        |
| haiku-4-5 → sonnet-4-5          | 200    | +142 (same as replaying to itself)                               | used                                        |

**Replay rule for the adapter:**

- **Same `(provider, api, model)`:** replay the `content` array byte-for-byte. Never edit, merge, dedupe or reorder thinking or redacted_thinking blocks, and never drop them from the latest assistant turn.
- **Different model:** strip `thinking` and `redacted_thinking` blocks from that model's messages before sending. The API never errors on a valid foreign block, but whether the block is used depends on an undocumented compatibility matrix: 5.5 Haiku/Sonnet/Opus share; 4.x → 5.5 works; 5.x → 4.x and → fable-5-1 is silently dropped. Under our "refuse what the provider silently drops" policy, carrying the block is unsafe. Stripping is always accepted.
  - On a 4.5 target with `enabled` thinking, a stripped latest tool-loop turn means that response runs without thinking. Surface this, or start a fresh user turn.
- **Before sending:** check that each signature is present and non-empty. A corrupted one is a hard 400 from anywhere in history.
- **Error kind:** a 400 for an invalid signature or a modified block is a non-retryable **invalid history** error. The text names the exact `messages.N.content.M` path.

### Tools

| Question                                            | Observed                                                                                                                                                                                                                                                                                                                | Implication                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| tool_use id                                         | `toolu_` + 24 chars ([0-9A-Za-z], starting `01`). Server tools use `srvtoolu_…`. On replay, ids must match `^[a-zA-Z0-9_-]+$`: `call_abc123XYZ`, `x`, `fc-01_ab-cd` and an 80-char id are accepted. **`.`, `:` and empty give 400** `messages.1.content.0.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'`. | Cross-provider replay must remap ids such as `functions.get_weather:0` deterministically (in both tool_use and tool_result). |
| Parallel calls                                      | Several `tool_use` blocks in one message (text, tool_use, tool_use). `tool_choice:{type:auto, disable_parallel_tool_use:true}` gives one call. It also works with `any`.                                                                                                                                                | pass                                                                                                                         |
| `tool_choice: none`                                 | **`content: []`**, `stop_reason: end_turn`, `output_tokens: 1` when the prompt asks for tools. Replaying an assistant message with `content: []` is accepted.                                                                                                                                                           | Handle empty content.                                                                                                        |
| `tool_choice: any/tool` with an irrelevant prompt   | Calls the tool with `{"city":"<UNKNOWN>"}`. Unknown name gives 400 `Tool 'nope' not found in provided tools`.                                                                                                                                                                                                           | —                                                                                                                            |
| tool_result content forms                           | String, `[text…]`, `[text, image(base64 png)]`, `[document(text)]`, `""`, missing `content`, and `is_error:true` are all 200. A number gives 400 ``…`tool_result` content must either be a string or a list of content blocks.``                                                                                        | pass                                                                                                                         |
| Order inside the user message                       | Results in any order are fine, and **text after the results is fine**. **Text before the results gives 400** `` `tool_use` ids were found without `tool_result` blocks immediately after: … ``                                                                                                                          | Emit tool_results first.                                                                                                     |
| Results split across two consecutive user messages  | 200 (merged)                                                                                                                                                                                                                                                                                                            | —                                                                                                                            |
| Missing result (one or all)                         | 400 ``messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: <ids>. Each `tool_use` block must have a corresponding `tool_result` block in the next message.``                                                                                                                           | Refuse locally.                                                                                                              |
| Result in a later message (after intervening turns) | Same 400                                                                                                                                                                                                                                                                                                                | Refuse.                                                                                                                      |
| Mismatched `tool_use_id`                            | 400 ``unexpected `tool_use_id` found in `tool_result` blocks: … Each `tool_result` block must have a corresponding `tool_use` block in the previous message.``                                                                                                                                                          | —                                                                                                                            |
| Duplicate result                                    | 400 `each tool_use must have a single result. Found multiple …`                                                                                                                                                                                                                                                         | —                                                                                                                            |
| Replayed tool_use for a tool not in `tools`         | 200                                                                                                                                                                                                                                                                                                                     | —                                                                                                                            |
| `tool_use.input` as a JSON string                   | 400 `…tool_use.input: Input should be an object`                                                                                                                                                                                                                                                                        | Parse before replay.                                                                                                         |
| `tools: null`                                       | 400 `tools: Input should be a valid array` (leaving it out is fine)                                                                                                                                                                                                                                                     | Omit, never null.                                                                                                            |
| `strict: true`                                      | Requires `additionalProperties: false`, otherwise 400 `tools.0.custom: For 'object' type, 'additionalProperties' must be explicitly set to false`. `minLength` is accepted in strict mode.                                                                                                                              | —                                                                                                                            |
| Tool name                                           | `^[a-zA-Z0-9_-]{1,128}$` (65 chars OK; `get weather!` and `weather.get` give 400). Duplicate names give 400 `Tool names must be unique.`                                                                                                                                                                                | Refuse locally.                                                                                                              |
| input_schema                                        | Required, and `type` must be `"object"` (`{type:"string"}` gives `Input should be 'object'`; no type gives `Field required`). `{type:"object"}` alone is OK.                                                                                                                                                            | —                                                                                                                            |
| Extra tool fields                                   | `foo` gives 400. `input_examples` and `eager_input_streaming` are accepted. Every tool having `defer_loading:true` gives 400 `At least one tool must have defer_loading=false.`                                                                                                                                         | —                                                                                                                            |

### Structured outputs (haiku-5-5 unless noted)

| Question                                             | Observed                                                                                                                                                                                                                                                                                                                                                                                                                              | Implication                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `output_config.format: {type:"json_schema", schema}` | 200; the text block is the JSON. Works on haiku-4-5, sonnet-5-5 and opus-4-6 too. Works with adaptive thinking (the model didn't think), with `effort`, and alongside `tools`.                                                                                                                                                                                                                                                        | pass                                             |
| Format variants                                      | `type:"text"` and `"json_object"` give 400 `Input should be 'json_schema'`. A `name` key gives `Extra inputs are not permitted`. Top-level `array` and `string` schemas are accepted.                                                                                                                                                                                                                                                 | —                                                |
| Legacy `output_format`                               | Without a beta header: 400 `output_format: This field is deprecated. Use 'output_config.format' instead.` **With `anthropic-beta: structured-outputs-2025-11-13` it still works** on haiku-5-5 and haiku-4-5.                                                                                                                                                                                                                         | Use `output_config.format` only.                 |
| Schema limits                                        | `additionalProperties` must be explicitly `false` (missing or `true` gives 400). `minimum` gives 400 `For 'number' type, property 'minimum' is not supported`. `minItems: 2` gives 400 `…'minItems' values other than 0 or 1 are not supported`. Recursive `$ref` gives 400 `Circular reference detected…`. Lookahead regex gives 400 `Invalid regex in pattern field…`. **Accepted:** `minLength`, `format: email`, `enum`, `const`. | Let the provider reject; the messages are clear. |

### Prompt caching

| Question                                          | Observed                                                                                                                                                                                                                                                                                    | Implication                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Does `input_tokens` include cached tokens?        | **No.** Call 1: `input_tokens: 15, cache_creation_input_tokens: 5181`. Call 2: `input_tokens: 15, cache_read_input_tokens: 5181`. Total prompt = `input + cache_creation + cache_read`. `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` split the creation by TTL. | Normalize: total input = sum of all three.                                                                                               |
| System and last-user breakpoints                  | The second breakpoint reads the system prefix and writes only the 15-token user tail. Extending the conversation reads 5196 and writes 14.                                                                                                                                                  | Incremental caching works as documented.                                                                                                 |
| `ttl: "1h"`                                       | Counted under `ephemeral_1h_input_tokens`. `"10m"` gives 400 `Input should be '5m' or '1h'`. A 5m breakpoint before a 1h one gives 400 ``a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block … order: `tools`, `system`, `messages`.``                        | Refuse misordered TTLs locally.                                                                                                          |
| Breakpoint limit                                  | 5 gives 400 `A maximum of 4 blocks with cache_control may be provided. Found 5.`                                                                                                                                                                                                            | Refuse locally.                                                                                                                          |
| **Below the minimum**                             | **Silently not cached**, with no error (`cache_creation_input_tokens: 0`).                                                                                                                                                                                                                  | The cache can't be relied on silently. Report creation=0 as observed fact; don't refuse (the length isn't known exactly before sending). |
| Minimum cacheable prefix (observed)               | haiku-5-5: cached at 604, **not** at 472. sonnet-5-5 and opus-5-5: cached at ~1040 (the smallest size tried). sonnet-4-6: cached at 1053, not at 766. haiku-4-5 and opus-4-6: **not** cached at ~3000–3070, cached at ~4227.                                                                | Keep a per-model table: 5.x ≤ ~1K (Haiku 5.5 ~512), Sonnet 4.6 ~1K, Haiku 4.5 and Opus 4.6 4096.                                         |
| **Top-level `cache_control`**                     | **Accepted on haiku-5-5 and works as automatic caching**: call 1 writes 5192, which is the whole prompt including the user message; call 2 reads 5192.                                                                                                                                      | A real request option; pass it through `providerOptions`.                                                                                |
| `cache_control` on a thinking block               | 400 `messages.1.content.0.thinking.cache_control: Extra inputs are not permitted`                                                                                                                                                                                                           | Refuse.                                                                                                                                  |
| On `tool_use`, `tool_result` or a tool definition | Accepted.                                                                                                                                                                                                                                                                                   | —                                                                                                                                        |
| On an empty text block                            | 400 `cache_control cannot be set for empty text blocks`                                                                                                                                                                                                                                     | —                                                                                                                                        |

### Server tools and context management

| Question                           | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Implication                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `web_search_20250305` (max_uses 1) | Content: `server_tool_use{id:srvtoolu_…, name:"web_search", input:{query}}`, then `web_search_tool_result{tool_use_id, content:[web_search_result{title,url,encrypted_content,page_age}…×10], caller}`, then `thinking`, then `text`, then `text{citations:[web_search_result_location{cited_text,url,title,encrypted_index}]}`. Usage includes `server_tool_use:{web_search_requests:1, web_fetch_requests:0}`. The search result cost about 7.7K input tokens.                                                                                                                                                                                                                                                                                                                                   | Note that thinking comes **after** the server blocks.                                     |
| Web search replay                  | Verbatim: 200. Without `tools`: 200. To haiku-4-5: 200. Server blocks stripped: 200. **Tampered `encrypted_content`** gives 400 ``Invalid `encrypted_content` in `search_result` block``.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Same verbatim rule as thinking. Encrypted fields are validated.                           |
| `web_search_20260209`              | Accepted. In our run the model sent `input:{params:{query}}`, which produced `web_search_tool_result.content = {type:"web_search_tool_result_error", error_code:"invalid_tool_input"}`. It then fell back to a `code_execution` server tool calling `web_search` inside Python: `code_execution_tool_result.content{type:"encrypted_code_execution_result", encrypted_stdout, stderr:"Server tool use limit exceeded during code execution.", return_code:1}`. **A `container` was created implicitly.**                                                                                                                                                                                                                                                                                           | Expect code-execution blocks and a container even when only web search was requested.     |
| `code_execution_20250825`          | Tool name in the output is `bash_code_execution`. Block types: `server_tool_use{input:{command}}` and `bash_code_execution_tool_result{content:{type:"bash_code_execution_result",stdout,stderr,return_code,content:[]}}`. Top-level `container:{id:"container_…", expires_at}` (~1 h).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Persist `container.id`.                                                                   |
| Replaying without `container`      | 200, but the response has a **new container id**, so state is silently lost. With `container: <id>`, the same container is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Send `container` back whenever the history has code execution.                            |
| `pause_turn`                       | Not observed (needs long server-tool loops; skipped for cost).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Handle per the docs: re-send the assistant content as-is.                                 |
| `context_management`               | Without a beta header: 400 `context_management: Extra inputs are not permitted`. With `anthropic-beta: context-management-2025-06-27`: `clear_thinking_20251015` with `keep:{type:"thinking_turns",value:1}` returns `context_management.applied_edits:[{type:"clear_thinking_20251015", cleared_thinking_turns:1, cleared_input_tokens:53}]`, and `input_tokens` drops from 733 (keep all, `applied_edits: []`) to 663. It requires thinking: with disabled it gives 400 ``"`clear_thinking_20251015` strategy requires `thinking` to be enabled or adaptive"``. `clear_tool_uses_20250919` with a trigger of 100 tokens returned `applied_edits: []` both times (inconclusive). `compact_20260112` needs beta `compact-2026-01-12` and `trigger.value must be at least 50000` (not run further). | A beta-gated request option. The server edits history; our stored history stays verbatim. |

---

## 2. Per-model thinking support matrix (live)

Prompt: `How many times does the letter r appear in "strawberry raspberry"? Reply with just the number.` with `max_tokens: 1600`. Cells show `HTTP · thinking block? · thinking_tokens`.

| Model                      | omitted                  | `disabled`                  | `enabled` 1024 | `adaptive`       | `between_tools` | effort                          | `display` default               | prefill                            | temp≠1 / top_p / top_k                             |
| -------------------------- | ------------------------ | --------------------------- | -------------- | ---------------- | --------------- | ------------------------------- | ------------------------------- | ---------------------------------- | -------------------------------------------------- |
| claude-haiku-5-5           | 200 · block (empty) · 97 | 200 · none · 0              | **400**        | 200 · block · 94 | **400**         | low–max ✓                       | omitted                         | **400**                            | 400 "deprecated"                                   |
| claude-sonnet-5-5          | 200 · block (empty) · 91 | **400 → use between_tools** | **400**        | 200 · block · 91 | 200 · none · 0  | ✓ (`low` → no thinking)         | omitted                         | **400**                            | 400 "deprecated"; tool_choice any/tool **400**     |
| claude-opus-5-5            | 200 · block (empty) · 85 | **400**                     | **400**        | 200 · block · 89 | **400**         | ✓ (`low` still thinks)          | omitted                         | —                                  | —                                                  |
| claude-fable-5-1           | 200 · block (empty) · 87 | **400**                     | **400**        | 200 · block · 75 | **400**         | ✓ (`low` → no thinking)         | omitted                         | —                                  | —                                                  |
| claude-opus-4-6            | 200 · no thinking        | 200                         | 200 · 659      | 200 · 945        | **400**         | low/med/high/max; **xhigh 400** | summarized                      | **400**                            | —                                                  |
| claude-sonnet-4-6          | 200 · no thinking        | 200                         | 200 · 102      | 200 · 159        | —               | `max` ✓                         | summarized                      | —                                  | —                                                  |
| claude-haiku-4-5-20251001  | 200 · no thinking        | 200                         | 200 · 180      | **400**          | **400**         | **400 (any level)**             | summarized (`omitted` accepted) | 200; **thinking silently skipped** | temp 400, top_k 400, top_p 0.95 OK; temp+top_p 400 |
| claude-sonnet-4-5-20250929 | 200 · no thinking        | 200                         | 200 · 167      | **400**          | —               | **400**                         | summarized                      | —                                  | —                                                  |

"—" = not probed. The catalog (`anthropic-models.json`) also lists `disabled` as supported on claude-opus-5, claude-sonnet-5, claude-opus-4-8 and claude-opus-4-7 (not probed live).

---

## 3. Exchanges

The snippets are trimmed: signatures and `encrypted_*` values are shortened to their first 16 chars plus the length, strings over 300 chars are cut, and long lists show their first items. The full JSON is in the scratchpad directory under the same names. Every request was sent with `x-api-key: <omitted>`, `anthropic-version: 2023-06-01` and, where noted, `anthropic-beta`.

### Thinking modes

#### `t1-haiku55-omit` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ]
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4nG8GG2SvVnUqGuRus",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "", "signature": "CAQS0QUKEAgSGAI4…(972 chars)" },
    { "type": "text", "text": "6" }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 38,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 100,
    "output_tokens_details": { "thinking_tokens": 97 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t1b-haiku55-display-summarized` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4ropNHhhBJHuJYA75Q",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Counting the r's: strawberry has 3 (positions 3, 8, 9), raspberry has 3 (positions 1, 7, 8), giving a total of 6.\n\n",
      "signature": "CAQSxQUKEAgSGAI4…(956 chars)"
    },
    { "type": "text", "text": "6" }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 38,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 100,
    "output_tokens_details": { "thinking_tokens": 97 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t1-opus46-adaptive` → HTTP 200

Request:

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "adaptive" }
}
```

Response:

```json
{
  "model": "claude-opus-4-6",
  "id": "msg_011Cfw4nPmPjjR94fKTdc1jT",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me count the letter 'r' in \"strawberry raspberry\":\n\ns-t-r-a-w-b-e-r-r-y - r appears at positions 3, 8, 9 → 3 times\n(…(692 chars)",
      "signature": "EtASCqQBCBIYAipA…(3188 chars)"
    },
    { "type": "text", "text": "**6**" }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 28,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 954,
    "output_tokens_details": { "thinking_tokens": 945 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t1-sonnet55-disabled` → HTTP 400

Request:

```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "To turn thinking off on this model, send \"thinking\": {\"type\": \"between_tools\"} instead of {\"type\": \"disabled\"}. The model does not think before responding. The short updates it writes between tool calls come back as thinking blocks."
  },
  "request_id": "req_011Cfw4nFmvs37TNvGTyQS88"
}
```

#### `t1-opus55-enabled1024` → HTTP 400

Request:

```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "enabled", "budget_tokens": 1024 }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "\"thinking.type.enabled\" is not supported for this model. Use \"thinking.type.adaptive\" and \"output_config.effort\" to control thinking behavior."
  },
  "request_id": "req_011Cfw4nHze4GaqX917D5VNA"
}
```

#### `t1-haiku45-adaptive` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "adaptive" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "adaptive thinking is not supported on this model"
  },
  "request_id": "req_011Cfw4ngTzECKzTXVmfCFV1"
}
```

#### `t1b-sonnet55-between_tools` → HTTP 200

Request:

```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "between_tools" }
}
```

Response:

```json
{
  "model": "claude-sonnet-5-5",
  "id": "msg_011Cfw4ropsTgtMAaTTeZRRw",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Let me count carefully.\n\n\"strawberry\": s-t-r-a-w-b-e-r-r-y → r at positions 3, 8, 9 = 3\n\n\"raspberry\": r-a-s-p-b-e-r-r-y → r at positions 1, 7, 8 = 3\n\nTotal: 6\n\n**6**"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 36,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 104,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t1g-haiku55-type-xyz` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "xyz" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "thinking: Input tag 'xyz' found using 'type' does not match any of the expected tags: 'adaptive', 'between_tools', 'disabled', 'enabled'"
  },
  "request_id": "req_011Cfw4tfoiUaSfqwa5scTqd"
}
```

#### `t1g-opus46-type-auto` → HTTP 200

Request:

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "auto" }
}
```

Response:

```json
{
  "model": "claude-opus-4-6",
  "id": "msg_011Cfw4tg6b4NDfja1z7SywY",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me count the letter 'r' in \"strawberry raspberry\":\n\ns-t-r-a-w-b-e-r-r-y-space-r-a-s-p-b-e-r-r-y\n\nstrawberry: s-t-r-a-w-b-e-r-r-y → r appears at positions 3, 8, 9 → 3 times\nraspberry: r-a-s-p-b-e-r-r-y → r appears at positions 1, 7, 8 → 3 times\n\nTotal: 6",
      "signature": "EpIECqQBCBIYAipA…(716 chars)"
    },
    { "type": "text", "text": "6" }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 28,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 161,
    "output_tokens_details": { "thinking_tokens": 154 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t1b-haiku45-budget-ge-max` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "enabled", "budget_tokens": 1024 }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`max_tokens` must be greater than `thinking.budget_tokens`. Please consult our documentation at https://platform.claude.com/docs/en/build-with-claude/extended-thinking#max-tokens-and-context-window-size-with-extended-thinking"
  },
  "request_id": "req_011Cfw4rvwVMowKCrhiALJNY"
}
```

### Effort, sampling, forced tools, prefill

#### `t1c-opus46-effort-xhigh` → HTTP 400

Request:

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 4000,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "output_config": { "effort": "xhigh" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support effort level 'xhigh'. Supported levels: high, low, max, medium."
  },
  "request_id": "req_011Cfw4s51vVhBgDRYXZRGg2"
}
```

#### `t1c-haiku45-effort-low` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "output_config": { "effort": "low" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support the effort parameter."
  },
  "request_id": "req_011Cfw4s62BykHZmxb5A3dBW"
}
```

#### `t1c-sonnet55-effort-low` → HTTP 200

Request:

```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "output_config": { "effort": "low" }
}
```

Response:

```json
{
  "model": "claude-sonnet-5-5",
  "id": "msg_011Cfw4s8cxwdJwQxvNcJhSy",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "strawberry: s-t-r-a-w-b-e-r-r-y → r at positions 3, 8, 9 = 3.\nraspberry: r-a-s-p-b-e-r-r-y → r at 1, 7, 8 = 3.\n\nTotal = 6\n\n**6**"
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 38,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 93,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t1d-haiku55-omit-temp05` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "temperature": 0.5
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` is deprecated for this model."
  },
  "request_id": "req_011Cfw4sBB1DK4aGATadmQ3G"
}
```

#### `t1d-haiku55-adaptive-temp05` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "adaptive" },
  "temperature": 0.5
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`temperature` may only be set to 1 when thinking is enabled or in adaptive mode. Please consult our documentation at https://platform.claude.com/docs/en/build-with-claude/extended-thinking"
  },
  "request_id": "req_011Cfw4s9CSRnd3WjNxCTEfj"
}
```

#### `t1d-haiku45-enabled-topk` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 1600,
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    }
  ],
  "thinking": { "type": "enabled", "budget_tokens": 1024 },
  "top_k": 5
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "`top_k` must be unset when thinking is enabled. Please consult our documentation at https://platform.claude.com/docs/en/build-with-claude/extended-thinking"
  },
  "request_id": "req_011Cfw4sH6wuRCBgZzfrwG5L"
}
```

#### `t1e-haiku45-enabled-tc-any` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 2000,
  "thinking": { "type": "enabled", "budget_tokens": 1024 },
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "tool_choice": { "type": "any" },
  "messages": [{ "role": "user", "content": "Weather in Paris?" }]
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Thinking may not be enabled when tool_choice forces tool use."
  },
  "request_id": "req_011Cfw4sLDxvKEZEFhwrrdNG"
}
```

#### `t1e-haiku55-adaptive-tc-any` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1000,
  "thinking": { "type": "adaptive" },
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "tool_choice": { "type": "any" },
  "messages": [{ "role": "user", "content": "Weather in Paris?" }]
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4sKcWWZG3NtoCxtfNg",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01NZejmNpHsmr9pXB9yxoYer",
      "name": "get_weather",
      "input": { "city": "Paris" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 491,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 40,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t1e-sonnet55-tc-any` → HTTP 400

Request:

```json
{
  "model": "claude-sonnet-5-5",
  "max_tokens": 1000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "tool_choice": { "type": "any" },
  "messages": [{ "role": "user", "content": "Weather in Paris?" }]
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "tool_choice: type \"tool\" and \"any\" are not supported for this model."
  },
  "request_id": "req_011Cfw4sNPwA5d48ZYdcex8P"
}
```

#### `t1f-haiku55-adaptive-prefill` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 500,
  "thinking": { "type": "adaptive" },
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    },
    { "role": "assistant", "content": "The answer is" }
  ]
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "This model does not support assistant message prefill. The conversation must end with a user message."
  },
  "request_id": "req_011Cfw4sP4sKG91vCqaNLajr"
}
```

#### `t1f-haiku45-enabled-prefill` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 2000,
  "thinking": { "type": "enabled", "budget_tokens": 1024 },
  "messages": [
    {
      "role": "user",
      "content": "How many times does the letter r appear in \"strawberry raspberry\"? Reply with just the number."
    },
    { "role": "assistant", "content": "The answer is" }
  ]
}
```

Response:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw4sR7QiUWnVm9rBbMak",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": " 8." }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 31,
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

### Replay: latest turn

#### `t3-seed-haiku55-summ` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4vTY6SeNGVDJbE8kEV",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
      "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
    },
    {
      "type": "text",
      "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
    },
    {
      "type": "tool_use",
      "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
      "name": "get_weather",
      "input": { "city": "Paris" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 417,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 150,
    "output_tokens_details": { "thinking_tokens": 68 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-verbatim` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4yWjesrF1n6xST35cY",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_01W568Mc1SxMqksCRfv1uHgb",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 579,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 74,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-modify-thinking-text` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Lyon first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4yWfwbuVLwwXNF4mop",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_016vCSAfDei7KQuW5eEzruwr",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 579,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 74,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-flip-signature-char` → HTTP 400

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.0: Invalid `signature` in `thinking` block"
  },
  "request_id": "req_011Cfw4yWU32UcJ8gPyaMG8a"
}
```

#### `t3-missing-signature` → HTTP 400

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.0.thinking.signature: Field required"
  },
  "request_id": "req_011Cfw4yYT5yZbMHWXfz3FEC"
}
```

#### `t3-dup-thinking` → HTTP 400

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.1: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response."
  },
  "request_id": "req_011Cfw4yac4xVCDFfaypvxZ1"
}
```

#### `t3-two-thinking-diff-responses` → HTTP 400

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        { "type": "thinking", "thinking": "", "signature": "CAQS5QUKEAgSGAI4…(1000 chars)" },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.1: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response."
  },
  "request_id": "req_011Cfw53PXgJtBULqEE9s7xH"
}
```

#### `t3-fake-redacted` → HTTP 400

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        { "type": "redacted_thinking", "data": "Zm9vYmFy" },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.0: Invalid `data` in `redacted_thinking` block"
  },
  "request_id": "req_011Cfw4yf4hn9cX1iJ8HSbN7"
}
```

#### `t3-redacted-with-real-sig-as-data` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        { "type": "redacted_thinking", "data": "CAQSlAYKEAgSGAI4…(1060 chars)" },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4yfXVEMUTPQkcsfLpX",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_01ERw91vzWwywh6j7NyhdXEM",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 579,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 74,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-drop-thinking` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4yWocum2AFkVaLJJbM",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_01EHWfiW4pFffiS2bpUEhpx4",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 511,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 74,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-haiku45-drop-thinking` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "**Plan:**\n1. Call get_weather for Paris and get the current temperature\n2. Wait for the result\n3. Then call get_weather for Tokyo\n4. Compare the two temperatures and report which city is warmer\n\nLet me start:"
        },
        {
          "type": "tool_use",
          "id": "toolu_011hVj1svrYwdmrQZMwdqdvw",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_011hVj1svrYwdmrQZMwdqdvw",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-4-5-20251001",
  "thinking": { "type": "enabled", "budget_tokens": 1024 }
}
```

Response:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw4ypQ3ETV4uXfmzQh7d",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is currently 14°C. Now let me check Tokyo:" },
    {
      "type": "tool_use",
      "id": "toolu_016hJgbr5V1QoFVCWtAC3HC2",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 716,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 68,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

#### `t3-thinking-in-user-msg` → HTTP 400

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2.content: thinking blocks may only be in `assistant` messages"
  },
  "request_id": "req_011Cfw53TBCwFJFit8g9WHU7"
}
```

#### `t3-thinking-disabled` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4yfgRPJdkHRwfUQuXt",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_01LqeJWMh388KyG22G3iPwa1",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 578,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 74,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### Replay: earlier turn

#### `t3e-verbatim` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 2000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    "…4 earlier messages (see .req.json)",
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01W568Mc1SxMqksCRfv1uHgb",
          "content": "Tokyo: 22C"
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "Tokyo is warmer. It's 22°C there, compared with 14°C in Paris, an 8°C difference."
        }
      ]
    },
    { "role": "user", "content": "Thanks. Now just tell me: which city name is longer? One word." }
  ],
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw53DvioeQehDLGXipz6",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Paris and Tokyo both have 5 letters, so neither is longer—they're equal in length.\n\n",
      "signature": "CAQS4QYKEAgSGAI4…(1164 chars)"
    },
    { "type": "text", "text": "Neither." }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 733,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 82,
    "output_tokens_details": { "thinking_tokens": 76 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3e-drop` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 2000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    "…4 earlier messages (see .req.json)",
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01W568Mc1SxMqksCRfv1uHgb",
          "content": "Tokyo: 22C"
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "Tokyo is warmer. It's 22°C there, compared with 14°C in Paris, an 8°C difference."
        }
      ]
    },
    { "role": "user", "content": "Thanks. Now just tell me: which city name is longer? One word." }
  ],
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw53E6QWm6Hs92ypZbdW",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Both \"Paris\" and \"Tokyo\" have 5 letters, so they're actually tied in length. Since I need a one-word answer but they're equal, \"Neither\" is the most honest single-word response.\n\n",
      "signature": "CAQSvQcKEAgSGAI4…(1288 chars)"
    },
    { "type": "text", "text": "Neither." }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 665,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 139,
    "output_tokens_details": { "thinking_tokens": 133 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3e-flip-sig` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 2000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    "…4 earlier messages (see .req.json)",
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01W568Mc1SxMqksCRfv1uHgb",
          "content": "Tokyo: 22C"
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "Tokyo is warmer. It's 22°C there, compared with 14°C in Paris, an 8°C difference."
        }
      ]
    },
    { "role": "user", "content": "Thanks. Now just tell me: which city name is longer? One word." }
  ],
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.0: Invalid `signature` in `thinking` block"
  },
  "request_id": "req_011Cfw53Dd8AE6yL1V5iWBwz"
}
```

#### `t3e-to-haiku45-enabled` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 2000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    "…4 earlier messages (see .req.json)",
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01W568Mc1SxMqksCRfv1uHgb",
          "content": "Tokyo: 22C"
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "Tokyo is warmer. It's 22°C there, compared with 14°C in Paris, an 8°C difference."
        }
      ]
    },
    { "role": "user", "content": "Thanks. Now just tell me: which city name is longer? One word." }
  ],
  "thinking": { "type": "enabled", "budget_tokens": 1024 }
}
```

Response:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw53JCx3KPocmy4ftmr6",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "The user is asking which city name is longer - Paris or Tokyo.\n\nParis = 5 letters\nTokyo = 5 letters\n\nThey're the same le…(604 chars)",
      "signature": "EvgGCrgBCBIYAipA…(1192 chars)"
    },
    { "type": "text", "text": "Equal." }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 848,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 192,
    "output_tokens_details": { "thinking_tokens": 184 },
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

#### `t3e-to-haiku45-enabled-drop` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 2000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    "…4 earlier messages (see .req.json)",
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01W568Mc1SxMqksCRfv1uHgb",
          "content": "Tokyo: 22C"
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "Tokyo is warmer. It's 22°C there, compared with 14°C in Paris, an 8°C difference."
        }
      ]
    },
    { "role": "user", "content": "Thanks. Now just tell me: which city name is longer? One word." }
  ],
  "thinking": { "type": "enabled", "budget_tokens": 1024 }
}
```

Response:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw53LJhfDr8zmqt8wB8B",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "The user is asking which city name is longer - Paris or Tokyo.\n\nParis: 5 letters\nTokyo: 5 letters\n\nThey're the same leng…(603 chars)",
      "signature": "EvcGCrgBCBIYAipA…(1192 chars)"
    },
    { "type": "text", "text": "Same." }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 848,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 174,
    "output_tokens_details": { "thinking_tokens": 166 },
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

### Replay: cross-model

#### `t3-xmodel-to-sonnet55` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-sonnet-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-sonnet-5-5",
  "id": "msg_011Cfw4yg9CQgtbTMKEzTo5k",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_015RDaxwv2VVhCqZszFGtLLD",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 579,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 74,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-xtext-haiku55-to-sonnet55-drop` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-sonnet-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-sonnet-5-5",
  "id": "msg_011Cfw55WMWP2qRhd5F7iWGv",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_011UqvnFaTEB6JyVk6Zbf11d",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 511,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 74,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-xtext-haiku55-to-opus46-blank` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        { "type": "thinking", "thinking": "", "signature": "CAQSlAYKEAgSGAI4…(1060 chars)" },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-opus-4-6",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-opus-4-6",
  "id": "msg_011Cfw55WG3P6YtKA4dsgHKj",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Got Paris at 14°C. Now I need to check Tokyo.",
      "signature": "ErYCCqQBCBIYAipA…(420 chars)"
    },
    { "type": "text", "text": "Paris is currently **14°C**. Now let me check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_01SHVaV7iact2hPNPR7s42Ke",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 684,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 99,
    "output_tokens_details": { "thinking_tokens": 27 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-xtext-haiku55-to-opus46-drop` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-opus-4-6",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "model": "claude-opus-4-6",
  "id": "msg_011Cfw55WG3XsAnWcSmGvtQ3",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Got Paris at 14°C. Now I need to check Tokyo.",
      "signature": "ErYCCqQBCBIYAipA…(420 chars)"
    },
    { "type": "text", "text": "Paris is currently **14°C**. Now let me check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_011HjzuvttwFiC8X1JjjnkHH",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 684,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 99,
    "output_tokens_details": { "thinking_tokens": 27 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-xmodel-to-haiku45-enabled` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-4-5-20251001",
  "thinking": { "type": "enabled", "budget_tokens": 1024 }
}
```

Response:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw4yhjhEPcGAK3eCuajP",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is currently 14°C. Now let me check Tokyo:" },
    {
      "type": "tool_use",
      "id": "toolu_018dQRJYCVSkDDSjafNJbocD",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 706,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 68,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

#### `t3-bl-haiku55content-nothinking-to-haiku45-enabled` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-4-5-20251001",
  "thinking": { "type": "enabled", "budget_tokens": 1024 }
}
```

Response:

```json
{
  "model": "claude-haiku-4-5-20251001",
  "id": "msg_011Cfw53NXepQbUJdBLffVLu",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Now let me check Tokyo:" },
    {
      "type": "tool_use",
      "id": "toolu_01HzkLg2JtA5X9u3VuCohpfb",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 683,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 60,
    "service_tier": "standard",
    "inference_geo": "not_available"
  },
  "diagnostics": null
}
```

#### `t3-xmodel-opus46-to-haiku55` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "The user wants me to check the weather in Paris first, then Tokyo, one at a time. Let me plan and then call Paris first.",
          "signature": "EoEDCqQBCBIYAipA…(520 chars)"
        },
        {
          "type": "text",
          "text": "**Plan:** I'll first call the weather tool for Paris, then once I have that result, I'll call it for Tokyo. After getting both temperatures, I'll compare them.\n\n**Step 1: Check Paris**"
        },
        {
          "type": "tool_use",
          "id": "toolu_014WLAcruUYPpCqm1LqLvApL",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_014WLAcruUYPpCqm1LqLvApL",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw4ykC2ZRQWWFCrABjph",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_01Fqen4Lm5SbEDoa6dHypimx",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 593,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 74,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-bl-opus46content-nothinking-to-haiku55` → HTTP 200

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "**Plan:** I'll first call the weather tool for Paris, then once I have that result, I'll call it for Tokyo. After getting both temperatures, I'll compare them.\n\n**Step 1: Check Paris**"
        },
        {
          "type": "tool_use",
          "id": "toolu_014WLAcruUYPpCqm1LqLvApL",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_014WLAcruUYPpCqm1LqLvApL",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw53P2RXYQ2P77kKwm4k",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Paris is 14°C. Next, I'll check Tokyo." },
    {
      "type": "tool_use",
      "id": "toolu_015r2qJdryEkXM1p4gSMjwYq",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 549,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 75,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t3-flip-sig-to-opus46` → HTTP 400

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)"
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "content": "Paris: 14C"
        }
      ]
    }
  ],
  "model": "claude-opus-4-6",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.0: Invalid `signature` in `thinking` block"
  },
  "request_id": "req_011Cfw53T4GMigYtUFKMJZS4"
}
```

### Tools

#### `t4-parallel` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "What is the weather in Paris and in Tokyo? Call the tool for both cities at once."
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5Bsp1VGBMzQQwNPPws",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "I'll check the weather in both cities." },
    {
      "type": "tool_use",
      "id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
      "name": "get_weather",
      "input": { "city": "Paris" },
      "caller": { "type": "direct" }
    },
    {
      "type": "tool_use",
      "id": "toolu_01GL2RB5Sme4KbYXuAToYjD5",
      "name": "get_weather",
      "input": { "city": "Tokyo" },
      "caller": { "type": "direct" }
    }
  ],
  "container": null,
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 396,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 112,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t4-tc-none` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "What is the weather in Paris and in Tokyo? Call the tool for both cities at once."
    }
  ],
  "thinking": { "type": "disabled" },
  "tool_choice": { "type": "none" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5C4yihVc1fzSY7p8bU",
  "type": "message",
  "role": "assistant",
  "content": [],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 396,
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

#### `t4-text-before-results` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "What is the weather in Paris and in Tokyo? Call the tool for both cities at once."
    },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "I'll check the weather in both cities." },
        {
          "type": "tool_use",
          "id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        },
        {
          "type": "tool_use",
          "id": "toolu_01GL2RB5Sme4KbYXuAToYjD5",
          "name": "get_weather",
          "input": { "city": "Tokyo" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Answer in French." },
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
          "content": "Paris 14C"
        },
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01GL2RB5Sme4KbYXuAToYjD5",
          "content": "Tokyo 22C"
        }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01GL2RB5Sme4KbYXuAToYjD5, toolu_01UFrMwKGsjGTeaiXrnDXX3L. Each `tool_use` block must have a corresponding `tool_result` block in the next message."
  },
  "request_id": "req_011Cfw5C9Znop5U9jW9iaYz5"
}
```

#### `t4-result-missing-one` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "What is the weather in Paris and in Tokyo? Call the tool for both cities at once."
    },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "I'll check the weather in both cities." },
        {
          "type": "tool_use",
          "id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        },
        {
          "type": "tool_use",
          "id": "toolu_01GL2RB5Sme4KbYXuAToYjD5",
          "name": "get_weather",
          "input": { "city": "Tokyo" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
          "content": "Paris 14C"
        }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01GL2RB5Sme4KbYXuAToYjD5. Each `tool_use` block must have a corresponding `tool_result` block in the next message."
  },
  "request_id": "req_011Cfw5CB6a3sAcQCJNfuaPJ"
}
```

#### `t4-result-wrong-id` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "What is the weather in Paris and in Tokyo? Call the tool for both cities at once."
    },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "I'll check the weather in both cities." },
        {
          "type": "tool_use",
          "id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        },
        {
          "type": "tool_use",
          "id": "toolu_01GL2RB5Sme4KbYXuAToYjD5",
          "name": "get_weather",
          "input": { "city": "Tokyo" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
          "content": "Paris 14C"
        },
        { "type": "tool_result", "tool_use_id": "toolu_01XXXXXXXXXXXXXXXXXXXXXX", "content": "x" }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.2.content.1: unexpected `tool_use_id` found in `tool_result` blocks: toolu_01XXXXXXXXXXXXXXXXXXXXXX. Each `tool_result` block must have a corresponding `tool_use` block in the previous message."
  },
  "request_id": "req_011Cfw5CDKWdsvPsHVTVafvj"
}
```

#### `t4-foreign-id-with-colon` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    { "role": "user", "content": "Weather in Paris?" },
    {
      "role": "assistant",
      "content": [
        {
          "type": "tool_use",
          "id": "functions.get_weather:0",
          "name": "get_weather",
          "input": { "city": "Paris" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "tool_result", "tool_use_id": "functions.get_weather:0", "content": "14C" }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.0.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'"
  },
  "request_id": "req_011Cfw5CG5xktJNBK3arUqrH"
}
```

#### `t4-foreign-id-openai-style` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    { "role": "user", "content": "Weather in Paris?" },
    {
      "role": "assistant",
      "content": [
        {
          "type": "tool_use",
          "id": "call_abc123XYZ",
          "name": "get_weather",
          "input": { "city": "Paris" }
        }
      ]
    },
    {
      "role": "user",
      "content": [{ "type": "tool_result", "tool_use_id": "call_abc123XYZ", "content": "14C" }]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5CFzFaMf6RSbgLXA88",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "The current temperature in Paris is 14°C." }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 432,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 17,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t4-strict-tool-no-additionalProperties` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      },
      "strict": true
    }
  ],
  "messages": [{ "role": "user", "content": "Weather in Paris?" }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "tools.0.custom: For 'object' type, 'additionalProperties' must be explicitly set to false"
  },
  "request_id": "req_011Cfw5CKDUDbbEtxxciXYVu"
}
```

#### `t4-name-invalid-chars` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get weather!",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [{ "role": "user", "content": "hi" }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'"
  },
  "request_id": "req_011Cfw5CKFTAnS6eBXh4MQ9d"
}
```

#### `t4-schema-string` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": { "type": "string" }
    }
  ],
  "messages": [{ "role": "user", "content": "hi" }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "tools.0.custom.input_schema.type: Input should be 'object'"
  },
  "request_id": "req_011Cfw5CMRgeGCsHxU3nrbHs"
}
```

### Structured outputs

#### `t5-basic` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 800,
  "messages": [{ "role": "user", "content": "Give the largest city in Japan and its population." }],
  "thinking": { "type": "disabled" },
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": { "city": { "type": "string" }, "population_millions": { "type": "number" } },
        "required": ["city", "population_millions"],
        "additionalProperties": false
      }
    }
  }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5EaCS7qqyiXyieowMV",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "{\"city\": \"Tokyo\", \"population_millions\": 14.0}" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 233,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 23,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t5-minimum` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 800,
  "messages": [{ "role": "user", "content": "Give the largest city in Japan and its population." }],
  "thinking": { "type": "disabled" },
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": { "n": { "type": "number", "minimum": 0 } },
        "required": ["n"],
        "additionalProperties": false
      }
    }
  }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "output_config.format.schema: For 'number' type, property 'minimum' is not supported"
  },
  "request_id": "req_011Cfw5EZFPWJwDhftMd9pK1"
}
```

#### `t5-minItems-2` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 800,
  "messages": [{ "role": "user", "content": "Give the largest city in Japan and its population." }],
  "thinking": { "type": "disabled" },
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": { "a": { "type": "array", "items": { "type": "string" }, "minItems": 2 } },
        "required": ["a"],
        "additionalProperties": false
      }
    }
  }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "output_config.format.schema: For 'array' type, 'minItems' values other than 0 or 1 are not supported (got: [2, 5])"
  },
  "request_id": "req_011Cfw5EcJRuHWKEAXEs4oMn"
}
```

#### `t5-legacy-output_format-nobeta` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 800,
  "messages": [{ "role": "user", "content": "Give the largest city in Japan and its population." }],
  "thinking": { "type": "disabled" },
  "output_format": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "properties": { "city": { "type": "string" }, "population_millions": { "type": "number" } },
      "required": ["city", "population_millions"],
      "additionalProperties": false
    }
  }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "output_format: This field is deprecated. Use 'output_config.format' instead. See https://platform.claude.com/docs/en/build-with-claude/structured-outputs for more information."
  },
  "request_id": "req_011Cfw5EjLcBh5UQppDXr8ub"
}
```

### Prompt caching

#### `t6-a1-system-5m` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791750237] lamp98 meadow8 lamp85 alpha68 copper83 copper31 ember60 ember50 alpha74 orbit69 signal75 quiet67 orbit2…(9691 chars)",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5JfuazoZCgmCXCSfiV",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "ok" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 15,
    "cache_creation_input_tokens": 5181,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 5181, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t6-a2-system-5m` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791750237] lamp98 meadow8 lamp85 alpha68 copper83 copper31 ember60 ember50 alpha74 orbit69 signal75 quiet67 orbit2…(9691 chars)",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5JmxDj5w3CrtjXdp3p",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "ok" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 15,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 5181,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t6-b1-system+user` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791750237] lamp98 meadow8 lamp85 alpha68 copper83 copper31 ember60 ember50 alpha74 orbit69 signal75 quiet67 orbit2…(9691 chars)",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Remember: the code word is TEAL.",
          "cache_control": { "type": "ephemeral" }
        }
      ]
    }
  ],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5Ju2cupGidjKUQf7Do",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Got it, I'll remember that the code word is TEAL.\n\n" }],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 4,
    "cache_creation_input_tokens": 15,
    "cache_read_input_tokens": 5181,
    "cache_creation": { "ephemeral_5m_input_tokens": 15, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 20,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t6-c1-1h` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791750238] orbit89 quiet25 signal94 meadow9 violet38 stone23 lattice5 copper13 lamp84 quiet3 quiet99 quiet22 quiet…(9703 chars)",
      "cache_control": { "type": "ephemeral", "ttl": "1h" }
    }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5KDaqpjeACBqeSYAiM",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "ok" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 15,
    "cache_creation_input_tokens": 5147,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5147 },
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t6-c4-5m-then-1h` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791750240] stone3 vector29 cedar20 river37 signal87 tundra9 meadow64 orbit11 quiet20 signal32 violet69 stone74 sig…(2514 chars)",
      "cache_control": { "type": "ephemeral" }
    },
    {
      "type": "text",
      "text": "[doc 1791750238] orbit89 quiet25 signal94 meadow9 violet38 stone23 lattice5 copper13 lamp84 quiet3 quiet99 quiet22 quiet…(9703 chars)",
      "cache_control": { "type": "ephemeral", "ttl": "1h" }
    }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "system.1.cache_control.ttl: a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block. Note that blocks are processed in the following order: `tools`, `system`, `messages`."
  },
  "request_id": "req_011Cfw5Ka39xSrCj8V6wJ1sB"
}
```

#### `t6-d-5-breakpoints` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    { "type": "text", "text": "part 0", "cache_control": { "type": "ephemeral" } },
    { "type": "text", "text": "part 1", "cache_control": { "type": "ephemeral" } },
    { "type": "text", "text": "part 2", "cache_control": { "type": "ephemeral" } },
    { "type": "text", "text": "part 3", "cache_control": { "type": "ephemeral" } },
    { "type": "text", "text": "part 4", "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "A maximum of 4 blocks with cache_control may be provided. Found 5."
  },
  "request_id": "req_011Cfw5KgCUy7PCPYsqD727T"
}
```

#### `t6-e1-toplevel-cc` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791750241] orbit7 orbit97 copper48 violet47 tundra59 vector68 signal15 alpha94 tundra57 signal40 lattice58 alpha60…(9704 chars)"
    }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" },
  "cache_control": { "type": "ephemeral" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5KpLstGKEMAk4wnq8B",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "ok" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 4,
    "cache_creation_input_tokens": 5192,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 5192, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t6-e2-toplevel-cc` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791750241] orbit7 orbit97 copper48 violet47 tundra59 vector68 signal15 alpha94 tundra57 signal40 lattice58 alpha60…(9704 chars)"
    }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" },
  "cache_control": { "type": "ephemeral" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5KvkLaLiGSVbtmXtFV",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "ok" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 4,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 5192,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

#### `t6-f-cc-on-thinking` → HTTP 400

Request:

```json
{
  "max_tokens": 3000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Is it warmer in Paris or in Tokyo right now? Check with the tool, one city at a time, Paris first. Before calling, briefly plan."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "thinking",
          "thinking": "Since they asked for one city at a time, I'll check Paris first and wait for that result before moving on to Tokyo.\n\n",
          "signature": "CAQSlAYKEAgSGAI4…(1060 chars)",
          "cache_control": { "type": "ephemeral" }
        },
        {
          "type": "text",
          "text": "I'll check Paris first, then Tokyo, one at a time, and compare the two temperatures."
        },
        {
          "type": "tool_use",
          "id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "tool_result", "tool_use_id": "toolu_01TSzenec6ZMAR5i7qQ4ND5x", "content": "14C" }
      ]
    }
  ],
  "model": "claude-haiku-5-5",
  "thinking": { "type": "adaptive", "display": "summarized" }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.0.thinking.cache_control: Extra inputs are not permitted"
  },
  "request_id": "req_011Cfw5L2vuXzTWhX2suApYo"
}
```

#### `t6-h-haiku55-100` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791750877] quiet41 lattice98 signal87 quiet21 meadow32 ember81 tundra53 lamp66 vector6 harbor8 ember30 vector12 co…(854 chars)",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5MjftGWi5qa4gyPFoi",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "ok" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 472,
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

#### `t6-h-haiku55-130` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 20,
  "system": [
    {
      "type": "text",
      "text": "[doc 1791751636] ember53 signal39 lattice85 lamp53 cedar0 stone64 copper7 tundra56 quiet89 tundra75 lattice47 quiet84 ha…(1098 chars)",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [{ "role": "user", "content": "Reply with the word ok." }],
  "thinking": { "type": "disabled" }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5n9ewzNQnppavH9dyU",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "ok" }],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 15,
    "cache_creation_input_tokens": 604,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 604, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### Server tools, context management, truncation

#### `t7-websearch-20250305` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1500,
  "messages": [
    {
      "role": "user",
      "content": "Use web search once: what is the current stable version of the Python programming language? Answer in one sentence with a citation."
    }
  ],
  "tools": [{ "type": "web_search_20250305", "name": "web_search", "max_uses": 1 }]
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5PA47oF6dLUi3dJmMr",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01CuyrfYV7syWAjgFhXHaXkA",
      "name": "web_search",
      "input": { "query": "current stable version of Python" }
    },
    {
      "type": "web_search_tool_result",
      "tool_use_id": "srvtoolu_01CuyrfYV7syWAjgFhXHaXkA",
      "content": [
        {
          "type": "web_search_result",
          "title": "Python latest stable version? - Python Help - Discussions on Python.org",
          "url": "https://discuss.python.org/t/python-latest-stable-version/24563",
          "encrypted_content": "EtYGCioIFBgCIiQ2…(1148 chars)",
          "page_age": "1314 days ago"
        },
        {
          "type": "web_search_result",
          "title": "The Latest Version of Python",
          "url": "https://phoenixnap.com/kb/latest-python-version",
          "encrypted_content": "EpsJCioIFBgCIiQ2…(1580 chars)",
          "page_age": "213 days ago"
        },
        "…8 more web_search_result items"
      ],
      "caller": { "type": "direct" }
    },
    { "type": "thinking", "thinking": "", "signature": "CAQSlg0KEAgSGAI4…(2260 chars)" },
    { "type": "text", "text": "According to python.org's source downloads page, " },
    {
      "citations": [
        {
          "type": "web_search_result_location",
          "cited_text": "The official home of the Python Programming Language\n\n# Python Source Releases\n- Latest Python 3 Release - Python 3.15.0\n\n## Stable Releases\n- Python ...",
          "url": "https://www.python.org/downloads/source/",
          "title": "Python Source Releases for Source release",
          "encrypted_index": "Eo8BCioIFBgCIiQ2…(200 chars)"
        }
      ],
      "type": "text",
      "text": "Python 3.15.0 is listed as the latest Python 3 release, dated Oct. 9, 2026."
    }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 13437,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 527,
    "output_tokens_details": { "thinking_tokens": 405 },
    "service_tier": "standard",
    "inference_geo": "global",
    "server_tool_use": { "web_search_requests": 1, "web_fetch_requests": 0 }
  },
  "diagnostics": null
}
```

#### `t7-websearch-replay-tampered-encrypted` → HTTP 400

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1500,
  "messages": [
    {
      "role": "user",
      "content": "Use web search once: what is the current stable version of the Python programming language? Answer in one sentence with a citation."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "server_tool_use",
          "id": "srvtoolu_01CuyrfYV7syWAjgFhXHaXkA",
          "name": "web_search",
          "input": { "query": "current stable version of Python" }
        },
        {
          "type": "web_search_tool_result",
          "tool_use_id": "srvtoolu_01CuyrfYV7syWAjgFhXHaXkA",
          "content": [
            {
              "type": "web_search_result",
              "title": "Python latest stable version? - Python Help - Discussions on Python.org",
              "url": "https://discuss.python.org/t/python-latest-stable-version/24563",
              "encrypted_content": "EtYGCioIFBgCIiQ2…(1148 chars)",
              "page_age": "1314 days ago"
            },
            {
              "type": "web_search_result",
              "title": "The Latest Version of Python",
              "url": "https://phoenixnap.com/kb/latest-python-version",
              "encrypted_content": "EpsJCioIFBgCIiQ2…(1580 chars)",
              "page_age": "213 days ago"
            },
            "…8 more web_search_result items"
          ],
          "caller": { "type": "direct" }
        },
        { "type": "thinking", "thinking": "", "signature": "CAQSlg0KEAgSGAI4…(2260 chars)" },
        { "type": "text", "text": "According to python.org's source downloads page, " },
        {
          "citations": [
            {
              "type": "web_search_result_location",
              "cited_text": "The official home of the Python Programming Language\n\n# Python Source Releases\n- Latest Python 3 Release - Python 3.15.0\n\n## Stable Releases\n- Python ...",
              "url": "https://www.python.org/downloads/source/",
              "title": "Python Source Releases for Source release",
              "encrypted_index": "Eo8BCioIFBgCIiQ2…(200 chars)"
            }
          ],
          "type": "text",
          "text": "Python 3.15.0 is listed as the latest Python 3 release, dated Oct. 9, 2026."
        }
      ]
    },
    { "role": "user", "content": "Thanks. In one word, which organization publishes it?" }
  ],
  "tools": [{ "type": "web_search_20250305", "name": "web_search", "max_uses": 1 }]
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "messages.1.content.0: Invalid `encrypted_content` in `search_result` block"
  },
  "request_id": "req_011Cfw5PomkxDYRggVhBS9Sa"
}
```

#### `t7-websearch-web_search_20260209` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1500,
  "messages": [
    {
      "role": "user",
      "content": "Use web search once: what is the current stable version of the Python programming language? Answer in one sentence with a citation."
    }
  ],
  "tools": [{ "type": "web_search_20260209", "name": "web_search", "max_uses": 1 }]
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5Pz1uKvPikAKo9SJWL",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01CYKPGLQMdf6NRgXnd5Fqc3",
      "name": "web_search",
      "input": { "params": { "query": "current stable version of Python programming language" } }
    },
    {
      "type": "web_search_tool_result",
      "tool_use_id": "srvtoolu_01CYKPGLQMdf6NRgXnd5Fqc3",
      "content": { "type": "web_search_tool_result_error", "error_code": "invalid_tool_input" },
      "caller": { "type": "direct" }
    },
    { "type": "thinking", "thinking": "", "signature": "CAQSugYKEAgSGAI4…(1112 chars)" },
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01MybF8cXSiqU8sAoba5AEwK",
      "name": "code_execution",
      "input": {
        "code": "import json\nresult = await web_search({\"query\": \"current stable version of Python programming language\"})\nprint(json.dum…(444 chars)"
      }
    },
    {
      "type": "code_execution_tool_result",
      "tool_use_id": "srvtoolu_01MybF8cXSiqU8sAoba5AEwK",
      "content": {
        "type": "encrypted_code_execution_result",
        "encrypted_stdout": "Eo4BCioIFBgCIiQ2…(196 chars)",
        "stderr": "Server tool use limit exceeded during code execution.",
        "return_code": 1,
        "content": []
      }
    },
    { "type": "thinking", "thinking": "", "signature": "CAQSsAkKEAgSGAI4…(1612 chars)" },
    {
      "type": "text",
      "text": "I couldn't get a citation: the web search failed because the tool's usage limit was exceeded, so this answer comes from …(336 chars)"
    }
  ],
  "container": {
    "id": "container_01MG4C7b6KrAYXExvSFxPSvt",
    "expires_at": "2026-10-11T21:25:14.741906Z"
  },
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 18521,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 644,
    "output_tokens_details": { "thinking_tokens": 263 },
    "service_tier": "standard",
    "inference_geo": "global",
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 }
  },
  "diagnostics": null
}
```

#### `t7-codeexec-20250825` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1500,
  "thinking": { "type": "disabled" },
  "messages": [
    {
      "role": "user",
      "content": "Use the code execution tool to run python: print(sum(range(10))). Then state the result."
    }
  ],
  "tools": [{ "type": "code_execution_20250825", "name": "code_execution" }]
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5SS5NVt6AUD7LMWjkS",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'll run that with the bash tool, since it's the available code execution option here."
    },
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01Td46Pr8L1tP3GH59JETbQQ",
      "name": "bash_code_execution",
      "input": { "command": "python3 -c \"print(sum(range(10)))\"" }
    },
    {
      "type": "bash_code_execution_tool_result",
      "tool_use_id": "srvtoolu_01Td46Pr8L1tP3GH59JETbQQ",
      "content": {
        "type": "bash_code_execution_result",
        "stdout": "45\n",
        "stderr": "",
        "return_code": 0,
        "content": []
      }
    },
    { "type": "text", "text": "The result is **45**. This is the sum of the integers 0 through 9." }
  ],
  "container": {
    "id": "container_01Ty8jLumqG2TKj2o341qkzr",
    "expires_at": "2026-10-11T21:25:44.793897Z"
  },
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 5892,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 116,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global",
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 }
  },
  "diagnostics": null
}
```

#### `t7-codeexec-replay-no-container` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 1500,
  "thinking": { "type": "disabled" },
  "messages": [
    {
      "role": "user",
      "content": "Use the code execution tool to run python: print(sum(range(10))). Then state the result."
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "I'll run that with the bash tool, since it's the available code execution option here."
        },
        {
          "type": "server_tool_use",
          "id": "srvtoolu_01Td46Pr8L1tP3GH59JETbQQ",
          "name": "bash_code_execution",
          "input": { "command": "python3 -c \"print(sum(range(10)))\"" }
        },
        {
          "type": "bash_code_execution_tool_result",
          "tool_use_id": "srvtoolu_01Td46Pr8L1tP3GH59JETbQQ",
          "content": {
            "type": "bash_code_execution_result",
            "stdout": "45\n",
            "stderr": "",
            "return_code": 0,
            "content": []
          }
        },
        {
          "type": "text",
          "text": "The result is **45**. This is the sum of the integers 0 through 9."
        }
      ]
    },
    {
      "role": "user",
      "content": "Now print the value doubled using the same tool. Reply with the number only."
    }
  ],
  "tools": [{ "type": "code_execution_20250825", "name": "code_execution" }]
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5Ss9V8NWwEbLpYwj5L",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01DSW2cAvbdk3F4TUQpXtCN4",
      "name": "bash_code_execution",
      "input": { "command": "python3 -c \"print(sum(range(10))*2)\"" }
    },
    {
      "type": "bash_code_execution_tool_result",
      "tool_use_id": "srvtoolu_01DSW2cAvbdk3F4TUQpXtCN4",
      "content": {
        "type": "bash_code_execution_result",
        "stdout": "90\n",
        "stderr": "",
        "return_code": 0,
        "content": []
      }
    },
    { "type": "text", "text": "90" }
  ],
  "container": {
    "id": "container_017uBfBeruUz4gkbZMPfr9zt",
    "expires_at": "2026-10-11T21:25:50.635966Z"
  },
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 6188,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 72,
    "output_tokens_details": { "thinking_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global",
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 }
  },
  "diagnostics": null
}
```

#### `t8-clear-thinking-keep1` → HTTP 200 · `anthropic-beta: context-management-2025-06-27`

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 2000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    "…4 earlier messages (see .req.json)",
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01W568Mc1SxMqksCRfv1uHgb",
          "content": "Tokyo: 22C"
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "Tokyo is warmer. It's 22°C there, compared with 14°C in Paris, an 8°C difference."
        }
      ]
    },
    { "role": "user", "content": "Thanks. Now just tell me: which city name is longer? One word." }
  ],
  "thinking": { "type": "adaptive", "display": "summarized" },
  "context_management": {
    "edits": [
      { "type": "clear_thinking_20251015", "keep": { "type": "thinking_turns", "value": 1 } }
    ]
  }
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5iEDvAZEXtb6BZoFYg",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "Tokyo and Paris both have 5 letters, so they're equal in length. The one-word answer is \"Neither.\"\n\n",
      "signature": "CAQSxwcKEAgSGAI4…(1300 chars)"
    },
    { "type": "text", "text": "Neither." }
  ],
  "container": null,
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 663,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 112,
    "output_tokens_details": { "thinking_tokens": 106 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null,
  "context_management": {
    "applied_edits": [
      { "type": "clear_thinking_20251015", "cleared_thinking_turns": 1, "cleared_input_tokens": 53 }
    ]
  }
}
```

#### `t8-compact-small-trigger` → HTTP 400 · `anthropic-beta: compact-2026-01-12`

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 600,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current temperature (C) for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "What is the weather in Paris and in Tokyo? Call the tool for both cities at once."
    },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "I'll check the weather in both cities." },
        {
          "type": "tool_use",
          "id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
          "name": "get_weather",
          "input": { "city": "Paris" },
          "caller": { "type": "direct" }
        },
        {
          "type": "tool_use",
          "id": "toolu_01GL2RB5Sme4KbYXuAToYjD5",
          "name": "get_weather",
          "input": { "city": "Tokyo" },
          "caller": { "type": "direct" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01UFrMwKGsjGTeaiXrnDXX3L",
          "content": "Paris 14C"
        },
        {
          "type": "tool_result",
          "tool_use_id": "toolu_01GL2RB5Sme4KbYXuAToYjD5",
          "content": "Tokyo 22C"
        }
      ]
    }
  ],
  "thinking": { "type": "disabled" },
  "context_management": {
    "edits": [{ "type": "compact_20260112", "trigger": { "type": "input_tokens", "value": 1000 } }]
  }
}
```

Response:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "context_management.edits.0.compact_20260112: trigger.value must be at least 50000"
  },
  "request_id": "req_011Cfw5iYoNcQ4oFCqwY5X5M"
}
```

#### `t9-maxtokens-midthinking-haiku55` → HTTP 200

Request:

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 30,
  "thinking": { "type": "adaptive", "display": "summarized" },
  "messages": [
    {
      "role": "user",
      "content": "Prove that there are infinitely many primes, then list the first 30 primes."
    }
  ]
}
```

Response:

```json
{
  "model": "claude-haiku-5-5",
  "id": "msg_011Cfw5kLynVsysCp7mNVx7P",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "The user wants Euclid's proof that primes are infinite, plus a list of the first primes to accompany it.\n\n",
      "signature": "CAQSlgUKEAgSGAI4…(892 chars)"
    }
  ],
  "container": null,
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 32,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 30,
    "output_tokens_details": { "thinking_tokens": 30 },
    "service_tier": "standard",
    "inference_geo": "global"
  },
  "diagnostics": null
}
```

### Streaming, thinking with display omitted (`t9-stream-haiku55-omit-2`)

```text
event: message_start
data: {"type":"message_start","message":{"model":"claude-haiku-5-5","id":"msg_011Cfw5n3nET6aNW4Tsoq6k4","type":"message","role":"assistant","content":[],"container":null,"stop_reason":null,"stop_sequence":null,"stop_details":null,"usage":{"input_tokens":38,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0},"output_tokens":7,"service_tier":"standard","inference_geo":"global"},"diagnostics":null}            }
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}  }
event: ping
data: {"type": "ping"}
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}         }
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"CAQSjQYKEAgSGAI4…"}     }
event: content_block_stop
data: {"type":"content_block_stop","index":0             }
event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}           }
event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"6"}    }
event: content_block_stop
data: {"type":"content_block_stop","index":1              }
event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null,"stop_details":null,"container":null},"usage":{"input_tokens":38,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":120,"output_tokens_details":{"thinking_tokens":117}}       }
event: message_stop
data: {"type":"message_stop"  }
```

## 4. Probe index (all exchanges)

`in`/`out` = input/output tokens, `think` = `output_tokens_details.thinking_tokens` (– = field absent), `cw`/`cr` = cache write/read. `thinking[Nc]` = visible thinking text length in chars.

| Probe                                                | HTTP | Result                                                                                                                                                             |
| ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `t000-smoke-haiku55-omit`                            | 200  | end_turn; text; in=22 out=11 think=0                                                                                                                               |
| `t1-fable51-adaptive`                                | 200  | end_turn; thinking[0c] text; in=38 out=78 think=75                                                                                                                 |
| `t1-fable51-disabled`                                | 400  | `"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.`                  |
| `t1-fable51-enabled1024`                             | 400  | `"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.`                   |
| `t1-fable51-omit`                                    | 200  | end_turn; thinking[0c] text; in=38 out=90 think=87                                                                                                                 |
| `t1-haiku45-adaptive`                                | 400  | `adaptive thinking is not supported on this model`                                                                                                                 |
| `t1-haiku45-disabled`                                | 200  | end_turn; text; in=28 out=5 think=–                                                                                                                                |
| `t1-haiku45-enabled1024`                             | 200  | end_turn; thinking[349c] text; in=57 out=186 think=180                                                                                                             |
| `t1-haiku45-omit`                                    | 200  | end_turn; text; in=28 out=5 think=–                                                                                                                                |
| `t1-haiku55-adaptive`                                | 200  | end_turn; thinking[0c] text; in=38 out=97 think=94                                                                                                                 |
| `t1-haiku55-disabled`                                | 200  | end_turn; text; in=36 out=3 think=0                                                                                                                                |
| `t1-haiku55-enabled1024`                             | 400  | `"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.`                   |
| `t1-haiku55-omit`                                    | 200  | end_turn; thinking[0c] text; in=38 out=100 think=97                                                                                                                |
| `t1-opus46-adaptive`                                 | 200  | end_turn; thinking[692c] text; in=28 out=954 think=945                                                                                                             |
| `t1-opus46-disabled`                                 | 200  | end_turn; text; in=28 out=138 think=–                                                                                                                              |
| `t1-opus46-enabled1024`                              | 200  | end_turn; thinking[618c] text; in=57 out=667 think=659                                                                                                             |
| `t1-opus46-omit`                                     | 200  | end_turn; text; in=28 out=175 think=–                                                                                                                              |
| `t1-opus55-adaptive`                                 | 200  | end_turn; thinking[0c] text; in=38 out=92 think=89                                                                                                                 |
| `t1-opus55-disabled`                                 | 400  | `"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.`                  |
| `t1-opus55-enabled1024`                              | 400  | `"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.`                   |
| `t1-opus55-omit`                                     | 200  | end_turn; thinking[0c] text; in=38 out=88 think=85                                                                                                                 |
| `t1-sonnet45-adaptive`                               | 400  | `adaptive thinking is not supported on this model`                                                                                                                 |
| `t1-sonnet45-disabled`                               | 200  | end_turn; text; in=28 out=5 think=–                                                                                                                                |
| `t1-sonnet45-enabled1024`                            | 200  | end_turn; thinking[406c] text; in=57 out=173 think=167                                                                                                             |
| `t1-sonnet45-omit`                                   | 200  | end_turn; text; in=28 out=5 think=–                                                                                                                                |
| `t1-sonnet46-adaptive`                               | 200  | end_turn; thinking[256c] text; in=28 out=165 think=159                                                                                                             |
| `t1-sonnet46-disabled`                               | 200  | end_turn; text; in=28 out=111 think=–                                                                                                                              |
| `t1-sonnet46-enabled1024`                            | 200  | end_turn; thinking[190c] text; in=57 out=108 think=102                                                                                                             |
| `t1-sonnet46-omit`                                   | 200  | end_turn; text; in=28 out=108 think=–                                                                                                                              |
| `t1-sonnet55-adaptive`                               | 200  | end_turn; thinking[0c] text; in=38 out=94 think=91                                                                                                                 |
| `t1-sonnet55-disabled`                               | 400  | `To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}. The model does not think before responding. The ` |
| `t1-sonnet55-enabled1024`                            | 400  | `"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.`                   |
| `t1-sonnet55-omit`                                   | 200  | end_turn; thinking[0c] text; in=38 out=94 think=91                                                                                                                 |
| `t1b-haiku45-between_tools`                          | 400  | `"thinking.type.between_tools" is not supported for this model.`                                                                                                   |
| `t1b-haiku45-budget-500`                             | 400  | `thinking.enabled.budget_tokens: Input should be greater than or equal to 1024`                                                                                    |
| `t1b-haiku45-budget-ge-max`                          | 400  | ``max_tokens`must be greater than`thinking.budget_tokens`. Please consult our documentation at https://platform.claude.com/docs/en/build-with-claude/extended-t`   |
| `t1b-haiku45-enabled-display-omitted`                | 200  | end_turn; thinking[0c] text; in=57 out=189 think=183                                                                                                               |
| `t1b-haiku45-enabled-nobudget`                       | 400  | `thinking.enabled.budget_tokens: Field required`                                                                                                                   |
| `t1b-haiku55-adaptive-budget`                        | 400  | `thinking.adaptive.budget_tokens: Extra inputs are not permitted`                                                                                                  |
| `t1b-haiku55-between_tools`                          | 400  | `"thinking.type.between_tools" is not supported for this model.`                                                                                                   |
| `t1b-haiku55-bogus-type`                             | 200  | end_turn; thinking[0c] text; in=38 out=100 think=97                                                                                                                |
| `t1b-haiku55-display-bogus`                          | 400  | `thinking.adaptive.display: Input should be 'summarized', 'omitted'`                                                                                               |
| `t1b-haiku55-display-omitted`                        | 200  | end_turn; thinking[0c] text; in=38 out=100 think=97                                                                                                                |
| `t1b-haiku55-display-summarized`                     | 200  | end_turn; thinking[115c] text; in=38 out=100 think=97                                                                                                              |
| `t1b-opus46-between_tools`                           | 400  | `"thinking.type.between_tools" is not supported for this model.`                                                                                                   |
| `t1b-opus46-display-omitted`                         | 200  | end_turn; thinking[0c] text; in=28 out=307 think=298                                                                                                               |
| `t1b-opus55-between_tools`                           | 400  | `"thinking.type.between_tools" is not supported for this model.`                                                                                                   |
| `t1b-opus55-display-summarized`                      | 200  | end_turn; thinking[84c] text; in=38 out=69 think=66                                                                                                                |
| `t1b-sonnet46-budget-ge-max`                         | 400  | ``max_tokens`must be greater than`thinking.budget_tokens`. Please consult our documentation at https://platform.claude.com/docs/en/build-with-claude/extended-t`   |
| `t1b-sonnet55-between_tools`                         | 200  | end_turn; text; in=36 out=104 think=0                                                                                                                              |
| `t1b-sonnet55-display-summarized`                    | 200  | end_turn; thinking[71c] text; in=38 out=94 think=91                                                                                                                |
| `t1c-fable51-effort-low`                             | 200  | end_turn; text; in=38 out=66 think=0                                                                                                                               |
| `t1c-haiku45-effort-low`                             | 400  | `This model does not support the effort parameter.`                                                                                                                |
| `t1c-haiku55-effort-high`                            | 200  | end_turn; thinking[0c] text; in=38 out=109 think=106                                                                                                               |
| `t1c-haiku55-effort-low`                             | 200  | end_turn; thinking[0c] text; in=38 out=100 think=97                                                                                                                |
| `t1c-haiku55-effort-low-disabled`                    | 200  | end_turn; text; in=36 out=3 think=0                                                                                                                                |
| `t1c-haiku55-effort-max`                             | 200  | end_turn; thinking[0c] text; in=38 out=350 think=347                                                                                                               |
| `t1c-haiku55-effort-medium`                          | 200  | end_turn; thinking[0c] text; in=38 out=100 think=97                                                                                                                |
| `t1c-haiku55-effort-minimal`                         | 400  | `output_config.effort: Input should be 'low', 'medium', 'high', 'xhigh' or 'max'`                                                                                  |
| `t1c-haiku55-effort-none`                            | 400  | `output_config.effort: Input should be 'low', 'medium', 'high', 'xhigh' or 'max'`                                                                                  |
| `t1c-haiku55-effort-xhigh`                           | 200  | end_turn; thinking[0c] text; in=38 out=109 think=106                                                                                                               |
| `t1c-opus46-effort-low-omit`                         | 200  | end_turn; text; in=28 out=5 think=–                                                                                                                                |
| `t1c-opus46-effort-xhigh`                            | 400  | `This model does not support effort level 'xhigh'. Supported levels: high, low, max, medium.`                                                                      |
| `t1c-opus55-effort-low`                              | 200  | end_turn; thinking[0c] text; in=38 out=78 think=75                                                                                                                 |
| `t1c-sonnet45-effort-high-enabled`                   | 400  | `This model does not support the effort parameter.`                                                                                                                |
| `t1c-sonnet45-effort-low`                            | 400  | `This model does not support the effort parameter.`                                                                                                                |
| `t1c-sonnet46-effort-max-adaptive`                   | 200  | end_turn; thinking[277c] text; in=28 out=197 think=190                                                                                                             |
| `t1c-sonnet55-effort-low`                            | 200  | end_turn; text; in=38 out=93 think=0                                                                                                                               |
| `t1d-haiku45-enabled-temp05`                         | 400  | ``temperature` may only be set to 1 when thinking is enabled. Please consult our documentation at https://platform.claude.com/docs/en/build-with-claude/extended-` |
| `t1d-haiku45-enabled-topk`                           | 400  | ``top_k` must be unset when thinking is enabled. Please consult our documentation at https://platform.claude.com/docs/en/build-with-claude/extended-thinking`      |
| `t1d-haiku45-enabled-topp095`                        | 200  | end_turn; thinking[530c] text; in=57 out=269 think=263                                                                                                             |
| `t1d-haiku45-temp-and-topp`                          | 400  | ``temperature`and`top_p` cannot both be specified for this model. Please use only one.`                                                                            |
| `t1d-haiku55-adaptive-temp05`                        | 400  | ``temperature` may only be set to 1 when thinking is enabled or in adaptive mode. Please consult our documentation at https://platform.claude.com/docs/en/build-w` |
| `t1d-haiku55-adaptive-temp1`                         | 200  | end_turn; thinking[0c] text; in=38 out=97 think=94                                                                                                                 |
| `t1d-haiku55-adaptive-topk`                          | 400  | ``top_k` must be unset when thinking is enabled or in adaptive mode. Please consult our documentation at https://platform.claude.com/docs/en/build-with-claude/ex` |
| `t1d-haiku55-adaptive-topp095`                       | 400  | ``top_p` is deprecated for this model.`                                                                                                                            |
| `t1d-haiku55-disabled-temp05`                        | 400  | ``temperature` is deprecated for this model.`                                                                                                                      |
| `t1d-haiku55-disabled-topk`                          | 400  | ``top_k` is deprecated for this model.`                                                                                                                            |
| `t1d-haiku55-disabled-topp`                          | 400  | ``top_p` is deprecated for this model.`                                                                                                                            |
| `t1d-haiku55-omit-temp05`                            | 400  | ``temperature` is deprecated for this model.`                                                                                                                      |
| `t1d-sonnet55-temp05`                                | 400  | ``temperature` is deprecated for this model.`                                                                                                                      |
| `t1e-haiku45-enabled-tc-any`                         | 400  | `Thinking may not be enabled when tool_choice forces tool use.`                                                                                                    |
| `t1e-haiku45-enabled-tc-auto`                        | 200  | tool_use; thinking[219c] tool_use({"city": "Paris"}); in=590 out=111 think=55                                                                                      |
| `t1e-haiku55-adaptive-tc-any`                        | 200  | tool_use; tool_use({"city": "Paris"}); in=491 out=40 think=0                                                                                                       |
| `t1e-haiku55-adaptive-tc-tool`                       | 200  | tool_use; tool_use({"city": "Paris"}); in=497 out=34 think=0                                                                                                       |
| `t1e-haiku55-disabled-tc-any`                        | 200  | tool_use; tool_use({"city": "Paris"}); in=490 out=40 think=0                                                                                                       |
| `t1e-haiku55-omit-tc-any`                            | 200  | tool_use; tool_use({"city": "Paris"}); in=491 out=40 think=0                                                                                                       |
| `t1e-sonnet55-tc-any`                                | 400  | `tool_choice: type "tool" and "any" are not supported for this model.`                                                                                             |
| `t1f-haiku45-disabled-prefill`                       | 200  | end_turn; text; in=31 out=6 think=–                                                                                                                                |
| `t1f-haiku45-enabled-prefill`                        | 200  | end_turn; text; in=31 out=6 think=–                                                                                                                                |
| `t1f-haiku55-adaptive-prefill`                       | 400  | `This model does not support assistant message prefill. The conversation must end with a user message.`                                                            |
| `t1f-haiku55-disabled-prefill`                       | 400  | `This model does not support assistant message prefill. The conversation must end with a user message.`                                                            |
| `t1f-haiku55-omit-prefill`                           | 400  | `This model does not support assistant message prefill. The conversation must end with a user message.`                                                            |
| `t1f-opus46-disabled-prefill`                        | 400  | `This model does not support assistant message prefill. The conversation must end with a user message.`                                                            |
| `t1f-sonnet55-prefill`                               | 400  | `This model does not support assistant message prefill. The conversation must end with a user message.`                                                            |
| `t1g-haiku45-type-auto`                              | 400  | `adaptive thinking is not supported on this model`                                                                                                                 |
| `t1g-haiku55-adaptive-extra`                         | 400  | `thinking.adaptive.foo: Extra inputs are not permitted`                                                                                                            |
| `t1g-haiku55-disabled-display`                       | 400  | `thinking.disabled.display: Extra inputs are not permitted`                                                                                                        |
| `t1g-haiku55-output_config-bogus`                    | 400  | `output_config.foo: Extra inputs are not permitted`                                                                                                                |
| `t1g-haiku55-output_config-empty`                    | 200  | end_turn; thinking[0c] text; in=38 out=103 think=100                                                                                                               |
| `t1g-haiku55-thinking-null`                          | 400  | `thinking: Input should be an object`                                                                                                                              |
| `t1g-haiku55-toplevel-bogus`                         | 400  | `frobnicate: Extra inputs are not permitted`                                                                                                                       |
| `t1g-haiku55-type-missing`                           | 400  | `thinking.type: Field required`                                                                                                                                    |
| `t1g-haiku55-type-xyz`                               | 400  | `thinking: Input tag 'xyz' found using 'type' does not match any of the expected tags: 'adaptive', 'between_tools', 'disabled', 'enabled'`                         |
| `t1g-opus46-type-auto`                               | 200  | end_turn; thinking[257c] text; in=28 out=161 think=154                                                                                                             |
| `t3-bl-haiku45content-nothinking-to-haiku55`         | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=557 out=71 think=0                                                                                                  |
| `t3-bl-haiku45content-nothinking-to-sonnet45`        | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=716 out=60 think=–                                                                                                  |
| `t3-bl-haiku55content-nothinking-to-haiku45-enabled` | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=683 out=60 think=–                                                                                                  |
| `t3-bl-opus46content-nothinking-to-haiku55`          | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=549 out=75 think=0                                                                                                  |
| `t3-blank-summarized-text`                           | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-bt-fable51`                                      | 400  | `"thinking.type.between_tools" is not supported for this model.`                                                                                                   |
| `t3-bt-sonnet55-seed`                                | 200  | tool_use; text tool_use({"city": "Paris"}); in=416 out=96 think=0                                                                                                  |
| `t3-bt-sonnet55-to-haiku55-disabled`                 | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=524 out=75 think=0                                                                                                  |
| `t3-bt-sonnet55-turn2`                               | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=524 out=71 think=0                                                                                                  |
| `t3-bt-sonnet55-turn2-switch-adaptive`               | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=525 out=74 think=0                                                                                                  |
| `t3-constructed-tooluse-only`                        | 200  | tool_use; thinking[91c] text tool_use({"city": "Tokyo"}); in=479 out=114 think=40                                                                                  |
| `t3-drop-text`                                       | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=548 out=72 think=0                                                                                                  |
| `t3-drop-thinking`                                   | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=511 out=74 think=0                                                                                                  |
| `t3-dup-thinking`                                    | 400  | `messages.1.content.1: `thinking`or`redacted_thinking`blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the`     |
| `t3-empty-signature`                                 | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-fake-redacted`                                   | 400  | `messages.1.content.0: Invalid `data`in`redacted_thinking` block`                                                                                                  |
| `t3-flip-sig-thinking-disabled`                      | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-flip-sig-to-haiku45-disabled`                    | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-flip-sig-to-opus46`                              | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-flip-signature-char`                             | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-foreign-signature-same-model`                    | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=570 out=74 think=0                                                                                                  |
| `t3-garbage-signature`                               | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-haiku45-constructed-tooluse-only`                | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=663 out=70 think=–                                                                                                  |
| `t3-haiku45-drop-thinking`                           | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=716 out=68 think=–                                                                                                  |
| `t3-haiku45-flip-signature`                          | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-haiku45-modify-text`                             | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=858 out=69 think=0                                                                                                  |
| `t3-haiku45-thinking-disabled`                       | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=835 out=69 think=–                                                                                                  |
| `t3-haiku45-thinking-into-haiku55-latest`            | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=671 out=74 think=0                                                                                                  |
| `t3-haiku45-verbatim`                                | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=858 out=69 think=0                                                                                                  |
| `t3-missing-signature`                               | 400  | `messages.1.content.0.thinking.signature: Field required`                                                                                                          |
| `t3-modify-thinking-text`                            | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-omit-seed-add-text`                              | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=580 out=74 think=0                                                                                                  |
| `t3-omit-seed-drop-thinking`                         | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=521 out=74 think=0                                                                                                  |
| `t3-omit-seed-verbatim`                              | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=580 out=71 think=0                                                                                                  |
| `t3-opus46-drop-thinking`                            | 200  | tool_use; thinking[45c] text tool_use({"city": "Tokyo"}); in=710 out=111 think=27                                                                                  |
| `t3-opus46-flip-signature`                           | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-opus46-modify-text`                              | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=754 out=81 think=0                                                                                                  |
| `t3-opus46-verbatim`                                 | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=754 out=81 think=0                                                                                                  |
| `t3-redacted-with-real-sig-as-data`                  | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-reorder-text-first`                              | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-reorder-tool-first`                              | 200  | tool_use; thinking[103c] text tool_use({"city": "Tokyo"}); in=577 out=122 think=48                                                                                 |
| `t3-seed-haiku45-enabled`                            | 200  | tool_use; thinking[447c] text tool_use({"city": "Paris"}); in=622 out=219 think=109                                                                                |
| `t3-seed-haiku55-omit`                               | 200  | tool_use; thinking[0c] text tool_use({"city": "Paris"}); in=417 out=151 think=59                                                                                   |
| `t3-seed-haiku55-summ`                               | 200  | tool_use; thinking[117c] text tool_use({"city": "Paris"}); in=417 out=150 think=68                                                                                 |
| `t3-seed-opus46-adapt`                               | 200  | tool_use; thinking[120c] text tool_use({"city": "Paris"}); in=593 out=145 think=41                                                                                 |
| `t3-summarized-replayed-under-omitted`               | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-thinking-disabled`                               | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=578 out=74 think=0                                                                                                  |
| `t3-thinking-disabled-drop-thinking`                 | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=510 out=75 think=0                                                                                                  |
| `t3-thinking-in-user-msg`                            | 400  | `messages.2.content: thinking blocks may only be in `assistant` messages`                                                                                          |
| `t3-thinking-omitted-field`                          | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-truncate-signature`                              | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3-two-thinking-diff-responses`                     | 400  | `messages.1.content.1: `thinking`or`redacted_thinking`blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the`     |
| `t3-verbatim`                                        | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-verbatim-strip-caller`                           | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-xmodel-haiku45-to-haiku55`                       | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=717 out=71 think=0                                                                                                  |
| `t3-xmodel-haiku45-to-sonnet45`                      | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=858 out=60 think=0                                                                                                  |
| `t3-xmodel-haiku55omit-to-fable51`                   | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=521 out=70 think=0                                                                                                  |
| `t3-xmodel-haiku55omit-to-fable51-drop`              | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=521 out=70 think=0                                                                                                  |
| `t3-xmodel-haiku55omit-to-haiku45-enabled`           | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=713 out=68 think=0                                                                                                  |
| `t3-xmodel-haiku55omit-to-haiku45-enabled-drop`      | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=690 out=68 think=–                                                                                                  |
| `t3-xmodel-haiku55omit-to-sonnet46`                  | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=691 out=67 think=0                                                                                                  |
| `t3-xmodel-haiku55omit-to-sonnet46-drop`             | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=691 out=67 think=0                                                                                                  |
| `t3-xmodel-opus46-to-haiku55`                        | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=593 out=74 think=0                                                                                                  |
| `t3-xmodel-opus46-to-sonnet46`                       | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=754 out=80 think=0                                                                                                  |
| `t3-xmodel-to-haiku45-disabled`                      | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=683 out=60 think=–                                                                                                  |
| `t3-xmodel-to-haiku45-enabled`                       | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=706 out=68 think=0                                                                                                  |
| `t3-xmodel-to-opus46-adaptive`                       | 200  | tool_use; thinking[45c] text tool_use({"city": "Tokyo"}); in=684 out=102 think=27                                                                                  |
| `t3-xmodel-to-opus55`                                | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=70 think=0                                                                                                  |
| `t3-xmodel-to-sonnet55`                              | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-xtext-haiku45-self-long`                         | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=858 out=69 think=0                                                                                                  |
| `t3-xtext-haiku45-to-haiku55-blank`                  | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=717 out=72 think=0                                                                                                  |
| `t3-xtext-haiku45-to-haiku55-long`                   | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=717 out=71 think=0                                                                                                  |
| `t3-xtext-haiku55-self-long`                         | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=579 out=74 think=0                                                                                                  |
| `t3-xtext-haiku55-to-haiku45-blank`                  | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=706 out=60 think=0                                                                                                  |
| `t3-xtext-haiku55-to-haiku45-long`                   | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=706 out=68 think=0                                                                                                  |
| `t3-xtext-haiku55-to-opus46-blank`                   | 200  | tool_use; thinking[45c] text tool_use({"city": "Tokyo"}); in=684 out=99 think=27                                                                                   |
| `t3-xtext-haiku55-to-opus46-drop`                    | 200  | tool_use; thinking[45c] text tool_use({"city": "Tokyo"}); in=684 out=99 think=27                                                                                   |
| `t3-xtext-haiku55-to-sonnet55-drop`                  | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=511 out=74 think=0                                                                                                  |
| `t3-xtext-opus46-to-haiku55-blank`                   | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=593 out=74 think=0                                                                                                  |
| `t3-xtext-opus46-to-haiku55-long`                    | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=593 out=74 think=0                                                                                                  |
| `t3-xtext-opus46-to-sonnet46-blank`                  | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=754 out=78 think=0                                                                                                  |
| `t3-xtext-opus46-to-sonnet46-drop`                   | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=710 out=78 think=0                                                                                                  |
| `t3e-disabled`                                       | 200  | end_turn; text; in=732 out=7 think=0                                                                                                                               |
| `t3e-disabled-flip-sig`                              | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3e-drop`                                           | 200  | end_turn; thinking[179c] text; in=665 out=139 think=133                                                                                                            |
| `t3e-dup`                                            | 400  | `messages.1.content.1: `thinking`or`redacted_thinking`blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the`     |
| `t3e-fake-redacted`                                  | 400  | `messages.1.content.0: Invalid `data`in`redacted_thinking` block`                                                                                                  |
| `t3e-flip-sig`                                       | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3e-garbage-sig`                                    | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3e-haiku45-sig`                                    | 200  | end_turn; thinking[127c] text; in=825 out=113 think=108                                                                                                            |
| `t3e-haiku45-thinking-block`                         | 200  | end_turn; thinking[114c] text; in=825 out=81 think=77                                                                                                              |
| `t3e-missing-sig`                                    | 400  | `messages.1.content.0.thinking.signature: Field required`                                                                                                          |
| `t3e-opus46-thinking-block`                          | 200  | end_turn; thinking[106c] text; in=709 out=76 think=71                                                                                                              |
| `t3e-to-haiku45-enabled`                             | 200  | end_turn; thinking[604c] text; in=848 out=192 think=184                                                                                                            |
| `t3e-to-haiku45-enabled-drop`                        | 200  | end_turn; thinking[603c] text; in=848 out=174 think=166                                                                                                            |
| `t3e-to-haiku45-enabled-flip`                        | 400  | `messages.1.content.0: Invalid `signature`in`thinking` block`                                                                                                      |
| `t3e-turn3`                                          | 200  | end_turn; text; in=667 out=40 think=0                                                                                                                              |
| `t3e-verbatim`                                       | 200  | end_turn; thinking[84c] text; in=733 out=82 think=76                                                                                                               |
| `t4-disable-parallel`                                | 200  | tool_use; text tool_use({"city": "Paris"}); in=396 out=63 think=0                                                                                                  |
| `t4-foreign-id-empty`                                | 400  | `messages.1.content.0.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'`                                                                                 |
| `t4-foreign-id-long`                                 | 200  | end_turn; text; in=432 out=17 think=0                                                                                                                              |
| `t4-foreign-id-openai-style`                         | 200  | end_turn; text; in=432 out=17 think=0                                                                                                                              |
| `t4-foreign-id-short`                                | 200  | end_turn; text; in=432 out=17 think=0                                                                                                                              |
| `t4-foreign-id-with-colon`                           | 400  | `messages.1.content.0.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'`                                                                                 |
| `t4-foreign-id-with-dash`                            | 200  | end_turn; text; in=432 out=17 think=0                                                                                                                              |
| `t4-foreign-id-with-dot`                             | 400  | `messages.1.content.0.tool_use.id: String should match pattern '^[a-zA-Z0-9_-]+$'`                                                                                 |
| `t4-name-64`                                         | 200  | end_turn; text; in=429 out=13 think=0                                                                                                                              |
| `t4-name-65`                                         | 200  | end_turn; text; in=430 out=14 think=0                                                                                                                              |
| `t4-name-dot`                                        | 400  | `tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'`                                                                                        |
| `t4-name-dup`                                        | 400  | `tools: Tool names must be unique.`                                                                                                                                |
| `t4-name-invalid-chars`                              | 400  | `tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'`                                                                                        |
| `t4-parallel`                                        | 200  | tool_use; text tool_use({"city": "Paris"}) tool_use({"city": "Tokyo"}); in=396 out=112 think=0                                                                     |
| `t4-parallel-adaptive`                               | 200  | tool_use; tool_use({"city": "Paris"}) tool_use({"city": "Tokyo"}); in=397 out=99 think=0                                                                           |
| `t4-replay-empty-assistant`                          | 200  | tool_use; text tool_use({"city": "Paris"}) tool_use({"city": "Tokyo"}); in=408 out=147 think=0                                                                     |
| `t4-result-both-strings`                             | 200  | end_turn; text; in=580 out=36 think=0                                                                                                                              |
| `t4-result-cache-control`                            | 200  | end_turn; text; in=2 cw=578 cr=0 out=36 think=0                                                                                                                    |
| `t4-result-content-number`                           | 400  | `messages.2.content.0.tool_result.content: Found a number, but `tool_result` content must either be a string or a list of content blocks.`                         |
| `t4-result-document-block`                           | 200  | end_turn; text; in=613 out=36 think=0                                                                                                                              |
| `t4-result-dup`                                      | 400  | `messages.2.content.1: each tool_use must have a single result. Found multiple `tool_result` blocks with id: toolu_01UFrMwKGsjGTeaiXrnDXX3L`                       |
| `t4-result-empty-string`                             | 200  | end_turn; text; in=584 out=52 think=0                                                                                                                              |
| `t4-result-image`                                    | 200  | end_turn; text; in=596 out=73 think=0                                                                                                                              |
| `t4-result-in-later-message`                         | 400  | `messages.2: `tool_use`ids were found without`tool_result`blocks immediately after: toolu_01GL2RB5Sme4KbYXuAToYjD5, toolu_01UFrMwKGsjGTeaiXrnDXX3L. Each`tool`     |
| `t4-result-is-error`                                 | 200  | end_turn; text; in=580 out=54 think=0                                                                                                                              |
| `t4-result-missing-all`                              | 400  | `messages.2: `tool_use`ids were found without`tool_result`blocks immediately after: toolu_01GL2RB5Sme4KbYXuAToYjD5, toolu_01UFrMwKGsjGTeaiXrnDXX3L. Each`tool`     |
| `t4-result-missing-one`                              | 400  | `messages.2: `tool_use`ids were found without`tool_result`blocks immediately after: toolu_01GL2RB5Sme4KbYXuAToYjD5. Each`tool_use` block must have a correspo`     |
| `t4-result-no-content`                               | 200  | end_turn; text; in=584 out=55 think=0                                                                                                                              |
| `t4-result-no-tools-param`                           | 400  | `tools: Input should be a valid array`                                                                                                                             |
| `t4-result-split-two-user-msgs`                      | 200  | end_turn; text; in=580 out=36 think=0                                                                                                                              |
| `t4-result-text-blocks`                              | 200  | end_turn; text; in=586 out=36 think=0                                                                                                                              |
| `t4-result-wrong-id`                                 | 400  | `messages.2.content.1: unexpected `tool_use_id`found in`tool_result`blocks: toolu_01XXXXXXXXXXXXXXXXXXXXXX. Each`tool_result` block must have a corresponding`     |
| `t4-results-reversed-order`                          | 200  | end_turn; text; in=580 out=36 think=0                                                                                                                              |
| `t4-schema-empty-object`                             | 200  | end_turn; text; in=343 out=30 think=0                                                                                                                              |
| `t4-schema-missing`                                  | 400  | `tools.0.custom.input_schema: Field required`                                                                                                                      |
| `t4-schema-no-type`                                  | 400  | `tools.0.custom.input_schema.type: Field required`                                                                                                                 |
| `t4-schema-string`                                   | 400  | `tools.0.custom.input_schema.type: Input should be 'object'`                                                                                                       |
| `t4-strict-tool`                                     | 200  | tool_use; tool_use({"city": "Paris"}); in=385 out=50 think=0                                                                                                       |
| `t4-strict-tool-minLength`                           | 200  | tool_use; tool_use({"city": "Paris"}); in=393 out=50 think=0                                                                                                       |
| `t4-strict-tool-no-additionalProperties`             | 400  | `tools.0.custom: For 'object' type, 'additionalProperties' must be explicitly set to false`                                                                        |
| `t4-tc-any`                                          | 200  | tool_use; tool_use({"city": "<UNKNOWN>"}); in=491 out=45 think=0                                                                                                   |
| `t4-tc-any-disable-parallel`                         | 200  | tool_use; tool_use({"city": "Paris"}); in=519 out=38 think=0                                                                                                       |
| `t4-tc-none`                                         | 200  | end_turn; []; in=396 out=1 think=0                                                                                                                                 |
| `t4-tc-none-adaptive`                                | 200  | end_turn; []; in=397 out=1 think=0                                                                                                                                 |
| `t4-tc-tool`                                         | 200  | tool_use; tool_use({"city": "<UNKNOWN>"}); in=497 out=39 think=0                                                                                                   |
| `t4-tc-tool-unknown`                                 | 400  | `Tool 'nope' not found in provided tools`                                                                                                                          |
| `t4-text-after-results`                              | 200  | end_turn; text; in=590 out=32 think=0                                                                                                                              |
| `t4-text-before-results`                             | 400  | `messages.2: `tool_use`ids were found without`tool_result`blocks immediately after: toolu_01GL2RB5Sme4KbYXuAToYjD5, toolu_01UFrMwKGsjGTeaiXrnDXX3L. Each`tool`     |
| `t4-tool-defer_loading`                              | 400  | `At least one tool must have defer_loading=false. All tools cannot be deferred.`                                                                                   |
| `t4-tool-eager_input_streaming`                      | 200  | end_turn; text; in=369 out=13 think=0                                                                                                                              |
| `t4-tool-extra-field`                                | 400  | `tools.0.custom.foo: Extra inputs are not permitted`                                                                                                               |
| `t4-tool-input_examples`                             | 200  | end_turn; text; in=456 out=13 think=0                                                                                                                              |
| `t4-tooluse-input-string`                            | 400  | `messages.1.content.0.tool_use.input: Input should be an object`                                                                                                   |
| `t4-tooluse-unknown-tool-name`                       | 200  | end_turn; text; in=409 out=17 think=0                                                                                                                              |
| `t5-adaptive`                                        | 200  | end_turn; text; in=234 out=24 think=0                                                                                                                              |
| `t5-additionalProperties-true`                       | 400  | `output_config.format.schema: For 'object' type, 'additionalProperties: true' is not supported. Please set 'additionalProperties' to false`                        |
| `t5-basic`                                           | 200  | end_turn; text; in=233 out=23 think=0                                                                                                                              |
| `t5-enum-and-const`                                  | 200  | end_turn; text; in=246 out=16 think=0                                                                                                                              |
| `t5-format-email`                                    | 200  | end_turn; text; in=213 out=16 think=0                                                                                                                              |
| `t5-haiku45`                                         | 200  | end_turn; text; in=183 out=19 think=–                                                                                                                              |
| `t5-json_schema-with-name`                           | 400  | `output_config.format.name: Extra inputs are not permitted`                                                                                                        |
| `t5-legacy-output_format-beta`                       | 200  | end_turn; text; in=233 out=23 think=0 (beta `structured-outputs-2025-11-13`)                                                                                       |
| `t5-legacy-output_format-beta-haiku45`               | 200  | end_turn; text; in=183 out=19 think=– (beta `structured-outputs-2025-11-13`)                                                                                       |
| `t5-legacy-output_format-nobeta`                     | 400  | `output_format: This field is deprecated. Use 'output_config.format' instead. See https://platform.claude.com/docs/en/build-with-claude/structured-outputs for mo` |
| `t5-minItems-2`                                      | 400  | `output_config.format.schema: For 'array' type, 'minItems' values other than 0 or 1 are not supported (got: [2, 5])`                                               |
| `t5-minLength`                                       | 200  | end_turn; text; in=214 out=13 think=0                                                                                                                              |
| `t5-minimum`                                         | 400  | `output_config.format.schema: For 'number' type, property 'minimum' is not supported`                                                                              |
| `t5-no-additionalProperties`                         | 400  | `output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false`                                                           |
| `t5-opus46`                                          | 200  | end_turn; text; in=184 out=16 think=–                                                                                                                              |
| `t5-pattern-lookahead`                               | 400  | `output_config.format.schema: Invalid regex in pattern field: Quantifier '?' without preceding element`                                                            |
| `t5-recursive-ref`                                   | 400  | `output_config.format.schema: Invalid schema: Circular reference detected in schema definitions: n -> n. Self-referencing or mutually-referencing definitions are` |
| `t5-sonnet55`                                        | 200  | end_turn; text; in=234 out=22 think=0                                                                                                                              |
| `t5-top-array`                                       | 200  | end_turn; text; in=169 out=55 think=0                                                                                                                              |
| `t5-top-string`                                      | 200  | end_turn; text; in=152 out=45 think=0                                                                                                                              |
| `t5-type-json_object`                                | 400  | `output_config.format.type: Input should be 'json_schema'`                                                                                                         |
| `t5-type-text`                                       | 400  | `output_config.format.type: Input should be 'json_schema'`                                                                                                         |
| `t5-with-effort`                                     | 200  | end_turn; text; in=234 out=24 think=0                                                                                                                              |
| `t5-with-tools`                                      | 200  | end_turn; text; in=583 out=24 think=0                                                                                                                              |
| `t6-a1-system-5m`                                    | 200  | end_turn; text; in=15 cw=5181 cr=0 out=4 think=0                                                                                                                   |
| `t6-a2-system-5m`                                    | 200  | end_turn; text; in=15 cw=0 cr=5181 out=4 think=0                                                                                                                   |
| `t6-b1-system+user`                                  | 200  | max_tokens; text; in=4 cw=15 cr=5181 out=20 think=0                                                                                                                |
| `t6-b2-system+user`                                  | 200  | max_tokens; text; in=4 cw=0 cr=5196 out=20 think=0                                                                                                                 |
| `t6-b3-extended`                                     | 200  | end_turn; text; in=4 cw=14 cr=5196 out=11 think=0                                                                                                                  |
| `t6-c1-1h`                                           | 200  | end_turn; text; in=15 cw=5147 cr=0 out=4 think=0                                                                                                                   |
| `t6-c2-1h`                                           | 200  | end_turn; text; in=15 cw=0 cr=5147 out=4 think=0                                                                                                                   |
| `t6-c3-1h-then-5m`                                   | 200  | end_turn; text; in=15 cw=1355 cr=5147 out=4 think=0                                                                                                                |
| `t6-c4-5m-then-1h`                                   | 400  | `system.1.cache_control.ttl: a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block. Note that blocks are processed in the following o` |
| `t6-c5-bad-ttl`                                      | 400  | `system.0.cache_control.ephemeral.ttl: Input should be '5m' or '1h'`                                                                                               |
| `t6-c6-bad-type`                                     | 400  | `system.0.cache_control: Input tag 'persistent' found using 'type' does not match any of the expected tags: 'ephemeral'`                                           |
| `t6-count-1200`                                      | 200  | count_tokens: {"input_tokens": 5377}                                                                                                                               |
| `t6-count-300`                                       | 200  | count_tokens: {"input_tokens": 1359}                                                                                                                               |
| `t6-count-600`                                       | 200  | count_tokens: {"input_tokens": 2697}                                                                                                                               |
| `t6-d-4-breakpoints`                                 | 200  | end_turn; text; in=29 out=4 think=0                                                                                                                                |
| `t6-d-5-breakpoints`                                 | 400  | `A maximum of 4 blocks with cache_control may be provided. Found 5.`                                                                                               |
| `t6-e1-toplevel-cc`                                  | 200  | end_turn; text; in=4 cw=5192 cr=0 out=4 think=0                                                                                                                    |
| `t6-e2-toplevel-cc`                                  | 200  | end_turn; text; in=4 cw=0 cr=5192 out=4 think=0                                                                                                                    |
| `t6-f-cc-empty-text`                                 | 400  | `system.0: cache_control cannot be set for empty text blocks`                                                                                                      |
| `t6-f-cc-on-thinking`                                | 400  | `messages.1.content.0.thinking.cache_control: Extra inputs are not permitted`                                                                                      |
| `t6-f-cc-on-tool_use`                                | 200  | tool_use; text tool_use({"city": "Tokyo"}); in=7 cw=567 cr=0 out=74 think=0                                                                                        |
| `t6-f-cc-on-tooldef`                                 | 200  | end_turn; text; in=88 cw=5429 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-haiku45-230`                                   | 200  | end_turn; text; in=779 out=4 think=–                                                                                                                               |
| `t6-g-haiku45-470`                                   | 200  | end_turn; text; in=1541 out=4 think=–                                                                                                                              |
| `t6-g-haiku45-930`                                   | 200  | end_turn; text; in=3012 out=4 think=–                                                                                                                              |
| `t6-g-haiku55-230`                                   | 200  | end_turn; text; in=15 cw=1042 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-haiku55-470`                                   | 200  | end_turn; text; in=15 cw=2103 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-haiku55-930`                                   | 200  | end_turn; text; in=15 cw=4179 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-opus46-230`                                    | 200  | end_turn; text; in=764 out=4 think=–                                                                                                                               |
| `t6-g-opus46-470`                                    | 200  | end_turn; text; in=1562 out=4 think=–                                                                                                                              |
| `t6-g-opus46-930`                                    | 200  | end_turn; text; in=3074 out=4 think=–                                                                                                                              |
| `t6-g-opus55-230`                                    | 200  | end_turn; text; in=15 cw=1036 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-opus55-470`                                    | 200  | end_turn; text; in=15 cw=2102 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-opus55-930`                                    | 200  | end_turn; text; in=15 cw=4192 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-sonnet46-230`                                  | 200  | end_turn; text; in=766 out=4 think=–                                                                                                                               |
| `t6-g-sonnet46-470`                                  | 200  | end_turn; text; in=12 cw=1540 cr=0 out=4 think=–                                                                                                                   |
| `t6-g-sonnet46-930`                                  | 200  | end_turn; text; in=12 cw=3048 cr=0 out=4 think=–                                                                                                                   |
| `t6-g-sonnet55-230`                                  | 200  | end_turn; text; in=15 cw=1044 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-sonnet55-470`                                  | 200  | end_turn; text; in=15 cw=2151 cr=0 out=4 think=0                                                                                                                   |
| `t6-g-sonnet55-930`                                  | 200  | end_turn; text; in=15 cw=4195 cr=0 out=4 think=0                                                                                                                   |
| `t6-h-haiku45-1300`                                  | 200  | end_turn; text; in=12 cw=4227 cr=0 out=4 think=–                                                                                                                   |
| `t6-h-haiku55-100`                                   | 200  | end_turn; text; in=472 out=4 think=0                                                                                                                               |
| `t6-h-haiku55-130`                                   | 200  | end_turn; text; in=15 cw=604 cr=0 out=4 think=0                                                                                                                    |
| `t6-h-haiku55-160`                                   | 200  | end_turn; text; in=15 cw=742 cr=0 out=4 think=0                                                                                                                    |
| `t6-h-haiku55-180`                                   | 200  | end_turn; text; in=15 cw=825 cr=0 out=4 think=0                                                                                                                    |
| `t6-h-haiku55-215`                                   | 200  | end_turn; text; in=15 cw=983 cr=0 out=4 think=0                                                                                                                    |
| `t6-h-opus46-1300`                                   | 200  | end_turn; text; in=12 cw=4228 cr=0 out=4 think=–                                                                                                                   |
| `t6-h-sonnet46-320`                                  | 200  | end_turn; text; in=12 cw=1053 cr=0 out=4 think=–                                                                                                                   |
| `t7-codeexec-20250825`                               | 200  | end_turn; text server_tool_use bash_code_execution_tool_result text; in=5892 out=116 think=0                                                                       |
| `t7-codeexec-replay-container`                       | 200  | end_turn; server_tool_use bash_code_execution_tool_result text; in=6188 out=72 think=0                                                                             |
| `t7-codeexec-replay-no-container`                    | 200  | end_turn; server_tool_use bash_code_execution_tool_result text; in=6188 out=72 think=0                                                                             |
| `t7-websearch-20250305`                              | 200  | end_turn; server_tool_use web_search_tool_result thinking[0c] text text; in=13437 out=527 think=405                                                                |
| `t7-websearch-replay`                                | 200  | end_turn; thinking[0c] text; in=11074 out=254 think=249                                                                                                            |
| `t7-websearch-replay-no-tools`                       | 200  | end_turn; text; in=8226 out=12 think=0                                                                                                                             |
| `t7-websearch-replay-strip-server-blocks`            | 200  | end_turn; thinking[0c] text; in=3334 out=189 think=184                                                                                                             |
| `t7-websearch-replay-tampered-encrypted`             | 400  | `messages.1.content.0: Invalid `encrypted_content`in`search_result` block`                                                                                         |
| `t7-websearch-replay-to-haiku45`                     | 200  | end_turn; text; in=8767 out=11 think=–                                                                                                                             |
| `t7-websearch-web_search_20260209`                   | 200  | end_turn; server_tool_use web_search_tool_result thinking[0c] server_tool_use code_execution_tool_result thinking[0c] text; in=18521 out=644 think=263             |
| `t8-clear-thinking-keep-all`                         | 200  | end_turn; thinking[98c] text; in=733 out=112 think=97 (beta `context-management-2025-06-27`)                                                                       |
| `t8-clear-thinking-keep1`                            | 200  | end_turn; thinking[100c] text; in=663 out=112 think=106 (beta `context-management-2025-06-27`)                                                                     |
| `t8-clear-thinking-on-disabled`                      | 400  | ``clear_thinking_20251015`strategy requires`thinking` to be enabled or adaptive` (beta `context-management-2025-06-27`)                                            |
| `t8-clear-tool-uses-beta`                            | 200  | end_turn; text; in=580 out=35 think=0 (beta `context-management-2025-06-27`)                                                                                       |
| `t8-clear-tool-uses-default-trigger`                 | 200  | end_turn; text; in=580 out=36 think=0 (beta `context-management-2025-06-27`)                                                                                       |
| `t8-clear-tool-uses-earlier-turn`                    | 200  | end_turn; thinking[110c] text; in=733 out=61 think=55 (beta `context-management-2025-06-27`)                                                                       |
| `t8-clear-tool-uses-nobeta`                          | 400  | `context_management: Extra inputs are not permitted`                                                                                                               |
| `t8-compact-nobeta`                                  | 400  | `context_management: Extra inputs are not permitted`                                                                                                               |
| `t8-compact-small-trigger`                           | 400  | `context_management.edits.0.compact_20260112: trigger.value must be at least 50000` (beta `compact-2026-01-12`)                                                    |
| `t9-maxtokens-midthinking-haiku45`                   | 200  | end_turn; thinking[1088c] text; in=57 out=938 think=412                                                                                                            |
| `t9-maxtokens-midthinking-haiku55`                   | 200  | max_tokens; thinking[106c]; in=32 out=30 think=30                                                                                                                  |
| `t9-stream-haiku55-omit-2`                           | 200  | SSE stream                                                                                                                                                         |
| `t9-stream-haiku55-summ`                             | 200  | SSE stream                                                                                                                                                         |
| `t9-stream-haiku55-summ-2`                           | 200  | SSE stream                                                                                                                                                         |
