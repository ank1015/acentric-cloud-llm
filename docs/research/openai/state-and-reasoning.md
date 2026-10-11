# OpenAI Responses API: conversation state, reasoning, compaction, long runs

Research date: 2026-10-11. Scope: what a stateless, non-streaming, multi-provider gateway (`complete` = one request in, one complete response out) and its TypeScript SDK must know about the OpenAI Responses API for durable agent harnesses.

## 0. How to read this report

Evidence tags used throughout:

- **[doc]** current OpenAI guide or API reference page (fetched as `.md`, which developers.openai.com serves by appending `.md` to a page URL).
- **[spec]** `openai/openai-openapi` `openapi.yaml` (HEAD of 2026-10-09) or `openai/openai-node` `src/resources/responses/responses.ts` (HEAD of 2026-10-11).
- **[client]** behaviour of OpenAI's own clients (openai-node helpers, openai-agents-python, Codex CLI source).
- **[community]** reproduced error text from OpenAI community threads or GitHub issues. Treat as observed behaviour, not contract. Some are from 2025 and may have changed.
- **[inferred]** my conclusion, not stated by OpenAI. Verify with a live call before depending on it.

I did not call the live API (no key), so every exact error body below comes from docs, specs, or third-party reports, and is tagged accordingly.

### What is new or changed versus the 2025 Responses API (things that affect the design)

| Item                                                  | Status as of Oct 2026                                                                                                                                          | Source                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Model families                                        | GPT-6 (`gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`), GPT-5.6 (`sol/terra/luna`), GPT-5.5 and older still served                                    | changelog, model pages        |
| `reasoning.effort`                                    | enum now `none, minimal, low, medium, high, xhigh, max`; per-model subset                                                                                      | [spec], models pages          |
| `reasoning.context` (`auto, current_turn, all_turns`) | new; controls whether earlier-turn reasoning is rendered into the next sample                                                                                  | [doc] reasoning guide         |
| `reasoning.mode` (`standard`, `pro`)                  | new for GPT-5.6 / GPT-6                                                                                                                                        | [doc]                         |
| `encrypted_content` on reasoning items                | now returned **by default** (the `include` value is still accepted, "legacy")                                                                                  | [doc] reasoning guide, [spec] |
| Server-side compaction (`context_management`)         | GA since Feb 10 2026                                                                                                                                           | changelog                     |
| `POST /responses/compact`                             | GA since late 2025                                                                                                                                             | changelog                     |
| `compaction_trigger` input item                       | new; explicit in-request compaction, must be the final input item                                                                                              | [spec]                        |
| `configuration_update` input item                     | new, GPT-6 only; change effort mid-conversation                                                                                                                | [doc]                         |
| `phase` on assistant messages                         | released Feb 24 2026                                                                                                                                           | changelog                     |
| `truncation`                                          | marked **`deprecated: true`** in OpenAPI and openai-node (no replacement stated, nothing on the deprecations page)                                             | [spec]                        |
| `async: true` on function/custom tools                | new, GPT-6; changes what "the turn is over" means                                                                                                              | [doc]                         |
| Mid-turn steering                                     | WebSocket only; `incomplete_details.reason = "steered"`                                                                                                        | [doc]                         |
| WebSocket mode for Responses                          | new (Feb 23 2026); connection-local cache for `previous_response_id`, ZDR compatible                                                                           | [doc]                         |
| Multi-agent                                           | beta; needs `OpenAI-Beta: responses_multi_agent=v1`; the beta surface is a parallel set of `?beta=true` operations and adds only a `multi_agent` request field | [doc], [spec]                 |
| Misalignment monitoring                               | GPT-6 Astra; can hard-stop a conversation with HTTP 403                                                                                                        | [doc]                         |
| Assistants API                                        | sunset Aug 26 2026; Conversations API is its successor                                                                                                         | deprecations page             |
| Agents API / Decisions API                            | separate beta products (`/v1/agents`, `/v1/decisions`); out of scope here                                                                                      | changelog                     |
| Cookbook "reasoning_items" recipe                     | archived, describes the o3/o4-mini era; still says reasoning must be passed back when tools are involved                                                       | cookbook                      |

## 1. `store` + `previous_response_id`

### 1.1 Semantics

- `store` (boolean, default **true** when omitted): "Whether to store the generated model response for later retrieval via API... response data will be stored for **at least 30 days**, subject to the data retention exceptions." [spec] [doc]
- `previous_response_id`: ID of an earlier stored response. The server rebuilds the context as the prior chain's inputs and outputs, then appends the new `input`. [doc] "Cannot be used in conjunction with `conversation`." [spec]
- Stored responses are retrievable with `GET /v1/responses/{id}` (supports `include`, `stream`, `starting_after` query params), deletable with `DELETE /v1/responses/{id}`, and their input items are listable with `GET /v1/responses/{id}/input_items`. [spec]

### 1.2 What is carried over, and what is not

| Thing                                                                                                                                | Carried by `previous_response_id`?                                                                                                                                                                              | Source                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Prior input items and output items (user messages, assistant messages, function calls and outputs, built-in tool items)              | Yes, the whole chain, not just the last response                                                                                                                                                                | [doc] conversation-state                            |
| Prior reasoning items                                                                                                                | Yes, held server-side. Whether they are _rendered into the next sample_ depends on `reasoning.context` (see 3.3)                                                                                                | [doc] reasoning                                     |
| Compaction items                                                                                                                     | Yes (server-side compaction: "If you are using `previous_response_id`, pass only the new user message each turn")                                                                                               | [doc] compaction                                    |
| `instructions`                                                                                                                       | **No.** "the instructions from a previous response will not be carried over to the next response"                                                                                                               | [spec] [doc]                                        |
| `tools` / `tool_choice`                                                                                                              | **No.** Must be re-sent on every request. The async-tool guide says to "include the tools and instructions in the continuation request"                                                                         | [doc] async-tool-calling [inferred for tool_choice] |
| `model`, `reasoning`, `text`, `temperature`, `max_output_tokens`, `store`, `metadata`, `truncation`, `context_management`, `include` | No (per-request parameters; not documented as inherited over HTTP). WebSocket "automatic successors" inherit settings, but an explicit `response.create` "uses its own tools, instructions, and other settings" | [doc] steering [inferred for HTTP]                  |
| `metadata`                                                                                                                           | No                                                                                                                                                                                                              | [inferred]                                          |
| Prior `conversation` binding                                                                                                         | N/A; the two are mutually exclusive                                                                                                                                                                             | [spec]                                              |

Consequence: with `previous_response_id`, each call must still carry the full `instructions`, `tools`, `reasoning`, `include`, etc. This fits the gateway design (those are always sent) but the harness must remember it.

### 1.3 Retention

- Default: stored "at least 30 days" (the docs say "at least", not "exactly"). `store:false` disables storage. [doc] conversation-state, your-data
- Anything attached to a `conversation` has no 30-day TTL; conversation objects and items persist until deleted. [doc] conversation-state, your-data table (`/v1/conversations`: "Until deleted", ZDR eligible: No)
- Background mode: response data is written to disk "for roughly 10 minutes" to enable polling when `store` is false (see section 6). [doc]
- Abuse-monitoring logs are a separate 30-day retention unaffected by `store` unless the org has ZDR or Modified Abuse Monitoring. [doc] your-data

### 1.4 Error when `previous_response_id` cannot be resolved

