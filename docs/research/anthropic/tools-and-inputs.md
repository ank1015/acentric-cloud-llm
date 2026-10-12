# Anthropic Messages API: tools, structured outputs, inputs, citations, context management, system prompts

Research date: 2026-10-12. Docs-only research (live probing is done separately).
Scope: everything a non-streaming, stateless adapter for `POST /v1/messages`
needs to know about client tools, structured outputs, Anthropic-defined tools
(server and client), input content blocks, citations, context management and
compaction, system prompts (top-level and mid-conversation), the remaining
request fields we type as `providerOptions`, and what errors versus what is
silently dropped.

## 0. Sources and how they were checked

Primary:

- Official TS SDK `@anthropic-ai/sdk` **v0.133.0**, cloned `--depth 1` at commit
  `2979ed5cef4b2f059b95af23e08728c01e588f86` (2026-10-09). Files:
  `src/resources/messages/messages.ts` (GA types) and
  `src/resources/beta/messages/messages.ts` (beta types). Generated from the
  OpenAPI spec; the best proxy for the wire shapes.
- API reference (Markdown): https://platform.claude.com/docs/en/api/messages/create.md
  and the beta variant https://platform.claude.com/docs/en/api/beta/messages/create.md.
- Index: https://platform.claude.com/llms.txt. Every guide below was fetched as
  Markdown by appending `.md` (URLs cited without the suffix).

Guides used (short labels used in the text are in brackets):

| Label                  | URL                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------- |
| [define-tools]         | https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools              |
| [tool-reference]       | https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference            |
| [handle-tool-calls]    | https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls         |
| [parallel]             | https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use         |
| [strict]               | https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use           |
| [server-tools]         | https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools              |
| [web-search]           | https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool           |
| [web-fetch]            | https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool            |
| [code-exec]            | https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool       |
| [tool-search]          | https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool          |
| [advisor]              | https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool              |
| [memory]               | https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool               |
| [ptc]                  | https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling |
| [bash]                 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool                 |
| [text-editor]          | https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool          |
| [computer]             | https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool         |
| [browser]              | https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool          |
| [mcp]                  | https://platform.claude.com/docs/en/agents-and-tools/mcp-connector                      |
| [stop-reasons]         | https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons             |
| [structured]           | https://platform.claude.com/docs/en/build-with-claude/structured-outputs                |
| [vision]               | https://platform.claude.com/docs/en/build-with-claude/vision                            |
| [vision-coords]        | https://platform.claude.com/docs/en/build-with-claude/vision-coordinates                |
| [pdf]                  | https://platform.claude.com/docs/en/build-with-claude/pdf-support                       |
| [files]                | https://platform.claude.com/docs/en/build-with-claude/files                             |
| [search-results]       | https://platform.claude.com/docs/en/build-with-claude/search-results                    |
| [citations]            | https://platform.claude.com/docs/en/build-with-claude/citations                         |
| [context-editing]      | https://platform.claude.com/docs/en/build-with-claude/context-editing                   |
| [compaction]           | https://platform.claude.com/docs/en/build-with-claude/compaction                        |
| [compaction-on-demand] | https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand              |
| [compaction-threshold] | https://platform.claude.com/docs/en/build-with-claude/compaction-threshold              |
| [mid-system]           | https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages  |
| [messages-guide]       | https://platform.claude.com/docs/en/build-with-claude/working-with-messages             |
| [caching]              | https://platform.claude.com/docs/en/build-with-claude/prompt-caching                    |
| [errors]               | https://platform.claude.com/docs/en/api/errors                                          |
| [beta-headers]         | https://platform.claude.com/docs/en/api/beta-headers                                    |
| [service-tiers]        | https://platform.claude.com/docs/en/api/service-tiers                                   |
| [data-residency]       | https://platform.claude.com/docs/en/manage-claude/data-residency                        |
| [fast-mode]            | https://platform.claude.com/docs/en/build-with-claude/fast-mode                         |
| [pricing]              | https://platform.claude.com/docs/en/about-claude/pricing                                |
| [task-budgets]         | https://platform.claude.com/docs/en/build-with-claude/task-budgets                      |

Current models named across these pages: Claude Fable 5.1 / 5, Mythos 5.1 / 5 /
Preview, Opus 5.5 / 5 / 4.8 / 4.7 / 4.6, Sonnet 5.5 / 5 / 4.6, Haiku 5.5 / 4.5.
Feature support varies per model and is spelled out per item below; do not
hard-code a matrix in the adapter (D11), let the API 400.

---

## 1. The big picture (what matters for the adapter)

1. **There is now a native mid-conversation `system` role** (`{"role":"system"}`
   inside `messages`), GA, no beta header, on Fable 5.1/5, Mythos 5.1/5, Opus
   5.5/5/4.8, Sonnet 5.5, Haiku 5.5. **Not** on Sonnet 5 and not on older
   models. Strict placement rules (section 7). D3 maps directly onto it.
   The generated API reference text still says "there is no `system` role"
   (stale); the SDK `MessageParam.role` is `'user' | 'assistant' | 'system'`.
2. **Forced tool use is gone on the newest models.** `tool_choice` `any` and
   `tool` return 400 on Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1 (and on any
   model with manual `thinking: {type:"enabled"}`). `auto`/`none` always work.
