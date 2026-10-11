# OpenAI Responses API: tools (research for the multi-provider LLM library)

Research date: 2026-10-11. Scope: every tool type reachable through `POST /v1/responses`, the call/result item shapes, replay rules, `tool_choice` / `parallel_tool_calls` / `max_tool_calls`, strict-mode schema rules, and implications for our design (stateless gateway, one non-streaming `complete` endpoint, native-verbatim assistant output, `providerOptions` passthrough, shared `FunctionTool` / `CustomTool` / `tool_result` / `native` shapes).

## 0. Sources and how they were checked

Primary (authoritative for shapes):

- openai-node `v7.32.0`, cloned `--depth 1` at commit `3add47071b68a05935b25d17044951a19f59c602` (2026-10-11). Files: `src/resources/responses/responses.ts` (stable types), `src/resources/beta/responses/responses.ts` (beta types: multi-agent items, `max_tool_calls`), `src/resources/shared.ts` (`CustomToolInputFormat`). Generated from the OpenAPI spec, so these are the best proxy for the spec.
- API reference, Markdown build: https://developers.openai.com/api/reference/resources/responses/methods/create.md (and `.../create` in HTML). Fetched in full (~500 KB).
- Guides, all fetched as Markdown by appending `.md`:
  - Function calling (+ custom tools, grammars, namespaces): https://developers.openai.com/api/docs/guides/function-calling
  - Tools overview: https://developers.openai.com/api/docs/guides/tools
  - Web search: https://developers.openai.com/api/docs/guides/tools-web-search
  - File search: https://developers.openai.com/api/docs/guides/tools-file-search
  - Code interpreter: https://developers.openai.com/api/docs/guides/tools-code-interpreter
  - Image generation tool: https://developers.openai.com/api/docs/guides/tools-image-generation
  - Computer use: https://developers.openai.com/api/docs/guides/tools-computer-use and https://developers.openai.com/api/docs/guides/tools-computer-use-integration
  - Remote MCP / connectors: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
  - Shell: https://developers.openai.com/api/docs/guides/tools-shell ; legacy local shell: https://developers.openai.com/api/docs/guides/tools-local-shell
  - Apply patch: https://developers.openai.com/api/docs/guides/tools-apply-patch
  - Tool search: https://developers.openai.com/api/docs/guides/tools-tool-search
  - Programmatic tool calling: https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling
  - Async tool calling: https://developers.openai.com/api/docs/guides/async-tool-calling
  - Skills: https://developers.openai.com/api/docs/guides/tools-skills
  - Multi-agent (beta): https://developers.openai.com/api/docs/guides/responses-multi-agent
  - Structured outputs (supported schema subset): https://developers.openai.com/api/docs/guides/structured-outputs
  - Conversation state: https://developers.openai.com/api/docs/guides/conversation-state ; reasoning (stateless replay, `phase`): https://developers.openai.com/api/docs/guides/reasoning
  - Migrate to Responses: https://developers.openai.com/api/docs/guides/migrate-to-responses
  - Pricing: https://developers.openai.com/api/docs/pricing ; deprecations: https://developers.openai.com/api/docs/deprecations ; data controls: https://developers.openai.com/api/docs/guides/your-data
  - Model page for the current flagship: https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra

Caveat that matters for the design: the guides are ahead of the generated SDK/reference in places (section 13 lists the discrepancies). Several documented web-search options exist only in the guide, not in the node types. This is direct evidence that `providerOptions` passthrough (rather than hand-typing every field) is the right approach.

Models mentioned in current docs: GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol/Luna, GPT-5.6 family (Terra etc.), GPT-5.5, 5.4, 5.2, 5.1. Do not hard-code a model matrix; pass through and let the API 400.

---

## 1. The big picture (what is new vs. the 2025 Responses API)

Things that are new or changed and that the design must not be surprised by:

1. `computer` (GA) replaced `computer_use_preview`. GA `computer_call` carries a batched `actions[]` array (preview carried one `action`). `computer-use-preview` model shut down 2026-07-23 (deprecations page). `computer_use_preview` tool still exists in the type union but the model it was built for is gone.
2. Legacy `local_shell` tool is dead: `codex-mini-latest` removed 2026-02-12. Replaced by `shell` with `environment: {type:'local'}` (caller executes) or `container_auto` / `container_reference` (OpenAI executes). Both use the same `shell_call` / `shell_call_output` items.
3. `apply_patch` (caller-executed file diffs) and `shell` are first-class, caller-or-hosted tools.
4. `tool_search` (hosted or client-executed) + `defer_loading` + `namespace` tool grouping (gpt-5.4+).
5. Programmatic Tool Calling (PTC): the model writes JavaScript (`program` item) which calls your tools; nested calls carry `caller: {type:'program', caller_id}` and results MUST echo `caller`. Tool flag `allowed_callers`.
6. Async tools (GPT-6 Astra+): `async: true` on function/custom tools; the model keeps going without the result, and the result may be delivered in a later request. A response can therefore end "completed" with a final message AND unresolved async calls.
7. `output_schema` on function tools (describes the JSON string in the result; used by PTC).
8. Assistant message `phase` (`commentary` | `final_answer`) must be preserved on replay; it drives "is this a final answer" logic in agent loops.
9. Reasoning items now carry `encrypted_content` by default when stateless (`store:false` or ZDR); `include:['reasoning.encrypted_content']` is legacy but still accepted.
10. `connector_id` MCP connectors are deprecated for models released after 2026-09-01; use `server_url` or `tunnel_id` (Secure MCP Tunnel).
11. Multi-agent mode (beta, `OpenAI-Beta: responses_multi_agent=v1`): hosted `multi_agent_call` / `agent_message` items. Not caller-executed.
12. There is no "requires_action" status anywhere. A response that is waiting on you is just `status: "completed"` whose `output` contains unresolved calls.

---

## 2. Cross-cutting request parameters

### 2.1 `tools`

`tools: Array<Tool>` where `Tool` is (SDK `Tool` union, reference `tools`):

`function` | `file_search` | `computer` | `computer_use_preview` | `web_search` (and `web_search_2025_08_26`) | `mcp` | `code_interpreter` | `programmatic_tool_calling` | `image_generation` | `local_shell` (dead) | `shell` | `custom` | `namespace` | `tool_search` | `web_search_preview` (and `_2025_03_11`) | `apply_patch`.

Definitions are internally tagged (`{type:'function', name, ...}`), not Chat Completions' `{type:'function', function:{...}}`.

Common optional fields on caller-executed tool definitions (function, custom, mcp, code_interpreter, shell, apply_patch):

- `allowed_callers?: ('direct'|'programmatic')[] | null` (omitted = `['direct']`). Needed to let PTC programs call the tool.
- `defer_loading?: boolean` (function, custom, mcp; used with `tool_search`).
- `async?: boolean` (function, custom only; GPT-6 Astra+; do not combine with PTC).

### 2.2 `tool_choice`

Type (`ResponseCreateParams.tool_choice`, and echoed on the `Response`):

```ts
type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'allowed_tools'; mode: 'auto' | 'required'; tools: Array<Record<string, unknown>> }
  | { type: 'function'; name: string }
  | { type: 'custom'; name: string }
  | { type: 'mcp'; server_label: string; name?: string | null }
  | {
      type:
        | 'file_search'
        | 'web_search_preview'
        | 'web_search_preview_2025_03_11'
        | 'computer'
        | 'computer_use_preview'
        | 'computer_use'
        | 'code_interpreter'
        | 'image_generation'
        | 'mcp';
    } // ToolChoiceTypes (hosted)
  | { type: 'shell' }
  | { type: 'apply_patch' }
  | { type: 'programmatic_tool_calling' };
```

