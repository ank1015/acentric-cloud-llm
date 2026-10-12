# Converting a conversation to another provider

`convert(messages, to, options?)` returns the conversation ready for another
provider or model, and a record of everything it dropped or rewrote. It is
pure (no I/O, clock or randomness), lives in `@acentric-llm/providers` and is
re-exported by the SDK. The live findings behind it are in
[`research/conversion.md`](research/conversion.md).

```ts
import { convert } from '@acentric-llm/sdk';

const { messages, changes } = convert(
  history,
  { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  { reasoning: 'drop' },
);
const response = await llm.complete({
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  messages,
});
```

Keep the original history and convert it each time you send to a provider it
was not written for. Conversion loses things (reasoning, provider items), so a
history stored after converting cannot be converted back. Messages that
already fit the target come back unchanged, so converting a history that is
mostly for the target costs nothing. Switching provider or model also starts
the prompt cache over.

## How it works

Only assistant messages (and `native` messages) belong to a provider; user,
system and tool result messages are shared. For each assistant message:

1. **Same provider and model:** kept as is.
2. **Same API format, another provider or model** (between OpenAI,
   Fireworks and OpenRouter, or OpenAI model A → model B): filtered. Items the target can take are kept;
   item IDs are dropped when the provider changes; reasoning bound to the
   source model and provider items (hosted tool calls, compaction) go.
3. **Another API format** (Responses ↔ Messages): read into provider-neutral
   parts (text, refusal, reasoning text, function calls, custom calls, and
   "other" for anything provider-specific), then written as the target's
   items. The neutral form is internal and never stored.

A converted assistant message is tagged with the target's provider, API and
model, so it replays normally afterwards. Its `id` is dropped when the
provider changes, since a response ID belongs to the provider that answered.

## What moves and what does not

| Item                                                                      | Across formats or providers                                                                                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text                                                                      | Moves. Citations and annotations are dropped.                                                                                                                                                       |
| Function tool calls                                                       | Move: `function_call` ↔ `tool_use`. Arguments that are not a JSON object are wrapped as `{ arguments }` for Anthropic.                                                                              |
| Reasoning bound to a model                                                | Dropped by default, also on a model change within a provider (OpenAI encrypted reasoning, Anthropic signed thinking). See `reasoning` below.                                                        |
| Plain reasoning (Fireworks)                                               | Kept between Fireworks models; otherwise follows the `reasoning` policy.                                                                                                                            |
| Refusals                                                                  | Kept within the Responses format; become text for Anthropic.                                                                                                                                        |
| Custom tool calls                                                         | Kept where the target has custom tools (OpenAI); otherwise dropped with their results.                                                                                                              |
| Hosted or server tool calls and results, compaction, other provider items | Dropped when the provider changes. Their effect is usually in the text.                                                                                                                             |
| `native` messages                                                         | Kept for their own provider; otherwise dropped.                                                                                                                                                     |
| Tool call IDs                                                             | Rewritten only for Anthropic (`^[a-zA-Z0-9_-]+$`): invalid characters become `_`, plus a short hash of the original. Results follow the same mapping.                                               |
| File parts                                                                | Dropped for a target that takes no files (Fireworks).                                                                                                                                               |
| Images and files by file ID                                               | Dropped for a target that takes no file IDs (Fireworks, OpenRouter). Otherwise kept: a file ID from another provider fails there with a clear `not_found`.                                          |
| Options on parts and tool results                                         | Keys another provider owns and the target does not are dropped (`cache_control`, `detail`, `caller`, `toolset_name`, ...). Keys the target owns, and unknown keys, are kept. Nothing is translated. |
| Messages left empty                                                       | Dropped.                                                                                                                                                                                            |
| The application's `custom` messages                                       | Kept.                                                                                                                                                                                               |

Cache breakpoints are not translated between providers: where they go is a
per-request strategy, and providers place and limit them differently
(Anthropic allows four explicit breakpoints; OpenAI caches prefixes on its
own and takes explicit breakpoints only on newer models). A harness sets them
for the provider it is sending to.

## Options

- **`reasoning: 'drop' | 'text'`** (default `drop`): what happens to reasoning
  the target cannot use as is. `text` keeps its readable text: as a plain
  reasoning item where the target reads one (Fireworks), otherwise as
  assistant text (OpenAI and OpenRouter ignore plain reasoning items;
  Anthropic thinking needs a signature). Reasoning with no readable text (encrypted only, or
  Anthropic thinking with `display: "omitted"`) is dropped either way.

## The record

`changes` lists every change, in order:

```ts
{ index: 1, action: 'dropped', what: 'reasoning', detail: 'bound to its model' }
{ index: 1, action: 'rewritten', what: 'tool_call_id', detail: 'functions.get_weather:0 → functions_get_weather_0_9lkr65' }
{ index: 2, action: 'dropped', what: 'part_option', detail: 'cache_control' }
```

`index` is the message's index in the input. A harness can log it, show it
("switched to Claude: 3 reasoning blocks dropped"), or refuse to switch when
something it cares about would be lost.

## Adding a format or provider

A provider adds its row to `TARGETS` (custom tools, files, file IDs, plain
reasoning) and its option keys to `PART_OPTIONS`; both are keyed by provider,
so a new provider fails to compile until it is there. A new API format adds
one converter: `sameFormat`, `read` and `write`.
