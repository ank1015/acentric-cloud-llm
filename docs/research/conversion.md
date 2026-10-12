# Cross-provider conversion: live findings

Live calls on 2026-10-12 to settle how `convert` builds messages for another
provider. OpenAI on `gpt-6-luna` (and `gpt-6.1-sol`, `gpt-5.6-luna`),
Fireworks on `deepseek-v4p1-flash`, Anthropic on `claude-haiku-5-5`. Each
request replays a hand-built tool exchange (asked for the Oslo weather, one
call, one result) and asks for the answer.

## Responses format (OpenAI, Fireworks)

| Input                                                             | OpenAI                                                       | Fireworks             |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| assistant `message` and `function_call` items without IDs         | 200                                                          | 200                   |
| the same with `annotations` left out                              | 200                                                          | 200                   |
| foreign item IDs (`msg_…`, `fc_…` from Fireworks), `store: false` | 200                                                          | 200                   |
| a `reasoning` item with only summary text, no ID                  | 200, **ignored** (input tokens equal to no reasoning: 90/90) | 200, read (363 → 604) |
| the same with a foreign `rs_…` ID                                 | **404** "Item with id 'rs_…' not found"                      | 200                   |
| `cache_control` on `input_text`                                   | **400** "Unknown parameter"                                  | 200, ignored          |
| `call_id` `functions.get_weather:0`                               | 200                                                          | 200                   |

OpenAI encrypted reasoning from `gpt-6-luna`, replayed with the call and its
result (input tokens with the reasoning / without it):

| Target         | With | Without | Reasoning            |
| -------------- | ---- | ------- | -------------------- |
| `gpt-6-luna`   | 169  | 126     | read                 |
| `gpt-6.1-sol`  | 169  | 126     | read                 |
| `gpt-5.6-luna` | 126  | 126     | **silently ignored** |

As with Anthropic, reasoning moved to another model never errors and is read
by some targets and ignored by others.

## Messages format (Anthropic)

| Input                                                    | Result                                               |
| -------------------------------------------------------- | ---------------------------------------------------- |
| hand-built `text` + `tool_use`, no thinking, thinking on | 200                                                  |
| `tool_use` before `text` in one assistant message        | 200                                                  |
| tool use IDs of 64, 65 and 200 characters                | 200: no length limit                                 |
| tool use ID `functions.get_weather:0`                    | 400 "String should match pattern '^[a-zA-Z0-9_-]+$'" |
| `detail` on a text block                                 | 400 "Extra inputs are not permitted"                 |
| an empty text block in an assistant message              | 400 "text content blocks must be non-empty"          |
| `tool_use.input` that is a string                        | 400 "Input should be an object"                      |

## Decisions

- Converted items carry no IDs. Reasoning items never keep a foreign ID.
- Reasoning bound to a model (OpenAI encrypted reasoning, Anthropic signed
  thinking) is dropped whenever the model changes. With `reasoning: "text"`
  its readable text is carried instead: as a plain `reasoning` item where the
  target reads one (Fireworks), otherwise as assistant text, since OpenAI
  ignores plain reasoning items.
- Options on shared parts and tool results that belong to another provider
  are dropped; options the target knows, or that no provider is known to own,
  are kept. Nothing is translated: cache breakpoints are a per-request
  strategy, and the providers place and limit them differently.
- Tool call IDs are rewritten only for Anthropic's pattern, deterministically,
  and the same mapping is applied to their results.
- Empty text is never written for Anthropic. Arguments that are not a JSON
  object are wrapped for Anthropic and reported.