Notes:

- `allowed_tools.tools` is a list of partial tool references, e.g. `[{type:'function',name:'get_weather'},{type:'mcp',server_label:'deepwiki'},{type:'image_generation'}]`. Purpose per the guide: restrict what can be called without changing the `tools` array, to preserve prompt caching.
- `'none'` imitates passing no tools. `'required'` = must call one or more tools.
- `ToolChoiceTypes.type` does NOT list `web_search` (only `web_search_preview*`), yet the web-search guide says "use `tool_choice: 'required'` or a specific web search tool choice when search must run". Whether `{type:'web_search'}` is accepted is unverified here; treat as passthrough and let the API decide.
- With tool search, `tool_choice` applies to tools currently callable in that turn.
- Forced `custom` vs `function` are different `type`s: a shared "force tool X" option needs to know which kind X is (the gateway has the tools list, so it can resolve).

### 2.3 `parallel_tool_calls`

`boolean | null`. Default true. `false` => zero or one tool call per turn ("ensures exactly zero or one tool is called"). Per the function-calling guide: from GPT-5 on, functions can be called in parallel when built-in tools are also available, but built-in tools cannot be part of a parallel function-call batch. Fine-tuned models: strict mode is disabled for calls when several are made in one turn. Multi-agent: do not combine async tools with parallel tool calls. Echoed on the response as `parallel_tool_calls: boolean`.

### 2.4 `max_tool_calls`

`number | null`. "Maximum number of total calls to **built-in tools** that can be processed in a response. Applies across all built-in tool calls, not per tool. Any further attempts to call a tool by the model will be ignored." Does not bound your own function calls. Present in the API reference body params for create; in the node SDK it appears only in the beta types and the WebSocket create event, not in the stable `ResponseCreateParamsBase` (SDK lag). Echoed on the `Response` as `max_tool_calls`. Pass through via `providerOptions`.

### 2.5 `include`

Allowed values (`ResponseIncludable`, identical in stable and beta):

| value                                   | effect                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search_call.action.sources`        | full list of consulted URLs on `web_search_call.action.sources` (more than the cited ones; includes `oai-sports`, `oai-weather`, `oai-finance` feed labels) |
| `web_search_call.results`               | raw results, used for web image search (`results[]` of `image_result`)                                                                                      |
| `code_interpreter_call.outputs`         | populate `code_interpreter_call.outputs` (logs, images); null otherwise                                                                                     |
| `file_search_call.results`              | populate `file_search_call.results` (null otherwise)                                                                                                        |
| `computer_call_output.output.image_url` | return image URLs on computer call outputs                                                                                                                  |
| `message.input_image.image_url`         | return image URLs of input images                                                                                                                           |
| `message.output_text.logprobs`          | logprobs (not supported with GPT-6 reasoning efforts other than `none`)                                                                                     |
| `reasoning.encrypted_content`           | legacy: reasoning items get `encrypted_content`. Now returned by default when stateless                                                                     |

### 2.6 `store`, `previous_response_id`, `conversation`

- `store` defaults to true (30-day retention). ZDR orgs force `store=false`.
- `previous_response_id`: continue from stored response. NOT inherited: `tools`, `instructions`, MCP `authorization`/`headers`. Resend them every request. Cannot be combined with `conversation`.
- `conversation`: server-persisted item list.
- `truncation` is deprecated (`@deprecated` in the SDK); `computer` GA no longer needs `truncation:'auto'`.

---

## 3. Replay rules (what must be sent on the next turn)

### 3.1 `store:false` (stateless; our gateway's natural mode)

- Replay the complete `response.output` array, in order, verbatim, then append new input items. This keeps: `reasoning` items (with `encrypted_content`), assistant `message` items (with `phase`), `function_call` / `custom_tool_call`, all hosted-call items (`web_search_call`, `file_search_call`, `code_interpreter_call`, `image_generation_call`, `mcp_list_tools`, `mcp_call`, `mcp_approval_request`, `shell_call` + `shell_call_output`, `program` + `program_output`, `tool_search_call` + `tool_search_output`, `additional_tools`, `compaction`).
- Every output item type has a matching input form in the `ResponseInputItem` union (checked in the SDK), so verbatim replay type-checks. (Exception: beta multi-agent items have beta input forms.)
- Reasoning guidance verbatim from the function-calling flow: pass back any reasoning items returned with the last function call; if the model made several consecutive calls, pass back all reasoning, function call, and function call output items since the last user message.
- Do not use `item_reference` (needs stored items).
- A response produced with `store:true` has reasoning items WITHOUT `encrypted_content` (id only); replaying those in a later `store:false` request is not self-contained. Keep `store` consistent across a conversation, or force `store:false` from turn one (my inference from the docs: stateless mode is what makes `encrypted_content` appear by default).
- Large payloads: `image_generation_call.result` is a base64 image (can be megabytes) and must be replayed in full when stateless. `computer_call_output` screenshots likewise.
- PTC: replay every `program`, reasoning, `function_call`, `function_call_output`, `program_output` item in order (docs); `program.fingerprint` is an opaque replay token that "must be round-tripped".
- Tool search: replay `tool_search_call` and `tool_search_output` so later `function_call`s to deferred tools are valid. `additional_tools` items are position-sensitive ("preserve the item's position").
- Code interpreter: `container_id` in the call item; `container: {type:'auto'}` reuses an active container used by a previous `code_interpreter_call` in context. Containers expire after 20 min idle; state is lost.

### 3.2 `previous_response_id` (stored)

- Send only the new items (`function_call_output`, `custom_tool_call_output`, `computer_call_output`, `shell_call_output`, `apply_patch_call_output`, `mcp_approval_response`, `tool_search_output`, `local_shell_call_output`, plus new user messages).
- Resend `tools`, `instructions`, MCP `authorization`, container refs. Prior assistant `phase` is preserved server-side.
- All earlier tokens in the chain are still billed as input.
- Async tools: set `previous_response_id` to the latest response id but keep the ORIGINAL `call_id` on late results.

### 3.3 Verbatim vs. what the caller must add

Everything the model emits stays verbatim. The caller only adds result items. Result items reference calls by `call_id` (function, custom, computer, shell, apply_patch, tool_search client, local_shell [see quirk below]) or `approval_request_id` (MCP).

---

## 4. Function tools (caller-executed)

### 4.1 Definition

```ts
interface FunctionTool {
  // SDK FunctionTool
  type: 'function';
  name: string;
  parameters: object | null; // JSON Schema (required key in the type; may be null)
  strict: boolean | null; // required key in the type, but the API treats omission specially (see 4.5)
  description?: string | null;
  allowed_callers?: ('direct' | 'programmatic')[] | null;
  async?: boolean; // GPT-6 Astra+
  defer_loading?: boolean; // tool search
  output_schema?: object | null; // JSON Schema of the JSON encoded in the string result (PTC)
}
```

Guide's example: `{type:'function', name:'get_weather', description:..., parameters:{type:'object', properties:{...}, required:[...], additionalProperties:false}, strict:true}`.

Guidance: aim for < ~20 functions at turn start (soft), function defs count as input tokens.

### 4.2 Call in `output`

```json
{
  "type": "function_call",
  "id": "fc_12345xyz",
  "call_id": "call_12345xyz",
  "name": "get_weather",
  "arguments": "{\"location\":\"Paris, France\"}",
  "status": "completed"
}
```

Full type (`ResponseFunctionToolCall`): `arguments: string` (JSON-encoded string, must be parsed; not validated when `strict` is false), `call_id: string`, `name: string`, `type: 'function_call'`, optional `id`, `status` ('in_progress'|'completed'|'incomplete'), `namespace?: string`, `async?: boolean`, `caller?: {type:'direct'} | {type:'program', caller_id}`; `created_by` appears on the Item (list) form.

`id` (`fc_...`) is the item id in the OpenAI platform (used for `item_reference`, streaming `item_id`). `call_id` (`call_...`) is the correlation key for results. Always use `call_id` for results.

A response can contain zero, one, or many function calls. Parallel by default.

### 4.3 Result (input item)

```ts
interface FunctionCallOutput {
  // ResponseInputItem.FunctionCallOutput
  type: 'function_call_output';
  call_id?: string | null; // effectively required
  output: string | Array<InputTextContent | InputImageContent | InputFileContent>;
  caller?: { type: 'direct' } | { type: 'program'; caller_id: string } | null; // MUST echo for PTC calls
  name?: string | null;
  namespace?: string | null;
  id?: string | null;
  status?: 'in_progress' | 'completed' | 'incomplete' | null;
}
```

Content parts (all with optional `prompt_cache_breakpoint`):

- `{type:'input_text', text}`
- `{type:'input_image', image_url? (https URL or data: URL), file_id?, detail?: 'low'|'high'|'auto'|'original'}`
- `{type:'input_file', file_data? (base64), file_id?, file_url?, filename?, detail?: 'auto'|'low'|'high'}`

So yes: images and files ARE allowed in function outputs (and in `custom_tool_call_output`, whose array type is the older `ResponseInputText | ResponseInputImage | ResponseInputFile`). The guide says output "should typically be a string, where the format is up to you" and "for functions that return images or files, you can pass an array". No `is_error` field exists; errors are conveyed as text (docs: "success"/failure strings; error codes). Computer-use docs require `detail:'original'` on screenshots returned via function outputs.

If the function has no return value, return a success string (docs).

### 4.4 Status, server-side, replay

Statuses on the call: `in_progress | completed | incomplete`. Caller-executed: the response ends (status `completed`) and you must run it. Replay: stateless => the `function_call` item verbatim (with its `reasoning` neighbors) + `function_call_output`; stored => just the output(s). Unresolved synchronous call in the next request is an API error (standard 400; I did not find the exact string in the docs, so treat as expected behavior, not documented guarantee). Async calls are the documented exception (section 8).

### 4.5 Strict mode and schema restrictions

Docs (function-calling + structured-outputs):

- `strict: true` requires: every object has `additionalProperties:false`; every key of `properties` is in `required`. Optional fields are modeled as `type: ['string','null']`.
- `strict` omitted on Responses: the API attempts to normalize the schema into strict mode and, if it cannot, silently falls back to non-strict best-effort; the resolved tool echoes `strict:false` (and `true` when normalized). Chat Completions default is non-strict. Set `strict:false` to opt out explicitly.
- `strict:true` with an incompatible schema => request rejected with details.
- Supported types: string, number, boolean, integer, object, array, enum, `anyOf`. Root must be an object (not `anyOf`).
- String: `pattern`, `format` in {date-time, time, date, duration, email, hostname, ipv4, ipv6, uuid}. (`minLength`/`maxLength` are not listed as supported.) Number: `multipleOf`, `maximum`, `exclusiveMaximum`, `minimum`, `exclusiveMinimum`. Array: `minItems`, `maxItems`. `$defs` / `$ref` and recursion (`#`) supported. `const` appears in the size-limit text (supported).
- Not supported: `allOf`, `not`, `dependentRequired`, `dependentSchemas`, `if`/`then`/`else`. `oneOf` is not listed (treat as unsupported). Fine-tuned models additionally lose the string/number/array constraint keywords and `patternProperties`, and strict is disabled on multi-call turns.
- Limits: up to 5000 object properties total, 10 levels nesting; total string length of property names, definition names, enum values, const values <= 120,000 chars; up to 1000 enum values total (and 15,000 chars for one enum with > 250 values).
- Keys are emitted in schema order.
- Model caveat in the docs: fine-tuned model schemas are cached on first use and are not ZDR-eligible.

