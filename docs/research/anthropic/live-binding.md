# Thinking block binding, live

Live calls on 2026-10-12 against `claude-haiku-5-5`, with adaptive thinking,
`display: "summarized"` and effort `high`. Turn 1 asked a timing question and
called a weather tool; the answer held `thinking` (257 thinking tokens),
`text` and `tool_use`. Turn 2 replayed that assistant message verbatim with a
tool result and changed one thing at a time. Raw exchanges are in the session
scratchpad (`anthropic-probe/binding/`).

On Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5, a signed thinking block is
bound to everything before it: `system`, `tools` and earlier content. The docs
say accounts created on or after 2026-08-31 get a 400 on a mismatch and older
accounts have the block dropped. The test account is older. With the default
behavior, the block was **kept and billed** even after the prefix changed:
input tokens rose by exactly the size of the change, and did not fall by the
257 thinking tokens. Only `drop_block` removed it.

`thinking.block_binding.prefix_mismatch_behavior` (`"error"` or
`"drop_block"`) needs the beta header `thinking-binding-controls-2026-08-01`.
Without the header, the field is refused with "Extra inputs are not
permitted".

## Default behavior (this older account, no binding option)

| Turn 2 change                          | Result | Input tokens |
| -------------------------------------- | ------ | ------------ |
| none                                   | 200    | 934          |
| system text changed (+5 tokens)        | 200    | 939          |
| a tool added                           | 200    | 1002         |
| `prefix_mismatch_behavior: drop_block` | 200    | 682          |
| thinking block removed from the replay | 200    | 677          |

## `prefix_mismatch_behavior: "error"`

| Turn 2 change                                         | Result                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| none                                                  | 200                                                                                       |
| system text changed                                   | 400 "The `system` prompt differs from the one this block was created with."               |
| a tool added                                          | 400 "The `tools` list differs from the one this block was created with."                  |
| a tool description changed                            | 400, same                                                                                 |
| earlier user text changed                             | 400 "Content before this block differs … first at `messages.0.content.0`."                |
| a system message inserted before the assistant turn   | 400 "… content before this block that was not present … first at `messages.0.content.1`." |
| a system message after the tool result (new content)  | 200                                                                                       |
| system as a string vs one text block, same text       | 200                                                                                       |
| `cache_control` added to the system block             | 200                                                                                       |
| user content as a string vs one text block, same text | 200                                                                                       |
| effort `high` → `low`                                 | 200                                                                                       |
| `display` summarized → omitted                        | 200                                                                                       |
| `max_tokens` changed                                  | 200                                                                                       |
| model changed to `claude-sonnet-5-5`                  | 200 (the target used no thinking that turn)                                               |
| the assistant `text` block removed, thinking kept     | 200                                                                                       |

Every 400 has the prefix ``messages.1.content.0: Invalid `signature` in
`thinking` block. The block is bound to a different conversation. Remove the
block, or set `thinking.block_binding.prefix_mismatch_behavior` to
"drop_block".`` and type `invalid_request_error`.

## What this means for the adapter

- The binding compares content, not bytes: a string and the same text as a
  single block are equal, and `cache_control` is ignored.
- Effort, display and `max_tokens` are not part of the binding on this model.
  pi's per-message effort markers (`{role:"system", content:[],
output_config}`) were not needed here. Whether their absence matters
  elsewhere is not established.
- Changing tools or the system prompt mid-conversation breaks the binding on
  every replayed thinking block before the change. Newer accounts get a 400,
  which retrying will not fix. That is the caller's history, not ours to
  rewrite: the adapter replays verbatim and passes `thinking.block_binding`
  through, which needs the beta header.