Not documented in the HTTP guides. The error-codes guide lists `previous_response_not_found` only under "WebSocket mode errors": "The `previous_response_id` cannot be resolved from available state. Retry with full input context and `previous_response_id` set to `null`." [doc] error-codes

Observed on plain HTTP [community]:

- HTTP **400**, `error.type = "invalid_request_error"`, `error.code = "previous_response_not_found"`, `error.param = "previous_response_id"` (semantic-kernel #13128: "HTTP 400 (invalid_request_error: previous_response_not_found) / Parameter: previous_response_id").
- Message text seen: `Previous response with id 'resp_...' not found.` (SK #13128, OpenAI forum 1362365). One BYOK path (vscode #316747) shows a different message, `No response found for previous_response_id resp_xxx.`, so do not match on message text. Match `code === "previous_response_not_found"`.
- Codex CLI keys on the same code string (`PREVIOUS_RESPONSE_NOT_FOUND_CODE = "previous_response_not_found"`). [client]

Causes (all collapse to the same error):

1. The original request used `store:false` (or the org is ZDR, which forces `store:false`).
2. The response expired (>= 30 days) or was deleted via `DELETE /responses/{id}`.
3. Different org/project/API key than the one that created it [inferred; consistent with reports].
4. **Eventual consistency right after creation.** Several independent reports show intermittent 400s on a follow-up sent immediately after a tool-calling response completed (forum 1362365 reports roughly 10-20% of runs; SK #13128; dotnet/extensions #7704). A short retry with backoff reportedly fixes it. [community] The harness should retry once or twice (hundreds of ms) before concluding the id is gone.

Important client-side pitfall: do not blindly retry with the same `previous_response_id` (vscode #316747). Fallback must drop it and send the full history.

### 1.5 ZDR interaction

- ZDR org: "the `store` parameter ... will always be treated as `false`, even if the request attempts to set the value to `true`." [doc] your-data. The request does not error; it silently behaves as stateless.
- So under ZDR, `previous_response_id` chaining over HTTP cannot work: the next call returns `previous_response_not_found`. The response body schema does not declare a `store` field (docs examples show `"store": true` on the wire, but it is not in the typed schema) so a harness cannot reliably detect "store was forced off" from the response. [spec] [inferred]
- ZDR-compatible state options: full-history replay with `store:false` + encrypted reasoning, server-side compaction with `store:false` ("no data is retained when `store="false"`"), standalone `/responses/compact` ("fully stateless and ZDR-friendly"), and WebSocket mode (connection-local cache). `/v1/conversations` is **not** ZDR-eligible. [doc]
- Modified Abuse Monitoring orgs (not ZDR): `store` omitted/true behaves normally for foreground requests; for background requests the response is retained past polling only if `store=true` is explicit. [doc] background, your-data

### 1.6 Billing

- "Even when using `previous_response_id`, all previous input tokens for responses in the chain are billed as input tokens in the API." [doc] conversation-state. The migration guide repeats it as a pitfall: "Assuming `previous_response_id` removes billing for prior context." [doc]
- What does reduce cost is prompt caching: cached prefix tokens are billed at the cached-input rate (`usage.input_tokens_details.cached_tokens`). For GPT-5.6 and later, **cache writes are billed at 1.25x** the uncached input rate (`usage.input_tokens_details.cache_write_tokens`); reads at 0.1x (0.05x on GPT-6.1 Sol). [doc] prompt-caching
- Prompts above 272K input tokens are priced at 2x input and cache rates and 1.5x output for the **full request** (Astra page; other 1.05M-context models similar). Matters for runs that let context grow instead of compacting. [doc] model pages
- Cache reuse is hurt by: changing `reasoning.effort`, tools, model, `context_management` (compaction), `configuration_update` placement, etc. `Response.prompt_cache_diagnostics` exposes `cache_miss` reasons (`model_changed`, `tools_changed`, `reasoning_effort_changed`, `context_compacted`, `input_changed`, ...). [doc] [spec]
- Both replay styles are billed the same in tokens; `previous_response_id` just saves you from sending the bytes.

## 2. Conversations API (`conversation` param, `/v1/conversations`)

- Durable server-side object (`conv_...`) holding **items**, created with `POST /v1/conversations` (`items` up to 20 initial, `metadata`), plus `GET/POST/DELETE /conversations/{id}` and `POST/GET /conversations/{id}/items`, `GET/DELETE .../items/{item_id}`. Deleting a conversation does not delete its items ("Items in the conversation will not be deleted"). [spec]
- Use: pass `conversation: "conv_..."` (or `{id}`) to `responses.create`. "Items from this conversation are prepended to `input_items`... Input items and output items from this response are automatically added to this conversation after this response completes." [spec] The response echoes `conversation: {id}`.
- Relation to `previous_response_id`: alternative mechanism, **mutually exclusive** ("Cannot be used in conjunction with `conversation`"). Even `previous_response_id: null` alongside `conversation` was rejected in one report (forum 1358465, Sept 2025). Exact error text for the conflict was not found; expect HTTP 400 `invalid_request_error`. [spec] [community] [inferred]
- Retention: no 30-day TTL, kept until deleted; any response attached to a conversation has its items persisted with no TTL. Not ZDR eligible; not Private Retention eligible. [doc] your-data
- Reported caveat: with `store:false` plus `conversation`, new turns were silently not appended (forum 1358465, Sept 2025). Status today unknown. [community]
- Reported caveat: persisted reasoning items inside a conversation still hit "reasoning ... without its required following item" for one user (forum 1151686, late post). [community]
- Compaction: `context_management` and `/responses/compact` are described for `previous_response_id` and stateless chaining; docs do not describe interplay with `conversation`. Steering docs state responses "bound to a conversation or using automatic compaction do not support steering". [doc]

**Should a stateless gateway pass `conversation` through?** Yes, as an opaque provider option, like `previous_response_id`. It is the caller's choice, requires nothing from the gateway, and the gateway must not create/read/delete conversations on its own. Caveats: (a) it breaks the "harness owns the log" principle because the source of truth moves to OpenAI and the harness cannot see which items the server included; (b) it cannot be used with provider switching; (c) it is not ZDR eligible; (d) the Conversations CRUD routes are a separate surface the SDK would only need if we expose a `native` escape hatch for it. Recommendation: pass-through only; document that durable harnesses should not use it; do not wrap the CRUD routes in v1.

## 3. Reasoning models

### 3.1 Effort and summary values

`reasoning.effort` union: `none | minimal | low | medium | high | xhigh | max` (null allowed). Support is per model. [spec] [doc]

| Model family              | Supported effort (default)                                                                     | Source                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `gpt-6-astra`             | `low, medium, high, xhigh, max`. `none` returns HTTP 400. Default not stated on the model page | model page, reasoning guide                   |
| `gpt-6.1-sol`             | `low, medium (default), high, xhigh, max`. `none` and `minimal` unsupported                    | model page                                    |
| `gpt-6-sol`, `gpt-6-luna` | `none, low, medium (default), high, xhigh, max`                                                | model pages                                   |
| `gpt-5.6-sol/terra/luna`  | `none, low, medium (default), high, xhigh, max`                                                | model pages                                   |
| `gpt-5.5`                 | `none, low, medium (default), high, xhigh`                                                     | model page                                    |
| `gpt-5.4`, `gpt-5.2`      | `none (default), low, medium, high, xhigh` (`xhigh` added in 5.2)                              | model pages                                   |
| `gpt-5.1`                 | `none (default), low, medium, high`                                                            | model page                                    |
| `gpt-5` / o-series        | `minimal` existed for gpt-5; o-series `low/medium/high`                                        | [inferred from history; not on current pages] |

Other reasoning knobs:

- `reasoning.summary`: `auto | concise | detailed | null`. `auto` = most detailed available (usually `detailed`). `concise` is supported for computer-use-preview and "all reasoning models after gpt-5". Summaries "will not be included unless you explicitly opt in", and latest models may require API organization verification. `reasoning.generate_summary` is deprecated. [doc] [spec]
- `reasoning.context`: `auto | current_turn | all_turns`. GPT-5.6 family defaults to `all_turns`; earlier models default to `current_turn`. GPT-6.1 Sol also supports `all_turns`. The response echoes the effective value. [doc] [spec]
- `reasoning.mode`: `standard | pro` (GPT-5.6 and GPT-6). Pro bills the aggregated work at standard rates. [doc]
- Response `reasoning` echoes `effort`, `summary`, `context`, `mode`. With `configuration_update` the echoed `effort` stays the request-level one. [doc]

### 3.2 Shape of a reasoning item

Output (and input) item [spec]:

```json
{
  "id": "rs_6876cf02e0bc8192b74af0fb64b715ff06fa2fcced15a5ac",
  "type": "reasoning",
  "summary": [{ "type": "summary_text", "text": "..." }],
  "encrypted_content": "gAAAA...",
  "status": "completed"
}
```

- `summary` is required (empty array is valid for replay: forum 1370540, forum 1375928 staff-adjacent reply says "The summary with strings is also a required key"). `content` (raw reasoning text) is optional and only populated by open-weight models. `encrypted_content` is optional/nullable. `status` is `in_progress | completed | incomplete`.
- `encrypted_content`: "populated by default for reasoning items returned by `POST /v1/responses`". [spec] The reasoning guide: in stateless mode (`store:false` or ZDR) items include it by default; `include: ["reasoning.encrypted_content"]` is accepted for compatibility but not required. The migration guide: "Each item includes `encrypted_content` by default when you create a response." [doc] The older cookbook and many harnesses still send the include explicitly. **Recommendation: harnesses should keep sending the include.** It is harmless and covers models/paths where the default is not applied. [inferred]

### 3.3 Rules for replaying reasoning items

Documented rules:

1. **With tool calls, reasoning must be passed back.** "Any reasoning items returned in model responses with tool calls must also be passed back with tool call outputs." [doc] function-calling. "If the model calls multiple functions consecutively, you should pass back all reasoning items, function call items, and function call output items, since the last `user` message." For advanced truncation: "ensure all items between the last user message and your function call output are passed into the next response untouched." [doc] reasoning guide
2. **Across ordinary turns (no tool call in the turn), reasoning is optional.** Pre-5.6 models (default `current_turn`) do not render earlier-turn reasoning; "including them is harmless, the API will simply discard any reasoning items that aren't relevant" (cookbook). GPT-5.6 / Astra-class models default to `all_turns`, which does render them, so dropping them loses quality and cache hits. [doc]
3. **Simplest correct behaviour: replay the entire `output` array untouched.** "For stateless reasoning-model requests, preserve every item in the response's `output` array." [doc] conversation-state. Migration-guide pitfall: "Dropping reasoning, function call, or function call output Items when manually carrying context into the next response."
4. **Model-family scope.** "Persisted reasoning can be reused only within the same model family. `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` can reuse each other's reasoning, but reasoning does not carry between the GPT-5.6 and GPT-5.5 families. When you switch model families, the API omits incompatible reasoning from the model's context, even when `reasoning.context` is `all_turns`." [doc] reasoning guide. So model A to model B across families should be silently tolerated today. But see errors below for older behaviour.
5. **`reasoning.context`** only has an effect if the request has access to earlier items (via `previous_response_id`, `conversation`, or manually replayed history).

Observed errors [community] (HTTP 400 unless noted, shape `{"error":{"message","type":"invalid_request_error","param":"input","code":null}}`):

| Trigger                                                                                                                                                      | Message                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rs_` item present but the item that followed it in the original output (message / function_call / computer_call / etc.) is missing, reordered, or has no id | `Item 'rs_...' of type 'reasoning' was provided without its required following item.` (forum 1308318, 1151686, 1344988; vercel/ai #8379; openclaw #19582)                                                                                                                                                                                      |
| A `msg_`/`fc_` item replayed (by id) without the `rs_` item that preceded it                                                                                 | `Item 'msg_...' of type 'message' was provided without its required 'reasoning' item: 'rs_...'.` (forum 1344988); same wording for `web_search_call` (LangGraph forum)                                                                                                                                                                         |
| Reasoning item sent to a non-reasoning target (e.g. o4-mini then gpt-4.1)                                                                                    | `Reasoning input items can only be provided to a reasoning or computer use model. Remove reasoning items from your input and try again.` (forum 1266924, May 2025, `param: input`)                                                                                                                                                             |
| Replaying `rs_` (no `encrypted_content`) with `store:false`                                                                                                  | HTTP **404**, `Item with id 'rs_...' not found. Items are not persisted when 'store' is set to 'false'. Try again with 'store' set to 'true', or remove this item from your input.` OpenAI staff reproduced the 404 in March 2026 (forum 1375928); fix: request/return encrypted content and replay verbatim, or drop the plain reasoning item |
| Function call without output                                                                                                                                 | `No tool output found for function call call_...` (well-known; not re-verified this session)                                                                                                                                                                                                                                                   |

Pairing logic, as understood by OpenAI's own client [client]: openai-agents-python's `_drop_reasoning_items_preceding_dropped_calls` states "A reasoning item is considered tied to the next non-reasoning model-emitted item. If that item was dropped, the reasoning item is now dangling and would be rejected by the Responses API with ... `reasoning was provided without its required following item`." The same module prunes orphan tool calls and their reasoning together.

Practical consequences:

- A reasoning item is bound to the **next non-reasoning output item** in the original order. Never reorder, never drop one side, never insert between them.
- A response that ends with a trailing `reasoning` item and nothing after it (typical of `incomplete` with `max_output_tokens`, where reasoning consumed the budget) is an orphan if replayed. [inferred from the pairing rule] Safer: drop trailing reasoning-only tails before replay, or continue with `previous_response_id`.
- Stripping the `rs_` id: the Agents SDK ships `reasoning_item_id_policy="omit"` ("strips reasoning item IDs from model input built by the runner"), implying an id-less reasoning item carrying `encrypted_content` is acceptable. A forum answer says the opposite ("the ID is not something that you can strip"). Conflicting; test before relying on it. [client] [community]
- When switching to a different provider or to a non-reasoning/other-family OpenAI model: drop `reasoning` items and anything else opaque to the new target (`compaction` too, see 4.5), and make sure no kept message/function_call item still points to a stripped reasoning item by id. If unsure, replay as plain role/content messages (no ids). [inferred]

### 3.4 IDs: `rs_`, `fc_`, `msg_`, `call_`, and `store:false`

- Observed prefixes: `resp_` (response), `rs_` (reasoning), `msg_` (message), `fc_` (function_call item id), `call_` (the `call_id` that links `function_call` and `function_call_output`; this is what tools match on), `cu_` (computer call), `ws_` (web search call), `ctc_` (custom tool call), compaction ids vary (`cmp_` in the spec example, `compaction_123` in SDK tests). [spec] [community] [inferred for prefixes not in docs]
- OpenAI's official replay helper `toResponseInputItems` (openai-node `src/lib/responses/ResponseInputItems.ts`) **keeps `id` fields**, including `rs_`/`msg_`/`fc_`, and keeps `status`. It strips only: `created_by` (output-only provenance, on any item), SDK-only `parsed` / `parsed_arguments`, and it **drops** `computer_call_output` with status `failed` and `custom_tool_call_output` that is not `completed` (also strips their `status`/`created_by`). It throws on unknown item types. [client]
- The official docs' stateless examples simply do `history += response.output` with `store:false`. So: with `store:false`, **do not strip ids** and do not use `item_reference` (it cannot resolve; the 404 above). Preserve them verbatim. [doc]
- Easy-message shape `{role:"assistant", content:"..."}` has no id and is accepted as input, so ids are not mandatory for plain messages. But assistant messages that originally followed a reasoning item and are replayed **with** their `msg_` id may trigger the pairing check; with id omitted there is nothing to pair. [community] [inferred]
- Codex (first-party) keeps `id`, `encrypted_content`, `status`, `phase` on replay and even types an optional `encrypted_content` on **message** items that the public SDK schema does not declare, which is a good argument for verbatim passthrough rather than field whitelisting. [client]
- Input-side `ResponseOutputMessage` requires `id` and `status` in the SDK types; `EasyInputMessage` does not. [spec]

## 4. Compaction

Two mechanisms, both ZDR-friendly with `store:false`, both produce an opaque encrypted `compaction` item. [doc] compaction

### 4.1 Server-side compaction (inside `POST /responses`)

Request field (OpenAPI `ContextManagementParam`, array, `minItems: 1`):

```json
"context_management": [{ "type": "compaction", "compact_threshold": 200000 }]
```

- `type`: string, "Currently only 'compaction' is supported." `compact_threshold`: integer, `minimum: 1000`, "Token threshold at which compaction should be triggered for this entry." [spec]
- Behaviour: when the rendered token count crosses the threshold during generation, the server runs a compaction pass, emits a **`compaction` output item in the same response's `output`**, "and prunes context before continuing inference." No separate call needed. Works with `store:false`. [doc]
- Streaming emits `response.compaction.compacting` ("Contains no summary content"). Not relevant to non-streaming.
- Continuing:
  - Stateless: append `response.output` (including `compaction`) to your input array as usual. Optional latency tip: "you can drop items that came before the most recent compaction item". "If you use `previous_response_id` chaining, do not manually prune."
  - Stateful: pass only the new user message with `previous_response_id`.
- Cost effects: first request after compaction reuses less prompt cache (`context_compacted` in cache diagnostics). [doc]
- Incompatible with `configuration_update` and with steering. [doc]

### 4.2 Explicit in-request compaction: `compaction_trigger` input item

`{ "type": "compaction_trigger", "id"?: string }`, an **input-only** item: "Compacts the current context. Must be the final input item." Used inside a normal `/responses` call. Mentioned in the reasoning guide ("You can still explicitly compact history by including a `compaction_trigger` item in a `/responses` request. After compaction, add a fresh `configuration_update`"). Sparse documentation; treat as new. [spec] [doc]

### 4.3 Standalone `POST /v1/responses/compact`

Request (`CompactResponseMethodPublicBody`): `model` (required), `input` (string or item array, up to 131,072 items / 10 MB string), `instructions`, `previous_response_id`, `prompt_cache_key`, `prompt_cache_options`, `prompt_cache_retention` (deprecated), `service_tier`. No `tools`, no `reasoning`, no `store`. [spec] "You send a full context window (messages, tools, and other items)" (so tool-related items in the history are fine). The window sent "must still fit within your model's context window." [doc] "This endpoint is fully stateless and ZDR-friendly."

Response (`CompactedResponse`, `object: "response.compaction"`, **not** a `Response`; no `status`, `model`, or `error`): [spec]

```json
{
  "id": "resp_001",
  "object": "response.compaction",
  "created_at": 1731459200,
  "output": [
    {
      "id": "msg_001",
      "type": "message",
      "role": "user",
      "status": "completed",
      "content": [
        { "type": "input_text", "text": "Summarize our launch checklist from last week." }
      ]
    },
    {
      "id": "msg_002",
      "type": "message",
      "role": "user",
      "status": "completed",
      "content": [
        { "type": "input_text", "text": "You are performing a CONTEXT CHECKPOINT COMPACTION..." }
      ]
    },
    { "type": "compaction", "id": "cmp_001", "encrypted_content": "encrypted-summary" }
  ],
  "usage": {
    "input_tokens": 42897,
    "output_tokens": 12000,
    "total_tokens": 54897,
    "input_tokens_details": { "cached_tokens": 0, "cache_write_tokens": 0 },
    "output_tokens_details": { "reasoning_tokens": 0 }
  }
}
```

- `output` is "a list of all user messages, followed by a single compaction item" (SDK comment) but the guide says it "generally contains more than just the compaction item. It can also include retained items from the previous window." Do not assume the shape; treat it as an ordered list of replayable items.
- **Replay**: "do not prune `/responses/compact` output. The returned window is the canonical next context window, so pass it into your next `/responses` call as-is." Then append the next user message and call `/responses` (typically `store:false`, no `previous_response_id`). In WebSocket mode this starts a new chain: omit `previous_response_id`. [doc]
- Histories containing `configuration_update` items are rejected by `/responses/compact`. [doc]
- Errors documented: 400 ("Invalid compaction request or incompatible input parameters"), 429, 503. [spec] Real-world: compaction itself can fail with context overflow when the window is already too big (codex issue #51368 "Codex ran out of room in the model's context window" during remote compact; opencode #50187). A harness needs a pre-trim fallback. [community]

### 4.4 Input versus output, summarized

| Item                                               | Appears as                                                                                                            | Shape                                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compaction`                                       | **Output** item (in `response.output` for server-side compaction and in `/compact` `output`); **also valid as input** | output: `{id, type:"compaction", encrypted_content, created_by?}` (`ResponseCompactionItem`). input: `{type:"compaction", encrypted_content, id?}` (`ResponseCompactionItemParam`) |
| `compaction_trigger`                               | **Input only**                                                                                                        | `{type:"compaction_trigger", id?}`                                                                                                                                                 |
| retained user `message` items in `/compact` output | Output (role `user`, content `input_text`), replay as input                                                           | `EasyInputMessage`-compatible                                                                                                                                                      |
| `context_management`                               | Request parameter                                                                                                     | see 4.1                                                                                                                                                                            |

### 4.5 Open compaction questions (not answered by any doc I found)

- Is a `compaction` item bound to a specific model/family or org? Not stated. Treat as **non-portable across providers and, to be safe, across models**; when switching, fall back to the harness's own full history (or its own summary). [inferred]
- `compaction_trigger` semantics when `store:true` and when combined with `previous_response_id` are undocumented.
- Whether `usage` on the main response includes the compaction pass tokens for server-side compaction is not stated (the standalone endpoint returns its own `usage`).

## 5. `truncation` and context overflow

- `truncation: "auto" | "disabled" | null`, default `disabled`. `auto`: "If the input to this Response exceeds the model's context window size, the model will truncate the response to fit the context window by dropping items from the beginning of the conversation." `disabled`: "the request will fail with a 400 error." [spec]
- **Deprecated**: both the request and response fields carry `deprecated: true` in OpenAPI and `@deprecated` in openai-node, with no replacement named and no entry on the deprecations page or changelog. Treat as legacy; prefer compaction or harness-side trimming. The reference page still documents it without a deprecation marker. [spec] [doc]
- `truncation:auto` is incompatible with `configuration_update` ("Do not combine configuration updates with automatic compaction or automatic truncation"). Truncating from the front drops the oldest items, which can orphan reasoning/tool pairs [inferred] and defeats prompt caching. Not recommended for a durable harness that wants deterministic logs.
- Overflow error (non-streaming HTTP) [community, consistent across LiteLLM #43013 and others]: HTTP **400**,

```json
{
  "error": {
    "message": "Your input exceeds the context window of this model. Please adjust your input and try again.",
    "type": "invalid_request_error",
    "param": "input",
    "code": "context_length_exceeded"
  }
}
```

Older wording: "This model's maximum context length is N tokens..." (also `context_length_exceeded`). Match on `code`, not message. LiteLLM reports `param: "input"` from a fake-upstream repro, so treat `param` as likely, not certain.

- Via streaming / background / WebSocket the same condition arrives as a failed response with `error.code = "context_length_exceeded"` (Codex test fixtures of `response.failed`). Note the typed `ResponseError.code` enum in the spec does **not** list `context_length_exceeded` (it lists `server_error, rate_limit_exceeded, invalid_prompt, data_residency_mismatch, bio_policy, misalignment_policy_violation, vector_store_timeout, invalid_image*...`), so the enum is incomplete. Never treat unknown codes as invalid_response. [client] [spec]
- Window accounting: context = input + output + reasoning tokens. Reserve space: "reserving at least 25,000 tokens for reasoning and outputs when you start experimenting". If generation hits the window or `max_output_tokens`, the result is `status:"incomplete"`, `incomplete_details.reason:"max_output_tokens"`, possibly with **no visible output** (all reasoning). [doc]
- Limits: GPT-6 Astra: 1,050,000 context, 922,000 max input, 128,000 max output. GPT-5.x mini/nano 400k/128k. o3/o4-mini 200k/100k. [model pages]
- `POST /v1/responses/input_tokens` exists for token counting (OpenAPI path). [spec]

## 6. `background: true`

- Create: `POST /v1/responses` with `background: true` returns immediately with a `Response` whose `status` is `queued` (then `in_progress`) and an empty `output`. [doc] [spec]
- Poll: `GET /v1/responses/{id}`; "Keep polling while the request is in the `queued` or `in_progress` state. When it leaves these states, it has reached a final (terminal) state." Statuses: `queued, in_progress, completed, failed, cancelled, incomplete`. `error` (with `code`/`message`) is set on `failed`; `incomplete_details` on `incomplete`. [doc] [spec]
- Cancel: `POST /v1/responses/{id}/cancel`. "Only responses created with the `background` parameter set to `true` can be cancelled." Idempotent: "Cancelling twice is idempotent - subsequent calls simply return the final `Response` object." To cancel a synchronous response, drop the connection. 404 `ErrorResponse` if missing. [doc] [spec] Error for cancelling a non-background response not documented (expect 400).
- Requirements regarding `store`: **`store:true` is not required.** "Background requests can use `store=false`, but response data is temporarily stored to support asynchronous execution and polling" (about 10 minutes of disk retention). ZDR projects run background with `store=false` and the same ~10-minute window. Modified-Abuse-Monitoring projects keep the response past polling only with explicit `store=true`; omitted/false is deleted after ~10 minutes. [doc] background, your-data. **So a gateway caller must poll within ~10 minutes if store is false.**
- Streaming + background: allowed (`background:true, stream:true`), resume via `GET /responses/{id}?stream=true&starting_after=<seq>`; only works if created with `stream=true`. Higher time to first token than synchronous. Not applicable to our non-streaming design. [doc]
- Webhooks: instead of polling, configure a webhook for `response.completed`, `response.failed`, `response.cancelled`, `response.incomplete`; the payload carries the response id, then you `retrieve` it. Webhooks are per-project, signature-verified (SDKs expose `unwrap` / `InvalidWebhookSignatureError`), delivered to an endpoint the caller controls. [doc] webhooks, [spec]
- Why it matters: reasoning requests at `xhigh`/`max`/pro can run many minutes; OpenAI positions background mode for exactly that: "without having to worry about timeouts or other connectivity issues." [doc]

### How a non-streaming stateless gateway could support it later

1. Keep `complete` semantically "one request, one terminal response". Add `background` to the denylist for `complete` until the retrieve route exists (otherwise `complete` returns a `queued`, empty-output, non-final response that violates its contract). [inferred]
2. Add separate routes, all stateless pass-throughs that only need the caller's credentials and the provider response id: `start` (POST with `background:true`, return `{id, status}`), `retrieve` (GET by id; same extractors as `complete` once terminal; `queued/in_progress` returned as "pending" with a poll hint), `cancel` (POST by id). The harness persists the id in its log, so a reducer can poll from a scheduled/background handler or be woken by a provider webhook. [inferred]
3. Extractors need a `pending` state in addition to the terminal ones.
4. Keep id scoping honest: the id is only valid for the same OpenAI org/project/key.

## 7. `phase`, "pause", "steer", and signals that mean "keep going"

### 7.1 `phase`

- `phase?: "commentary" | "final_answer" | null` on assistant `message` items, both input (`EasyInputMessage`) and output (`ResponseOutputMessage`). "Labels an `assistant` message as intermediate commentary (`commentary`) or the final answer (`final_answer`)." Released Feb 24 2026. [spec] [doc]
- Which models: documented for GPT-5.5 / GPT-5.4 workflows and "models like gpt-5.3-codex and beyond"; absent on older models. It is optional at the API level.
- Rule: "If you replay assistant history manually, preserve each original `phase` value." "Missing or dropped `phase` can cause preambles to be treated as final answers" and "dropping it can degrade performance." Do not add `phase` to user messages. Using `previous_response_id` preserves it automatically. [doc]
- Consequences for extractors: a single response may contain several assistant `message` items (commentary before tool calls, final at the end). "The text of the response" must be chosen deliberately: prefer messages with `phase === "final_answer"`; if no message carries a phase, use all messages; commentary messages are user-visible progress, not the answer. The SDK's convenience `output_text` just concatenates **every** `output_text` part of every message (including commentary); do not use it as "the answer". The multi-agent guide filters `item.phase === "final_answer"` and `item.agent.agent_name === "/root"`. [client] [doc]

### 7.2 "Is the turn finished?" signals (there is no `stop_reason`)

The Responses API has no single finish reason. A harness must derive it from `status`, `incomplete_details`, and `output` content:

| Observation                                                                                                                                                                                                                                               | Meaning                                                                                                                                           | Action                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status: "completed"`, `output` has a client-executed call item without its result (`function_call`, `custom_tool_call`, `computer_call`, `shell_call`, `apply_patch_call`, `local_shell_call`, `mcp_approval_request`, `tool_search_call` (client mode)) | Turn is **paused for the client**. Not an error                                                                                                   | Run the tool, append `*_output` (or `mcp_approval_response`), call again                                                                                                  |
| `status: "completed"`, `output` has `function_call` items with `async: true` (GPT-6 async tools)                                                                                                                                                          | The model **kept working**; a response can contain both a pending async call and a final answer. Result goes back later on the original `call_id` | Track pending async calls per `call_id`, deliver results in a later request (`previous_response_id` = latest response). Do not treat a final message as "no pending work" |
| `status: "completed"`, only messages                                                                                                                                                                                                                      | Normal end                                                                                                                                        | Done                                                                                                                                                                      |
| `status: "incomplete"`, `reason: "max_output_tokens"`                                                                                                                                                                                                     | Hit `max_output_tokens` or the window; may contain only reasoning                                                                                 | Continue with a new request (e.g. `previous_response_id` + a short user nudge / higher cap), or compact. Output may end in an orphan `reasoning` item (see 3.3)           |
| `status: "incomplete"`, `reason: "content_filter"`                                                                                                                                                                                                        | Filtered                                                                                                                                          | Surface as-is                                                                                                                                                             |
| `status: "incomplete"`, `reason: "max_messages"`                                                                                                                                                                                                          | In the enum, undocumented (likely multi-agent related)                                                                                            | Pass through, do not crash on unknown reasons                                                                                                                             |
| `status: "incomplete"`, `reason: "steered"`                                                                                                                                                                                                               | WebSocket-only; a successor response follows automatically                                                                                        | Not reachable over HTTP                                                                                                                                                   |
| `status: "failed"`, `error{code,message}`                                                                                                                                                                                                                 | Generation failed after acceptance                                                                                                                | Classify by `error.code`                                                                                                                                                  |
| `status: "cancelled"`                                                                                                                                                                                                                                     | Background response cancelled                                                                                                                     | `cancelled`                                                                                                                                                               |
| `status: "queued"/"in_progress"`                                                                                                                                                                                                                          | Background only                                                                                                                                   | Not terminal                                                                                                                                                              |

- Steering (`response.steer`, `response.steer.accepted/failed/pending`) is **WebSocket only**, GPT-6 only, not with `conversation` or automatic compaction. A pure HTTP gateway cannot offer it. [doc]
- Async tool pairing detail: when a result is returned, "set `previous_response_id` to the latest response ID, and include the tools and instructions in the continuation request". Results should be delivered **before** the wait-tool status in the same input array. [doc] async-tool-calling
- Multi-agent (beta): HTTP responses complete "once every active agent has either finished or paused to wait for a client-executed function call"; items carry an `agent` field and `multi_agent_call` items "should not be executed or have outputs submitted". Final answer = `/root` messages with `phase: "final_answer"`. Out of scope but extractors that assume one agent will misread it. [doc]

## 8. OpenAI-recommended practices for reasoning-model agent loops, and pitfalls

Recommended by OpenAI [doc]:

1. Prefer the Responses API for reasoning models (better intelligence, caching: 40-80% cache utilization versus Chat Completions in internal tests; Chat Completions does not support function calling with GPT-6 Astra / GPT-6.1 Sol).
2. Pass back reasoning items from the current tool-calling turn (everything since the last user message), untouched. Easiest: `previous_response_id`, or replay the full `output` array.
3. For stateless/ZDR: `store:false`, keep `encrypted_content` (default now; `include` still accepted), replay all output items including `phase`.
4. On `all_turns`-capable models, set `reasoning.context: "all_turns"` and replay complete history to preserve cross-turn reasoning; use `current_turn` to reduce rendered context for long workflows.
5. Reserve token budget for reasoning (`max_output_tokens` >= ~25k when starting) and handle `incomplete`.
6. Use compaction (server-side or standalone) for long runs; keep prefix stable for caching; change effort via `configuration_update` rather than the request-level `reasoning.effort` to preserve cache (GPT-6).
7. Use background mode (or WebSocket) for long reasoning/tool-heavy runs.
8. Preserve `phase` on every assistant message; use `final_answer` to detect completion.
9. Treat `effort` as a tuning knob, not the main quality lever; `xhigh`/`max` only with evals.

Pitfalls (documented or repeatedly reported):

- Dropping, reordering, or splitting reasoning/message/tool-call triples gives the "required following item" family of 400s.
- `previous_response_id` plus a client that also replays items: duplicated context and pairing errors (reported by LangChain users). Use one mechanism per conversation.
- `previous_response_id` with `store:false`, ZDR, expired or deleted responses: `previous_response_not_found`. Also transient right after creation.
- Forgetting that `instructions`/`tools`/`reasoning`/`include` are not inherited.
- `item_reference` with `store:false`: 404 "Items are not persisted".
- Model/family switches: stale reasoning (and probably compaction) items; see 3.3.
- Replaying output-only fields (`created_by`, SDK `parsed`) and failed/non-completed tool outputs. OpenAI's own helper strips/drops them.
- Relying on `output_text` convenience with `phase` commentary present.
- Billing: previous tokens are re-billed; cache writes are billed; >272K prompts get a 2x/1.5x multiplier; reasoning tokens are billed as output.
- Standalone compact input can itself overflow; keep headroom.
- Misalignment monitoring on GPT-6 Astra: monitored conversations (those using persisted reasoning, WebSocket, or OpenAI compaction) can be hard-stopped; see 9.4.

## 9. Implications for our design

### 9.1 What the gateway must do

1. **Pass through verbatim**: `store`, `include`, `previous_response_id`, `conversation`, `context_management`, `truncation`, `reasoning` (`effort`, `summary`, `context`, `mode`), `max_output_tokens`, `max_tool_calls`, `metadata`, `prompt_cache_*`, `service_tier`, `safety_identifier`, `moderation`, `text`, `top_*`, `temperature`, `parallel_tool_calls`, `tool_choice`, and unknown future fields. Never default `store`, never inject `previous_response_id`, never strip fields because they are "new".
2. **Denylist** (confirming the plan): `model`, `input`, `instructions`, `tools`, `stream`. Add `background` for `complete` (see section 6). Considered but not necessary: `conversation` and `previous_response_id` conflict is the provider's job to reject.
3. Return `response.output` **verbatim and in order** as the assistant message. Include `compaction`, `reasoning`, `function_call` (with `async`), `web_search_call`, `mcp_*`, `program`, `multi_agent_call`, etc. Do not whitelist types.
4. Carry back, outside the assistant message, the provider response `id` (so the harness can use `previous_response_id`), `status`, `incomplete_details`, `error`, `usage` (including `cached_tokens`, `cache_write_tokens`, `reasoning_tokens`), `model` (resolved snapshot), `service_tier`, `reasoning` (effective `context`/`mode`), and `prompt_cache_diagnostics` if present. The harness cannot reconstruct these.
5. Surface `Retry-After` and the request id header (`x-request-id`) on errors. [inferred; standard OpenAI headers, Codex reads them]
6. Support the standalone compact as an optional second route (`POST /v1/responses/compact`) later; it is the only compaction path that does not fit inside `complete` (its response is a different object). Server-side compaction (`context_management`) works inside `complete` with no gateway work.
7. Do not parse or validate item contents (encrypted blobs are opaque; unknown item types will keep appearing).

### 9.2 What the gateway must not do

- Must not store, cache, or synthesize anything (including retrying with `previous_response_id` removed on its own). The fallback from `previous_response_not_found` to full history needs the harness's log, so only the harness can do it.
- Must not auto-add `include: ["reasoning.encrypted_content"]` silently if "native is source of truth" is strict. But document that harnesses should add it (3.2).
- Must not strip `created_by`/ids in the response path. Any replay normalization belongs in the SDK conversion helper at request-build time (below), not in the stored message.
- Must not call `DELETE /responses/{id}` or Conversations CRUD.

### 9.3 What conversion helpers / extractors must know

- **Assistant message to input**: `response.output` items replay as input items; strip only the output-only/SDK-only keys OpenAI's own helper strips (`created_by`, `parsed`, `parsed_arguments`), and skip `computer_call_output` with `status:"failed"` and `custom_tool_call_output` not `completed` [client]. Keep `id`, `status`, `phase`, `encrypted_content`, `async`, unknown fields.
- **Same-provider, same-family continuation**: replay everything. **With `previous_response_id`**: send only new items (`function_call_output`s, user message, any `compaction_trigger` / `configuration_update`) and _do not also replay_ earlier items.
- **Fallback to full history** (invalid/expired id, provider/model switch, ZDR): rebuild from the harness log; keep reasoning+`encrypted_content` only for same-family OpenAI targets; otherwise drop `reasoning` and `compaction` and make sure no remaining item references them. On a non-reasoning OpenAI target keep nothing reasoning-related (error 3.3). Assistant messages replayed without their reasoning should ideally lose their `msg_`/`fc_` ids or be turned into role/content messages. [inferred; verify]
- **Trailing orphan**: if the last output items are `reasoning` with nothing following (typical `incomplete`), drop them before replaying statelessly.
- **Final text extraction**: filter on `phase`; do not use SDK `output_text`; refusals appear as `refusal` content parts; handle several assistant messages per response.
- **Pending-work detection**: unanswered `function_call`/`custom_tool_call`/`computer_call`/`shell_call`/`apply_patch_call`/`mcp_approval_request`; `async: true` calls stay pending across final answers; every `call_id` needs exactly one output.
- **Input-only item types for `native` messages**: `function_call_output`, `custom_tool_call_output`, `computer_call_output`, `mcp_approval_response`, `compaction_trigger`, `configuration_update`, `item_reference` (only valid with `store:true`), `tool_search_output`, `program_output`, `additional_tools`. `compaction` is valid in both directions. `configuration_update` must not be adjacent to another one and is rejected with auto compaction/truncation.
- **Usage**: `input_tokens` already includes cached and cache-write tokens; `output_tokens` includes reasoning tokens (`output_tokens_details.reasoning_tokens`).
- **Effort validation**: do not validate effort in the gateway (per-model support changes monthly; `none`/`minimal` on the wrong model is a provider 400).

### 9.4 Error classification (our kinds)

| Provider signal                                                                                                                                                           | HTTP                                | `type` / `code`                                        | Our kind                          | Notes                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad key, bad org, IP not allowed                                                                                                                                          | 401                                 | `invalid_api_key`, etc.                                | `auth`                            | Also 403 "Country, region, or territory not supported" (`auth`)                                                                                                                                                                                     |
| `previous_response_not_found`                                                                                                                                             | 400                                 | `invalid_request_error`, `param: previous_response_id` | `not_found`                       | Keep provider code in the error so the harness can fall back to full history; retry briefly first (eventual consistency)                                                                                                                            |
| "Item with id ... not found. Items are not persisted when `store` is false"                                                                                               | 404                                 | (type/code unverified)                                 | `not_found`                       | Distinct recoverable case: strip the unresolvable item / use encrypted reasoning                                                                                                                                                                    |
| `GET`/cancel of unknown response id                                                                                                                                       | 404                                 |                                                        | `not_found`                       |                                                                                                                                                                                                                                                     |
| `context_length_exceeded`                                                                                                                                                 | 400                                 | `invalid_request_error`, `param: input`                | `context_overflow`                | Also as `response.failed` / `error.code` in streaming and background                                                                                                                                                                                |
| Reasoning pairing errors ("without its required following item", "without its required 'reasoning' item", "Reasoning input items can only be provided to a reasoning...") | 400                                 | `invalid_request_error`, `param: input`                | `invalid_request`                 | Message-pattern only (`code` is null). Recoverable by sanitizing history; the SDK may want a sub-code such as `history_invalid`                                                                                                                     |
| Other invalid params (`reasoning.effort` unsupported, `none` on Astra, bad `compact_threshold`, `conversation`+`previous_response_id`)                                    | 400                                 | `invalid_request_error`                                | `invalid_request`                 |                                                                                                                                                                                                                                                     |
| `invalid_prompt`, `invalid_image*`, `image_*`, `data_residency_mismatch` in `response.error` or 400                                                                       | 400 / 200+failed                    |                                                        | `invalid_request`                 |                                                                                                                                                                                                                                                     |
| `rate_limit_exceeded`, `slow_down`                                                                                                                                        | 429 (or 503 `slow_down`, see Codex) | `rate_limit_error`                                     | `rate_limited`                    | Honor `Retry-After`; message contains "try again in 11.054s"                                                                                                                                                                                        |
| `insufficient_quota`, `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded`                | 429                                 | `insufficient_quota` type                              | `quota_exceeded`                  | Not retryable; must be told apart from `rate_limited` by `code`, since the HTTP status is identical                                                                                                                                                 |
| `server_is_overloaded`                                                                                                                                                    | 503                                 | `service_unavailable_error`                            | `overloaded`                      | `Retry-After` present                                                                                                                                                                                                                               |
| `server_error`                                                                                                                                                            | 500 (or `response.error`)           |                                                        | `provider_error`                  | Retry                                                                                                                                                                                                                                               |
| `vector_store_timeout` (response error)                                                                                                                                   |                                     |                                                        | `timeout` or `provider_error`     |                                                                                                                                                                                                                                                     |
| `bio_policy`, `cyber_policy`, `misalignment_policy_violation`                                                                                                             | 403 / 400 / in `response.error`     |                                                        | `invalid_request` (non-retryable) | **Misfit**: we have no content-policy kind. `misalignment_policy_violation` also means "stop the whole conversation; do not auto-retry" and has no resume path, so a retrying harness could loop. Preserve provider code and `misalignment` details |
| `status: "incomplete"`                                                                                                                                                    | 200                                 | `max_output_tokens`, `content_filter`, `max_messages`  | not an error                      | Return normally with a stop reason                                                                                                                                                                                                                  |
| `status: "failed"` with no HTTP error                                                                                                                                     | 200                                 |                                                        | map by `error.code`               | Must be handled in `complete` as well as `retrieve`                                                                                                                                                                                                 |
| `status: "cancelled"`                                                                                                                                                     | 200                                 |                                                        | `cancelled`                       | Background only                                                                                                                                                                                                                                     |
| Unparseable body / missing `output`                                                                                                                                       |                                     |                                                        | `invalid_response`                |                                                                                                                                                                                                                                                     |
| Fetch failure / abort                                                                                                                                                     |                                     |                                                        | `network_error` / `timeout`       | Long reasoning calls can legitimately take many minutes                                                                                                                                                                                             |

### 9.5 Things that do not fit the design cleanly

1. **`previous_response_id` / `conversation` / `background` make the provider a state store**, conflicting with "harness owns the log". The harness must keep the full history anyway for fallback; the SDK should make "send only deltas" easy but never assume the id is valid.
2. **Provider-specific hidden state, not representable portably**: `compaction` items, encrypted reasoning, `reasoning.context`, `configuration_update`, async calls. A harness switching provider or model must rebuild from its own log, so the harness needs its own summarization path for the non-OpenAI case. The gateway cannot translate these.
3. **`complete` has no representation for a non-terminal response** (`queued`/`in_progress`) or for the standalone `compact` object. These need extra routes later.
4. **Stop reason is not a single field** (3.2/7.2). Our normalized "finish" needs to be derived from `status`, `incomplete_details`, pending call detection, and async flags. Async tools in particular mean "response complete" does not equal "no pending work".
5. **HTTP-level success can carry a failed response**; status and error code must be inspected even on 200.
6. **No content-policy error kind** (see table).
7. **ZDR cannot be detected** from a response (no `store` echo in the typed schema), so a harness that sets `store:true` under a ZDR org learns only on the next call when `previous_response_not_found` appears. Mitigation: harnesses should always keep full history and treat id-chaining as an optimization.
8. **WebSocket-only features** (steering, `steered`, connection-local cache) are not reachable through a stateless HTTP gateway. Docs increasingly present WebSocket as the recommended transport for tool-heavy GPT-6 flows ("WebSocket is likely to provide lower latency"); an HTTP-only design gives up that latency, accepted trade-off.
9. **Output-only fields in outputs** (`created_by`) mean "replay verbatim" is slightly untrue; one tiny normalization at request-build time is needed.
10. **Beta surface drift**: multi-agent items and `?beta=true` operations/headers may change; passthrough should tolerate unknown item types and `agent` fields.

### 9.6 Items to verify empirically before locking the design (cheap live tests)

1. Exact 400/404 bodies (type, param, code) for: `previous_response_not_found`, "Items are not persisted", `context_length_exceeded`, reasoning pairing errors, `conversation` + `previous_response_id`, cancelling a non-background response.
2. Whether `store:false` replay works with reasoning items with `id` stripped (Agents SDK `omit` policy) versus kept; and with `msg_`/`fc_` ids kept or stripped when the `rs_` is dropped.
3. Whether `encrypted_content` is returned with `store:true` and with no `include` on older models; keep the explicit include.
4. Cross-family / cross-model replay of `reasoning` and `compaction` items (error or silent omission).
5. Whether a sync, non-streaming call can return HTTP 200 with `status:"failed"` or always an HTTP error.
6. Whether `compaction_trigger` works with `store:false`, and with `previous_response_id`.
7. Background: `store` omitted vs false; poll window ~10 min behaviour; cancel on non-background.

## 10. Sources

OpenAI docs (markdown variants, fetched 2026-10-11):

- Conversation state: https://developers.openai.com/api/docs/guides/conversation-state
- Compaction: https://developers.openai.com/api/docs/guides/compaction
- Reasoning models (effort, summary, context, encrypted content, phase, configuration_update): https://developers.openai.com/api/docs/guides/reasoning
- Reasoning best practices: https://developers.openai.com/api/docs/guides/reasoning-best-practices
- Background mode: https://developers.openai.com/api/docs/guides/background
- Your data (retention, ZDR, per-endpoint table): https://developers.openai.com/api/docs/guides/your-data
- Function calling: https://developers.openai.com/api/docs/guides/function-calling
- Async tool calling: https://developers.openai.com/api/docs/guides/async-tool-calling
- Mid-turn steering: https://developers.openai.com/api/docs/guides/steering
- WebSocket mode: https://developers.openai.com/api/docs/guides/websocket-mode
- Migrate to the Responses API: https://developers.openai.com/api/docs/guides/migrate-to-responses
- Prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- Multi-agent (beta): https://developers.openai.com/api/docs/guides/responses-multi-agent
- Misalignment monitoring: https://developers.openai.com/api/docs/guides/safety-checks/misalignment-monitoring
- Webhooks: https://developers.openai.com/api/docs/guides/webhooks
- Error codes: https://developers.openai.com/api/docs/guides/error-codes
- Using GPT-6: https://developers.openai.com/api/docs/guides/latest-model
- Changelog: https://developers.openai.com/api/docs/changelog ; Deprecations: https://developers.openai.com/api/docs/deprecations
- Model pages (effort support, context windows): https://developers.openai.com/api/docs/models/gpt-6-astra (and `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`, `gpt-5.2`, `gpt-5.1`, `o3`)
- API reference, create response: https://developers.openai.com/api/reference/resources/responses/methods/create ; compact: https://developers.openai.com/api/reference/resources/responses/methods/compact
- Cookbook (archived, o3/o4-mini era): https://developers.openai.com/cookbook/examples/responses_api/reasoning_items

Specs and source (cloned `--depth 1`):

- OpenAPI: https://github.com/openai/openai-openapi (`openapi.yaml`, commit of 2026-10-09). Schemas used: `CreateResponse`, `BetaCreateResponse`, `Response`, `ResponseError`, `Reasoning`, `ContextManagementParam`, `CompactResponseMethodPublicBody`, `CompactResource`, `CompactionBody`, `CompactionTriggerItemParam`, `ConversationParam`, `CreateConversationBody`; paths `/responses`, `/responses/{id}`, `/responses/{id}/cancel`, `/responses/compact`, `/conversations*`.
- openai-node: https://github.com/openai/openai-node (`src/resources/responses/responses.ts`, `src/resources/shared.ts`, `src/lib/responses/ResponseInputItems.ts`).
- openai-agents-python (reasoning pairing and id policy): https://github.com/openai/openai-agents-python (`src/agents/run_internal/items.py`, `run_config.py`).
- Codex CLI (error mapping, item replay): https://github.com/openai/codex (`codex-rs/codex-api/src/sse/responses_error.rs`, `api_bridge.rs`, `protocol/src/models.rs`).

Community / third-party reports (behavioural evidence, not contract):

- "Item 'rs_' ... without its required following item": https://community.openai.com/t/error-item-rs-of-type-reasoning-was-provided-without-its-required-following-item/1308318 ; https://community.openai.com/t/how-to-solve-gpt-5-reasoning-error-without-previous-response-id-item-of-type-reasoning-was-provided-without-its-required-following-item/1344988 ; https://community.openai.com/t/how-to-solve-badrequesterror-400-item-rs-of-type-reasoning-was-provided-without-its-required-following-item-error-in-responses-api/1151686 ; https://community.openai.com/t/one-potential-cause-of-item-rs-xx-of-type-reasoning-was-provided-without-its-required-following-item-error-stateless-using-agents-sdk/1370540
- `store:false` replay 404 and staff reproduction: https://community.openai.com/t/store-false-breaks-multi-turn-computer-use/1375928 ; https://community.openai.com/t/using-openai-playground-web-platform-to-test-responses-api-with-file-search-results-in-error/1354943
- Reasoning to non-reasoning model error: https://community.openai.com/t/using-previous-response-id-fails-when-swapping-from-reasoning-non-reasoning-models/1266924
- Intermittent `previous_response_not_found`: https://community.openai.com/t/responses-previous-response-id-reliable/1362365 ; https://github.com/microsoft/semantic-kernel/issues/13128 ; https://github.com/dotnet/extensions/issues/7704 ; https://github.com/microsoft/vscode/issues/316747
- Conversations and `store:false`: https://community.openai.com/t/conversations-issue-with-store-false-an-issue-to-be-rectified/1358465
- `context_length_exceeded` body: https://github.com/BerriAI/litellm/issues/43013
- Compaction overflow: https://github.com/openai/codex/issues/51368 ; https://github.com/anomalyco/opencode/issues/50187