---

## 5. Custom tools (caller-executed, free-form text)

### 5.1 Definition

```ts
interface CustomTool {
  // SDK CustomTool; format is Shared.CustomToolInputFormat
  type: 'custom';
  name: string;
  description?: string;
  format?: { type: 'text' } | { type: 'grammar'; syntax: 'lark' | 'regex'; definition: string };
  allowed_callers?: ('direct' | 'programmatic')[] | null;
  async?: boolean;
  defer_loading?: boolean;
}
```

This is exactly our `CustomTool` shape (name, description, format text|grammar lark|regex). Our shape lacks `allowed_callers`, `async`, `defer_loading`; those go in the tool's `providerOptions`.

Grammar rules (docs):

- Lark: sampling constrained with LLGuidance; terminal regexes are Rust-regex syntax, not Python `re`. Unsupported: lookarounds in lexer regexes, lazy modifiers (`*?` `+?` `??`) in lexer regexes, terminal priorities, templates, imports other than built-in `%import common`, `%declare`. Keep grammars small; free text between anchors must be a single terminal; avoid open-ended `%ignore`; API may reject overly complex grammars.
- Regex: no lookarounds, no lazy modifiers, single line (use `\n`), plain pattern string without `//` delimiters.

### 5.2 Call in `output`

```json
{
  "id": "ctc_6890e975e86c...",
  "type": "custom_tool_call",
  "status": "completed",
  "call_id": "call_aGiFQkRWSWAIsMQ19fKqxUgb",
  "name": "code_exec",
  "input": "print(\"hello world\")"
}
```

`input` is the raw string (not JSON). Type `ResponseCustomToolCall`: `call_id`, `input`, `name`, `type`, optional `id`, `async`, `caller` (direct|program), `namespace`. Item form adds `status` ('in_progress'|'completed'|'incomplete') and `created_by`.

### 5.3 Result

```ts
interface CustomToolCallOutput {
  // ResponseCustomToolCallOutput
  type: 'custom_tool_call_output';
  call_id: string;
  output: string | Array<InputText | InputImage | InputFile>;
  id?: string;
  caller?: { type: 'direct' } | { type: 'program'; caller_id: string } | null;
}
```

Same pairing/replay rules as functions (the guide does not print a custom-output example; shape is from the SDK/reference). `custom` in `tool_choice`: `{type:'custom', name}`.

---

## 6. Namespaces and tool search (grouping / deferral)

### 6.1 Namespace

```ts
interface NamespaceTool {
  type: 'namespace';
  name: string;
  description: string;
  tools: Array<FunctionLike | CustomTool>;
} // FunctionLike: {type:'function', name, description?, parameters?, strict?, defer_loading?, async?, output_schema?, allowed_callers?}
```

`defer_loading` applies to the functions inside, not to the namespace. Mix of deferred and eager is allowed. Guidance: keep each namespace < 10 functions; keep the namespace description short. In output, a function call to a namespaced function carries `namespace: "crm"` (and `name: "list_open_orders"`). Name uniqueness is therefore per namespace: two namespaces can both expose `search`.

### 6.2 `tool_search`

Tool definition: `{type:'tool_search', execution?: 'server'|'client', description?, parameters?}` (description/parameters only for client execution). Requires gpt-5.4 or later.