3. **Prefill is gone on Claude 4.6+ and Mythos Preview** (400 "The conversation
   must end with a user message"). A request whose last message is an
   assistant message is a prefill. This matters for replay: never end a
   request on a replayed assistant message except for `pause_turn`
   continuation (section 3.2), which the docs prescribe (probe that it is
   accepted on 4.6+).
4. **Structured outputs are GA** as `output_config.format`
   (`{type:"json_schema", schema}`); old `output_format` needs the
   `structured-outputs-2025-11-13` beta header or it 400s. Incompatible with
   citations (400) and prefill.
5. **Files API is GA** (no beta header). `source: {type:"file", file_id}` works
   on image and document blocks; `container_upload` for code execution.
6. **Server tools** (web search/fetch, code execution, tool search) are GA with
   no beta header; MCP connector and advisor are beta. Their call/result
   blocks live in the assistant message and are replayed verbatim. A
   response can stop with `tool_use` while a `server_tool_use` is still
   unanswered; the continuation must then contain **only** `tool_result`
   blocks.
7. **Client toolsets** (`computer_toolset_20260801`, `browser_toolset_20260801`)
   are new: one `tools` entry with no `name`, members arrive as `tool_use`
   blocks carrying `toolset_name`, and the `tool_result` **must echo**
   `toolset_name`. Results are text/image only (+ `browser_state`).
8. **Programmatic tool calling**: `tool_use.caller` is always present in GA
   responses (`{type:"direct"}` or `{type:"code_execution_20260120", tool_id}`).
9. **Two compaction modes**, both beta: threshold (`context_management.edits`
   with `compact_20260112`, header `compact-2026-01-12`) and on-demand
   (top-level `compaction: {type:"summarize"}`, header `compact-2026-09-04`,
   `stop_reason: "compaction"`). The `compaction` block must be replayed
   verbatim (it may carry `signature`, `encrypted_content`, `tool_changes`).
10. **Thinking blocks are bound to the prefix** on Fable 5.1, Opus 5.5, Sonnet
    5.5, Haiku 5.5: editing anything before a replayed thinking block (system,
    tools, earlier messages, a mid-conversation system message) makes it fail
    the "conversation check" (400 for accounts created on or after
    2026-08-31, otherwise dropped). The adapter must not rewrite history.
11. Images can opt out of silent downscaling: `transformations:
{oversized_image: "error"}` on an image block.

---

## 2. Client (user-defined) tools

### 2.1 Definition

SDK `Tool` (GA) fields [define-tools] [tool-reference]:

| Field                   | Type / limits                                                                                              | Notes                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | string, regex `^[a-zA-Z0-9_-]{1,128}$`                                                                     | required                                                                                                                          |
| `description`           | string                                                                                                     | optional in the SDK type; docs urge 3-4+ sentences                                                                                |
| `input_schema`          | JSON Schema object, `type: "object"` required, `properties?`, `required?`, other keys open                 | required. SDK says draft 2020-12                                                                                                  |
| `type`                  | `'custom'` or omitted/null                                                                                 | optional discriminator; plain `{name, description, input_schema}` is a custom tool                                                |
| `strict`                | boolean                                                                                                    | grammar-constrained inputs (section 2.6). Not allowed on `mcp_toolset` or the two toolsets                                        |
| `input_examples`        | array of objects                                                                                           | each must validate against `input_schema` or 400. ~20-50 tokens each (100-200 for nested). Not on server tools or client toolsets |
| `cache_control`         | `{type:"ephemeral", ttl?: "5m"\|"1h"}`                                                                     | cache breakpoint at this tool (tools are cached as a prefix up to and including it)                                               |
| `defer_loading`         | boolean                                                                                                    | tool hidden from the initial prompt; surfaced by tool search (`tool_reference`) or a mid-conversation `tool_addition`             |
| `allowed_callers`       | array of `'direct'`, `'code_execution_20250825'`, `'code_execution_20260120'`, `'code_execution_20260521'` | default `["direct"]`; for programmatic tool calling                                                                               |
| `eager_input_streaming` | boolean or null                                                                                            | streaming-only (fine-grained tool input streaming); irrelevant to us, pass through                                                |

Notes:

- The API builds a tool-use system prompt from the tool definitions; it costs
  a fixed overhead per request: e.g. Opus 5.5 / Sonnet 5.5 / Haiku 5.5: 286
  tokens (auto/none); Opus 5: 286 (auto/none) / 406 (any/tool); Opus 4.7: 675 /
  804 [pricing]. With no tools and `tool_choice: none` the overhead is 0.
- Tool definitions are the first thing in the cache prefix (`tools` ->
  `system` -> `messages`); any change to tools invalidates the whole cache
  [caching].
- There is no Anthropic equivalent of OpenAI custom (free-form grammar) tools.
  Our `custom` tool kind has no target here: refuse it.

### 2.2 `tool_choice`

```ts
type ToolChoice =
  | { type: 'auto'; disable_parallel_tool_use?: boolean } // default when tools present
  | { type: 'any'; disable_parallel_tool_use?: boolean } // must call some tool
  | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean }
  | { type: 'none' }; // default when no tools
```

- `any`/`tool` prefill the assistant turn with a tool call: no text before the
  `tool_use`, and **thinking is skipped** (no thinking block) [define-tools].
- `any`/`tool` are rejected (400 `invalid_request_error`, message
  `tool_choice: type "tool" and "any" are not supported for this model.`) on
  Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1, also on `count_tokens`
  [errors#forced-tool-use-not-supported]; and with manual extended thinking
  (`thinking.type: "enabled"`) on any model [define-tools].
- A `tool_choice` of type `tool` naming a toolset or a toolset member is
  rejected [tool-reference].
- Changing `tool_choice` invalidates cached message blocks (not tools/system)
  [caching].
- `disable_parallel_tool_use: true`: with `auto`, at most one tool call; with
  `any`/`tool`, exactly one. It is not a top-level param [parallel].

### 2.3 The `tool_use` block (assistant output)

```ts
interface ToolUseBlock {
  type: 'tool_use';
  id: string; // "toolu_..." (docs examples: toolu_01A09q90qw90lq917835lq9)
  name: string;
  input: unknown; // parsed JSON object, not a string
  caller:
    | { type: 'direct' }
    | { type: 'code_execution_20250825'; tool_id: string }
    | { type: 'code_execution_20260120'; tool_id: string }; // always present in GA responses
  toolset_name?: string | null; // "computer" | "browser" for client toolset members
}
```

- `input` is already an object (unlike OpenAI's JSON string). Without `strict`,
  it may not match the schema (Claude "will retry 2-3 times" after an
  `is_error` result) [handle-tool-calls].
- The request-side `ToolUseBlockParam` accepts the same fields plus
  `cache_control`; verbatim replay of the response block is valid input.
- Response `caller` types: blocks always tag PTC calls as
  `code_execution_20260120` even when the request declared
  `code_execution_20260521` [tool-reference].

### 2.4 The `tool_result` block (user input)

```ts
interface ToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;
  content?:
    | string
    | Array<
        | TextBlockParam
        | ImageBlockParam
        | SearchResultBlockParam
        | DocumentBlockParam
        | ToolReferenceBlockParam // {type:'tool_reference', tool_name} for client-side tool search
        | BrowserStateBlockParam
      >; // browser toolset only
  is_error?: boolean;
  cache_control?: CacheControlEphemeral | null;
  toolset_name?: string | null; // REQUIRED for computer/browser toolset member results
}
```

Rules [handle-tool-calls] [parallel] [stop-reasons#tool-use]:

- `content` is optional (empty result is valid), a string, or a list of
  `text`, `image`, `document` (including `source.type: "text"` plain-text
  documents), `search_result` blocks.
- If any block in a `tool_result.content` is a `search_result`, **all** must be
  `search_result` (validation error otherwise) [search-results].
- Toolset member results: `toolset_name` must echo the call's, else rejected;
  content limited to `text` and `image` (+ one `browser_state` for browser);
  oversized screenshots are **rejected**, not downscaled [vision].
- `is_error: true` is a real field (unlike OpenAI). Our `isError` maps 1:1.
- **Ordering**: tool results must be in the user message immediately after the
  assistant message with the `tool_use` blocks; no message in between.
  Inside that user message all `tool_result` blocks come **first**; text (or
  other blocks) may follow **after** them. Text before a `tool_result` is a 400
  ("tool_use ids were found without tool_result blocks immediately after").
- **Every** `tool_use` must be answered (one `tool_result` per `tool_use`, all in
  the same user message). If you skip a call, still return `is_error: true`
  with an explanation [parallel]. Separate user messages per result are
  accepted but "teach" the model to stop calling in parallel.
- **Exception: no trailing text when a server tool is still open.** If the
  assistant turn also has a `server_tool_use` (or `mcp_tool_use`) with no
  result block yet, the user message must contain **only** `tool_result`
  blocks. Text after them ends the turn and the request fails 400:
  `` `web_search` tool use with id `srvtoolu_...` was found without a corresponding `web_search_tool_result` block``.
  The `tools` array must also still define that server tool (400 otherwise:
  ``... but no `web_search` tool was provided``) [stop-reasons#tool-use].
- A mid-conversation `system` message can sit right after the tool-result user
  message (section 7), but never between `tool_use` and its result.
- Consecutive `user` (or `assistant`) messages are merged into one turn by the
  API [api-ref `messages`].

Programmatic tool calling: a `tool_use` with a code-execution `caller` is
answered with an ordinary `tool_result`; the docs say the follow-up user
message must contain only `tool_result` blocks and the request should pass the
response's `container.id` back. Details in section 3.

### 2.5 Parallel tool calls

On by default; Claude 4+ models call tools in parallel when useful
[parallel]. Turn it off only via `tool_choice.disable_parallel_tool_use`.
Fable 5.1 is noted to issue fewer parallel calls in long agent loops. For
computer/browser toolset batches, the client must execute in order and stop
at the first failure, answering the rest with each tool's documented
"skipped" text [parallel].

### 2.6 Strict tool use

`strict: true` on a tool => grammar-constrained sampling: `input` always matches
`input_schema` and `name` is always a valid tool [strict]. Same schema subset
and limits as JSON outputs (section 2.7). Not allowed on `mcp_toolset` or the
toolset entries (rejected). On models without forced tool use, `auto` +
`strict` is the recommended replacement for `tool_choice: tool`. Compiled
grammars are cached up to 24 h (schemas are not ZDR-protected: no PHI in
schemas).

### 2.7 Structured outputs (JSON outputs)

GA, ZDR-eligible, on: Fable 5.1/5, Mythos 5.1/5/Preview, Opus 5.5/5/4.8/4.7/4.6/4.5,
Sonnet 5.5/5/4.6/4.5, Haiku 5.5/4.5 [structured] (frontmatter
`supportedModels`).

Request:

```json
"output_config": {
  "format": { "type": "json_schema", "schema": { "type": "object", "properties": {...}, "required": [...], "additionalProperties": false } },
  "effort": "high"        // other output_config fields coexist
}
```

- Output arrives as the **text** content block(s) of the response (JSON
  string), not a separate field. There is no `name`/`strict` wrapper like
  OpenAI.
- Old beta `output_format` (top-level) is deprecated; without the
  `structured-outputs-2025-11-13` header it returns 400 [structured#migrating].
- Grammar applies only to Claude's direct output; tool calls, tool results and
  thinking are unconstrained. Works with strict tools in the same request.
- Incompatible with: **citations** (400 if any `document` or `search_result`
  has `citations.enabled` and `output_config.format` / `output_format` is
  set) and **prefill**. Also rejected on an on-demand compaction request.
- Invalid outputs still possible: `stop_reason: "refusal"` (200, may not match
  schema), `max_tokens` (truncated JSON). Enum/const **capitalization is not
  guaranteed** (no error) [structured#invalid-outputs]. Required properties
  are emitted first, then optional ones, in schema order.
- Changing `output_config.format` invalidates the prompt cache (an injected
  system prompt describes the format).

Supported JSON Schema subset (shared with strict tools) [structured#json-schema-limitations]:

- Supported: all basic types (object, array, string, integer, number,
  boolean, null); `enum` of primitives; `const`; `anyOf`, `allOf` (not with
  `$ref`); `$ref`/`$def`/`definitions` (internal only); `default`; `required`;
  `additionalProperties` **must be `false`** on objects; string `format`:
  `date-time`, `time`, `date`, `duration`, `email`, `hostname`, `uri`, `ipv4`,
  `ipv6`, `uuid`; array `minItems` 0 or 1 only; `pattern` with simple regex
  (no backreferences, lookaround, `\b`, large `{n,m}`).
- Not supported (400 with details): recursive schemas, complex enum members,
  external `$ref`, `minimum`/`maximum`/`multipleOf`, `minLength`/`maxLength`,
  other array constraints, `additionalProperties` other than `false`.
- Complexity limits per request (sum across all strict tools and the output
  schema): 20 strict tools; 24 optional parameters; 16 parameters with union
  types (`anyOf` or type arrays). Plus internal grammar-size limit ("Schema is
  too complex for compilation.", 400) and a 180 s compilation timeout.
- SDK helpers silently transform unsupported constraints into descriptions;
  the raw API does not (it 400s). Our adapter sends the schema as given.

---

## 3. Anthropic-defined tools

### 3.1 Directory [tool-reference]

| Tool           | `type` strings                                                                                                                            | Fixed `name`                                                                                  | Beta header                                                                                    | Executed by                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| Web search     | `web_search_20250305`, `web_search_20260209`, `web_search_20260318`                                                                       | `web_search`                                                                                  | none                                                                                           | Anthropic                             |
| Web fetch      | `web_fetch_20250910`, `web_fetch_20260209`, `web_fetch_20260309`, `web_fetch_20260318`                                                    | `web_fetch`                                                                                   | none                                                                                           | Anthropic                             |
| Code execution | `code_execution_20250825`, `code_execution_20260120`, `code_execution_20260521` (legacy `code_execution_20250522`, Python only)           | `code_execution`                                                                              | none                                                                                           | Anthropic                             |
| Tool search    | `tool_search_tool_regex_20251119`, `tool_search_tool_bm25_20251119` (undated aliases `tool_search_tool_regex` / `_bm25`)                  | same as type without date                                                                     | none                                                                                           | Anthropic                             |
| Advisor        | `advisor_20260301`                                                                                                                        | `advisor`                                                                                     | `advisor-tool-2026-03-01`                                                                      | Anthropic (a second model)            |
| MCP connector  | `mcp_toolset` + top-level `mcp_servers`                                                                                                   | none (`mcp_server_name`)                                                                      | `mcp-client-2025-11-20` (superset `mcp-client-2026-09-15`; `mcp-client-2025-04-04` deprecated) | Anthropic calls the remote MCP server |
| Memory         | `memory_20250818`                                                                                                                         | `memory`                                                                                      | none                                                                                           | client                                |
| Bash           | `bash_20250124`                                                                                                                           | `bash`                                                                                        | none                                                                                           | client                                |
| Text editor    | `text_editor_20250728` (Claude 4+), `text_editor_20250429` (Claude 4), `text_editor_20250124` (earlier); beta-only `text_editor_20241022` | `str_replace_based_edit_tool` (20250728, 20250429); `str_replace_editor` (20250124, 20241022) | none                                                                                           | client                                |
| Computer use   | `computer_toolset_20260801` (stable); `computer_20251124`, `computer_20250124` (beta, older models; beta-only `computer_20241022`)        | toolset: no name; legacy `computer`                                                           | none; `computer-use-2025-11-24` / `computer-use-2025-01-24` for the old versions               | client                                |
| Browser use    | `browser_toolset_20260801`                                                                                                                | toolset: no name                                                                              | none                                                                                           | client                                |

What versions add: `_20260209` web tools: dynamic filtering (Claude writes
code to filter results; code execution is provisioned automatically);
`web_fetch_20260309`: `use_cache`; `_20260318` web tools: `response_inclusion`;
`code_execution_20260120`: programmatic tool calling and REPL persistence;
`code_execution_20260521`: the description discloses the 90 s per-cell limit.
Older versions stay current. Model support differs by tool and version; the
Models API exposes `capabilities.server_tools.{web_search,code_execution}.supported`.
In the GA SDK, advisor, `mcp_toolset` and `mcp_servers` exist only in the
beta types.

These definitions all go in `providerOptions.tools` (D7). Shared optional
fields on Anthropic tools: `cache_control`, `defer_loading`, `allowed_callers`,
`strict` (not on `mcp_toolset`/toolsets). `input_examples` is not accepted on
server tools.

### 3.2 Shared mechanics of server tools [server-tools] [stop-reasons]

- Call block: `{type:"server_tool_use", id:"srvtoolu_...", name, input,
caller}`. `name` is one of `web_search`, `web_fetch`, `code_execution`,
  `bash_code_execution`, `text_editor_code_execution`,
  `tool_search_tool_regex`, `tool_search_tool_bm25` (beta adds `advisor`).
  `caller` is required on GA response blocks (`direct` or a code execution
  caller); on request params ids must match `^srvtoolu_[a-zA-Z0-9_]+$`.
- Its result block follows in the same assistant content, paired by
  `tool_use_id` (not position). **The client never sends a `tool_result` for a
  `srvtoolu_` id** (rejected).
- Tool failures are in-band: HTTP 200 with a `*_tool_result_error` content
  object and an `error_code`; Claude handles them itself.
- **`pause_turn`**: the server-side loop hit its iteration limit (default 10
  per request). The response may end with a `server_tool_use` without result.
  Continue by appending the assistant message **unchanged** and re-posting,
  with **no** new user message, the same `tools`, and the same beta headers
  (400 ``... but no `<name>` tool was provided`` if the tool is gone). It can
  pause again; cap continuations. `pause_turn` never leaves a client
  `tool_use` waiting (that is `stop_reason: tool_use`). The resend ends the
  request on an assistant message, which for ordinary content is a forbidden
  prefill on Claude 4.6+; the docs prescribe it anyway without addressing the
  conflict, so the API presumably treats a paused turn as a continuation
  (probe). Code execution docs add that you may instead modify the content to
  interrupt.
- **Mixed turn** (`stop_reason: tool_use` with an unanswered `server_tool_use`
  or `mcp_tool_use`): the API returned early so the client tools run first.
  Detect it only by an id with no result block. Reply with a user message of
  `tool_result` blocks only (nothing after them), same `tools`. The next
  response **starts with** the deferred result block; the `server_tool_use` is
  not repeated. Keep both assistant messages in order.
- Domain filters (web search / fetch): `allowed_domains` **or**
  `blocked_domains` (both => 400); no scheme; subdomains included; paths only
  for search (fetch matches domain only); wildcard only in the path; Console
  org settings also apply (conflicts => 400; web search disabled for the org
  => 400).
- `allowed_callers` defaults: `_20260209`+ web tools default to
  `["code_execution_20260120"]` (dynamic filtering); on models without PTC
  they **require** `allowed_callers: ["direct"]` (400 otherwise). Dynamic
  filtering is on Claude 4.6+ and Mythos Preview. An explicit `code_execution`
  tool next to these web tools must be `20260120`+ (older => 400).
- ZDR: `web_search_20250305`, `web_fetch_20250910` eligible; `_20260209`+ only
  with `allowed_callers: ["direct"]`; code execution, PTC, MCP connector, Files
  API not eligible.
- Caching: with any `cache_control` in the request, the API adds 5-minute
  breakpoints on server tool results between loop iterations; toggling web
  search/fetch invalidates the system and messages caches.

### 3.3 Web search [web-search]

- Definition: `{type, name:"web_search", max_uses?, allowed_domains? |
blocked_domains?, user_location?: {type:"approximate", city?, region?,
country? (ISO alpha-2; unsupported => 400), timezone? (IANA)},
response_inclusion?: "full" | "excluded" (20260318+), allowed_callers?,
cache_control?, defer_loading?, strict?}`.
- Platforms: Claude API and Claude Platform on AWS (all versions); Vertex basic
  only; Foundry Azure-hosted basic only; **not Bedrock**.
- Result: `{type:"web_search_tool_result", tool_use_id, caller, content}` with
  `content` = `[{type:"web_search_result", url, title, encrypted_content,
page_age|null}]` (empty array when no hits) or
  `{type:"web_search_tool_result_error", error_code}` with codes
  `too_many_requests`, `invalid_tool_input`, `max_uses_exceeded`,
  `query_too_long`, `request_too_large`, `unavailable`.
- Citations are always on: text blocks carry `web_search_result_location`
  (`url`, `title`, `encrypted_index`, `cited_text` up to 150 chars, not billed).
- `response_inclusion: "excluded"` omits nested search pairs that a completed
  code-execution (dynamic filtering) call consumed; anything that must be
  replayed is still returned.
- **Replay: send back exactly as received; if `encrypted_content` is missing or
  modified the request fails 400.** `encrypted_index` must be passed back too.
- Usage `usage.server_tool_use.web_search_requests`. Price **$10 / 1,000
  searches** plus tokens; errored searches are free [pricing].
- With web search in the request, `search_result` blocks must have citations
  enabled (section 4.4).

### 3.4 Web fetch [web-fetch]

- Definition: `{type, name:"web_fetch", max_uses?, allowed_domains? |
blocked_domains?, citations?: {enabled} (default off), max_content_tokens?,
use_cache? (20260309+, default true), response_inclusion? (20260318+),
allowed_callers?, cache_control?, defer_loading?, strict?}`; SDK also has
  `url_sources` (controls which earlier content may supply fetchable URLs).
- Only URLs that already appeared in user messages, client tool results or
  earlier web search/fetch results can be fetched (not URLs only in the
  system prompt, Claude's own text, or code/MCP results). No JS rendering.
  Not on Bedrock or Vertex.
- Result: `{type:"web_fetch_tool_result", tool_use_id, caller, content:
{type:"web_fetch_result", url, retrieved_at, content: {type:"document",
source: text or base64 PDF, title, citations}}}`; errors
  `web_fetch_tool_result_error` with `invalid_tool_input`, `url_too_long`
  (>250 chars), `url_not_allowed`, `url_not_in_prior_context`,
  `url_not_accessible`, `too_many_requests`, `unsupported_content_type`
  (text/HTML/PDF only), `max_uses_exceeded`, `unavailable` (SDK also
  `content_too_large`).
- Usage `web_fetch_requests`; tokens only, no fee. Replay verbatim.

### 3.5 Code execution [code-exec]

- Definition `{type:"code_execution_2025..."|"..._2026...", name:"code_execution"}`
  (+ `allowed_callers`, `cache_control`, `defer_loading`, `strict`). GA, not ZDR.
  Wide model support (Fable/Mythos 5.x, Opus 4.5-5.5, Sonnet 4.5-5.5, Haiku
  4.5/5.5; on Haiku 4.5 the new versions behave like 20250825).
- Claude uses sub-tools, visible as `server_tool_use.name`:
  - `bash_code_execution` (`input.command`) => `bash_code_execution_tool_result
{content: {type:"bash_code_execution_result", stdout, stderr, return_code,
content:[{type:"bash_code_execution_output", file_id}]}}`
  - `text_editor_code_execution` (`view`/`create`/`str_replace`) =>
    `text_editor_code_execution_tool_result` with `..._view_result`,
    `..._create_result` or `..._str_replace_result`
  - `code_execution` (`input.code`, PTC/REPL and legacy) =>
    `code_execution_tool_result {content: code_execution_result |
encrypted_code_execution_result {encrypted_stdout, ...}}`
  - Errors: `<name>_tool_result_error` (`unavailable`, `execution_time_exceeded`,
    `invalid_tool_input`, `too_many_requests`, bash `output_file_too_large`,
    editor `file_not_found` + `error_message`).
- **Container**: response top-level `container: {id, expires_at, skills}`
  whenever a container was used. Request `container`: string id or `{id?,
skills?: [{type:"anthropic"|"custom", skill_id, version?}] (max 20)}`. Each
  request gets a fresh container unless the id is passed. Containers live 30
  days from creation; checkpointed after ~5 min idle and restored on use;
  `expires_at` is a shorter rolling value. An expired id is an **error**
  (not silently recreated). Workspace-scoped. Python 3.11, 5 GiB RAM/disk,
  1 CPU, no internet.
- Files in: `container_upload {file_id}` user block. Files out:
  `bash_code_execution_output.file_id` (download via Files API).
  `container_upload` also appears as a response block type.
- Usage: docs show `server_tool_use.code_execution_requests`, but the SDK
  types only `web_search_requests` and `web_fetch_requests`.
- Pricing: **free when the request includes a `_20260209`+ web search/fetch
  tool**; otherwise $0.05 per container-hour after 1,550 free hours/org/month,
  5-minute minimum, and billed even when unused if files are preloaded.

### 3.6 Programmatic tool calling [ptc]

- Needs `code_execution_20260120`+ and a client tool with
  `allowed_callers` containing `"code_execution_20260120"` (or `_20260521`).
  Not on Haiku 4.5; not ZDR.
- Response: `stop_reason: "tool_use"`, a `server_tool_use{name:"code_execution"}`
  with no result yet, and client `tool_use` blocks whose `caller` is
  `{type:"code_execution_20260120", tool_id:"srvtoolu_..."}`.
- Continuation: a user message with **only** `tool_result` blocks (no text even
  after), each result's content **a string or text blocks only** (images,
  documents rejected), all pending calls answered at once, the same `tools`,
  and **the `container` id from the paused response (required; rejected
  without it)**. May loop several rounds; pending calls time out after ~4
  minutes.
- Incompatible: `strict` tools, `disable_parallel_tool_use`, `tool_choice`
  naming a tool without `"direct"` (400), recursive `$ref` (400), MCP tools,
  toolsets. `allowed_callers` is guidance, not a security boundary.
- Results of programmatic calls don't count as tokens; only the final code
  output does.

### 3.7 Tool search [tool-search]

- `{type:"tool_search_tool_regex_20251119", name:"tool_search_tool_regex"}` or
  the bm25 variant; GA; 4.5+ models. Never `defer_loading` on the search tool;
  at least one non-deferred tool (400 "All tools cannot be deferred"); every
  deferred definition must be sent on every request; max 10,000 deferred
  tools; `defer_loading` + `cache_control` on the same tool => 400.
- Result: `tool_search_tool_result {content: {type:"tool_search_tool_search_result",
tool_references: [{type:"tool_reference", tool_name}]}}` or
  `tool_search_tool_result_error` (`invalid_tool_input`, `unavailable`,
  `too_many_requests`, `execution_time_exceeded`). The API expands references
  throughout history, so discovered tools stay usable. Replay verbatim, same
  `tools`.
- Client-side search: a client tool returns `tool_result` content
  `[{type:"tool_reference", tool_name}]` (supported in `ToolResultBlockParam`).
  An unknown name => 400. Our shared `tool_result` content has no such part; it
  would need a native part or `providerOptions`.
- No usage field, no fee (tokens only); preserves the prompt cache.

### 3.8 MCP connector [mcp]

- Beta `mcp-client-2025-11-20`; not ZDR. Tools only (no prompts/resources);
  remote HTTP/SSE servers only.
- Request: `mcp_servers: [{type:"url", url (https), name (unique),
authorization_token?}]` plus exactly one `{type:"mcp_toolset",
mcp_server_name, default_config?: {enabled?, defer_loading?}, configs?:
{<tool>: {enabled?, defer_loading?}}, cache_control?}` per server (with
  `mcp-client-2026-09-15` also a pinned `tools` list). Unknown tool names in
  `configs` are **silently ignored**. `authorization_token` is a secret in
  the request body (D18).
- Response blocks: `{type:"mcp_tool_use", id:"mcptoolu_...", name, server_name,
input}` and `{type:"mcp_tool_result", tool_use_id, is_error, content: string
| text blocks}`; with `mcp-client-2026-09-15` the response may **start with**
  `mcp_tool_listing {mcp_server_name, tools}` blocks that must be replayed and
  require that header on every later request.
- `mcp_tool_use` follows the mixed-turn rule like `server_tool_use`. No
  MCP-specific fee.

### 3.9 Advisor [advisor]

- Beta `advisor-tool-2026-03-01`, Claude API and Claude Platform on AWS only.
  `{type:"advisor_20260301", name:"advisor", model (required), max_uses?,
max_tokens? (>= 1024), caching?: {type:"ephemeral", ttl} | null}`.
  Invalid executor/advisor pairs => 400.
- Blocks: `server_tool_use{name:"advisor", input:{}}` then `advisor_tool_result
{content: advisor_result {text} | advisor_redacted_result
{encrypted_content} | advisor_tool_result_error {error_code}}`.
- Replay verbatim; the tool may be removed from `tools` later but the beta
  header must stay while advisor blocks are in history.
- `usage.iterations[]` has `advisor_message` entries (advisor-model rates); the
  top-level usage counts executor tokens only.

### 3.10 Client-executed Anthropic tools (memory, bash, text editor, computer, browser)

Anthropic defines the schema (no `input_schema` is sent: "the schema is built
into Claude's model"); the client executes. The definition goes in
`providerOptions.tools`; Claude's calls are ordinary `tool_use` blocks
(`toolu_` ids), and results are ordinary `tool_result` blocks, except the
toolsets' `toolset_name` echo. Optional fields on bash / text editor / memory /
legacy computer: `allowed_callers`, `cache_control`, `defer_loading`,
`input_examples`, `strict` [bash] [text-editor] [memory].

- **Bash** [bash]: `{type:"bash_20250124", name:"bash"}`, all current models.
  Input `{command}` or `{restart: true}`. Result: combined stdout/stderr text;
  failures `is_error: true`. The API never truncates results (oversized
  request => error). Overhead 325 tokens on Claude 4.7+ (244 earlier).
  (`bash_20241022` needs `computer-use-2024-10-22`, retired models.)
- **Text editor** [text-editor]: `{type:"text_editor_20250728",
name:"str_replace_based_edit_tool", max_characters?}` for Claude 4+. Commands
  `view {path, view_range?}`, `str_replace {path, old_str, new_str}`,
  `create {path, file_text}`, `insert {path, insert_line, insert_text}`;
  `undo_edit` only on the old `str_replace_editor` versions. Results are text;
  errors `is_error: true`. Overhead 974 tokens on 4.7+ (745 earlier).
- **Memory** [memory]: `{type:"memory_20250818", name:"memory"}`, Claude 4+,
  GA. Commands `view`, `create`, `str_replace`, `insert`, `delete`, `rename`
  under `/memories` (the client must block path traversal). The API adds a
  memory protocol to the system prompt. Pairs with context editing.
- **Computer use toolset** [computer]: `{type:"computer_toolset_20260801",
configs?: {<member>: {enabled?, defer_loading?}}, cache_control?,
allowed_callers?: ["direct"]}`. GA, no header; Claude API and Vertex; models
  Fable 5.1/5, Mythos 5.1/5, Opus 5.5/5/4.8, Sonnet 5.5/5, Haiku 5.5. On Claude
  5.5 models (Claude API, Vertex) it is the **only** accepted computer type
  (legacy types => 400). 17 members (`screenshot`, `zoom`, five clicks,
  `left_click_drag`, `mouse_move`, `left_mouse_down/up`, `cursor_position`,
  `scroll`, `type`, `key`, `hold_key`, `wait`), each a `tool_use` with
  `name: <member>`, `toolset_name: "computer"`, and no `action` field.
  Rejected on the entry: `name`, display size fields, `strict`,
  `input_examples`, entry-level `defer_loading`, a code-execution caller,
  `tool_choice: tool` naming it, a second toolset or a tool named `computer`,
  unknown `configs` keys. Batch semantics: run in order, stop at the first
  failure, answer later calls with `is_error: true` and exactly
  `Not executed: an earlier computer action in this turn failed.` Every
  `tool_use` must be answered. Results: text and image only; screenshots
  above the model's limits are rejected (not downscaled). ~4,500 tokens of
  overhead. Prompt-injection classifiers scan computer-use tool results.
- **Legacy computer** (`computer_20251124` + `computer-use-2025-11-24` on
  Fable/Mythos 5.x, Opus 5/4.8/4.7/4.6/4.5, Sonnet 5/4.6; `computer_20250124` +
  `computer-use-2025-01-24` on Sonnet 4.5, Haiku 4.5, Opus 4.1/4, Sonnet 4):
  `{type, name:"computer", display_width_px, display_height_px,
display_number?, enable_zoom? (20251124)}`; calls are
  `tool_use{name:"computer", input:{action, ...}}` with no `toolset_name`.
- **Browser use toolset** [browser]: `{type:"browser_toolset_20260801",
configs?, cache_control?, allowed_callers?}`; same models as the computer
  toolset, Claude API and Vertex. 31 members (27 enabled by default;
  `javascript_exec`, `file_upload`, `read_console`, `read_network` off),
  targets by coordinate or `ref_N` from `read_page`. Results: `text`, `image`,
  and at most one `browser_state {tabs:[{tab_id, title, url, active?}],
state_changes?}` block; tab-management members return exactly one
  `browser_state`. Halt text `Not executed: an earlier action in this turn
failed.` ~6,600 tokens of overhead.

For our design these toolset results are not plain shared `tool_result`s
(required `toolset_name`, `browser_state`, strict content rules); see section 10.

### 3.11 Replay rules (summary)

1. Replay all of these verbatim: `server_tool_use`, every `*_tool_result`,
   `mcp_tool_use`, `mcp_tool_result`, `mcp_tool_listing`, `container_upload`,
   `compaction`, text blocks with `citations`, thinking blocks. Opaque fields
   that must survive: `web_search_result.encrypted_content`,
   `encrypted_index`, `advisor_redacted_result.encrypted_content`,
   `encrypted_code_execution_result.encrypted_stdout`,
   `compaction.signature` / `encrypted_content`, thinking `signature`.
2. No doc permits dropping server tool blocks; doing so risks id mismatch
   400s and breaks thinking binding.
3. Keep `tools` identical while a server call is pending or paused.
4. Pass `container.id` back whenever a container ran; mandatory for PTC
   continuations.
5. Keep beta headers while history contains their blocks (advisor, MCP
   listing, compaction).

---

## 4. Inputs (user content blocks)

GA request content union (SDK `ContentBlockParam`): `text`, `image`, `document`,
`search_result`, `thinking`, `redacted_thinking`, `tool_use`, `tool_result`,
`server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`,
`code_execution_tool_result`, `bash_code_execution_tool_result`,
`text_editor_code_execution_tool_result`, `tool_search_tool_result`,
`container_upload`. Beta adds (among others) `compaction`, `mcp_tool_use`,
`mcp_tool_result`, `tool_addition`, `tool_removal` and advisor blocks (see
section 3). Message `content` may be a string (shorthand for one text block).
Limit: 100,000 messages per request; request body 32 MB (413
`request_too_large`, returned by Cloudflare before the API) [errors].

### 4.1 Text

`{type:"text", text, cache_control?, citations?}`. `citations` on input text is
for replaying assistant text that carried citations. Empty text blocks can't
be cached [caching]. System text blocks require `minLength: 1`.

### 4.2 Images [vision] [vision-coords]

```ts
interface ImageBlockParam {
  type: 'image';
  source:
    | {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      }
    | { type: 'url'; url: string }
    | { type: 'file'; file_id: string };
  cache_control?: CacheControlEphemeral | null;
  transformations?: { oversized_image?: 'downsize' | 'error' } | null;
}
```

- Formats: JPEG, PNG, GIF, WebP only. Animated GIF: first frame only (silent).
  Base64 `media_type` is an enum, so anything else (e.g. `image/bmp`,
  `image/heic`) fails validation (400). What happens when a URL or file serves
  an unsupported type is not documented (probe).
- Images allowed in `user` messages and inside `tool_result` / custom
  `document` content. Not in `system`.
- Count: up to 600 per request (100 for models with a 200k context window);
  claude.ai is 20. Max 8000x8000 px. **More than 20 images in a request** (all
  image blocks, including history and tool results; on Bedrock/Vertex also
  documents) triggers a stricter per-image dimension limit; oversized images
  then fail with an `invalid_request_error` that mentions "many-image
  requests" and states the limit. The docs' safe rule: keep both sides at or
  under 2000 px, or send at most 20 image/document blocks.
- Size: 10 MB per image (base64) on the Claude API (5 MB on Bedrock / Vertex),
  and the 32 MB request cap.
- Resolution: images above the model's tier are **silently downscaled**
  (standard tier 1568 px long edge / 1568 visual tokens; high-res tier on
  Claude 4.7+: 2576 px / 4784 visual tokens; a token = a 28x28 patch). Opt out
  per image with `transformations.oversized_image: "error"` => 400 naming the
  dimensions. Exception: computer/browser toolset screenshots in
  `tool_result` are always rejected (not downscaled) when too large.
- Bedrock and Vertex accept only base64 sources (URL/file not available).
- No image metadata is read (EXIF ignored).

### 4.3 Documents [pdf] [citations] [files]

```ts
interface DocumentBlockParam {
  type: 'document';
  source:
    | { type: 'base64'; media_type: 'application/pdf'; data: string }
    | { type: 'url'; url: string } // PDF by URL
    | { type: 'file'; file_id: string } // PDF or text/plain upload
    | { type: 'text'; media_type: 'text/plain'; data: string }
    | { type: 'content'; content: string | Array<TextBlockParam | ImageBlockParam> }; // "custom content"
  title?: string | null; // passed to the model, not citable; length-limited (limit not stated)
  context?: string | null; // passed to the model, not citable (metadata / JSON)
  citations?: { enabled?: boolean } | null;
  cache_control?: CacheControlEphemeral | null;
}
```

- **Only PDF and plain text are document types.** `.docx`, `.xlsx` etc. are not
  supported in document blocks: convert to text/PDF, or send to code
  execution via `container_upload` [files]. A file whose type does not match
  the block (image file in a document block) => 400 "Invalid file type"
  [files]. CSV/MD may be uploaded with explicit `text/plain` content type.
- PDF limits: 32 MB request; **600 pages per request (100 when the request's
  context window is under 1M tokens)**; no encrypted/password PDFs. Each page
  is converted to an image plus extracted text (1,500-3,000 text tokens/page
  plus image tokens). All active models support PDFs. Bedrock/Vertex: base64
  only.
- Custom content documents (`source.type: "content"`): the blocks are used as
  the citation chunks (no further chunking).
- Documents are allowed in user messages and inside `tool_result` content.

### 4.4 Search results [search-results]

```ts
interface SearchResultBlockParam {
  type: 'search_result';
  source: string; // any stable string: URL or "kb://..."
  title: string;
  content: Array<TextBlockParam>; // text only, non-empty strings
  citations?: { enabled?: boolean }; // default disabled
  cache_control?: CacheControlEphemeral | null;
}
```

- Allowed in user messages (top-level) and in `tool_result.content` (where
  they must be the only block type). Rejected in assistant messages.
- All active models except Haiku 3. No beta header.
- Citations all-or-nothing across all search results in a request (mixing =>
  error). When the **web search tool** is in the same request, citations must
  be enabled on all `search_result` blocks.

### 4.5 Files API [files]

- **GA, no beta header.** The old `files-api-2025-04-14` header still works and
  switches list/metadata responses to the old beta shapes (no `expires_at`,
  `has_more`/`first_id`/`last_id` pagination). SDK `client.beta.files` stopped
  sending it in TS SDK 0.122.0.
- `POST /v1/files` (multipart) => `{id:"file_...", type:"file", filename,
mime_type, size_bytes, created_at, downloadable, expires_at}`. Optional
  `expires_in_seconds` (3,600 to 7,776,000). 500 MB per file, 1 TB per org,
  ~500 file requests/min. Operations are free; content used in messages is
  billed as input tokens. **Not ZDR-eligible.**
- Usage in Messages: `image` with `{type:"file", file_id}` (jpeg/png/gif/webp),
  `document` with `{type:"file", file_id}` (PDF or text/plain),
  `container_upload {type:"container_upload", file_id}` for any type the code
  execution container should get (needs the code execution tool).
- Files are workspace-scoped (any key in the workspace can read them); docs
  warn never to accept file IDs from end users. An expired file makes a
  Messages request "fail before inference"; a missing one is 404
  `not_found_error` "File `file_...` not found." Only files produced by code
  execution / skills are downloadable.
- Bedrock/Vertex: no Files API (base64 only). Foundry: only "Hosted on
  Anthropic" deployments.

### 4.6 `container_upload`

`{type:"container_upload", file_id, cache_control?}` in a user message puts the
file into the code execution container (path rules in section 3). Without a
code execution tool in the request this is presumably an error (probe).
Content inside the summarized range of a compaction is lost ("Images,
documents, `container_upload` blocks, and fetched URLs inside the summarized
messages are gone once the block replaces them") [compaction-on-demand].

### 4.7 Mapping our shared parts

| Ours                                      | Anthropic block                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| text                                      | `{type:"text", text}`                                                                                                                   |
| image URL                                 | `{type:"image", source:{type:"url", url}}`                                                                                              |
| image base64                              | `{type:"image", source:{type:"base64", media_type, data}}` (media type must be one of the four)                                         |
| image file ID                             | `{type:"image", source:{type:"file", file_id}}`                                                                                         |
| file URL (PDF)                            | `{type:"document", source:{type:"url", url}}` (URL source is PDF only per the SDK type name `URLPDFSource`)                             |
| file base64, `application/pdf`            | `{type:"document", source:{type:"base64", media_type:"application/pdf", data}}`                                                         |
| file base64, `text/plain` (or other text) | `{type:"document", source:{type:"text", media_type:"text/plain", data: utf8}}` (needs decoding; or refuse and let the caller send text) |
| file base64, any other type               | refuse (no Anthropic block takes it; `container_upload` needs a file ID)                                                                |
| file ID                                   | `{type:"document", source:{type:"file", file_id}}` (PDF/text upload only; other types 400)                                              |
| part `providerOptions`                    | merged: `cache_control`, `title`, `context`, `citations`, `transformations`                                                             |

Filename has no slot (use `title`). Images are not valid in `system`, so a
mid-conversation `system` message with an image part must be refused (system
content blocks are text, `tool_addition`, `tool_removal`).

---

## 5. Citations [citations] [search-results]

Request: `citations: {enabled: true}` on `document` blocks (PDF, plain text,
custom content) or `search_result` blocks. **All or none**: every document in
the request must have the same setting; same for all search results. All
active models. Incompatible with `output_config.format` (400). Toggling
citations changes the system prompt (invalidates system+messages cache)
[caching]. Image citations are not supported (scanned PDFs with no text are not
citable).

Response: the answer is split into several `text` blocks; cited spans carry
`citations: TextCitation[]` (non-cited blocks have `citations: null` in the SDK
type). Location types:

| `type`                       | Source                | Fields (besides `type`, `cited_text`)                                                                          |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `char_location`              | plain text doc        | `document_index`, `document_title`, `start_char_index`, `end_char_index` (0-based, end exclusive), `file_id`   |
| `page_location`              | PDF                   | `document_index`, `document_title`, `start_page_number`, `end_page_number` (1-based, end exclusive), `file_id` |
| `content_block_location`     | custom content doc    | `document_index`, `document_title`, `start_block_index`, `end_block_index` (0-based, end exclusive), `file_id` |
| `search_result_location`     | `search_result` block | `source`, `title`, `search_result_index`, `start_block_index`, `end_block_index`                               |
| `web_search_result_location` | web search tool       | `url`, `title`, `encrypted_index`                                                                              |

The beta `BetaTextCitation` union has the same five variants.

- `document_index` counts all document blocks in the request across all
  messages; `search_result_index` counts all `search_result` blocks in order.
- `cited_text` is not billed as output, and not billed as input when replayed.
- Replay: the text blocks with their `citations` are part of the assistant
  message; verbatim replay is accepted (`TextBlockParam.citations`). Web
  search citations carry `encrypted_index`, which must be preserved.
- Streaming uses `citations_delta`; irrelevant to us.

---

## 6. Context management and compaction

### 6.1 Context editing (`context_management.edits`) [context-editing]

Beta, header `context-management-2025-06-27`, "all supported Claude models".
Applied server-side before the prompt reaches the model; **the client keeps
and replays the full unmodified history** (fits a stateless gateway).

```ts
context_management?: { edits?: Array<
  | { type: 'clear_tool_uses_20250919';
      trigger?: { type: 'input_tokens'; value: number } | { type: 'tool_uses'; value: number };  // default 100k input tokens
      keep?: { type: 'tool_uses'; value: number };               // default 3
      clear_at_least?: { type: 'input_tokens'; value: number };
      exclude_tools?: string[];
      clear_tool_inputs?: boolean | string[] }                   // default false
  | { type: 'clear_thinking_20251015';
      keep?: { type: 'thinking_turns'; value: number } | { type: 'all' } | 'all' }  // default model-specific
  | { type: 'compact_20260112'; trigger?: { type: 'input_tokens'; value: number };  // >= 50,000; default 150,000
      pause_after_compaction?: boolean; instructions?: string | null }
> }
```

- `clear_thinking_20251015` must come first when combined.
- Cleared tool results are replaced by placeholder text; clearing invalidates
  the cache from that point (use `clear_at_least`).
- On Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, server-side context
  management never invalidates thinking blocks (client edits do).
- Response field: `context_management: { applied_edits: [{type:
"clear_thinking_20251015", cleared_thinking_turns, cleared_input_tokens} |
{type: "clear_tool_uses_20250919", cleared_tool_uses, cleared_input_tokens}] }`.
  `count_tokens` returns `context_management.original_input_tokens`.
- Can be combined with the memory tool (Claude gets a warning before clearing).

### 6.2 Threshold compaction (`compact_20260112`) [compaction-threshold]

Beta header **`compact-2026-01-12`**, inside `context_management.edits`. Models:
Fable 5.1/5, Mythos 5.1/5/Preview, Opus 5.5/5/4.8/4.7/4.6, Sonnet 5.5/5/4.6,
Haiku 5.5. ZDR-eligible.

- When input tokens reach `trigger`, the API summarizes, emits a `compaction`
  block **at the start of the assistant content**, and continues the response
  in the same request. Can happen more than once per request with server
  tools (trigger checked at each sampling iteration).
- `pause_after_compaction: true` => the response stops with
  `stop_reason: "compaction"` right after the block, so the caller can
  re-insert recent messages before continuing (on Fable 5.1, Opus 5.5, Sonnet
  5.5, Haiku 5.5 strip thinking from re-inserted turns or use
  `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` with
  `thinking-binding-controls-2026-08-01`).
- Replay: append the response as usual; the API ignores every content block
  before the last `compaction` block (you may keep or drop the earlier
  messages). The block must be sent back exactly as returned. A failed
  summary is a block with `content: null` (happens when the model calls a
  tool during summarization; fix with `instructions` saying not to).
- Usage: with the beta, every response has `usage.iterations[]`
  (`{type:"compaction"|"message", input_tokens, output_tokens}`); the
  top-level `input_tokens`/`output_tokens` **exclude** compaction iterations.
  Billing = sum of iterations.
- `cache_control` may be put on the compaction block.

### 6.3 On-demand compaction (`compaction` param) [compaction-on-demand]

Beta header **`compact-2026-09-04`**; same model list (Opus 4.7/4.6 etc.
included). Top-level request field:

```json
"compaction": { "type": "summarize", "instructions": "optional, <= 16,384 chars" }
```

- The request summarizes every message once and returns **only** a
  `compaction` block, `stop_reason: "compaction"`, top-level usage 0 and
  `usage.iterations: [{type:"compaction", ...}]`. It is a normal non-streaming
  call, so it fits `complete` (the caller owns the swap).
- Cannot be combined with `context_management` (any edits); rejected with
  `stop_sequences`, `output_config.format`, `tool_choice` any/tool, a
  task-budget `remaining`, or when the last assistant turn has an unanswered
  tool call. Send the same `system` and `tools` as the conversation.
- Missing summary is still 200 with empty `content`; `stop_reason` tells why
  (`max_tokens`, `model_context_window_exceeded`, `tool_use`, `refusal`,
  `end_turn`).
- Continue: replace the summarized messages with the returned assistant
  message; the block must be **first** in `messages` (its own assistant
  message, or the first content block of the first user/assistant message);
  exactly one `compaction` block per request; send the beta header on every
  later request carrying it (otherwise 400 "compaction is not one of the
  expected content block types").
- Error codes in `error.details.error_code`: `compaction_unavailable` (529),
  `compaction_block_misplaced`, `compaction_signature_invalid`,
  `compaction_content_mismatch`, `compaction_nothing_to_summarize` (400).
  Sending extra fields (e.g. `citations: null`, `text: null`) => 400 "Extra
  inputs are not permitted".
- **Silent failures**: summarized messages left after the block are sent to
  the model again; a request that omits the block gives the model no summary.
  Neither errors.

### 6.4 The `compaction` block (beta SDK)

```ts
interface BetaCompactionBlock {
  type: 'compaction';
  content: string | null; // summary text, null if compaction failed
  encrypted_content: string | null; // "opaque metadata from prior compaction, to be round-tripped verbatim"
  signature?: string | null; // on-demand blocks are signed
  tool_changes?: Array<tool_addition | tool_removal> | null; // tool set at the end of the compacted range
}
// Param adds cache_control; all other fields must be sent back unchanged.
```

Implication: with D1/D2 verbatim replay this needs nothing special, but the
adapter must never serialize `undefined`/`null` extras into it, and the
gateway must forward the compaction beta header whenever the history contains
a compaction block (the caller's responsibility via headers in
`providerOptions`, or detectable by the adapter; see open questions).

---

## 7. System prompts

### 7.1 Top-level `system`

`system?: string | Array<TextBlockParam>`; each block `{type:"text", text
(minLength 1), cache_control?, citations?}`. Text only. Cacheable (it is the
second segment of the cache prefix after `tools`). Any edit invalidates the
system and messages caches [caching]. Our `instructions` maps here; multiple
instruction parts can map to multiple text blocks so a part's
`providerOptions.cache_control` lands on its own block (unlike OpenAI's single
string).

### 7.2 Mid-conversation `system` messages (native, GA) [mid-system] [messages-guide]

`{"role": "system", "content": string | blocks}` inside `messages`.

- **Models:** Fable 5.1, Mythos 5.1, Fable 5, Mythos 5, Opus 5.5, Opus 4.8,
  Opus 5, Sonnet 5.5, Haiku 5.5. **Not Sonnet 5** ("use the top-level system
  field there"). Older models (Opus 4.7/4.6, Sonnet 4.6/4.5, Haiku 4.5) are not
  listed, so presumably rejected (probe the exact error). Claude API, Bedrock
  (Claude in Amazon Bedrock) and Vertex.
- **Semantics:** applies from that point on; later system messages override
  earlier ones and the top-level `system` for following turns. Operator
  priority (higher than user text). Appending one keeps the cache prefix.
- **Placement (400 otherwise):** a system message that carries content must
  immediately follow a `user` turn (a user turn of `tool_result`s counts) or an
  `assistant` turn ending in a server tool result (paused turn), and must be
  the last entry or be followed by an `assistant` turn. It cannot be first in
  `messages`, and cannot sit between a `tool_use` and its `tool_result`.
  Consecutive system messages are judged as one group.
- **Content blocks:** `text`; plus `tool_addition` / `tool_removal` (beta);
  turn-scoped messages are text-only.
- **Turn-scoped** (`clear_at: "next_user_message"`, beta header
  `mid-conversation-system-clear-at-2026-08-21`): renders only until the next
  user message; must then stay in the array **byte for byte**; no
  `cache_control`, no `output_config`, no tool blocks. Without the header:
  `messages.N.clear_at: Extra inputs are not permitted`.
- **Per-message effort** (beta `mid-conversation-output-config-2026-07-01`): a
  system message may carry `output_config: {effort}`; an effort-only message
  with empty content may sit anywhere.
- **Tool changes** (beta `inline-tools-2026-09-15`; older reference-only
  variant `mid-conversation-tool-changes-2026-07-01`): `tool_addition` /
  `tool_removal` blocks with `tool: {type:"tool_reference", name}` |
  `{type:"mcp_tool_reference", server_name, name}` |
  `{type:"mcp_toolset_reference", server_name}` |
  `{type:"tool_definition", definition: <tools entry>}` (by value). Unknown
  reference => 400 `tool_reference_unresolved`; same name, different tool
  type => 400 `tool_name_conflict`; caps => 400
  `available_tools_limit_exceeded` (10,000 deferred tools, 10,000 tools defined
  after the first user message, 4 MB). Not allowed right after a paused turn.
  Adding an MCP server mid-conversation additionally needs
  `mcp-client-2026-09-15`; responses then may start with an `mcp_tool_listing`
  block (replay verbatim, keep sending the header).
- **Model caveat:** on Sonnet 5.5 and Haiku 5.5 a system message right after
  tool results may be treated as untrusted (prompt-injection hardening);
  the docs say to relay the end user's words as a `text` block after the last
  `tool_result` in the same user message instead, and keep harness notices in
  a separate system message.
- **Thinking binding:** editing or removing a sent system message invalidates
  later thinking blocks on Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5.

How others emulate it where unsupported: a `user` message (or a text block
after the tool results) with the instruction, often wrapped in a tag such as
`<system-reminder>`; this has user, not operator, priority. Per D3 our
adapter should refuse `system` messages on models where the API refuses them,
and let a helper rewrite explicitly. Since D11 says any model is accepted,
the simplest correct behavior is: always send `role: "system"` and let the
API reject unsupported models (needs a probe to confirm it errors rather
than silently merging; the reference text's "no system role" note suggests
older validation would 400).

### 7.3 Caching on system content [caching]

- `cache_control: {type:"ephemeral", ttl?: "5m"|"1h"}` on system text blocks,
  tools, message content blocks (text, image, document, tool_use,
  tool_result, search_result, compaction, ...). Not on thinking blocks or
  citations sub-blocks; empty text blocks can't be cached.
- Max 4 breakpoints per request; a top-level `cache_control` (automatic
  caching) uses one slot and places itself on the last cacheable block (400 if
  4 explicit breakpoints already exist). Below the minimum cacheable length,
  caching is silently skipped (no error; usage shows zeros).
- Cache prefix order `tools` -> `system` -> `messages`. Toggling web search or
  citations, `speed`, thinking config and effort invalidate (see the table in
  [caching#what-invalidates-the-cache]).

---

## 8. Other request fields (for typing `providerOptions`)

Request body fields (SDK `MessageCreateParamsBase`, GA and beta). Ours = owned
by the adapter (refuse in `providerOptions`); the rest pass through.

| Field                           | Type                                                                                                                                                           | Owner / notes                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                         | string                                                                                                                                                         | ours                                                                                                                                                                                                                       |
| `messages`                      | `MessageParam[]` (roles `user`, `assistant`, `system`)                                                                                                         | ours; max 100,000                                                                                                                                                                                                          |
| `system`                        | string or text blocks                                                                                                                                          | ours (`instructions`)                                                                                                                                                                                                      |
| `tools`                         | tool union                                                                                                                                                     | ours + `providerOptions.tools` appended                                                                                                                                                                                    |
| `stream`                        | boolean                                                                                                                                                        | refuse `true`                                                                                                                                                                                                              |
| `max_tokens`                    | number >= 0 (**required**)                                                                                                                                     | providerOptions. `0` = cache pre-warm with no output. Large values without streaming risk idle-connection drops; SDKs refuse non-streaming requests expected to exceed 10 min [errors#long-requests]                       |
| `tool_choice`                   | section 2.2                                                                                                                                                    | providerOptions (or a shared field later)                                                                                                                                                                                  |
| `stop_sequences`                | string[]                                                                                                                                                       | `stop_reason: "stop_sequence"` + `stop_sequence` in response. Rejected on an on-demand compaction request                                                                                                                  |
| `temperature`, `top_p`, `top_k` | numbers                                                                                                                                                        | deprecated: models released after Opus 4.6 accept only `temperature: 1.0` and `top_p >= 0.99`, and reject any `top_k` (400)                                                                                                |
| `thinking`                      | `{type:"adaptive", display?}` / `{type:"enabled", budget_tokens}` / `{type:"disabled"}` / Sonnet 5.5 `{type:"between_tools"}`; beta `block_binding`            | covered by the thinking research                                                                                                                                                                                           |
| `output_config`                 | `{effort?: low/medium/high/xhigh/max, format?: {type:"json_schema", schema}, task_budget?: {type:"tokens", total, remaining?} (beta task-budgets-2026-03-13)}` | section 2.7                                                                                                                                                                                                                |
| `output_format`                 | deprecated beta                                                                                                                                                | needs `structured-outputs-2025-11-13`                                                                                                                                                                                      |
| `metadata`                      | `{user_id?: string (max 512)}`                                                                                                                                 | opaque id for abuse detection; no PII                                                                                                                                                                                      |
| `service_tier`                  | `"auto"` (default) or `"standard_only"`                                                                                                                        | Priority Tier no longer sold; response `usage.service_tier` (`"standard"`, `"priority"`, `"batch"`) [service-tiers]                                                                                                        |
| `inference_geo`                 | string: `"global"` (default) or `"us"`                                                                                                                         | Claude 4.6+ only (400 on Opus 4.5, Sonnet 4.5, Haiku 4.5 and earlier); `"us"` is 1.1x price; workspace `allowed_inference_geos` can reject; response `usage.inference_geo` [data-residency]                                |
| `container`                     | string id or `{id?, skills?}`                                                                                                                                  | section 3.5; response `container` goes to envelope `native`                                                                                                                                                                |
| `mcp_servers`                   | array (beta)                                                                                                                                                   | section 3.8; contains secrets                                                                                                                                                                                              |
| `context_management`            | `{edits: [...]}` (beta)                                                                                                                                        | section 6.1/6.2                                                                                                                                                                                                            |
| `compaction`                    | `{type:"summarize", instructions?}` (beta)                                                                                                                     | section 6.3                                                                                                                                                                                                                |
| `cache_control`                 | `{type:"ephemeral", ttl?}`                                                                                                                                     | top-level automatic caching                                                                                                                                                                                                |
| `diagnostics`                   | `{previous_message_id: string                                                                                                                                  | null}`                                                                                                                                                                                                                     | response gets `diagnostics.cache_miss_reason` |
| `speed`                         | `"standard"` or `"fast"` (beta `fast-mode-2026-02-01`, research preview, access-gated)                                                                         | Opus 5.5 / 5 / 4.8, Claude API only; error on unsupported models except Opus 4.6 (silently standard); response `usage.speed`; Opus 5.5 fast $8/$40 per MTok; switching speed invalidates system+messages cache [fast-mode] |
| `fallbacks`                     | `"default"` or `[{model, max_tokens?, output_config?, speed?, thinking?}]` (beta `server-side-fallback-2026-07-01`)                                            | server-side retry on another model after a classifier refusal; the response can then contain a beta `fallback` content block and mixed-model output (relevant to D2)                                                       |
| `fallback_credit_token`         | string or object (beta)                                                                                                                                        | fallback billing credit                                                                                                                                                                                                    |

Beta-only body fields (`speed`, `context_management`, `mcp_servers`,
`compaction`, `fallbacks`, `output_format`, `output_config.task_budget`,
`thinking.block_binding`, `thinking.display: "updates"`, message `clear_at`,
message `output_config`) are unknown fields (400 "Extra inputs are not
permitted") without their header.

Not body fields: `anthropic-beta` (SDK `betas`; comma-joined or repeated; an
unknown or unauthorized beta name is a 400 "Unexpected value(s) ... for the
`anthropic-beta` header"; Vertex reads only one header), `anthropic-version:
2023-06-01` (required; within a version Anthropic adds fields and enum values,
so tolerate unknowns), `anthropic-user-profile-id` (SDK `user_profile_id`,
user-profiles beta) and `anthropic-workspace-id` (SDK `workspace_id`) are
headers [beta-headers]. Response fields worth keeping in `native`:
`container`, `context_management`, `diagnostics`, `stop_details`, and `usage`
extras (`service_tier`, `inference_geo`, `speed`, `server_tool_use`,
`iterations`, `cache_creation`).

---

## 9. Gotchas: errors versus silent behavior

### 9.1 Errors (HTTP 400 `invalid_request_error` unless noted)

Tools and tool flow:

- `tool_choice` `any`/`tool` on Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1, or
  with manual extended thinking; `tool` naming a toolset/member; `tool` naming
  a tool without `"direct"` in `allowed_callers`.
- Text or other blocks **before** a `tool_result`; a missing `tool_result` for
  any `tool_use` ("tool_use ids were found without tool_result blocks
  immediately after").
- Text **after** tool results while a server tool or MCP call is still open,
  or while PTC calls are pending; `tools` missing the pending server tool.
- PTC continuation without `container`; PTC tool result with image/document
  content.
- `input_examples` that don't validate; `input_examples`, `strict` or
  entry-level `defer_loading` on a toolset; duplicate toolset or name clash.
- All tools deferred; `defer_loading` + `cache_control` on one tool; unknown
  `tool_reference`.
- Strict/JSON schema outside the subset; over 20 strict tools, 24 optional
  params, 16 union params; "Schema is too complex for compilation."
- `output_format` without its beta header; citations with
  `output_config.format`; mixed citation settings across documents or
  search results; `search_result` mixed with other blocks inside one
  `tool_result`; `search_result` in an assistant message.
- Unsupported Anthropic tool type for the model ("'claude-opus-5-5' does not
  support tool types: ..."), e.g. `computer_20251124` on Opus 5.5.
- Web tools: both domain lists, bad domain format, org conflicts, unsupported
  country, web search disabled for the org, `_20260209`+ without
  `allowed_callers:["direct"]` on non-PTC models, old code execution version
  next to them.
- Expired container id; expired file id ("fails before inference"); missing
  file (404 `not_found_error`); wrong file type for the block.

Messages and system:

- Prefill (last message `assistant`) on Claude 4.6+ / Mythos Preview: "This
  model does not support assistant message prefill. The conversation must end
  with a user message."
- Mid-conversation `system` message misplaced (first, between `tool_use` and
  `tool_result`, followed by a `user` message); tool changes right after a
  paused turn; `clear_at` without its beta header; disallowed content on a
  turn-scoped message.
- Thinking blocks in the latest assistant message modified, reordered or
  filtered; for accounts created on or after 2026-08-31 (or
  `prefix_mismatch_behavior: "error"`), any replayed thinking block whose
  prefix (system, tools, earlier messages) changed.
- Images: base64 media type outside jpeg/png/gif/webp; >8000 px; >20 images
  with large dimensions ("many-image requests"); oversized image marked
  `oversized_image: "error"`; oversized toolset screenshot. Request > 32 MB =>
  413 `request_too_large`.
- Compaction: block misplaced, modified, duplicated, missing header, extra
  fields; `compaction` with `context_management`, `stop_sequences`,
  `output_config.format`, forced `tool_choice`, task budget `remaining`, or an
  unanswered tool call.
- 4 explicit cache breakpoints plus top-level `cache_control` (no slot left).
- `speed: "fast"` on an unsupported model such as Opus 4.7.
- `temperature` other than 1.0, `top_p` below 0.99, or any `top_k` on models
  released after Opus 4.6; `inference_geo` on Claude 4.5 and earlier.
- Beta-only fields without their beta header ("Extra inputs are not
  permitted"); an unknown or unauthorized `anthropic-beta` value.
- A toolset member `tool_use` or `tool_result` without (or with a wrong)
  `toolset_name`, or `toolset_name` on a non-member result; an unanswered call
  in a toolset batch; non-text/image content in a member result.

### 9.2 Silent behavior (no error)

- Images larger than the model's tier are downscaled (unless
  `oversized_image: "error"`); animated images use the first frame; image
  metadata ignored.
- Prompts below the minimum cacheable length are not cached;
  automatic caching walks back to the nearest eligible block or skips caching.
- Thinking blocks from a model the current model cannot read are dropped (not
  billed); for older accounts, prefix-mismatched thinking blocks are dropped.
  Toggling thinking mid-turn silently disables thinking for that request.
- Threshold compaction: all blocks before the last `compaction` block are
  ignored. On-demand compaction: summarized messages left after the block are
  sent again; omitting the block loses the summary.
- Consecutive same-role messages are merged into one turn.
- MCP `configs` naming an unknown tool: ignored.
- `allowed_callers` without `"direct"` is guidance only.
- Server tool failures are HTTP 200 with error content; zero web search hits or
  tool search matches are empty arrays.
- Structured outputs: enum/const capitalization may differ from the schema.
- `speed: "fast"` on Opus 4.6 runs at standard speed (billed standard)
  [pricing].
- Content inside a compacted range (images, documents, `container_upload`,
  fetched URLs) is gone after compaction.
- `disable_parallel_tool_use` on a later request has no effect on earlier calls.

### 9.3 Not documented (probe)

- Whether a `role:"system"` message on an unsupported model (Sonnet 5, Opus
  4.7, Haiku 4.5) is a 400 or silently treated as something else.
- Whether re-sending a `pause_turn` assistant message as the last message
  triggers the "no prefill" 400 on Claude 4.6+ (docs prescribe it; expect it
  to work).
- URL/file image or document sources that serve an unsupported type, or a URL
  that fails to fetch: error code and type.
- `container_upload` without a code execution tool.
- Whether `type: "custom"` on a tool is accepted everywhere; whether
  `description` is truly optional.
- The `title` length limit on documents.
- Behavior of text-only `document` (`source.type:"text"`) with non-UTF-8 or
  other `media_type` values.

---

## 10. Implications for our design

### (a) Shared shapes that map cleanly

- Function tool => `{name, description, input_schema, strict?}`; tool-level
  `providerOptions` merged (`cache_control`, `defer_loading`,
  `allowed_callers`, `input_examples`, `eager_input_streaming`). Our `custom`
  tool kind: refuse (no Anthropic equivalent).
- `tool_result` (function) => `{type:"tool_result", tool_use_id, content,
is_error}`. `isError` is a real field here. Content: string when a single
  text part, else blocks. Result `providerOptions` merged (`cache_control`,
  and `toolset_name` for toolset members, though those results are better
  modeled as native items, see (c)).
- `instructions` => top-level `system` as an array of text blocks (keeps
  per-part `cache_control`).
- `system` message => `{role:"system", content}` natively on supported
  models. Only text parts; refuse image/file parts in system messages. The
  placement rule means the adapter cannot put a system message anywhere the
  caller likes: either validate (first message, between tool_use and
  tool_result, followed by user) or let the API 400. Recommend letting the
  API decide, with clear error mapping.
- User image/file parts => section 4.7.

### (b) Ordering constraints the adapter must respect when flattening

- Our tool results and any user text in the same turn must be emitted as one
  user message with all `tool_result` blocks first.
- When the previous assistant message has an unanswered `server_tool_use`
  / `mcp_tool_use`, or pending PTC calls, nothing may follow the tool results:
  the adapter should refuse a user text part placed in the same turn (or the
  API 400s). Detecting this needs the previous assistant message, which is in
  the request (stateless), so the gateway can do it.
- A system message after tool results must come after the tool-result user
  message (the API requires it); a user text "relay" goes inside that user
  message after the results (Sonnet 5.5/Haiku 5.5 guidance).
- Consecutive same-role messages are merged by the API; adjacent `native`
  and `tool_result` messages can therefore be emitted as separate user
  messages, but one user message is cleaner and matches the parallel-tool
  guidance.

### (c) Native items

- Assistant output is replayed verbatim (D1). Nothing in it may be dropped or
  normalized (`caller`, `citations`, `encrypted_*`, `signature`, `toolset_name`,
  empty thinking).
- Things the caller sends that are not shared shapes: computer/browser
  toolset results (`tool_result` with `toolset_name`, image+text,
  `browser_state`), client tool search results with `tool_reference`,
  `search_result` blocks, `container_upload`, `tool_addition`/`tool_removal`
  inside system messages, on-demand `compaction` blocks placed first,
  `document` blocks with citations/custom content. These travel as `native`
  user/system content (or as part `providerOptions` where they are just
  extra fields on a block we already produce).
- The extractor should report pending client calls as `tool_use` blocks
  without results (with `caller` and `toolset_name`), and separately the
  open server calls (`server_tool_use`/`mcp_tool_use` without result) so a
  harness knows it must send results only.

### (d) Stop reasons

`end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`
(+ `stop_details`), `model_context_window_exceeded`, and beta `compaction`.
These map directly (D12 needs no derivation). `pause_turn` and `compaction`
with `pause_after_compaction` mean "send the message back and call again".

### (e) Headers and statefulness

- Beta headers are request headers, not body fields: `providerOptions` is
  body-only today (design open question). Many features in this note need
  one (compaction, context editing, MCP, advisor, mid-conversation tool
  changes, `clear_at`, task budgets, fast mode, server-side fallback), and
  some must persist for as long as the history carries their blocks. The
  Anthropic profile needs an `anthropicBeta: string[]` request option (or
  similar) forwarded as `anthropic-beta`.
- Containers and Files are provider-side state; the gateway stays stateless
  because the caller passes `container` and file ids. The response
  `container` belongs in the envelope's `native` (D15).
- Tool changes between turns break thinking binding (tools are part of the
  thinking prefix) and the cache; Anthropic's answer is `defer_loading` +
  mid-conversation `tool_addition`. Worth documenting for harness authors.
