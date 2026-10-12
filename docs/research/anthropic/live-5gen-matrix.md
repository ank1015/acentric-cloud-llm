# Claude 5-generation feature matrix, live

One request per cell on 2026-10-12, "Say ok." with `max_tokens: 64` (2000 with a
budget). "ok (thinks)" means the response held a thinking block with thinking
tokens. Raw exchanges are in the session scratchpad (`anthropic-probe/matrix/`).

| Request                            | haiku-5-5                | sonnet-5-5             | opus-5-5               | fable-5-1              | opus-5                   | sonnet-5               | fable-5                |
| ---------------------------------- | ------------------------ | ---------------------- | ---------------------- | ---------------------- | ------------------------ | ---------------------- | ---------------------- |
| no `thinking`                      | ok                       | ok                     | ok                     | ok                     | ok                       | ok                     | ok (thinks)            |
| `thinking: disabled`               | ok                       | 400: use between_tools | 400                    | 400                    | ok                       | ok                     | 400                    |
| `thinking: adaptive`               | ok                       | ok                     | ok                     | ok                     | ok                       | ok                     | ok (thinks)            |
| `thinking: enabled` + budget       | 400                      | 400                    | 400                    | 400                    | 400                      | 400                    | 400                    |
| `thinking: between_tools`          | 400: use between_tools   | ok                     | 400: use between_tools | 400: use between_tools | 400: use between_tools   | 400: use between_tools | 400: use between_tools |
| disabled + effort `max`            | 400: needs effort ≤ high | 400: use between_tools | 400                    | 400                    | 400: needs effort ≤ high | ok                     | 400                    |
| effort `low`                       | ok                       | ok                     | ok                     | ok                     | ok                       | ok                     | ok (thinks)            |
| effort `xhigh`                     | ok                       | ok                     | ok (thinks)            | ok                     | ok                       | ok (thinks)            | ok (thinks)            |
| effort `max`                       | ok (thinks)              | ok (thinks)            | ok (thinks)            | ok                     | ok                       | ok (thinks)            | ok (thinks) max_tokens |
| `tool_choice: any`                 | ok tool_use              | 400                    | 400                    | 400                    | ok tool_use              | ok tool_use            | ok tool_use            |
| `tool_choice: none`                | ok                       | ok                     | ok                     | ok                     | ok                       | ok                     | ok                     |
| `temperature: 0.5`                 | 400: deprecated          | 400: deprecated        | 400: deprecated        | 400: deprecated        | 400: deprecated          | 400: deprecated        | 400: deprecated        |
| `temperature: 1`                   | ok                       | ok                     | ok                     | ok                     | ok (thinks)              | ok (thinks)            | ok (thinks)            |
| `top_p: 0.99`                      | ok                       | ok                     | ok                     | ok                     | ok                       | ok                     | ok (thinks)            |
| final assistant message (prefill)  | 400                      | 400                    | 400                    | 400                    | 400                      | 400                    | 400                    |
| `role: system` after the user turn | ok                       | ok (thinks)            | ok (thinks)            | ok                     | ok (thinks)              | ok (thinks)            | ok (thinks)            |
| `speed: fast` (no beta header)     | 400: needs beta          | 400: needs beta        | 400: needs beta        | 400: needs beta        | 400: needs beta          | 400: needs beta        | 400: needs beta        |
| `inference_geo: us`                | ok                       | ok                     | ok                     | ok                     | ok                       | ok                     | ok (thinks)            |

Error messages, verbatim:

- enabled: `"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" …`
- disabled on Opus 5.5, Fable 5.1, Fable 5: `"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" …`
- disabled on Sonnet 5.5: `To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}`
- disabled + max on Haiku 5.5 and Opus 5: `output_config.effort 'max' is not supported when thinking is disabled on this model. Use effort 'high' or below …`
- forced tool on Sonnet 5.5, Opus 5.5, Fable 5.1: `tool_choice: type "tool" and "any" are not supported for this model.`
- sampling: `` `temperature` is deprecated for this model. ``
- prefill: `This model does not support assistant message prefill. The conversation must end with a user message.`

Notes:

- Every 5-generation model rejects prefill and budgeted thinking, accepts
  mid-conversation system messages, `inference_geo: "us"`, `temperature: 1`
  and `top_p: 0.99`.
- Thinking cannot be turned off on Opus 5.5, Fable 5.1 or Fable 5; Sonnet 5.5
  turns it off with its own `between_tools` type.
- Forced tool choice works on Haiku 5.5, Opus 5, Sonnet 5 and Fable 5 (the
  thinking research found that it skips thinking there).
- Fable 5 thinks even on "Say ok." at every effort; at `max` it spent all 64
  tokens thinking and stopped with `max_tokens` and no text.