- Hosted (`execution:'server'`): response `output` has `tool_search_call` {`execution:'server'`, `call_id:null`, `status`, `arguments:{paths:[...]}`} then `tool_search_output` {`execution:'server'`, `call_id:null`, `tools:[...loaded defs...]`} then the real `function_call` (with `namespace`). Fully server-side. Replay both items when stateless.
- Client (`execution:'client'`): model emits `tool_search_call` with a real `call_id` and `arguments` (your schema) and the response ends. You return an input item `{type:'tool_search_output', execution:'client', call_id, status:'completed', tools:[...tool definitions...]}`. This result is a list of TOOL DEFINITIONS, not content parts. Tools returned this way may not be in the original `tools` list ("advanced injection"; validate them; changing the loaded set breaks the cache from that point).
- `additional_tools` input/output item `{type:'additional_tools', role:'developer', tools:[...]}` adds tools at a position in the conversation.
- Cache note: loaded tools are appended at the end of context to preserve the cache.

---

## 7. Programmatic Tool Calling (PTC)

- Enable: add `{type:'programmatic_tool_calling'}` to `tools`, and set `allowed_callers` on each tool the program may call (`['programmatic']` = program only; `['direct','programmatic']` = either). Supported: function, custom, mcp, apply_patch, shell (local and hosted), code_interpreter. MCP `require_approval` can pause the program. `tool_choice: {type:'programmatic_tool_calling'}` can force it.
- The model writes JavaScript (fresh V8; no Node, network, fs; has `text()`/`image()` emitters and `tools.*`). OpenAI runs it; you only execute nested client-owned tool calls.
- Output items: `program` {`id`, `call_id`, `code`, `fingerprint`}; nested `function_call` / `custom_tool_call` / `shell_call` / `apply_patch_call` items with `caller: {type:'program', caller_id: <program.call_id>}`; later `program_output` {`id`, `call_id`, `result` (string), `status`: 'completed'|'incomplete'}.
- Result rule: return `function_call_output` with the original `call_id` AND copy `caller` unchanged ("The service uses that value to resume the correct program").
- A program may pause multiple times. Loop until a final `message` item. "If the response contains no pending function_call items and no final message item, continue from that response" (replay output when stateless; `previous_response_id` when stored). `program_output` can arrive with or before the final message.
- ZDR-compatible when the org is ZDR (`store:false` alone does not grant ZDR).
- Do not combine with async tools.
- Pricing: no separate line item found.

---

## 8. Async tool calling (GPT-6 Astra and later)

- `async: true` on a function or custom tool. The call item in `output` has `async: true`. The model continues (can emit more calls, even a final answer) without waiting; you deliver the result in a later request on the original `call_id` (any later request in the chain; use latest `previous_response_id`).
- A "wait" tool is a plain developer-defined sync function (`wait_for_tasks` is not built in). Convention: deliver completed results first, then the wait status.
- Implication: one response can contain a final `message` AND outstanding async calls. Not applicable to hosted tools. Not combinable with PTC; do not combine with parallel tool calls in multi-agent mode.
- `output` items are `function_call` / `custom_tool_call` with `async:true`; results are the normal `function_call_output` / `custom_tool_call_output`.

---

## 9. Hosted / server-side tools (results inline, caller does nothing)

All of these go in `providerOptions.tools` per our design. In every case the response has `status:'completed'` (or `incomplete`/`failed`) with the call items already resolved.

### 9.1 `web_search`

Definition (SDK `WebSearchTool`): `{type:'web_search'|'web_search_2025_08_26', external_web_access?: boolean (default true; false = cache-only), filters?: {allowed_domains?: string[]|null}, search_context_size?: 'low'|'medium'|'high', user_location?: {type?:'approximate', city?, region?, country?, timezone?}|null}`.
Guide-only additions (not in SDK/reference types): `filters.blocked_domains` (up to 100 allowed or 100 blocked, no scheme), `return_token_budget: 'default'|'unlimited'` (GPT-5+ reasoning web search only; `null`/numbers rejected), `search_content_types: ['text','image']`, `image_settings: {max_results, caption}`.
Legacy `web_search_preview` (`search_content_types`, `search_context_size`, `user_location{type:'approximate',...}`) still accepted; no `filters` / `external_web_access` / `return_token_budget`.

Call item: `{type:'web_search_call', id:'ws_...', status: 'in_progress'|'searching'|'completed'|'failed'|'incomplete', action: Search | OpenPage | Find}`:

- Search: `{type:'search', queries?: string[], query?: string (deprecated), sources?: [{type:'url', url}]}` (sources only with the include).
- OpenPage: `{type:'open_page', url?}`; Find: `{type:'find_in_page', pattern, url}` (open_page / find_in_page are reasoning models only).
- With `include:['web_search_call.results']`: `results[]` of `{type:'image_result', image_url, thumbnail_url?, source_website_url, caption?}` on the call item, separate from the message.

Assistant `message.content[].annotations[]` carries `url_citation` {start_index, end_index, url, title}. UI requirement: inline citations must be clearly visible and clickable when showing web results to end users.

Pricing: $10 per 1k `search` actions plus search content tokens at model rates (for gpt-4o-mini / gpt-4.1-mini the non-preview tool bills a fixed 8,000 input tokens per call); image web search $10/1k; `web_search_preview` non-reasoning $25/1k with free content tokens; reasoning-model preview $10/1k. (pricing page "Tools" table.) Only `search` actions are billed per the guide.

Caveats: search context window capped at 128k regardless of model window; not supported on `gpt-5` with `minimal` reasoning; `gpt-5.4` with `none` effort lower quality; with `tool_choice:'auto'` search is optional; live web access is not HIPAA/BAA eligible (cache-only mode can be); o4-mini (listed with a 2026-10-23 shutdown) and the 4o search-preview models (shut down 2026-07-23) are going or gone.

### 9.2 `file_search`

Definition: `{type:'file_search', vector_store_ids: string[], filters?: ComparisonFilter|CompoundFilter|null, max_num_results?: 1..50, ranking_options?: {ranker?: 'auto'|'default-2024-11-15', score_threshold?: 0..1, hybrid_search?: {embedding_weight, text_weight}}}`.

Call item: `{type:'file_search_call', id:'fs_...', status:'in_progress'|'searching'|'completed'|'incomplete'|'failed', queries: string[], results?: [{file_id, filename, score, text, attributes}] | null}`. `results` is null unless `include:['file_search_call.results']`. (The guide's example prints `search_results: null`; the SDK/reference field is `results`. Reconcile by tolerating both.) Message annotations: `file_citation` {file_id, filename, index}.

Pricing: $2.50 per 1k calls (Responses API only) + storage $0.10/GB/day (first GB free).

### 9.3 `code_interpreter`

Definition: `{type:'code_interpreter', container: string /* cntr_... */ | {type:'auto', file_ids?: string[], memory_limit?: '1g'|'4g'|'16g'|'64g'|null, network_policy?: {type:'disabled'} | {type:'allowlist', allowed_domains, domain_secrets?}}, allowed_callers?}`.

Call item: `{type:'code_interpreter_call', id, container_id, code: string|null, outputs: Array<{type:'logs', logs} | {type:'image', url}> | null, status:'in_progress'|'completed'|'incomplete'|'interpreting'|'failed'}`. `outputs` is null unless `include:['code_interpreter_call.outputs']`. Generated files appear as `container_file_citation` annotations (container_id, file_id, filename) on the next message; download via the Containers API (a separate, stateful endpoint).

Pricing: container sessions, 1 GB $0.03 / 4 GB $0.12 / 16 GB $0.48 / 64 GB $1.92 per 20-minute session (billing note: per minute with a 5-minute minimum); tokens at model rates. Containers expire after 20 minutes idle. Rate limit 100 RPM per org. Note: Code Interpreter is no longer in the tools overview list (hosted shell with `container_auto` overlaps it) but is still in the tool union and reference; I found no deprecation notice for it.

### 9.4 `image_generation`

Definition: `{type:'image_generation', action?: 'generate'|'edit'|'auto', background?: 'transparent'|'opaque'|'auto', input_fidelity?: 'high'|'low'|null, input_image_mask?: {file_id?, image_url?}, model?: gpt-image-1 | -1-mini | -1.5 | gpt-image-2 | gpt-image-2.5-sunburst | gpt-image-2.5-flare | chatgpt-image-latest (+ dated snapshots), moderation?: 'auto'|'low', output_compression?: 0..100, output_format?: 'png'|'webp'|'jpeg', partial_images?: 0..3 (streaming only), quality?: 'low'|'medium'|'high'|'xhigh'|'max'|'auto' (xhigh/max only on 2.5 models), size?: 'WxH' | '1024x1024' | '1024x1536' | '1536x1024' | 'auto'}`. Arbitrary `WIDTHxHEIGHT` allowed for gpt-image-2+ (divisible by 16, aspect 1:3..3:1, max 3840x2160).

Call item: `{type:'image_generation_call', id:'ig_...', status:'in_progress'|'completed'|'generating'|'failed', result: string|null /* base64 */, revised_prompt?, action?, background?, output_format?, quality?, size?}`. No `call_id`. Follow-up edits: either `previous_response_id`, or an input item `{type:'image_generation_call', id}` (reference; needs stored), or (stateless) replay the full item incl. base64 `result`.

Pricing: image tokens per image model (e.g. gpt-image-2: text in $5/M, image in $8/M, image out $30/M; cached input discounts on Responses only) plus the host model's tokens. Supported host models list in the guide lags (names gpt-5.5, 5.4-mini/nano, 5.2, 5, 4.1, 4o...); the tool-level `model` is separate from the top-level `model`. Force with `tool_choice:{type:'image_generation'}`. ZDR-compatible for listed image models.

### 9.5 Remote `mcp`

Definition (SDK `Tool.Mcp`): `{type:'mcp', server_label (required), server_url? | tunnel_id? | connector_id? (exactly one), server_description?, authorization? (OAuth access token), headers?: Record<string,string>|null, allowed_tools?: string[] | {read_only?, tool_names?}|null, require_approval?: 'always'|'never' | {always?:{read_only?,tool_names?}, never?:{...}}|null, defer_loading?, allowed_callers?}`. `connector_id` (dropbox, gmail, googlecalendar, googledrive, microsoftteams, outlookcalendar, outlookemail, sharepoint) is deprecated for models released after 2026-09-01. Transports: Streamable HTTP or HTTP/SSE. `tunnel_id` = Secure MCP Tunnel for private servers (new).

Secrets: "the Responses API does not store the value you provide in the `authorization` field... also not visible in the Response object... you must send the `authorization` value in every Responses API creation request." So the stateless gateway must forward it on every call and must never log `providerOptions.tools`.

Output items:

- `mcp_list_tools` {id:'mcpl_...', server_label, tools:[{name, description, input_schema, annotations}], error?}. Produced once per server; as long as it is in context (replayed or via previous_response_id) the API does not re-list. Keep it in replays for latency.
- `mcp_call` {id:'mcp_...', server_label, name, arguments (JSON string), output: string|null, error: {type:'mcp_protocol_error', code, message} | {type:'mcp_tool_execution_error', content} | {type:'http_error', code, message} | null, approval_request_id: string|null, status?: 'in_progress'|'completed'|'incomplete'|'calling'|'failed'}. Fully server-side; result inline in `output` (string only).
- `mcp_approval_request` {id:'mcpr_...', server_label, name, arguments (JSON string)}.
- `mcp_approval_response` also appears as an output item echoing your decision.

Approval flow: default `require_approval` is approvals required for each call (docs: "defaults to requiring approvals of each MCP tool call"). Response ends with one or more `mcp_approval_request` items and no result. Reply with input item `{type:'mcp_approval_response', approval_request_id: 'mcpr_...', approve: true|false, reason?: string, id?}` (plus the same `tools`, and either `previous_response_id` or the replayed items). Each approval applies to one call; later approvals are handled the same way. After approval the next response contains the `mcp_call` with `approval_request_id` set. `require_approval:'never'` (or `{never:{tool_names:[...]}}`) skips this.

Pricing: no per-call fee; only tokens for imported tool definitions and calls. MCP servers are third party: data sent to them follows their retention; prompt-injection risk is highlighted. `tool_choice: {type:'mcp', server_label, name?}`. Tool calls can also be `allowed_callers:['programmatic']`.

### 9.6 `shell` (hosted container variant)

Definition: `{type:'shell', environment?: {type:'container_auto', file_ids?, memory_limit?, network_policy?, skills?} | {type:'container_reference', container_id} | {type:'local', skills?: LocalSkill[]} | null, allowed_callers?}`. Skills: `{type:'skill_reference', skill_id, version?}` or `{type:'inline', name, description, source:{type:'base64', media_type:'application/zip', data}}`. `network_policy`: `{type:'disabled'}` or `{type:'allowlist', allowed_domains, domain_secrets?:[{domain,name,value}]}`. Network is off by default; an org allow list must permit the domains. Runtime: Debian 12, Python 3.11, Node 22, Java 17, PHP 8.2, Ruby 3.1, Go 1.23, cwd `/mnt/data`, no TTY, no sudo.

Output when hosted (`container_auto` / `container_reference`): `shell_call` AND `shell_call_output` both appear in `output` (server executed). Distinguish from local by `shell_call.environment` = `{type:'container_reference', container_id}` (hosted) vs `{type:'local'}` (yours), and by presence of the paired `shell_call_output`. Pricing: same container table as code interpreter. Reuse container with `container_reference`; delete explicitly via Containers API.

### 9.7 Multi-agent (beta)

`multi_agent: {enabled, max_concurrent_subagents (default 3)}` request field and `OpenAI-Beta: responses_multi_agent=v1`. Output gains `multi_agent_call` {action: spawn_agent|interrupt_agent|list_agents|send_message|followup_task|wait_agent, arguments, call_id} / `multi_agent_call_output` and `agent_message` items. "Your application should not execute these or submit outputs for them." Developer-defined `function_call`s from any agent still need your `function_call_output`; over HTTP the response completes once every active agent has finished or paused for a client function call. Item schemas may change. Treat as native passthrough only.

---

## 10. Caller-executed non-function tools (item pairs)

### 10.1 `computer` (GA) and `computer_use_preview` (legacy)

Definitions: `{type:'computer'}` (no fields), legacy `{type:'computer_use_preview', display_width, display_height, environment:'windows'|'mac'|'linux'|'ubuntu'|'browser'}`.

Call: `{type:'computer_call', id, call_id, status:'in_progress'|'completed'|'incomplete', pending_safety_checks:[{id, code?, message?}], actions?: ComputerAction[] (GA, batched), action?: ComputerAction (preview)}`. Action types: click{button,x,y,keys?}, double_click, drag, keypress, move, screenshot, scroll, type, wait. A first call may be only a `screenshot` action. `status:'completed'` only means the model finished generating the call; you still execute it.

Result (input item, NOT the function-output shape):

```json
{
  "type": "computer_call_output",
  "call_id": "call_002",
  "output": {
    "type": "computer_screenshot",
    "image_url": "data:image/png;base64,...",
    "file_id": null,
    "detail": "original"
  },
  "acknowledged_safety_checks": [{ "id": "...", "code": "...", "message": "..." }]
}
```

Output object is `{type:'computer_screenshot', image_url?|file_id?}` (docs example adds `detail:'original'`, which the SDK type lacks). `acknowledged_safety_checks` echoes the `pending_safety_checks` the developer has acknowledged. `status`, `id` optional. Include `computer_call_output.output.image_url` to get image URLs back.

Docs recommend, for GPT-6 Astra, a code-execution harness using an ordinary function tool (`exec_js` / `exec_py`) that returns `function_call_output` with `input_text` / `input_image {detail:'original'}` array; `computer` remains supported. Preview model is shut down (2026-07-23). Pricing: tokens only (no per-call line item).

### 10.2 `shell` (local variant)

Result: `{type:'shell_call_output', call_id, output:[{stdout, stderr, outcome: {type:'exit', exit_code} | {type:'timeout'}}], max_output_length?: number|null, status?, caller?, id?}`. The `shell_call` is `{type:'shell_call', id, call_id, action:{commands: string[], timeout_ms|null, max_output_length|null}, environment:{type:'local'}|..., status:'in_progress'|'completed'|'incomplete', caller?}` (commands: ordered list). If `shell_call.action.max_output_length` is present, return it on the output ("include it in shell_call_output"). On timeout return `{type:'timeout'}` with partial output; preserve non-zero exits. No images/files here, only stdout/stderr strings.

### 10.3 `apply_patch`

Definition `{type:'apply_patch', allowed_callers?}` (no schema; model knows operation shapes). Models: docs table lists GPT-5.1/5.2/5.4/5.5 but doc examples use GPT-6 (table lags).

Call: `{type:'apply_patch_call', id, call_id, status:'in_progress'|'completed', operation: {type:'create_file', path, diff} | {type:'update_file', path, diff} | {type:'delete_file', path}, caller?}` (V4A diff format; your harness applies it).

Result: `{type:'apply_patch_call_output', call_id, status:'completed'|'failed', output?: string|null, caller?, id?}`; exactly one per call_id. `tool_choice: {type:'apply_patch'}`.

### 10.4 Legacy `local_shell` (dead)

Call `{type:'local_shell_call', id, call_id, status, action:{type:'exec', command: string[], env, timeout_ms?, user?, working_directory?}}`; result `{type:'local_shell_call_output', id: <the call_id value!>, output: <string, JSON-string of output>, status?}`. Quirk: the output item's `id` field holds the CALL's `call_id` (docs examples pass `id: shellCall.call_id`), unlike every other output. Only worked with `codex-mini-latest` (removed 2026-02-12). Do not support except via passthrough.

### 10.5 Client-executed `tool_search`

See section 6.2: result is `tool_search_output` with a `tools` array.

### 10.6 MCP approvals

See 9.5; the caller-supplied item is `mcp_approval_response`.

---

## 11. Status values (summary)

| item                                                                                | statuses                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| response                                                                            | `completed`, `failed`, `in_progress`, `cancelled`, `queued`, `incomplete`            |
| `incomplete_details.reason`                                                         | `max_output_tokens`, `max_messages`, `content_filter`, `steered` (WebSocket)         |
| message / function_call / custom_tool_call / computer_call / shell_call / reasoning | `in_progress`, `completed`, `incomplete`                                             |
| web_search_call                                                                     | `in_progress`, `searching`, `completed`, `failed`, `incomplete`                      |
| file_search_call                                                                    | `in_progress`, `searching`, `completed`, `incomplete`, `failed`                      |
| code_interpreter_call                                                               | `in_progress`, `interpreting`, `completed`, `incomplete`, `failed`                   |
| image_generation_call                                                               | `in_progress`, `generating`, `completed`, `failed`                                   |
| mcp_call                                                                            | `in_progress`, `calling`, `completed`, `incomplete`, `failed`                        |
| apply_patch_call                                                                    | `in_progress`, `completed` (output: `completed`, `failed`)                           |
| tool_search_call / output, program_output                                           | `in_progress`, `completed`, `incomplete` (program_output: `completed`, `incomplete`) |
| computer_call_output                                                                | `completed`, `incomplete`, `failed`, `in_progress`                                   |

`error` on the Response (`ResponseError`) when `status:'failed'`.

---

## 12. Pricing summary (per-call charges)

From https://developers.openai.com/api/docs/pricing (Tools table):

- Web search: $10.00 / 1k calls (+ content tokens at model rates); image web search $10 / 1k; preview non-reasoning $25 / 1k with free content tokens.
- File search: $2.50 / 1k calls; storage $0.10 / GB / day (1 GB free).
- Hosted shell and Code Interpreter containers: $0.03 (1 GB) / $0.12 (4 GB) / $0.48 (16 GB) / $1.92 (64 GB) per 20-minute session per container; billed by the minute with a 5-minute minimum per session.
- MCP: no additional per-call fee (tokens only). Function, custom, apply_patch, computer, tool_search, PTC: tokens only (no line item found).
- Image generation: token-based per image model.
- `usage` on the Response is tokens only (`input_tokens_details.{cached_tokens,cache_write_tokens}`, `output_tokens_details.reasoning_tokens`). Per-call tool charges are NOT in `usage`; derive from output items (count `web_search_call` with `action.type==='search'`, `file_search_call`, container-using items).

---

## 13. Doc / SDK discrepancies noted (verify before hard-coding anything)

1. Web search guide documents `filters.blocked_domains`, `return_token_budget`, `search_content_types` and `image_settings` on `web_search`, plus `web_search_call.results[].image_result`; none are in the node `WebSearchTool` type or API reference tool schema.
2. File search guide example shows `search_results: null`; SDK/reference field is `results`.
3. Computer screenshot docs include `detail:'original'`; `ResponseComputerToolCallOutputScreenshot` has no `detail`.
4. `ToolChoiceTypes.type` enum lacks `web_search` although the guide implies a specific web-search choice is possible.
5. `max_tool_calls` is in the reference but only in beta/WebSocket SDK types.
6. Apply patch and image generation "supported models" lists lag the examples.
7. SDK marks `strict` and `parameters` as required keys on `FunctionTool`, but the guide/migration notes describe omitting `strict` as a supported mode (server normalizes).
8. Reference text for `ToolChoiceTypes` lists `code_interpreter`, `mcp` inconsistently between prose and enum.

---

## 14. Implications for our design

### (a) Caller-executed tools that map onto `FunctionTool` / `CustomTool`

Direct fits:

- `FunctionTool {type:'function', name, description, parameters, strict?, providerOptions?}` maps 1:1 to `{type:'function', name, description, parameters, strict}` (internally tagged). Gaps to carry in `providerOptions`: `allowed_callers`, `async`, `defer_loading`, `output_schema`. Note `description` is optional on OpenAI; ours is required (fine). `strict` omitted must be forwarded as omitted (not `false`): omission triggers server-side normalization, which differs from Chat Completions and from other providers. Document: the resolved `strict` is echoed in `response.tools` (only if we expose the echoed tools).
- `CustomTool {type:'custom', name, description, format?}` maps 1:1. Gaps: `allowed_callers`, `async`, `defer_loading` in `providerOptions`. Raw `input` string on the call. Result is `custom_tool_call_output {call_id, output: string | parts[]}` and our `tool_result` with `toolType:'custom'` maps cleanly.
- `tool_result.content` text|image|file parts => `output` string (when a single text part; also safe to always use an array) or array of `input_text` / `input_image` / `input_file`. Required additions for fidelity: image `detail` ('low'|'high'|'auto'|'original'; computer-use harnesses REQUIRE `original`) and file fields (`file_data` base64, `file_id`, `file_url`, `filename`) need either optional `detail` on our image part or part-level `providerOptions`.
- Tools grouped by `namespace` are function/custom tools with an extra `namespace` on the tool; the call carries `namespace`.
- `apply_patch`, `shell` (local), `computer`, `tool_search` (client) are caller-executed but are NOT user-defined schemas: they are provider-defined definitions placed in `providerOptions.tools` (consistent with "hosted tools are provider definitions"), yet the CALLER executes them. So "hosted vs caller-executed" is not the same axis as "defined in `providerOptions.tools` vs shared `tools`". Our docs/SDK should call the second axis "provider-defined" and add a third property "executed by": caller | provider.

Where our shapes are missing something:

1. `caller` echo (PTC): `function_call_output` / `custom_tool_call_output` / `shell_call_output` / `apply_patch_call_output` must carry the call's `caller` unchanged. Our `tool_result` has no slot. Options: (i) `tool_result.providerOptions` passthrough merged into the output item; (ii) the gateway copies it automatically by looking up `toolCallId` in the replayed assistant native output (the history is in the same request, so a stateless gateway can do this deterministically). Recommend (ii) as default with (i) as an escape hatch.
2. `namespace` (and `name`) on function results: optional on OpenAI but harmless; the gateway can fill from the matching call. Extractor must surface `namespace` on tool calls because `name` alone may collide across namespaces; `toolName` in `tool_result` should be accompanied by `namespace?`.
3. `isError`: no OpenAI field. Convention needed: prefix/format into text (e.g. content text starts with an error marker) or leave unmapped. For `apply_patch_call_output` / MCP / shell, errors are structured (`status:'failed'`, `outcome`) and belong in `native` items.
4. Async: a response may validly leave an `async:true` call unresolved. SDK helpers must not assume "all tool calls must receive a result next turn" and should expose `async` on extracted calls. Late results may arrive in a later request, after other turns, using the original `call_id`; the gateway must not reject results whose call is not in the immediately preceding assistant message.
5. `arguments` is a JSON string; extractor should parse for convenience but keep the raw string (the assistant output is replayed verbatim, so do not rewrite it; strict-less calls can contain invalid JSON).
6. `call_id` vs `id`: results use `call_id` (`call_...`). `id` (`fc_...`/`ctc_...`) is only the item id. Our `toolCallId` must be the `call_id`. Do NOT use `id` (and watch the local_shell quirk).

### (b) Hosted tools: `providerOptions.tools` and what an extractor should report

Hosted (provider-executed, inline results): `web_search` (+preview), `file_search`, `code_interpreter`, `image_generation`, `mcp` (remote tools; approval optional), `shell` with hosted `environment`, `tool_search` (server), PTC `program` (runs hosted; nested caller-executed calls are separate), multi-agent (beta). Merge rule: tools from `providerOptions.tools` appended to ours; no name collisions to manage for hosted types, but an MCP server's tool names are namespaced by `server_label`.

Extractor should report two lists, never mixing them:

1. `toolCalls` (pending, needs caller): `function_call`, `custom_tool_call`, plus NATIVE-kind calls: `computer_call`, `shell_call` without a paired `shell_call_output` (or with `environment.type==='local'`), `apply_patch_call`, `local_shell_call`, `tool_search_call` with `execution:'client'`. Each: `{toolCallId: call_id, toolName, toolType: 'function'|'custom'|'native', providerType: item.type, namespace?, async?, caller?, input (parsed or raw string), raw}`.
2. `hostedToolUse` / `serverToolCalls` (already resolved, informational): `web_search_call` {action, queries, sources, status}, `file_search_call` {queries, results?}, `code_interpreter_call` {code, container_id, outputs?}, `image_generation_call` {result (base64), revised_prompt}, `mcp_call` {server_label, name, arguments, output, error, approval_request_id}, `mcp_list_tools`, hosted `shell_call`+`shell_call_output`, `tool_search_call/output` (server), `program`/`program_output`. Include `status`, so `failed` hosted calls are visible even though the overall response is `completed`.
3. `approvals` (pending, needs caller decision): `mcp_approval_request` {id, server_label, name, arguments}.
4. Citations from `message.content[].annotations` (`url_citation`, `file_citation`, `container_file_citation`) as a separate helper; the web-search guide imposes a UI requirement to show citations.
5. Billing hints: count of billable hosted calls (search actions, file search calls, container sessions), since `usage` has tokens only.

Request-side passthrough: `include` (sources, results, outputs), `max_tool_calls`, `tool_choice` forms for hosted tools, `parallel_tool_calls` all go in `providerOptions` (or shared `toolChoice` where our shared design has one; `allowed_tools` and hosted/mcp/shell/apply_patch choices should be passthrough).

Operational notes for a stateless gateway:

- MCP `authorization`/`headers` and `domain_secrets` are secrets inside `providerOptions.tools`: do not log them, forward them every request (OpenAI does not store them, and `previous_response_id` does not inherit them).
- Hosted tools (code interpreter, shell, deep-research style web search, PTC, multi-agent) can run for minutes. OpenAI's answer is `background:true` + polling (documented for deep research and long web searches). Our single non-streaming `complete` has no equivalent; document that long runs may exceed client/Worker/upstream timeouts and consider allowing `providerOptions.background` only if the response shape (queued/in_progress, no output) is acceptable. This is a real misfit.
- Responses can be large (base64 images from `image_generation_call.result`, screenshots). Worker memory and response size limits apply, and stateless replay re-sends them.

### (c) Items that need `native` messages (vs `tool_result`)

`tool_result` is only a faithful fit for `function_call_output` and `custom_tool_call_output`. Everything else has a different input item type and field set:

| result item                                                    | why it is not a `tool_result`                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `computer_call_output`                                         | `output` is a `computer_screenshot` object (`image_url`/`file_id`), plus `acknowledged_safety_checks[]` (must echo/ack `pending_safety_checks`) |
| `shell_call_output`                                            | structured `output[] {stdout, stderr, outcome}` + `max_output_length` echo                                                                      |
| `apply_patch_call_output`                                      | `status` completed/failed + string `output`                                                                                                     |
| `local_shell_call_output` (dead)                               | `id` field carries the call_id; JSON-string `output`                                                                                            |
| `mcp_approval_response`                                        | keyed by `approval_request_id`, `approve` boolean, `reason`; there is no tool result, it is a decision                                          |
| `tool_search_output` (client)                                  | payload is `tools[]` (tool definitions), not content                                                                                            |
| `additional_tools`                                             | tool definitions injected at a position                                                                                                         |
| `program`/`program_output` and replayed hosted-call items      | replay of provider output verbatim (these are assistant-side items)                                                                             |
| `item_reference`, `compaction_trigger`, `configuration_update` | control items                                                                                                                                   |

So: the `native` message must (1) hold an array of input items (a single result can need two, e.g., several `mcp_approval_response`s), (2) be positionable among `tool_result`s, since the gateway must flatten messages to one ordered `input` array (async doc: deliver results before wait status; order matters). SDK helper constructors are worth providing (`computerCallOutput(callId, screenshot, acks)`, `shellCallOutput`, `applyPatchCallOutput`, `mcpApproval(requestId, approve, reason)`, `toolSearchOutput(callId, tools)`), each returning a `native` message. A convenient rule: any extracted call whose `toolType` is `'native'` can only be answered with a `native` message.

Mixed case: a single turn may need function results (tool_result) and a computer output and MCP approvals, all in one next request. All must reach the API in one `input` array.

Safety acknowledgement: `pending_safety_checks` on a `computer_call` must be surfaced to the caller (extractor) so it can ack them; the gateway must never auto-ack.

### (d) Stop reason mapping

OpenAI has no `finish_reason`. Derive from `status`, `incomplete_details.reason`, and the shape of `output`:

| condition                                                                                                                                                                                                                              | suggested normalized stop reason                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status:'failed'` or `error` present                                                                                                                                                                                                   | `error` (surface `response.error` code/message)                                                                                                                                                                                                                  |
| `status:'incomplete'`, reason `max_output_tokens`                                                                                                                                                                                      | `length` (note: reasoning tokens count toward the cap, so output may be empty)                                                                                                                                                                                   |
| `status:'incomplete'`, reason `content_filter`                                                                                                                                                                                         | `content_filter`                                                                                                                                                                                                                                                 |
| `incomplete_details.reason: 'max_messages'`                                                                                                                                                                                            | a distinct `length`-like reason (new; meaning not documented in the guides, treat as provider-specific)                                                                                                                                                          |
| `status:'incomplete'`, reason `steered`                                                                                                                                                                                                | WebSocket only; not reachable on non-streaming HTTP                                                                                                                                                                                                              |
| `status:'cancelled'` / `queued` / `in_progress`                                                                                                                                                                                        | only with `background:true`; treat as not-final                                                                                                                                                                                                                  |
| output contains any pending caller-executed call (function_call / custom_tool_call without result, local `shell_call` without `shell_call_output`, `apply_patch_call`, `computer_call`, client `tool_search_call`, `local_shell_call`) | `tool_use` (status is still `completed`)                                                                                                                                                                                                                         |
| output contains `mcp_approval_request` with no matching response                                                                                                                                                                       | `tool_use`-family but distinct: recommend a separate reason such as `approval_required` (or `tool_use` + `approvals.length > 0`), because the caller's reply is a decision, not a result                                                                         |
| hosted calls only, followed by a final assistant `message` (phase absent or `final_answer`)                                                                                                                                            | `end_turn` / `stop` (hosted calls are invisible to the stop reason)                                                                                                                                                                                              |
| hosted calls only, NO final message (e.g., only reasoning + `web_search_call`, or `program` with no `program_output`, or a message with `phase:'commentary'` and nothing else)                                                         | `pause` / "continue" (like Anthropic's `pause_turn`): caller should send the output back (stateless replay or `previous_response_id`) to let it continue. PTC docs describe exactly this ("no pending function_call items and no final message item: continue"). |
| `message` containing an `output_refusal` content part                                                                                                                                                                                  | `refusal` (status stays `completed`)                                                                                                                                                                                                                             |
| final message plus unresolved `async:true` calls                                                                                                                                                                                       | `tool_use` (calls pending) but with a flag that a final answer text is also present; the loop may stop OR deliver async results later                                                                                                                            |
| PTC `program` + nested `function_call`s with `caller.program`                                                                                                                                                                          | `tool_use` (nested calls are the pending ones)                                                                                                                                                                                                                   |

Pending-call detection algorithm (pure function of `output`): build sets of `call_id`s present in result-type output items (`shell_call_output`, `apply_patch_call_output`, `tool_search_output`, `program_output`->program call_id, `function_call_output` etc.); a caller-executed call is pending iff its `call_id` has no result in the same output (hosted shell is resolved by its paired `shell_call_output`). `function_call`, `custom_tool_call`, `computer_call`, `apply_patch_call`, `local_shell_call` are always pending in a fresh response.

Caution on `phase`: for GPT-5.4/5.5-era models and later, a message with `phase:'commentary'` is not a final answer; an agent loop that stops when "no tool calls" will stop early. The docs call out that dropping `phase` on replay causes preambles to be treated as final answers. Our native-verbatim replay preserves it; the stop-reason logic should also look at it.

### (e) Things that do not fit

1. "One request in, one complete response out" vs. long-running hosted tools (deep-research-style web search, hosted shell, code interpreter, PTC, multi-agent). OpenAI's recommendation is `background:true` + polling or streaming. Without streaming/background, long calls risk timeouts. Mid-turn steering and `response.inject` are WebSocket-only and out of scope.
2. Multi-turn tool loops where the SERVER already looped. A single OpenAI response can contain many internal hosted tool rounds (agentic loop by default); `max_tool_calls` caps only built-in calls. Usage/cost for one `complete` may be large.
3. Stateful dependencies the gateway cannot own: code interpreter / hosted shell containers (`container_id`, 20-minute idle expiry), vector stores for file search, MCP `mcp_list_tools` caching, `previous_response_id`/`conversation` stored state, image `id` references. The stateless design works only if the caller supplies these ids and replays verbatim items; with ZDR, `previous_response_id` is unusable (inference: `store` forced false).
4. Result shapes outside content parts (section 14c), plus `caller`/`namespace`/`detail`/`acknowledged_safety_checks` fields our `tool_result` lacks.
5. `toolType: 'function'|'custom'` does not cover `computer`, `shell`, `apply_patch`, `tool_search`, `local_shell`, `mcp_approval_request`: need a third kind (`'native'`) in extracted calls.
6. Name collisions: function names are unique only within a namespace; MCP tool names only within `server_label`. Any registry keyed by `toolName` alone is lossy.
7. Pending vs. required results: async calls break "every call must be answered next turn".
8. Reasoning/state coupling: `store:true` replay without `encrypted_content` is not portable to a `store:false` request; keep `store` fixed per conversation (recommend forcing `store:false` in the gateway by default so every response is self-contained; this costs bandwidth for big base64 items).
9. Secrets in tool config (MCP `authorization`, `headers`, `domain_secrets` values) travel inside request tools and are not echoed back; gateway logging/caching must exclude them.
10. Compatibility with the documented-but-untyped options: because guides get ahead of generated types (section 13), our hand-written types should model only what we interpret (call/result item shapes, status) and keep tool definitions and request options as opaque pass-through objects.
11. Billing: per-call tool fees are not in `usage`; if the library reports cost, it must count items.
12. Deprecated/dead surface to NOT build around: `local_shell`, `computer_use_preview`, `web_search_preview` (legacy), `connector_id` for new models, `truncation`, Assistants API (sunset 2026-08-26).

### Short checklist of item types the SDK should recognize (read-only unless noted)

Output items relevant to tools: `function_call`, `custom_tool_call`, `computer_call`, `shell_call`, `shell_call_output`, `apply_patch_call`, `local_shell_call` (legacy), `tool_search_call`, `tool_search_output`, `additional_tools`, `program`, `program_output`, `web_search_call`, `file_search_call`, `code_interpreter_call`, `image_generation_call`, `mcp_list_tools`, `mcp_call`, `mcp_approval_request`, `mcp_approval_response`, `reasoning`, `message` (with `phase`), `compaction`, and beta `multi_agent_call(_output)`, `agent_message`.

Input items the gateway may need to emit from helpers: `function_call_output`, `custom_tool_call_output`, `computer_call_output`, `shell_call_output`, `apply_patch_call_output`, `tool_search_output`, `mcp_approval_response`, `additional_tools`, `item_reference` (stored only), and replayed copies of all output items.
