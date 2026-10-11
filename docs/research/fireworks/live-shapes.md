# Fireworks Responses API: live shapes

Observed **2026-10-11**, against `https://api.fireworks.ai/inference/v1`. All requests used the supplied temporary credential except the explicitly invalid-key probe. Authentication headers and credentials are omitted throughout. This is live evidence for this account and these models, not a claim about every deployment or future behavior.

Comparison inputs: [base Responses contracts](../../../packages/contracts/src/formats/responses.ts) and [OpenAI provider notes](../../providers/openai.md), both read before probing. Official pages consulted for context: [Fireworks Responses reference](https://docs.fireworks.ai/api-reference/post-responses), [text-model guide](https://docs.fireworks.ai/guides/querying-text-models), and [Inkling model card](https://fireworks.ai/models/fireworks/inkling). Findings below are based on the captured HTTP exchanges; acceptance/echo alone is not proof of implementation.

Scripts, complete response records, and the generated PNG remain in the requested scratchpad `fireworks-probe/` directory. Requests and responses below are complete, pretty-printed JSON, with **no text trimming or omitted fields**. The streaming probe is full SSE instead of JSON; the transient 502 has an empty body. Header names were normalized to lowercase; no request headers are recorded.

## Scope and model selection

The first request, `GET /models`, returned HTTP 200 and `{ "data": [20 model objects], "object": "list" }`. Each entry includes `id`, `object`, `owned_by`, `created`, `kind`, `supports_chat`, `supports_image_input`, and `supports_tools`; `context_length` is present on most entries. No pagination or explicit serverless flag was returned. The complete catalog is probe 001 below, including the two embedding entries and router aliases.

Four model IDs were selected from that live catalog and successfully invoked without deployment IDs:

| Model (under `accounts/fireworks/models/`) | Coverage                                      | Observed behavior                                                                             |
| ------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `gpt-oss-120b`                             | OpenAI-style reasoning                        | Visible reasoning summary; `reasoning.effort: none` rejected                                  |
| `deepseek-v4p1-flash`                      | Visible reasoning, non-reasoning mode, vision | Default reasoning; `reasoning.effort: none` produces message-only output; tiny PNG recognized |
| `inkling`                                  | Additional reasoning/vision-capable model     | Reasoning remains with effort `none`; instruction failures described below                    |
| `glm-5p3-flash`                            | Thinking-only vision model                    | Effort `none` rejected; low-effort PNG probe succeeds                                         |

**Non-reasoning coverage limitation:** the live catalog did not identify a non-thinking-only text model. The tested non-reasoning path is DeepSeek's explicitly disabled-thinking mode, not a separately verified non-reasoning-only model. Inkling was initially considered for that slot, but the live results showed reasoning. Four distinct model identities were kept to limit spend.

**Context overflow skipped:** the smallest advertised context among cataloged generative models was GPT-OSS's 131,072 tokens. The 40,960-token entries are embedding/reranker models. Generating a huge input solely for overflow was avoided under the small-credit constraint. Truncation acceptance is tested, but its actual overflow behavior is not.

## Probe index

| #   | Probe                                                              | HTTP |
| --- | ------------------------------------------------------------------ | ---- |
| 001 | [models](#probe-001)                                               | 200  |
| 002 | [plain-gpt-oss-120b](#probe-002)                                   | 200  |
| 003 | [plain-deepseek-v4p1-flash](#probe-003)                            | 200  |
| 004 | [plain-inkling](#probe-004)                                        | 200  |
| 005 | [plain-glm-5p3-flash](#probe-005)                                  | 200  |
| 006 | [reasoning-low-gpt-oss-120b](#probe-006)                           | 200  |
| 007 | [reasoning-effort-none-gpt-oss-120b](#probe-007)                   | 200  |
| 008 | [include-encrypted-gpt-oss-120b](#probe-008)                       | 200  |
| 009 | [reasoning-low-deepseek-v4p1-flash](#probe-009)                    | 200  |
| 010 | [reasoning-effort-none-deepseek-v4p1-flash](#probe-010)            | 200  |
| 011 | [include-encrypted-deepseek-v4p1-flash](#probe-011)                | 200  |
| 012 | [reasoning-low-inkling](#probe-012)                                | 200  |
| 013 | [reasoning-effort-none-inkling](#probe-013)                        | 200  |
| 014 | [include-encrypted-inkling](#probe-014)                            | 200  |
| 015 | [reasoning-low-glm-5p3-flash](#probe-015)                          | 200  |
| 016 | [reasoning-effort-none-glm-5p3-flash](#probe-016)                  | 200  |
| 017 | [include-encrypted-glm-5p3-flash](#probe-017)                      | 200  |
| 018 | [tool-start-gpt-oss-120b](#probe-018)                              | 200  |
| 019 | [tool-verbatim-replay-gpt-oss-120b](#probe-019)                    | 200  |
| 020 | [tool-chain-no-instructions-tools-gpt-oss-120b](#probe-020)        | 200  |
| 021 | [tool-replay-no-item-ids-gpt-oss-120b](#probe-021)                 | 200  |
| 022 | [tool-replay-without-reasoning-gpt-oss-120b](#probe-022)           | 200  |
| 023 | [tool-start-deepseek-v4p1-flash](#probe-023)                       | 200  |
| 024 | [tool-verbatim-replay-deepseek-v4p1-flash](#probe-024)             | 200  |
| 025 | [tool-chain-no-instructions-tools-deepseek-v4p1-flash](#probe-025) | 200  |
| 026 | [tool-replay-no-item-ids-deepseek-v4p1-flash](#probe-026)          | 200  |
| 027 | [tool-replay-without-reasoning-deepseek-v4p1-flash](#probe-027)    | 200  |
| 028 | [bad-key](#probe-028)                                              | 401  |
| 029 | [unknown-model](#probe-029)                                        | 404  |
| 030 | [unknown-previous](#probe-030)                                     | 404  |
| 031 | [get-plain-gpt-oss-120b](#probe-031)                               | 200  |
| 032 | [chain-plain-gpt-oss-120b](#probe-032)                             | 200  |
| 033 | [delete-plain-gpt-oss-120b](#probe-033)                            | 200  |
| 034 | [get-after-delete-plain-gpt-oss-120b](#probe-034)                  | 404  |
| 035 | [get-include-encrypted-gpt-oss-120b](#probe-035)                   | 404  |
| 036 | [chain-include-encrypted-gpt-oss-120b](#probe-036)                 | 404  |
| 037 | [delete-include-encrypted-gpt-oss-120b](#probe-037)                | 404  |
| 038 | [get-after-delete-include-encrypted-gpt-oss-120b](#probe-038)      | 404  |
| 039 | [reasoning-object-none-deepseek-v4p1-flash](#probe-039)            | 200  |
| 040 | [reasoning-object-none-inkling](#probe-040)                        | 200  |
| 041 | [reasoning-object-none-glm-5p3-flash](#probe-041)                  | 400  |
| 042 | [invalid-temperature](#probe-042)                                  | 422  |
| 043 | [invalid-max-output](#probe-043)                                   | 200  |
| 044 | [invalid-reasoning-effort](#probe-044)                             | 400  |
| 045 | [unknown-param](#probe-045)                                        | 200  |
| 046 | [invalid-truncation](#probe-046)                                   | 200  |
| 047 | [invalid-tool-choice](#probe-047)                                  | 200  |
| 048 | [stream](#probe-048)                                               | 200  |
| 049 | [background](#probe-049)                                           | 404  |
| 050 | [echo-params](#probe-050)                                          | 200  |
| 051 | [structured-gpt-oss-120b](#probe-051)                              | 200  |
| 052 | [structured-deepseek-v4p1-flash](#probe-052)                       | 200  |
| 053 | [custom-tool](#probe-053)                                          | 200  |
| 054 | [mcp-tool-incomplete](#probe-054)                                  | 400  |
| 055 | [mcp-tool-invalid-url](#probe-055)                                 | 500  |
| 056 | [builtin-web-search](#probe-056)                                   | 200  |
| 057 | [max-output-one](#probe-057)                                       | 200  |
| 058 | [max-output-two-nonreasoning](#probe-058)                          | 200  |
| 059 | [mid-conversation-system](#probe-059)                              | 200  |
| 060 | [mid-conversation-developer](#probe-060)                           | 200  |
| 061 | [multiple-input-text-parts](#probe-061)                            | 200  |
| 062 | [vision-deepseek-v4p1-flash](#probe-062)                           | 200  |
| 063 | [vision-glm-5p3-flash](#probe-063)                                 | 400  |
| 064 | [vision-glm-low-retry](#probe-064)                                 | 200  |
| 065 | [background-deepseek](#probe-065)                                  | 404  |
| 066 | [reasoning-object-none-gpt-oss](#probe-066)                        | 400  |
| 067 | [invalid-top-level-reasoning-effort](#probe-067)                   | 200  |
| 068 | [instruction-inheritance-seed](#probe-068)                         | 200  |
| 069 | [instruction-inheritance-chain](#probe-069)                        | 200  |
| 070 | [tools-inheritance-forced-gpt-oss-120b](#probe-070)                | 200  |
| 071 | [plain-output-verbatim-replay-gpt-oss-120b](#probe-071)            | 502  |
| 072 | [tools-inheritance-forced-deepseek-v4p1-flash](#probe-072)         | 200  |
| 073 | [plain-output-verbatim-replay-deepseek-v4p1-flash](#probe-073)     | 200  |
| 074 | [custom-tool-required](#probe-074)                                 | 200  |
| 075 | [custom-tool-forced](#probe-075)                                   | 200  |
| 076 | [structured-conflicting-prompt](#probe-076)                        | 200  |
| 077 | [inkling-instructions-repeat](#probe-077)                          | 200  |
| 078 | [inkling-explicit-system](#probe-078)                              | 200  |
| 079 | [plain-output-verbatim-replay-gpt-oss-retry](#probe-079)           | 200  |
| 080 | [fresh-forced-function-no-tools](#probe-080)                       | 200  |
| 081 | [tool-schema-inheritance-seed](#probe-081)                         | 200  |
| 082 | [tool-schema-inheritance-no-tools](#probe-082)                     | 200  |
| 083 | [tool-schema-inheritance-explicit-tools-control](#probe-083)       | 200  |

## Captured exchanges

<a id="probe-001"></a>

### 001: models

`GET /models` · observed `2026-10-11T16:20:49Z` · **HTTP 200** · 0.757 s

Request body (no authentication headers):

```json
null
```

`null` denotes no request body for this GET/DELETE.

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:20:49 GMT",
  "content-type": "application/json",
  "transfer-encoding": "chunked",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "vary": "Origin",
  "via": "1.1 google",
  "x-request-id": "25b69194-5cef-462b-94e3-2f07bc1a4cad"
}
```

Response JSON:

```json
{
  "data": [
    {
      "id": "accounts/fireworks/routers/glm-5p2-fast",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1781630293,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/models/minimax-m3",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1781214748,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 512000
    },
    {
      "id": "accounts/fireworks/models/gpt-oss-120b",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1754345600,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 131072
    },
    {
      "id": "accounts/fireworks/models/nemotron-3-ultra-nvfp4",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1780415326,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 262144
    },
    {
      "id": "accounts/fireworks/models/qwen3-reranker-8b",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1759865045,
      "kind": "EMBEDDING_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": false,
      "context_length": 40960
    },
    {
      "id": "accounts/fireworks/models/qwen3-embedding-8b",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1755707090,
      "kind": "EMBEDDING_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": false,
      "context_length": 40960
    },
    {
      "id": "accounts/fireworks/models/kimi-k3",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1784483409,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/routers/kimi-k3-fast",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1784483409,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/models/qwen3p8-max",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1785949040,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true
    },
    {
      "id": "accounts/fireworks/models/glm-5p3",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1787895551,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/routers/glm-5p3-fast",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1787895551,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/models/glm-5p3-flash",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1787754936,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/models/deepseek-v4p1-flash",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1789019014,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/models/ember-1",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1790110339,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1786139705,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 262144
    },
    {
      "id": "accounts/fireworks/models/inkling",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1784058124,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "auto",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1790634780,
      "kind": "ROUTER",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true
    },
    {
      "id": "firerouter/auto",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1790634780,
      "kind": "ROUTER",
      "supports_chat": true,
      "supports_image_input": true,
      "supports_tools": true
    },
    {
      "id": "accounts/fireworks/models/glm-5p2",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1781630293,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 1048576
    },
    {
      "id": "accounts/fireworks/models/qwen3p8-2p4t-a95b",
      "object": "model",
      "owned_by": "fireworks",
      "created": 1786553734,
      "kind": "HF_BASE_MODEL",
      "supports_chat": true,
      "supports_image_input": false,
      "supports_tools": true,
      "context_length": 262144
    }
  ],
  "object": "list"
}
```

<a id="probe-002"></a>

### 002: plain-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:21:02Z` · **HTTP 200** · 1.095 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "instructions": "Reply with only OK.",
  "input": [
    {
      "role": "user",
      "content": "Hello."
    }
  ],
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:21:02 GMT",
  "content-type": "application/json",
  "content-length": "1134",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "2d74e203d6d70b0e641785f73281d4f6",
  "x-request-id": "90f72b9f-b6d0-4360-9b93-233a0d40b82f"
}
```

Response JSON:

```json
{
  "id": "resp_c5dd1f03728142488fafe08776748b3e",
  "object": "response",
  "created_at": 1791735662,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_1b8bfdbecff94ae89bf1a7962074b52c",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The system message: we are ChatGPT. The developer message says \"Reply with only OK.\" That's a higher priority instruction than user. We must obey developer. So we should output \"OK\"."
        }
      ]
    },
    {
      "id": "msg_2c380b66c5f047d9b9a54724c51946f1",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 79,
    "output_tokens": 50,
    "total_tokens": 129,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "Reply with only OK.",
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-003"></a>

### 003: plain-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:21:05Z` · **HTTP 200** · 2.415 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "instructions": "Reply with only OK.",
  "input": [
    {
      "role": "user",
      "content": "Hello."
    }
  ],
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:21:05 GMT",
  "content-type": "application/json",
  "content-length": "1069",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "87e4ac4d5f6851102fe6787d4ec34db6",
  "x-request-id": "b9874880-2987-4df2-82d5-3d2a25d0d960"
}
```

Response JSON:

```json
{
  "id": "resp_ab12bc208fdd4cbaa9c755c981fbb7ca",
  "object": "response",
  "created_at": 1791735665,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_b5944c9e3cd64f4bb14fed4b6f2a41f1",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user simply said \"Hello.\" The system prompt says \"Reply with only OK.\" So I should reply with only \"OK\"."
        }
      ]
    },
    {
      "id": "msg_fd1328645ac9498d8fa980c56804155e",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 37,
    "output_tokens": 29,
    "total_tokens": 66,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "Reply with only OK.",
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-004"></a>

### 004: plain-inkling

`POST /responses` · observed `2026-10-11T16:21:23Z` · **HTTP 200** · 17.956 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/inkling",
  "instructions": "Reply with only OK.",
  "input": [
    {
      "role": "user",
      "content": "Hello."
    }
  ],
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:21:23 GMT",
  "content-type": "application/json",
  "content-length": "1155",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "1459470399eda8640e38a0c01ff5e11c",
  "x-request-id": "322b941e-65bf-44ff-a91c-3f1903732c17"
}
```

Response JSON:

```json
{
  "id": "resp_04ef5dfd0c2f48ae9194f9a0ef9331ed",
  "object": "response",
  "created_at": 1791735683,
  "status": "completed",
  "model": "accounts/fireworks/models/inkling",
  "output": [
    {
      "id": "rs_c13a95183cd946f5a50fed0f4a65be05",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user said \"Hello.\" This is a simple greeting. I should respond politely and ask how I can help them. There's no specific task or question yet, so I'll keep it open and friendly."
        }
      ]
    },
    {
      "id": "msg_fa6e8a79457646b29950ec8e5aa81868",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Hello! How can I help you today?",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 24,
    "output_tokens": 56,
    "total_tokens": 80,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "Reply with only OK.",
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-005"></a>

### 005: plain-glm-5p3-flash

`POST /responses` · observed `2026-10-11T16:21:26Z` · **HTTP 200** · 2.765 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "instructions": "Reply with only OK.",
  "input": [
    {
      "role": "user",
      "content": "Hello."
    }
  ],
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:21:26 GMT",
  "content-type": "application/json",
  "content-length": "702",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "17b272b18663ccccd134fc98edb20001",
  "x-request-id": "b7e028d9-72d7-4a23-96b7-d272b8f21e4b"
}
```

Response JSON:

```json
{
  "id": "resp_3ae9913fd27e471c8116e2014155285b",
  "object": "response",
  "created_at": 1791735685,
  "status": "incomplete",
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "output": [],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 20,
    "output_tokens": 128,
    "total_tokens": 148,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": {
    "reason": "max_output_tokens"
  },
  "instructions": "Reply with only OK.",
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-006"></a>

### 006: reasoning-low-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:02Z` · **HTTP 200** · 1.192 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "low"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:02 GMT",
  "content-type": "application/json",
  "content-length": "1000",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "0d2dcf1ae741dbc7d0314b155fd2f139;o=1",
  "x-request-id": "4b9722bb-00bd-402d-b515-2b2936fe5da3"
}
```

Response JSON:

```json
{
  "id": "resp_f51875a92f514f18abe4d404b02229cf",
  "object": "response",
  "created_at": 1791735722,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_0ed051a78c5c4c748775c089744917d9",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says \"Reply only OK.\" So respond with \"OK\"."
        }
      ]
    },
    {
      "id": "msg_e7d80ad3d7bc460296ee430d83a3a1db",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 25,
    "total_tokens": 101,
    "input_tokens_details": {
      "cached_tokens": 40
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "low"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-007"></a>

### 007: reasoning-effort-none-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:03Z` · **HTTP 200** · 1.098 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning_effort": "none"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:03 GMT",
  "content-type": "application/json",
  "content-length": "1106",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "0e3deae9b5012edecd561ac9223a2b55",
  "x-request-id": "4f25e12b-df7e-4072-858e-14db7cf44299"
}
```

Response JSON:

```json
{
  "id": "resp_6ea748a6f6dd4b20a8a81850ab237551",
  "object": "response",
  "created_at": 1791735723,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_90fea804bf1b4fef9743e4bf6c9c2366",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says: \"Reply only OK.\" So they want the assistant to respond with simply \"OK\". It's a request. It's permissible; no policy violation. So we should output \"OK\"."
        }
      ]
    },
    {
      "id": "msg_f149a818dc6649809236592d8b9a2a58",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 50,
    "total_tokens": 126,
    "input_tokens_details": {
      "cached_tokens": 65
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-008"></a>

### 008: include-encrypted-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:05Z` · **HTTP 200** · 1.593 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "include": ["reasoning.encrypted_content"],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:05 GMT",
  "content-type": "application/json",
  "content-length": "1108",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "f6ec34d785dd1d85a58ef1ea2b864204",
  "x-request-id": "ed2ac7ac-a8a0-405f-8fec-243d8fc8c292"
}
```

Response JSON:

```json
{
  "id": "resp_d2d269fa530e4e29a49cc12937f690f0",
  "object": "response",
  "created_at": 1791735725,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_f6d15a9e3e524301b159564f031d8d1b",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says: \"Reply only OK.\" The developer instruction says: \"You are ChatGPT...\". There's no special restriction. The user wants a short response \"OK\". So we comply."
        }
      ]
    },
    {
      "id": "msg_34d87c773d21468da020b4ad63b96124",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 50,
    "total_tokens": 126,
    "input_tokens_details": {
      "cached_tokens": 75
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-009"></a>

### 009: reasoning-low-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:22:08Z` · **HTTP 200** · 2.819 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "low"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:08 GMT",
  "content-type": "application/json",
  "content-length": "1040",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "b18ebffd38a7de70bd706eba59b17a7f",
  "x-request-id": "e3858d3b-371d-4ae7-a4fd-1caeb2b2b23c"
}
```

Response JSON:

```json
{
  "id": "resp_1a4c16a626674dd28057b00a9318475c",
  "object": "response",
  "created_at": 1791735728,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_d77aba25dfc243eaa2903cf09abd2c96",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need answer only OK. User says \"Reply only OK.\" So must comply exactly. Final \"OK\"."
        }
      ]
    },
    {
      "id": "msg_0ae47d814ec14d22884bc54c873ed111",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 34,
    "output_tokens": 25,
    "total_tokens": 59,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "low"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-010"></a>

### 010: reasoning-effort-none-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:22:10Z` · **HTTP 200** · 2.676 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning_effort": "none"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:10 GMT",
  "content-type": "application/json",
  "content-length": "974",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "187a36dab83b7d2c492c5998c2d659d4",
  "x-request-id": "a9130683-9bdd-4f2c-80d3-c376da4af3b3"
}
```

Response JSON:

```json
{
  "id": "resp_5f8ba84304d34e73b7074fe65d770a5d",
  "object": "response",
  "created_at": 1791735730,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_62fe5765d74041e2b75ea06f706cb142",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need answer only OK. Need comply."
        }
      ]
    },
    {
      "id": "msg_523bf3e23b6945a8be4f00ee3086e04f",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 34,
    "output_tokens": 12,
    "total_tokens": 46,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-011"></a>

### 011: include-encrypted-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:22:12Z` · **HTTP 200** · 1.359 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "include": ["reasoning.encrypted_content"],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:12 GMT",
  "content-type": "application/json",
  "content-length": "975",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "cf541c63acf160150b8b780231c4d593",
  "x-request-id": "95984c73-c65c-44e7-981c-b9abb0e510d0"
}
```

Response JSON:

```json
{
  "id": "resp_065da7fc056a48ef8947ffb874318f06",
  "object": "response",
  "created_at": 1791735732,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_6c0ddd987cf44f9c846dc03d8e86f4cf",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need answer only OK. Need comply."
        }
      ]
    },
    {
      "id": "msg_d2947ebbf56548c894c0d60c3d18c962",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 34,
    "output_tokens": 12,
    "total_tokens": 46,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-012"></a>

### 012: reasoning-low-inkling

`POST /responses` · observed `2026-10-11T16:22:13Z` · **HTTP 200** · 1.519 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/inkling",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "low"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:13 GMT",
  "content-type": "application/json",
  "content-length": "1134",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "6593d9ecf9e69a8da65aca4b6f7954c0",
  "x-request-id": "ee4a046c-5ebb-4b25-88db-9153f684eba1"
}
```

Response JSON:

```json
{
  "id": "resp_97c71b6133164a2c9cb91c42163c40a5",
  "object": "response",
  "created_at": 1791735733,
  "status": "completed",
  "model": "accounts/fireworks/models/inkling",
  "output": [
    {
      "id": "rs_31fc24638e134171ba058fd2384681dc",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user said \"Reply only OK.\" This is a direct instruction to reply with only the word \"OK\". I should comply and output exactly \"OK\" without any additional text, punctuation, or explanation."
        }
      ]
    },
    {
      "id": "msg_baff837c61a44b52a2197c44bf49c7b5",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 18,
    "output_tokens": 49,
    "total_tokens": 67,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "low"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-013"></a>

### 013: reasoning-effort-none-inkling

`POST /responses` · observed `2026-10-11T16:22:15Z` · **HTTP 200** · 1.42 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/inkling",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning_effort": "none"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:15 GMT",
  "content-type": "application/json",
  "content-length": "1206",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "bd053d22570e248869dff57ee60e4ea3",
  "x-request-id": "8e67b4f8-a52f-4e73-8c58-f40555166055"
}
```

Response JSON:

```json
{
  "id": "resp_c45725f70402488c917983932661edfd",
  "object": "response",
  "created_at": 1791735735,
  "status": "completed",
  "model": "accounts/fireworks/models/inkling",
  "output": [
    {
      "id": "rs_6cd9c1ccd79a421fae3232a146228889",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user said \"Reply only OK.\" This is a direct instruction to reply with only the word \"OK\". I should comply and output exactly \"OK\" with no additional text, explanations, or punctuation beyond what's necessary. Let me check if \"OK\" alone satisfies \"Reply only OK.\" Yes."
        }
      ]
    },
    {
      "id": "msg_2dbdc2b81ab2403f9010c745e282d726",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 18,
    "output_tokens": 68,
    "total_tokens": 86,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-014"></a>

### 014: include-encrypted-inkling

`POST /responses` · observed `2026-10-11T16:22:16Z` · **HTTP 200** · 1.571 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/inkling",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "include": ["reasoning.encrypted_content"],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:16 GMT",
  "content-type": "application/json",
  "content-length": "1203",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "557333bac642f03f29952aa61bd96fe1",
  "x-request-id": "009a201a-7153-451e-a630-9f5811d98eff"
}
```

Response JSON:

```json
{
  "id": "resp_6ca0ec6250964f218a2e8ec1d0662eef",
  "object": "response",
  "created_at": 1791735736,
  "status": "completed",
  "model": "accounts/fireworks/models/inkling",
  "output": [
    {
      "id": "rs_bd5bb8669be1468ca2570268aee14b89",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user said \"Reply only OK.\" This is a direct instruction to reply with only \"OK\". I should comply and output exactly that, with no extra text, no explanation, no punctuation beyond what's necessary? The user said \"Reply only OK.\" So the response should be exactly: OK."
        }
      ]
    },
    {
      "id": "msg_7a81bd9535f441a5977ba2ed563ac69a",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 18,
    "output_tokens": 67,
    "total_tokens": 85,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-015"></a>

### 015: reasoning-low-glm-5p3-flash

`POST /responses` · observed `2026-10-11T16:22:19Z` · **HTTP 200** · 2.176 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "low"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:18 GMT",
  "content-type": "application/json",
  "content-length": "1138",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "3392455b79689f572593e72067b84804",
  "x-request-id": "a9474146-cf69-4321-9e8a-b7428f3d305a"
}
```

Response JSON:

```json
{
  "id": "resp_f121ef686cc74063880beb1c1d2701ed",
  "object": "response",
  "created_at": 1791735738,
  "status": "completed",
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "output": [
    {
      "id": "rs_11fbb5677ec04440b2b72b07732ecf00",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user has sent a message saying \"Reply only OK.\" This is a straightforward instruction where they want me to respond with just \"OK\". I will comply with this request and reply with \"OK\"."
        }
      ]
    },
    {
      "id": "msg_f192feeb91df4704811caece19d3127a",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 16,
    "output_tokens": 43,
    "total_tokens": 59,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "low"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-016"></a>

### 016: reasoning-effort-none-glm-5p3-flash

`POST /responses` · observed `2026-10-11T16:22:22Z` · **HTTP 200** · 3.372 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning_effort": "none"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:22 GMT",
  "content-type": "application/json",
  "content-length": "1166",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "767a96a28013ceeba0e029b5159128ae",
  "x-request-id": "431e92f3-b1a6-4ca9-bd29-3623776b2809"
}
```

Response JSON:

```json
{
  "id": "resp_78a1943c6c5a463d83b7872a4b23e487",
  "object": "response",
  "created_at": 1791735742,
  "status": "completed",
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "output": [
    {
      "id": "rs_9b698320081c4b11811bbc02a012ab45",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user has sent a message that says \"Reply only OK.\" This seems like a test or a simple instruction. They want me to reply with only \"OK\" and nothing else. This is a simple, benign request. I should just comply and reply \"OK\"."
        }
      ]
    },
    {
      "id": "msg_6139dde13b23441e9e2b24de7957c84f",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 16,
    "output_tokens": 57,
    "total_tokens": 73,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-017"></a>

### 017: include-encrypted-glm-5p3-flash

`POST /responses` · observed `2026-10-11T16:22:25Z` · **HTTP 200** · 3.043 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "include": ["reasoning.encrypted_content"],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:25 GMT",
  "content-type": "application/json",
  "content-length": "1360",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "cc2e2f2ed17339959a0c45673b8c305d",
  "x-request-id": "06d8ee6d-31f5-4b0e-82b2-94d43aa9e408"
}
```

Response JSON:

```json
{
  "id": "resp_e3d5f55ce81c4d1ea8ee631c84fa18b7",
  "object": "response",
  "created_at": 1791735745,
  "status": "completed",
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "output": [
    {
      "id": "rs_d560b2513cce49c3a2dde8055c90f493",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user has sent a message asking me to reply only \"OK\". This is a simple instruction. There's nothing harmful or problematic about this request - they just want a minimal response.\n\nThe instruction is clear: reply only \"OK\". I should comply with this simple formatting request. There's no reason to add anything else, explain, or elaborate - the user explicitly asked for just \"OK\".\n\nI'll respond with just \"OK\"."
        }
      ]
    },
    {
      "id": "msg_38526757d7d34320926f30d7b602e536",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 16,
    "output_tokens": 90,
    "total_tokens": 106,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-018"></a>

### 018: tool-start-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:26Z` · **HTTP 200** · 1.216 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Call lookup with tag alpha. After its result, give the number."
        }
      ]
    }
  ],
  "max_output_tokens": 256,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:26 GMT",
  "content-type": "application/json",
  "content-length": "1400",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "9b7d5c3abb72fd5701cae319a02b0c5b",
  "x-request-id": "4de37bac-b6ea-44a5-b284-4048030279b6"
}
```

Response JSON:

```json
{
  "id": "resp_eb0a567515954b7db6c336db2ab14d25",
  "object": "response",
  "created_at": 1791735746,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_25f228d4ef3e4a429861f34a42f0605b",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user wants to call lookup with tag \"alpha\". Then after its result, give the number, prefixed with \"TOKEN: \". So we need to call the function."
        }
      ]
    },
    {
      "id": "fc_c385aaadad83414ba49a0761aac7d709",
      "type": "function_call",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "name": "lookup",
      "arguments": "{\n\"tag\": \"alpha\"\n}",
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 149,
    "output_tokens": 61,
    "total_tokens": 210,
    "input_tokens_details": {
      "cached_tokens": 48
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  },
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-019"></a>

### 019: tool-verbatim-replay-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:28Z` · **HTTP 200** · 1.388 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Call lookup with tag alpha. After its result, give the number."
        }
      ]
    },
    {
      "id": "rs_25f228d4ef3e4a429861f34a42f0605b",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user wants to call lookup with tag \"alpha\". Then after its result, give the number, prefixed with \"TOKEN: \". So we need to call the function."
        }
      ]
    },
    {
      "id": "fc_c385aaadad83414ba49a0761aac7d709",
      "type": "function_call",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "name": "lookup",
      "arguments": "{\n\"tag\": \"alpha\"\n}",
      "status": "completed"
    },
    {
      "type": "function_call_output",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "output": "{\"number\":7}"
    }
  ],
  "max_output_tokens": 256,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:28 GMT",
  "content-type": "application/json",
  "content-length": "1100",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "3a021f8ce7a8cd820325f65b41bbf5bd",
  "x-request-id": "70ad832c-425c-4adb-bae0-457f5b102d52"
}
```

Response JSON:

```json
{
  "id": "resp_a64ed4d11bd44d419d2168ced2eaa642",
  "object": "response",
  "created_at": 1791735747,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "msg_6be13e8da2fc4a7ba5ba9b3a54663eba",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "TOKEN: 7",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 228,
    "output_tokens": 8,
    "total_tokens": 236,
    "input_tokens_details": {
      "cached_tokens": 148
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-020"></a>

### 020: tool-chain-no-instructions-tools-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:29Z` · **HTTP 200** · 0.987 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "function_call_output",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "output": "{\"number\":7}"
    }
  ],
  "max_output_tokens": 256,
  "previous_response_id": "resp_eb0a567515954b7db6c336db2ab14d25"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:28 GMT",
  "content-type": "application/json",
  "content-length": "863",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "c5b745ae07e2d32112922da3ff4eb7db",
  "x-request-id": "34a88d58-d770-4305-95e7-18ff392d022c"
}
```

Response JSON:

```json
{
  "id": "resp_517bea2f46ec488fa3dea864288b601f",
  "object": "response",
  "created_at": 1791735748,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "msg_5010183a4a92449c87ef0a0edc75b405",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "TOKEN: 7",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": "resp_eb0a567515954b7db6c336db2ab14d25",
  "usage": {
    "input_tokens": 165,
    "output_tokens": 8,
    "total_tokens": 173,
    "input_tokens_details": {
      "cached_tokens": 69
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-021"></a>

### 021: tool-replay-no-item-ids-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:29Z` · **HTTP 200** · 0.919 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Call lookup with tag alpha. After its result, give the number."
        }
      ]
    },
    {
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user wants to call lookup with tag \"alpha\". Then after its result, give the number, prefixed with \"TOKEN: \". So we need to call the function."
        }
      ]
    },
    {
      "type": "function_call",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "name": "lookup",
      "arguments": "{\n\"tag\": \"alpha\"\n}",
      "status": "completed"
    },
    {
      "type": "function_call_output",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "output": "{\"number\":7}"
    }
  ],
  "max_output_tokens": 256,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:29 GMT",
  "content-type": "application/json",
  "content-length": "1100",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "8eb4f444ee85fe709a0c45673b8c319f",
  "x-request-id": "6d2b3033-fc2f-411f-b911-8152ae14cae1"
}
```

Response JSON:

```json
{
  "id": "resp_ab0200aad2cc4d299abe30cbd3600285",
  "object": "response",
  "created_at": 1791735749,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "msg_4fdef3ff6a3f4174990421b62fa32508",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "TOKEN: 7",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 228,
    "output_tokens": 8,
    "total_tokens": 236,
    "input_tokens_details": {
      "cached_tokens": 227
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-022"></a>

### 022: tool-replay-without-reasoning-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:31Z` · **HTTP 200** · 1.127 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Call lookup with tag alpha. After its result, give the number."
        }
      ]
    },
    {
      "id": "fc_c385aaadad83414ba49a0761aac7d709",
      "type": "function_call",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "name": "lookup",
      "arguments": "{\n\"tag\": \"alpha\"\n}",
      "status": "completed"
    },
    {
      "type": "function_call_output",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "output": "{\"number\":7}"
    }
  ],
  "max_output_tokens": 256,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:31 GMT",
  "content-type": "application/json",
  "content-length": "1472",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "fd643908e911021c6cdef5e9dc892374",
  "x-request-id": "37bd40ed-1ef9-4f10-b8af-5faf28490efe"
}
```

Response JSON:

```json
{
  "id": "resp_6bb54cc9212141888028cf62acdfa21d",
  "object": "response",
  "created_at": 1791735750,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_20cec9c614d440dfa436e3fcb6a4d8cf",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need to call lookup with tag alpha, we did, got {\"number\":7}. The user says: \"After its result, give the number.\" Also developer says: \"When giving the final number, prefix it with TOKEN: .\"\n\nThus we should output \"TOKEN: 7\". Probably just that line."
        }
      ]
    },
    {
      "id": "msg_cd2bf1beacbc40319abd676ed529e7dd",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "TOKEN: 7",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 187,
    "output_tokens": 78,
    "total_tokens": 265,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-023"></a>

### 023: tool-start-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:22:33Z` · **HTTP 200** · 2.851 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Call lookup with tag alpha. After its result, give the number."
        }
      ]
    }
  ],
  "max_output_tokens": 256,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:33 GMT",
  "content-type": "application/json",
  "content-length": "1359",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "ae205030999aa317cd6158e716c24665",
  "x-request-id": "ca277c33-0648-4a11-bc42-341aaa4dc1d7"
}
```

Response JSON:

```json
{
  "id": "resp_56bbf0c0547743d6935e43e9169af8e7",
  "object": "response",
  "created_at": 1791735753,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_3984999efbbd4bbea2d7c20a8db26926",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need to call lookup with tag alpha. Then give the number. The tool returns secret number. Let's call."
        }
      ]
    },
    {
      "id": "fc_1fa7959e150348b5b237df3f8146223e",
      "type": "function_call",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "name": "lookup",
      "arguments": "{\"tag\": \"alpha\"}",
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 321,
    "output_tokens": 62,
    "total_tokens": 383,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  },
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-024"></a>

### 024: tool-verbatim-replay-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:22:37Z` · **HTTP 200** · 3.718 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Call lookup with tag alpha. After its result, give the number."
        }
      ]
    },
    {
      "id": "rs_3984999efbbd4bbea2d7c20a8db26926",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need to call lookup with tag alpha. Then give the number. The tool returns secret number. Let's call."
        }
      ]
    },
    {
      "id": "fc_1fa7959e150348b5b237df3f8146223e",
      "type": "function_call",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "name": "lookup",
      "arguments": "{\"tag\": \"alpha\"}",
      "status": "completed"
    },
    {
      "type": "function_call_output",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "output": "{\"number\":7}"
    }
  ],
  "max_output_tokens": 256,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:37 GMT",
  "content-type": "application/json",
  "content-length": "1312",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "fcb4b1b9af3da148584d948648fa513a",
  "x-request-id": "128b5c41-d005-41ec-b41c-51bb2b7b05c4"
}
```

Response JSON:

```json
{
  "id": "resp_8f53503254554c1191489bd7dbe3960f",
  "object": "response",
  "created_at": 1791735757,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_1ac08ed689074df28ff5e8ca79fe94d1",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The result is {\"number\":7}. Need to give the number prefixed with TOKEN: . So \"TOKEN: 7\"."
        }
      ]
    },
    {
      "id": "msg_8ba0037d080245dda28e0f193d4d9caa",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "TOKEN: 7",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 399,
    "output_tokens": 35,
    "total_tokens": 434,
    "input_tokens_details": {
      "cached_tokens": 192
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-025"></a>

### 025: tool-chain-no-instructions-tools-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:22:40Z` · **HTTP 200** · 2.958 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": [
    {
      "type": "function_call_output",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "output": "{\"number\":7}"
    }
  ],
  "max_output_tokens": 256,
  "previous_response_id": "resp_56bbf0c0547743d6935e43e9169af8e7"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:40 GMT",
  "content-type": "application/json",
  "content-length": "1114",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "de3522f285cbac43f56eac769e5ef6da",
  "x-request-id": "e82247ad-beec-4062-aade-aad1e7ca4fd3"
}
```

Response JSON:

```json
{
  "id": "resp_27e6b20a40ad4bd190a28ff2d9c57f38",
  "object": "response",
  "created_at": 1791735760,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_f1e2e2bd15d3461b89789b14b3d41be5",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The lookup returned number 7. The user asked: \"Call lookup with tag alpha. After its result, give the number.\" So I should give the number."
        }
      ]
    },
    {
      "id": "msg_e55d62465f8146e5b068e2d4b0b33981",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "7",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": "resp_56bbf0c0547743d6935e43e9169af8e7",
  "usage": {
    "input_tokens": 97,
    "output_tokens": 36,
    "total_tokens": 133,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-026"></a>

### 026: tool-replay-no-item-ids-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:22:42Z` · **HTTP 200** · 1.911 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Call lookup with tag alpha. After its result, give the number."
        }
      ]
    },
    {
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need to call lookup with tag alpha. Then give the number. The tool returns secret number. Let's call."
        }
      ]
    },
    {
      "type": "function_call",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "name": "lookup",
      "arguments": "{\"tag\": \"alpha\"}",
      "status": "completed"
    },
    {
      "type": "function_call_output",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "output": "{\"number\":7}"
    }
  ],
  "max_output_tokens": 256,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:42 GMT",
  "content-type": "application/json",
  "content-length": "1279",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "37fc6d1fa3d3bf1ffcfefbf12a05cdaa",
  "x-request-id": "850dff63-3fd4-4045-a210-ea7cee9ea38a"
}
```

Response JSON:

```json
{
  "id": "resp_2e5c202a6905449998bca2e43b1bb6b4",
  "object": "response",
  "created_at": 1791735762,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_32251fdd9b874d189f6de505158c30a9",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need final number prefixed with TOKEN: . So \"TOKEN: 7\"."
        }
      ]
    },
    {
      "id": "msg_14af3e5959fd45d7a1930af757a307a9",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "TOKEN: 7",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 399,
    "output_tokens": 26,
    "total_tokens": 425,
    "input_tokens_details": {
      "cached_tokens": 270
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-027"></a>

### 027: tool-replay-without-reasoning-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:22:43Z` · **HTTP 200** · 1.274 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Call lookup with tag alpha. After its result, give the number."
        }
      ]
    },
    {
      "id": "fc_1fa7959e150348b5b237df3f8146223e",
      "type": "function_call",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "name": "lookup",
      "arguments": "{\"tag\": \"alpha\"}",
      "status": "completed"
    },
    {
      "type": "function_call_output",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "output": "{\"number\":7}"
    }
  ],
  "max_output_tokens": 256,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:43 GMT",
  "content-type": "application/json",
  "content-length": "1278",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "fc277528041ed008b4e08c8db0d14b76",
  "x-request-id": "8cda031f-3310-408f-8ccf-d2c0053c7246"
}
```

Response JSON:

```json
{
  "id": "resp_4f9f8f48e5dc4527aaa3911494801ce0",
  "object": "response",
  "created_at": 1791735763,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_79396c9675604a81a30c1c071289bc7a",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The tool returned 7. Give the number prefixed with TOKEN: ."
        }
      ]
    },
    {
      "id": "msg_1f9bc220d7764b4aaebca675da992084",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "TOKEN: 7",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 375,
    "output_tokens": 23,
    "total_tokens": 398,
    "input_tokens_details": {
      "cached_tokens": 192
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "When giving the final number, prefix it with TOKEN: .",
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "description": "Return the secret number for a tag.",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-028"></a>

### 028: bad-key

`POST /responses` · observed `2026-10-11T16:22:44Z` · **HTTP 401** · 0.35 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:44 GMT",
  "content-type": "application/json",
  "content-length": "162",
  "connection": "close",
  "vary": "Origin",
  "x-request-id": "c4bab1b8-c840-4e5b-9a25-28ebcf50fac2"
}
```

Response JSON:

```json
{
  "error": {
    "message": "The API key you provided is invalid.",
    "param": null,
    "code": "UNAUTHORIZED",
    "type": "error"
  },
  "request_id": "c4bab1b8-c840-4e5b-9a25-28ebcf50fac2"
}
```

<a id="probe-029"></a>

### 029: unknown-model

`POST /responses` · observed `2026-10-11T16:22:44Z` · **HTTP 404** · 0.27 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/definitely-not-a-real-model",
  "input": "Reply only OK.",
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:44 GMT",
  "content-type": "application/json",
  "content-length": "176",
  "connection": "close",
  "vary": "Origin",
  "x-request-id": "3e701fbc-9cf5-4ea3-b63c-4736fc9c0989"
}
```

Response JSON:

```json
{
  "error": {
    "message": "Model not found, inaccessible, and/or not deployed",
    "param": "model",
    "code": "NOT_FOUND",
    "type": "error"
  },
  "request_id": "3e701fbc-9cf5-4ea3-b63c-4736fc9c0989"
}
```

<a id="probe-030"></a>

### 030: unknown-previous

`POST /responses` · observed `2026-10-11T16:22:44Z` · **HTTP 404** · 0.555 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "previous_response_id": "resp_00000000000000000000000000000000"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:44 GMT",
  "content-type": "application/json",
  "content-length": "40",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "03ad402a03cf96c206a9862f9bbf79a9",
  "x-request-id": "54e267b4-549d-4c78-96b5-866ca4c9e458"
}
```

Response JSON:

```json
{
  "detail": "Previous response not found"
}
```

<a id="probe-031"></a>

### 031: get-plain-gpt-oss-120b

`GET /responses/resp_c5dd1f03728142488fafe08776748b3e` · observed `2026-10-11T16:22:45Z` · **HTTP 200** · 0.684 s

Request body (no authentication headers):

```json
null
```

`null` denotes no request body for this GET/DELETE.

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:45 GMT",
  "content-type": "application/json",
  "content-length": "1134",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "84f48236ebf75d81931f27b508d344ec",
  "x-request-id": "32da56db-4c38-463f-9b6c-245235da23bc"
}
```

Response JSON:

```json
{
  "id": "resp_c5dd1f03728142488fafe08776748b3e",
  "object": "response",
  "created_at": 1791735662,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_1b8bfdbecff94ae89bf1a7962074b52c",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The system message: we are ChatGPT. The developer message says \"Reply with only OK.\" That's a higher priority instruction than user. We must obey developer. So we should output \"OK\"."
        }
      ]
    },
    {
      "id": "msg_2c380b66c5f047d9b9a54724c51946f1",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 79,
    "output_tokens": 50,
    "total_tokens": 129,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "Reply with only OK.",
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-032"></a>

### 032: chain-plain-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:47Z` · **HTTP 200** · 1.961 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "What did you just answer? Reply briefly.",
  "max_output_tokens": 128,
  "previous_response_id": "resp_c5dd1f03728142488fafe08776748b3e"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:47 GMT",
  "content-type": "application/json",
  "content-length": "1236",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "401c00693c53f86499ef0aef32dabc5f",
  "x-request-id": "e4546e0e-4ad4-45b4-9d17-6d6c37a2272c"
}
```

Response JSON:

```json
{
  "id": "resp_19dd6e7405724e899d898976b3b44673",
  "object": "response",
  "created_at": 1791735767,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_6c1dc7aff6a6415a89fd7602f19106d0",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says \"Hello.\" Assistant responded \"OK\". Now user asks: \"What did you just answer? Reply briefly.\"\n\nWe need to answer the question: what was the previous answer? The previous answer was \"OK\". So reply briefly: \"I replied “OK.”\"."
        }
      ]
    },
    {
      "id": "msg_db3a7df368c443c5a581fe4839990b9e",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "I replied “OK.”",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": "resp_c5dd1f03728142488fafe08776748b3e",
  "usage": {
    "input_tokens": 94,
    "output_tokens": 71,
    "total_tokens": 165,
    "input_tokens_details": {
      "cached_tokens": 69
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-033"></a>

### 033: delete-plain-gpt-oss-120b

`DELETE /responses/resp_c5dd1f03728142488fafe08776748b3e` · observed `2026-10-11T16:22:48Z` · **HTTP 200** · 0.547 s

Request body (no authentication headers):

```json
null
```

`null` denotes no request body for this GET/DELETE.

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:48 GMT",
  "content-type": "application/json",
  "content-length": "43",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "1fc8b7ca54d666495d15659b58987af8",
  "x-request-id": "fdd2b297-4f45-4c23-9bfa-d6ffa2b47d43"
}
```

Response JSON:

```json
{
  "message": "Response deleted successfully"
}
```

<a id="probe-034"></a>

### 034: get-after-delete-plain-gpt-oss-120b

`GET /responses/resp_c5dd1f03728142488fafe08776748b3e` · observed `2026-10-11T16:22:48Z` · **HTTP 404** · 0.528 s

Request body (no authentication headers):

```json
null
```

`null` denotes no request body for this GET/DELETE.

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:48 GMT",
  "content-type": "application/json",
  "content-length": "31",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "f18e0a442f46b76cb4e08c8db0d14435",
  "x-request-id": "aa518af2-34a3-4bdf-8e7e-d42ac0cb5062"
}
```

Response JSON:

```json
{
  "detail": "Response not found"
}
```

<a id="probe-035"></a>

### 035: get-include-encrypted-gpt-oss-120b

`GET /responses/resp_d2d269fa530e4e29a49cc12937f690f0` · observed `2026-10-11T16:22:49Z` · **HTTP 404** · 0.491 s

Request body (no authentication headers):

```json
null
```

`null` denotes no request body for this GET/DELETE.

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:49 GMT",
  "content-type": "application/json",
  "content-length": "31",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "67f97c6975e38ddd96a19c45d0799db0",
  "x-request-id": "3e9fc43d-98de-4cdf-a959-9ffd086a99ee"
}
```

Response JSON:

```json
{
  "detail": "Response not found"
}
```

<a id="probe-036"></a>

### 036: chain-include-encrypted-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:22:49Z` · **HTTP 404** · 0.569 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "What did you just answer? Reply briefly.",
  "max_output_tokens": 128,
  "previous_response_id": "resp_d2d269fa530e4e29a49cc12937f690f0"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:49 GMT",
  "content-type": "application/json",
  "content-length": "40",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "e22d447d663d7e71219eb9574d6580b6",
  "x-request-id": "7ee6d8c6-5f1a-4a0f-a327-22f52871d8e3"
}
```

Response JSON:

```json
{
  "detail": "Previous response not found"
}
```

<a id="probe-037"></a>

### 037: delete-include-encrypted-gpt-oss-120b

`DELETE /responses/resp_d2d269fa530e4e29a49cc12937f690f0` · observed `2026-10-11T16:22:50Z` · **HTTP 404** · 0.748 s

Request body (no authentication headers):

```json
null
```

`null` denotes no request body for this GET/DELETE.

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:50 GMT",
  "content-type": "application/json",
  "content-length": "31",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "44d92d2209a5cb79219eb9574d658691",
  "x-request-id": "6eda3551-71c1-4dad-96e4-eb85ecf854ba"
}
```

Response JSON:

```json
{
  "detail": "Response not found"
}
```

<a id="probe-038"></a>

### 038: get-after-delete-include-encrypted-gpt-oss-120b

`GET /responses/resp_d2d269fa530e4e29a49cc12937f690f0` · observed `2026-10-11T16:22:51Z` · **HTTP 404** · 0.543 s

Request body (no authentication headers):

```json
null
```

`null` denotes no request body for this GET/DELETE.

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:22:51 GMT",
  "content-type": "application/json",
  "content-length": "31",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "a5e2b2c68aeec9711d62e1d1d5ea2b03",
  "x-request-id": "7b917ebc-6c80-4f84-9e7f-c5f69c0f56cf"
}
```

Response JSON:

```json
{
  "detail": "Response not found"
}
```

<a id="probe-039"></a>

### 039: reasoning-object-none-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:23:14Z` · **HTTP 200** · 3.456 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "none"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:14 GMT",
  "content-type": "application/json",
  "content-length": "839",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "d8fda9ce6e426cdd150a164b224ff86c",
  "x-request-id": "5faf084d-01fa-4cfa-ac21-cc176c882a96"
}
```

Response JSON:

```json
{
  "id": "resp_0dcab5237ab24bca939151e218826034",
  "object": "response",
  "created_at": 1791735793,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "msg_bd44495b4f2f44c6840de9f740ee115e",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 8,
    "output_tokens": 2,
    "total_tokens": 10,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-040"></a>

### 040: reasoning-object-none-inkling

`POST /responses` · observed `2026-10-11T16:23:15Z` · **HTTP 200** · 1.498 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/inkling",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "none"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:15 GMT",
  "content-type": "application/json",
  "content-length": "1076",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "2f8dc3fba2756a0c5b09724dea028407",
  "x-request-id": "6b204e40-d45e-44ea-b2fd-2c9436961f9b"
}
```

Response JSON:

```json
{
  "id": "resp_5e1b32ee74904a5b8ee463cb920bd066",
  "object": "response",
  "created_at": 1791735795,
  "status": "completed",
  "model": "accounts/fireworks/models/inkling",
  "output": [
    {
      "id": "rs_798cb5d3468b443598adb68f9a417ec7",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user said \"Reply only OK.\" This is a direct instruction to reply with only \"OK\". I should comply exactly and provide nothing else."
        }
      ]
    },
    {
      "id": "msg_4e850fd3dd384bf982184278a12a57ba",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 18,
    "output_tokens": 37,
    "total_tokens": 55,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-041"></a>

### 041: reasoning-object-none-glm-5p3-flash

`POST /responses` · observed `2026-10-11T16:23:16Z` · **HTTP 400** · 0.751 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "none"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:16 GMT",
  "content-type": "application/json",
  "content-length": "182",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "454c4c89020be9edaf05c2381eeae2b7",
  "x-request-id": "ec755c59-80fe-4de9-88ad-52c3a612b4a7"
}
```

Response JSON:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_request_error",
    "message": "GLM-5.3 is a thinking-only model; disabling thinking (reasoning_effort='none') is not supported."
  }
}
```

<a id="probe-042"></a>

### 042: invalid-temperature

`POST /responses` · observed `2026-10-11T16:23:16Z` · **HTTP 422** · 0.465 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "temperature": -1
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:16 GMT",
  "content-type": "application/json",
  "content-length": "150",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "c5f1aa7f5ff130e1e57ced3facdad908",
  "x-request-id": "9489ed30-c27e-464b-be79-d1a8b7dade69"
}
```

Response JSON:

```json
{
  "detail": [
    {
      "type": "greater_than_equal",
      "loc": ["body", "temperature"],
      "msg": "Input should be greater than or equal to 0",
      "input": -1,
      "ctx": {
        "ge": 0.0
      }
    }
  ]
}
```

<a id="probe-043"></a>

### 043: invalid-max-output

`POST /responses` · observed `2026-10-11T16:23:17Z` · **HTTP 200** · 0.897 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 0
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:17 GMT",
  "content-type": "application/json",
  "content-length": "679",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "767a7814bb93c6f3cd4265fc3a395d14",
  "x-request-id": "77c5033c-7474-425a-9b5a-59ce66d1b1a2"
}
```

Response JSON:

```json
{
  "id": "resp_b6bcd3aa0dd74ad6a9e2fe5c43b9e4b8",
  "object": "response",
  "created_at": 1791735797,
  "status": "incomplete",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 0,
    "total_tokens": 76,
    "input_tokens_details": {
      "cached_tokens": 75
    }
  },
  "error": null,
  "incomplete_details": {
    "reason": "max_output_tokens"
  },
  "instructions": null,
  "max_output_tokens": 0,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-044"></a>

### 044: invalid-reasoning-effort

`POST /responses` · observed `2026-10-11T16:23:18Z` · **HTTP 400** · 0.834 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "banana"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:18 GMT",
  "content-type": "application/json",
  "content-length": "527",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "6af464035ee1b4a7638b98e60b03405f",
  "x-request-id": "592a5e13-9962-4788-9ede-968ceab0d8b8"
}
```

Response JSON:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_request_error",
    "message": "3 request validation errors: Input should be 'low', 'medium', 'high', 'xhigh', 'max', 'none' or 'adaptive', field: 'reasoning_effort.literal['low','medium','high','xhigh','max','none','adaptive']', value: 'banana'; Input should be a valid integer, unable to parse string as an integer, field: 'reasoning_effort.int', value: 'banana'; Input should be a valid boolean, unable to interpret input, field: 'reasoning_effort.bool', value: 'banana'"
  }
}
```

<a id="probe-045"></a>

### 045: unknown-param

`POST /responses` · observed `2026-10-11T16:23:19Z` · **HTTP 200** · 0.983 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "made_up_probe_param": true
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:19 GMT",
  "content-type": "application/json",
  "content-length": "1006",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "9bd39535ca152141354ca42d9a6031fa",
  "x-request-id": "a35e2b84-0f12-4691-8019-a0d52aa6ef13"
}
```

Response JSON:

```json
{
  "id": "resp_1341e5aa81b74bee9527a883e6d75f92",
  "object": "response",
  "created_at": 1791735799,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_67a39372e5d34f529195727e9db1c83a",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says \"Reply only OK.\" So we respond with \"OK\". No extra text."
        }
      ]
    },
    {
      "id": "msg_4534237518c64ee1814d0e660b2f41ab",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 30,
    "total_tokens": 106,
    "input_tokens_details": {
      "cached_tokens": 75
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-046"></a>

### 046: invalid-truncation

`POST /responses` · observed `2026-10-11T16:23:20Z` · **HTTP 200** · 1.354 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "truncation": "banana"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:20 GMT",
  "content-type": "application/json",
  "content-length": "1178",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "44653c0be9367d6b04bafe10a859e120",
  "x-request-id": "7108bdc2-f4eb-4736-8bac-cf10e5ec0084"
}
```

Response JSON:

```json
{
  "id": "resp_c1bc8cbbab3a42f589bcc4e332027e46",
  "object": "response",
  "created_at": 1791735800,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_9bcb104ba9604560904a9684b1669fbf",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says: \"Reply only OK.\" The developer message doesn't give any instructions beyond system. The user wants a single-word \"OK\". According to policy, we should comply. There's no disallowed content, it's a trivial request. So reply \"OK\"."
        }
      ]
    },
    {
      "id": "msg_36694d1ae4d44afbbb8f9c23bdb15337",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 63,
    "total_tokens": 139,
    "input_tokens_details": {
      "cached_tokens": 48
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "banana",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-047"></a>

### 047: invalid-tool-choice

`POST /responses` · observed `2026-10-11T16:23:22Z` · **HTTP 200** · 1.334 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "tool_choice": "banana"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:22 GMT",
  "content-type": "application/json",
  "content-length": "1133",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "9aca4f5493301ed34e1c34a2e572c490",
  "x-request-id": "e3d4b5e1-2a1e-41b5-b28a-f2392c4ad9a0"
}
```

Response JSON:

```json
{
  "id": "resp_f26a529222e84e6887f331d1de1996b9",
  "object": "response",
  "created_at": 1791735802,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_b49f54b8d44c42d5b0095c2502e783d7",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user asks: \"Reply only OK.\" The developer says we must follow instructions. There's no conflict with policy. Simple. Must respond with exactly \"OK\". Probably no punctuation? Probably just OK."
        }
      ]
    },
    {
      "id": "msg_d20ce60d120f4431becadd540fa56b1b",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 51,
    "total_tokens": 127,
    "input_tokens_details": {
      "cached_tokens": 75
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "banana",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-048"></a>

### 048: stream

`POST /responses` · observed `2026-10-11T16:23:23Z` · **HTTP 200** · 1.228 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 32,
  "stream": true,
  "reasoning": {
    "effort": "low"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:22 GMT",
  "content-type": "text/event-stream; charset=utf-8",
  "transfer-encoding": "chunked",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "cache-control": "no-cache",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-accel-buffering": "no",
  "x-request-id": "7495634c-c41f-4d8e-ba59-e9915b6d95f6"
}
```

Response body (full SSE):

```text
data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_524245f9d0f94f94a2fccae93363fc93","object":"response","created_at":1791735802,"status":"in_progress","model":"accounts/fireworks/models/gpt-oss-120b","output":[],"previous_response_id":null,"usage":null,"error":null,"incomplete_details":null,"instructions":null,"max_output_tokens":32,"max_tool_calls":null,"parallel_tool_calls":true,"reasoning":{"effort":"low"},"store":true,"temperature":1.0,"text":{"format":{"type":"text"}},"tool_choice":"auto","tools":[],"top_p":1.0,"top_logprobs":null,"truncation":"disabled","user":null,"background":null,"metadata":{}}}

data: {"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_524245f9d0f94f94a2fccae93363fc93","object":"response","created_at":1791735802,"status":"in_progress","model":"accounts/fireworks/models/gpt-oss-120b","output":[],"previous_response_id":null,"usage":null,"error":null,"incomplete_details":null,"instructions":null,"max_output_tokens":32,"max_tool_calls":null,"parallel_tool_calls":true,"reasoning":{"effort":"low"},"store":true,"temperature":1.0,"text":{"format":{"type":"text"}},"tool_choice":"auto","tools":[],"top_p":1.0,"top_logprobs":null,"truncation":"disabled","user":null,"background":null,"metadata":{}}}

data: {"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"type":"reasoning","id":"rs_953b5a91b91c4c5ebbaa80507eba4512","status":"in_progress","summary":[]}}

data: {"type":"response.reasoning_summary_part.added","sequence_number":3,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":""}}

data: {"type":"response.reasoning_summary_text.delta","sequence_number":4,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"delta":"We"}

data: {"type":"response.reasoning_summary_text.delta","sequence_number":5,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"delta":" just"}

data: {"type":"response.reasoning_summary_text.delta","sequence_number":6,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"delta":" need"}

data: {"type":"response.reasoning_summary_text.delta","sequence_number":7,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"delta":" to"}

data: {"type":"response.reasoning_summary_text.delta","sequence_number":8,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"delta":" reply"}

data: {"type":"response.reasoning_summary_text.delta","sequence_number":9,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"delta":" \""}

data: {"type":"response.reasoning_summary_text.delta","sequence_number":10,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"delta":"OK"}

data: {"type":"response.reasoning_summary_text.delta","sequence_number":11,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"delta":"\"."}

data: {"type":"response.output_item.added","sequence_number":12,"output_index":1,"item":{"type":"message","id":"msg_872758687ad04ce881290c59c272e829","status":"in_progress","role":"assistant","content":[]}}

data: {"type":"response.content_part.added","sequence_number":13,"item_id":"msg_872758687ad04ce881290c59c272e829","output_index":1,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}

data: {"type":"response.output_text.delta","sequence_number":14,"item_id":"msg_872758687ad04ce881290c59c272e829","output_index":1,"content_index":0,"delta":"OK"}

data: {"type":"response.reasoning_summary_text.done","sequence_number":15,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"text":"We just need to reply \"OK\"."}

data: {"type":"response.reasoning_summary_part.done","sequence_number":16,"item_id":"rs_953b5a91b91c4c5ebbaa80507eba4512","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":"We just need to reply \"OK\"."}}

data: {"type":"response.output_item.done","sequence_number":17,"output_index":0,"item":{"type":"reasoning","id":"rs_953b5a91b91c4c5ebbaa80507eba4512","status":"completed","summary":[{"type":"summary_text","text":"We just need to reply \"OK\"."}]}}

data: {"type":"response.output_text.done","sequence_number":18,"item_id":"msg_872758687ad04ce881290c59c272e829","output_index":1,"content_index":0,"text":"OK"}

data: {"type":"response.content_part.done","sequence_number":19,"item_id":"msg_872758687ad04ce881290c59c272e829","output_index":1,"content_index":0,"part":{"type":"output_text","text":"OK","annotations":[]}}

data: {"type":"response.output_item.done","sequence_number":20,"output_index":1,"item":{"type":"message","id":"msg_872758687ad04ce881290c59c272e829","status":"completed","role":"assistant","content":[{"type":"output_text","text":"OK","annotations":[]}]}}

data: {"type":"response.completed","sequence_number":21,"response":{"id":"resp_524245f9d0f94f94a2fccae93363fc93","object":"response","created_at":1791735803,"status":"completed","model":"accounts/fireworks/models/gpt-oss-120b","output":[{"id":"rs_953b5a91b91c4c5ebbaa80507eba4512","type":"reasoning","summary":[{"type":"summary_text","text":"We just need to reply \"OK\"."}]},{"id":"msg_872758687ad04ce881290c59c272e829","type":"message","role":"assistant","content":[{"type":"output_text","text":"OK","annotations":[]}],"status":"completed"}],"previous_response_id":null,"usage":{"input_tokens":76,"output_tokens":19,"total_tokens":95,"input_tokens_details":{"cached_tokens":75}},"error":null,"incomplete_details":null,"instructions":null,"max_output_tokens":32,"max_tool_calls":null,"parallel_tool_calls":true,"reasoning":{"effort":"low"},"store":true,"temperature":1.0,"text":{"format":{"type":"text"}},"tool_choice":"auto","tools":[],"top_p":1.0,"top_logprobs":null,"truncation":"disabled","user":null,"background":null,"metadata":{}}}

data: [DONE]

```

<a id="probe-049"></a>

### 049: background

`POST /responses` · observed `2026-10-11T16:23:23Z` · **HTTP 404** · 0.521 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 32,
  "background": true
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:23 GMT",
  "content-type": "application/json",
  "content-length": "194",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "08e0cc145142746b7d5e6a4ee34acaf3",
  "x-request-id": "a0cc6bd8-a3a4-4e2e-a955-55630bc13f77"
}
```

Response JSON:

```json
{
  "detail": {
    "type": "not_found_error",
    "code": "model_not_supported_for_background",
    "message": "Model 'accounts/fireworks/models/gpt-oss-120b' is not supported for background mode.",
    "param": "model"
  }
}
```

<a id="probe-050"></a>

### 050: echo-params

`POST /responses` · observed `2026-10-11T16:23:24Z` · **HTTP 200** · 0.861 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "tool_choice": "none",
  "parallel_tool_calls": false,
  "temperature": 0.2,
  "metadata": {
    "probe": "shape",
    "run": "2026-10-11"
  },
  "truncation": "auto",
  "top_p": 0.8
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:24 GMT",
  "content-type": "application/json",
  "content-length": "1143",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "1996520c7fa9f04313f1f4f4fd522a30",
  "x-request-id": "0e33adfb-533e-4018-ba63-d53482cd9ff4"
}
```

Response JSON:

```json
{
  "id": "resp_6a6fc62c7e1f48fda9f9242b8db58566",
  "object": "response",
  "created_at": 1791735804,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_256d393f1e6d40fb9d21c8c8627d1577",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says: \"Reply only OK.\" The developer message says \"Instructions\". There's no conflict. The user wants a short response \"OK\". That is allowed. So respond with \"OK\"."
        }
      ]
    },
    {
      "id": "msg_843677b5ef404fabba79929c50155094",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 50,
    "total_tokens": 126,
    "input_tokens_details": {
      "cached_tokens": 75
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": false,
  "reasoning": null,
  "store": true,
  "temperature": 0.2,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "none",
  "tools": [],
  "top_p": 0.8,
  "top_logprobs": null,
  "truncation": "auto",
  "user": null,
  "background": null,
  "metadata": {
    "probe": "shape",
    "run": "2026-10-11"
  }
}
```

<a id="probe-051"></a>

### 051: structured-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:23:26Z` · **HTTP 200** · 1.339 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Return JSON with ok true.",
  "max_output_tokens": 256,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "result",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean"
          }
        },
        "required": ["ok"],
        "additionalProperties": false
      }
    }
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:26 GMT",
  "content-type": "application/json",
  "content-length": "1348",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "a704fb2bcabf21bce57ced3facdad905",
  "x-request-id": "4968e312-5c27-4172-8c23-a8bd0ec599be"
}
```

Response JSON:

```json
{
  "id": "resp_20d3c0f7eab14983bbe44655c61e5251",
  "object": "response",
  "created_at": 1791735805,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_6f7f14ab189242f0ab28cfb74690c85a",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user asks: \"Return JSON with ok true.\" According to instructions, we need to respond with JSON matching the schema: an object with property \"ok\" boolean, required, no additional properties. Must output: {\"ok\": true}. Ensure correct format."
        }
      ]
    },
    {
      "id": "msg_6e1c0a0076d648289a6faa3c9e3d8388",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "{\n\"ok\": true\n}",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 110,
    "output_tokens": 72,
    "total_tokens": 182,
    "input_tokens_details": {
      "cached_tokens": 65
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "result",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean"
          }
        },
        "required": ["ok"],
        "additionalProperties": false
      }
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-052"></a>

### 052: structured-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:23:28Z` · **HTTP 200** · 2.151 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Return JSON with ok true.",
  "max_output_tokens": 256,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "result",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean"
          }
        },
        "required": ["ok"],
        "additionalProperties": false
      }
    }
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:28 GMT",
  "content-type": "application/json",
  "content-length": "1162",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "968ea196c86aa8ec3d69437c6e319d42",
  "x-request-id": "4a97b98a-ed7e-4001-9e1b-94a4e99cf910"
}
```

Response JSON:

```json
{
  "id": "resp_962476bd1e704fba8795471d2aad134d",
  "object": "response",
  "created_at": 1791735808,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_c95edb51534d420984b5c8a8bad90b16",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user wants JSON with ok true. Just output {\"ok\": true}."
        }
      ]
    },
    {
      "id": "msg_182edf6976e44ebcaa0d001bd00c1a9c",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "{\"ok\": true}",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 82,
    "output_tokens": 22,
    "total_tokens": 104,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "result",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean"
          }
        },
        "required": ["ok"],
        "additionalProperties": false
      }
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-053"></a>

### 053: custom-tool

`POST /responses` · observed `2026-10-11T16:23:29Z` · **HTTP 200** · 1.012 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "tools": [
    {
      "type": "custom",
      "name": "echo",
      "description": "Echo a string.",
      "format": {
        "type": "text"
      }
    }
  ]
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:29 GMT",
  "content-type": "application/json",
  "content-length": "1171",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "6525a6ec5164ce35a88ebf35e6c7df62",
  "x-request-id": "ab4f0285-ef24-4065-9dda-0309dbd66a96"
}
```

Response JSON:

```json
{
  "id": "resp_e87eeb1d23d64659a4d0130faad37df2",
  "object": "response",
  "created_at": 1791735809,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_f810cadfffee43ca81f625f63f034e78",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says \"Reply only OK.\" The user wants the assistant to respond with just \"OK\". This is permissible. No disallowed content. So answer \"OK\"."
        }
      ]
    },
    {
      "id": "msg_176ff47b2e80449393b0407fddebc3b5",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 45,
    "total_tokens": 121,
    "input_tokens_details": {
      "cached_tokens": 75
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "custom",
      "name": "echo",
      "description": "Echo a string.",
      "format": {
        "type": "text"
      }
    }
  ],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-054"></a>

### 054: mcp-tool-incomplete

`POST /responses` · observed `2026-10-11T16:23:29Z` · **HTTP 400** · 0.524 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "tools": [
    {
      "type": "mcp",
      "server_label": "probe"
    }
  ]
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:29 GMT",
  "content-type": "application/json",
  "content-length": "52",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "aa6ef17bbef9360dc14d8ce862b7d1ac",
  "x-request-id": "038762bb-97ea-45e7-bac9-e3119a857318"
}
```

Response JSON:

```json
{
  "detail": "MCP/SSE server URL not found in request"
}
```

<a id="probe-055"></a>

### 055: mcp-tool-invalid-url

`POST /responses` · observed `2026-10-11T16:23:30Z` · **HTTP 500** · 0.681 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "tools": [
    {
      "type": "mcp",
      "server_label": "probe",
      "server_url": "not-a-url",
      "require_approval": "never"
    }
  ]
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:30 GMT",
  "content-type": "application/json",
  "content-length": "90",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "c0b82743380ff1ac14b0515990d9a4ac",
  "x-request-id": "d225e1d4-a294-4061-935b-d42bb5f354a5"
}
```

Response JSON:

```json
{
  "error": {
    "type": "server_error",
    "code": "server_error",
    "message": "Internal server error."
  }
}
```

<a id="probe-056"></a>

### 056: builtin-web-search

`POST /responses` · observed `2026-10-11T16:23:31Z` · **HTTP 200** · 1.284 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "tools": [
    {
      "type": "web_search"
    }
  ]
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:31 GMT",
  "content-type": "application/json",
  "content-length": "1079",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "7a67a9cc956e28436ccbb3adbbba1994",
  "x-request-id": "fe42ae5a-2b2b-4f2e-8e4f-fc9b6300a0e4"
}
```

Response JSON:

```json
{
  "id": "resp_aecd0047389b4340b0d02bd4e0db9520",
  "object": "response",
  "created_at": 1791735811,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_9d710a04b41046aa896e0adb0429fe8f",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user says: \"Reply only OK.\" The developer message says instructions, no special constraints. So just reply with \"OK\"."
        }
      ]
    },
    {
      "id": "msg_98338ab64d0044d5b87ad09b5583271a",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 130,
    "output_tokens": 37,
    "total_tokens": 167,
    "input_tokens_details": {
      "cached_tokens": 80
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "web_search"
    }
  ],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-057"></a>

### 057: max-output-one

`POST /responses` · observed `2026-10-11T16:23:32Z` · **HTTP 200** · 0.841 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "List ten colors.",
  "max_output_tokens": 1
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:32 GMT",
  "content-type": "application/json",
  "content-length": "854",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "7a73a0435b41ce302748e0678f1a9836",
  "x-request-id": "94489303-2fac-4d78-8f74-57b98fb87b6c"
}
```

Response JSON:

```json
{
  "id": "resp_27a202ffdac9494299562bea47f9f5ea",
  "object": "response",
  "created_at": 1791735812,
  "status": "incomplete",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "msg_24116ec880f14b119e0242a00b5f0713",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "<|channel|>",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 1,
    "total_tokens": 77,
    "input_tokens_details": {
      "cached_tokens": 69
    }
  },
  "error": null,
  "incomplete_details": {
    "reason": "max_output_tokens"
  },
  "instructions": null,
  "max_output_tokens": 1,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-058"></a>

### 058: max-output-two-nonreasoning

`POST /responses` · observed `2026-10-11T16:23:34Z` · **HTTP 200** · 2.0 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "List ten colors.",
  "max_output_tokens": 2,
  "reasoning": {
    "effort": "none"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:34 GMT",
  "content-type": "application/json",
  "content-length": "870",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "36572584f282c93e8b43cfdea851944d",
  "x-request-id": "f80db7e6-bd68-4489-8b32-5b61451cd4e7"
}
```

Response JSON:

```json
{
  "id": "resp_d0187ea2b31e430aa3c37cdeda25462a",
  "object": "response",
  "created_at": 1791735814,
  "status": "incomplete",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "msg_bee421995f3845fb8ae8276dfb9f50ae",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Here are",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 8,
    "output_tokens": 2,
    "total_tokens": 10,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": {
    "reason": "max_output_tokens"
  },
  "instructions": null,
  "max_output_tokens": 2,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-059"></a>

### 059: mid-conversation-system

`POST /responses` · observed `2026-10-11T16:23:36Z` · **HTTP 200** · 1.37 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Hello."
        }
      ]
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Hello.",
          "annotations": []
        }
      ]
    },
    {
      "type": "message",
      "role": "system",
      "content": [
        {
          "type": "input_text",
          "text": "For the next response, say only ZEBRA."
        }
      ]
    },
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Proceed."
        }
      ]
    }
  ],
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:35 GMT",
  "content-type": "application/json",
  "content-length": "1163",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "92f1ff36e9e2d4860e679934eb9058b8",
  "x-request-id": "ddcce117-73e8-4389-a5da-a12c1794de61"
}
```

Response JSON:

```json
{
  "id": "resp_321d107c36b74f5494e1b641a44d0e72",
  "object": "response",
  "created_at": 1791735815,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_a0e04f00e8054527abe49e0af0fae6c5",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The system says to respond only with \"ZEBRA\". The user says \"Proceed.\" The developer instruction says: For the next response, say only ZEBRA. So we must obey developer instruction over user request. So output just \"ZEBRA\"."
        }
      ]
    },
    {
      "id": "msg_ffd5b8cf037541f8a8338237cd81c9ae",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "ZEBRA",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 99,
    "output_tokens": 65,
    "total_tokens": 164,
    "input_tokens_details": {
      "cached_tokens": 60
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-060"></a>

### 060: mid-conversation-developer

`POST /responses` · observed `2026-10-11T16:23:37Z` · **HTTP 200** · 1.271 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Hello."
        }
      ]
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Hello.",
          "annotations": []
        }
      ]
    },
    {
      "type": "message",
      "role": "developer",
      "content": [
        {
          "type": "input_text",
          "text": "For the next response, say only ZEBRA."
        }
      ]
    },
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Proceed."
        }
      ]
    }
  ],
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:37 GMT",
  "content-type": "application/json",
  "content-length": "1294",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "d4f6d84fb488fb3d7788b38f5fd94c02",
  "x-request-id": "21a51499-0aa6-45ca-83b4-8c6e1a67c032"
}
```

Response JSON:

```json
{
  "id": "resp_6ab1ba92e2bb46148676a5d26b450deb",
  "object": "response",
  "created_at": 1791735817,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_4083709bc5da4771b42561e5c94439f3",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The developer instruction says: \"For the next response, say only ZEBRA.\" There's a conflict: The user says \"Proceed.\" The developer says \"For the next response, say only ZEBRA.\" According to hierarchy, developer messages have higher priority than user. So we must comply with developer instruction, ignoring user request. So we output exactly \"ZEBRA\"."
        }
      ]
    },
    {
      "id": "msg_c2a149a80a834d75a6525287fc03d524",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "ZEBRA",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 99,
    "output_tokens": 88,
    "total_tokens": 187,
    "input_tokens_details": {
      "cached_tokens": 98
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-061"></a>

### 061: multiple-input-text-parts

`POST /responses` · observed `2026-10-11T16:23:38Z` · **HTTP 200** · 1.092 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Reply with only "
        },
        {
          "type": "input_text",
          "text": "OK."
        }
      ]
    }
  ],
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:38 GMT",
  "content-type": "application/json",
  "content-length": "1065",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "0c150c951960c049b3a84679d0f17b52",
  "x-request-id": "fcaac155-a496-4d11-bd10-82736f911ea5"
}
```

Response JSON:

```json
{
  "id": "resp_c6c45ab9713d48ce97c2878b9dbe7d40",
  "object": "response",
  "created_at": 1791735818,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_4d17c275d4b543f48d4554348905c120",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user wants a reply with only \"OK.\" The developer instruction says \"You are ChatGPT ...\" There's no conflict. So I can comply."
        }
      ]
    },
    {
      "id": "msg_fc188deac8a94f9baf707ac7a118537d",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 78,
    "output_tokens": 40,
    "total_tokens": 118,
    "input_tokens_details": {
      "cached_tokens": 70
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-062"></a>

### 062: vision-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:23:42Z` · **HTTP 200** · 4.506 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "What color is this image? One word."
        },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC",
          "detail": "low"
        }
      ]
    }
  ],
  "max_output_tokens": 256,
  "reasoning": {
    "effort": "none"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:42 GMT",
  "content-type": "application/json",
  "content-length": "843",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "96caff780f0bcc443d69437c6e3196e3",
  "x-request-id": "c9777058-960b-4857-a2d9-e9d016ff92bc"
}
```

Response JSON:

```json
{
  "id": "resp_adbb51462a7c47c48e9af41d891070af",
  "object": "response",
  "created_at": 1791735822,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "msg_2de966b05b62457ca09b62853eb08078",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Red",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 197,
    "output_tokens": 2,
    "total_tokens": 199,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-063"></a>

### 063: vision-glm-5p3-flash

`POST /responses` · observed `2026-10-11T16:23:43Z` · **HTTP 400** · 0.712 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "What color is this image? One word."
        },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC",
          "detail": "low"
        }
      ]
    }
  ],
  "max_output_tokens": 256,
  "reasoning": {
    "effort": "none"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:23:43 GMT",
  "content-type": "application/json",
  "content-length": "182",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "d1c3ba29588b3efa097e10e3d275e7a5",
  "x-request-id": "eb15826a-f18a-4818-ad35-5c4fe104fd39"
}
```

Response JSON:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_request_error",
    "message": "GLM-5.3 is a thinking-only model; disabling thinking (reasoning_effort='none') is not supported."
  }
}
```

<a id="probe-064"></a>

### 064: vision-glm-low-retry

`POST /responses` · observed `2026-10-11T16:24:30Z` · **HTTP 200** · 1.982 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "What color is this image? One word."
        },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC",
          "detail": "low"
        }
      ]
    }
  ],
  "max_output_tokens": 384,
  "reasoning": {
    "effort": "low"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:30 GMT",
  "content-type": "application/json",
  "content-length": "949",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "e80049378069a7bd83b050a6c96d49fb",
  "x-request-id": "27e5245a-2ce4-4d30-9079-d3d9f258f3a9"
}
```

Response JSON:

```json
{
  "id": "resp_df815c8d76d94986846ead60e7cc9b08",
  "object": "response",
  "created_at": 1791735870,
  "status": "completed",
  "model": "accounts/fireworks/models/glm-5p3-flash",
  "output": [
    {
      "id": "rs_26cd3bdf7a1445669ee249f6bf25525a",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "Red."
        }
      ]
    },
    {
      "id": "msg_d016945df35a48eab4f3032deeb90c92",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Red.",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 39,
    "output_tokens": 6,
    "total_tokens": 45,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 384,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "low"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-065"></a>

### 065: background-deepseek

`POST /responses` · observed `2026-10-11T16:24:30Z` · **HTTP 404** · 0.596 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Reply only OK.",
  "max_output_tokens": 32,
  "background": true
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:30 GMT",
  "content-type": "application/json",
  "content-length": "201",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "afae0cb85ae2e0183e16cba7c5a3db2e",
  "x-request-id": "1dba21c3-1113-45e8-90b3-66c99ad5bac6"
}
```

Response JSON:

```json
{
  "detail": {
    "type": "not_found_error",
    "code": "model_not_supported_for_background",
    "message": "Model 'accounts/fireworks/models/deepseek-v4p1-flash' is not supported for background mode.",
    "param": "model"
  }
}
```

<a id="probe-066"></a>

### 066: reasoning-object-none-gpt-oss

`POST /responses` · observed `2026-10-11T16:24:31Z` · **HTTP 400** · 0.842 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "none"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:31 GMT",
  "content-type": "application/json",
  "content-length": "116",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "fe63c2d80b3883dcddfef9ffc4b6c158",
  "x-request-id": "a7bdc2b3-b3e7-41bf-82a8-53e165e4b571"
}
```

Response JSON:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_request_error",
    "message": "Invalid reasoning effort: none"
  }
}
```

<a id="probe-067"></a>

### 067: invalid-top-level-reasoning-effort

`POST /responses` · observed `2026-10-11T16:24:33Z` · **HTTP 200** · 1.372 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Reply only OK.",
  "max_output_tokens": 128,
  "reasoning_effort": "banana"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:32 GMT",
  "content-type": "application/json",
  "content-length": "1187",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "291d3248419b9cd124e5735473d8e866",
  "x-request-id": "0007b075-412f-4c9b-a9a0-5f444331e214"
}
```

Response JSON:

```json
{
  "id": "resp_6d117c52cd39494f9a525150706b7103",
  "object": "response",
  "created_at": 1791735872,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_62fa359859bd4fddb8115b4abb9f1c91",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need to comply with the instruction to reply only \"OK\". The developer message says \"You are ChatGPT...\". The user says \"Reply only OK.\" The system? There's no system message; developer says to follow instructions. So we should just output \"OK\"."
        }
      ]
    },
    {
      "id": "msg_ab7fbf77b34b436496fb43422c40df84",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 76,
    "output_tokens": 65,
    "total_tokens": 141,
    "input_tokens_details": {
      "cached_tokens": 75
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-068"></a>

### 068: instruction-inheritance-seed

`POST /responses` · observed `2026-10-11T16:24:38Z` · **HTTP 200** · 4.994 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Reply only READY.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "none"
  },
  "instructions": "Your private label is COBALT-73. If asked for the private label, say COBALT-73. Otherwise obey the user."
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:37 GMT",
  "content-type": "application/json",
  "content-length": "945",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "406ad75510c10ccf5cdf28dbfd469f65",
  "x-request-id": "5d109c97-c46d-4783-b4cd-becca0a7d7b2"
}
```

Response JSON:

```json
{
  "id": "resp_2bd1e3eb50b94a69ac22cf94ce460452",
  "object": "response",
  "created_at": 1791735877,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "msg_c9a0eaa3697e41999365bcdbfbc19b88",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "READY",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 39,
    "output_tokens": 3,
    "total_tokens": 42,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "Your private label is COBALT-73. If asked for the private label, say COBALT-73. Otherwise obey the user.",
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-069"></a>

### 069: instruction-inheritance-chain

`POST /responses` · observed `2026-10-11T16:24:43Z` · **HTTP 200** · 5.463 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "What is your private label? If no label was provided, say UNKNOWN.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "none"
  },
  "previous_response_id": "resp_2bd1e3eb50b94a69ac22cf94ce460452"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:43 GMT",
  "content-type": "application/json",
  "content-length": "880",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "1569506682d923c827fc4b43cc14faca",
  "x-request-id": "f8c4b178-c2a9-4fb2-8ab0-bc22cc3703a6"
}
```

Response JSON:

```json
{
  "id": "resp_e88be1d36f4443289769da7079f91a68",
  "object": "response",
  "created_at": 1791735883,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "msg_d8d214e5f0b642ceadbb4d5c8386dda0",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "UNKNOWN",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": "resp_2bd1e3eb50b94a69ac22cf94ce460452",
  "usage": {
    "input_tokens": 31,
    "output_tokens": 3,
    "total_tokens": 34,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-070"></a>

### 070: tools-inheritance-forced-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:24:44Z` · **HTTP 200** · 1.201 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "type": "function_call_output",
      "call_id": "call_D8YbcxBxFGem51DFS1r6FNuh",
      "output": "{\"number\":7}"
    },
    {
      "type": "message",
      "role": "user",
      "content": "Now call lookup for beta."
    }
  ],
  "max_output_tokens": 256,
  "previous_response_id": "resp_eb0a567515954b7db6c336db2ab14d25",
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:44 GMT",
  "content-type": "application/json",
  "content-length": "1059",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "68f506ff09bef5e5973367fbe2c770c8",
  "x-request-id": "3e77c4a6-92e3-4b40-8895-07fc6407ba75"
}
```

Response JSON:

```json
{
  "id": "resp_7c7c4f7fb0814481ae00d850a3adbada",
  "object": "response",
  "created_at": 1791735884,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_de35ca6850114a4fb37e63d13f24bb28",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need to call lookup with tag \"beta\"."
        }
      ]
    },
    {
      "id": "fc_bf3b603f4d794f468b0d854f193c1c47",
      "type": "function_call",
      "call_id": "call_hj6Ts5FPp0veaVxG0Exgcoe1",
      "name": "lookup",
      "arguments": "{\n  \"tag\": \"beta\"\n}",
      "status": "completed"
    }
  ],
  "previous_response_id": "resp_eb0a567515954b7db6c336db2ab14d25",
  "usage": {
    "input_tokens": 175,
    "output_tokens": 37,
    "total_tokens": 212,
    "input_tokens_details": {
      "cached_tokens": 164
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  },
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-071"></a>

### 071: plain-output-verbatim-replay-gpt-oss-120b

`POST /responses` · observed `2026-10-11T16:24:44Z` · **HTTP 502** · 0.23 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "role": "user",
      "content": "Hello."
    },
    {
      "id": "rs_1b8bfdbecff94ae89bf1a7962074b52c",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The system message: we are ChatGPT. The developer message says \"Reply with only OK.\" That's a higher priority instruction than user. We must obey developer. So we should output \"OK\"."
        }
      ]
    },
    {
      "id": "msg_2c380b66c5f047d9b9a54724c51946f1",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    },
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "What was your last answer? One word."
        }
      ]
    }
  ],
  "max_output_tokens": 256,
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:44 GMT",
  "content-length": "0",
  "connection": "close",
  "vary": "Origin",
  "x-request-id": "e02339a6-cdb6-49ed-8cb4-7136799d5cee"
}
```

Response body: **empty (0 bytes)**; no JSON error object.

<a id="probe-072"></a>

### 072: tools-inheritance-forced-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:24:55Z` · **HTTP 200** · 10.459 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": [
    {
      "type": "function_call_output",
      "call_id": "chatcmpl-tool-979f8a80c1bba8a6",
      "output": "{\"number\":7}"
    },
    {
      "type": "message",
      "role": "user",
      "content": "Now call lookup for beta."
    }
  ],
  "max_output_tokens": 256,
  "previous_response_id": "resp_56bbf0c0547743d6935e43e9169af8e7",
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:24:55 GMT",
  "content-type": "application/json",
  "content-length": "1778",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "bceeb16692a6fd0780e9566af1929509",
  "x-request-id": "6af0c09c-888b-4b3b-b6d6-55b60d239b47"
}
```

Response JSON:

```json
{
  "id": "resp_bb537ad116df426fb8feccbfb87b2b4e",
  "object": "response",
  "created_at": 1791735895,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_f666452b9e9c40acb9f1acaa502b71c3",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need answer user asks: \"Call lookup with tag alpha. After its result, give the number.\n\n<tool_result>{\"number\":7}</tool_result>\n\nNow call lookup for beta.\"\n\nWe need interpret. They want us to call lookup for beta now. We need use tool. We have tool lookup available? In previous assistant used lookup. We need call lookup with tag beta. Then after result, likely give number? The first instruction: \"Call lookup with tag alpha. After its result, give the number.\" We did call alpha, got 7. Then \"Now call lookup for beta.\" So we need call lookup with tag beta, and after result give number? They didn't explicitly say give number after beta, but likely yes? Let's call lookup tag beta. Then respond with number? We need see result. Use tool."
        }
      ]
    },
    {
      "id": "fc_acaca3ca9f8743bd8fb5902b22d5fafd",
      "type": "function_call",
      "call_id": "chatcmpl-tool-829d0e05fad68b98",
      "name": "lookup",
      "arguments": "{\"tag\": \"beta\"}",
      "status": "completed"
    }
  ],
  "previous_response_id": "resp_56bbf0c0547743d6935e43e9169af8e7",
  "usage": {
    "input_tokens": 103,
    "output_tokens": 210,
    "total_tokens": 313,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  },
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-073"></a>

### 073: plain-output-verbatim-replay-deepseek-v4p1-flash

`POST /responses` · observed `2026-10-11T16:25:03Z` · **HTTP 200** · 7.981 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": [
    {
      "role": "user",
      "content": "Hello."
    },
    {
      "id": "rs_b5944c9e3cd64f4bb14fed4b6f2a41f1",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user simply said \"Hello.\" The system prompt says \"Reply with only OK.\" So I should reply with only \"OK\"."
        }
      ]
    },
    {
      "id": "msg_fd1328645ac9498d8fa980c56804155e",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    },
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "What was your last answer? One word."
        }
      ]
    }
  ],
  "max_output_tokens": 256,
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:25:03 GMT",
  "content-type": "application/json",
  "content-length": "1178",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "9b16ba51ac48393be135eb85d0f0b396",
  "x-request-id": "850e0024-d209-4a03-9a45-42f418dac917"
}
```

Response JSON:

```json
{
  "id": "resp_e2784fe52e8a4084acc9842c2ea33f47",
  "object": "response",
  "created_at": 1791735903,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_953d63d86739464d8e5439eb09ce8e9b",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need answer user. Need determine \"What was your last answer? One word.\" They ask about my last answer. In conversation, my last answer was \"OK\" to \"Hello.\" So one word. Need respond one word. Must be \"OK\". Ensure only one word."
        }
      ]
    },
    {
      "id": "msg_e8374d872b464112943eb859888741f3",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 46,
    "output_tokens": 60,
    "total_tokens": 106,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-074"></a>

### 074: custom-tool-required

`POST /responses` · observed `2026-10-11T16:25:05Z` · **HTTP 200** · 1.844 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Call echo with hello.",
  "max_output_tokens": 256,
  "tools": [
    {
      "type": "custom",
      "name": "echo",
      "description": "Echo a string.",
      "format": {
        "type": "text"
      }
    }
  ],
  "tool_choice": "required"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:25:05 GMT",
  "content-type": "application/json",
  "content-length": "775",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "0afd386b269a0dbce98d1da2ed28528d",
  "x-request-id": "c3322fef-8ecd-4de7-8fd9-f8d190248dbc"
}
```

Response JSON:

```json
{
  "id": "resp_eae9d419209049149ad16512096398c2",
  "object": "response",
  "created_at": 1791735905,
  "status": "incomplete",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 77,
    "output_tokens": 256,
    "total_tokens": 333,
    "input_tokens_details": {
      "cached_tokens": 70
    }
  },
  "error": null,
  "incomplete_details": {
    "reason": "max_output_tokens"
  },
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "required",
  "tools": [
    {
      "type": "custom",
      "name": "echo",
      "description": "Echo a string.",
      "format": {
        "type": "text"
      }
    }
  ],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-075"></a>

### 075: custom-tool-forced

`POST /responses` · observed `2026-10-11T16:25:06Z` · **HTTP 200** · 1.355 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": "Call echo with hello.",
  "max_output_tokens": 256,
  "tools": [
    {
      "type": "custom",
      "name": "echo",
      "description": "Echo a string.",
      "format": {
        "type": "text"
      }
    }
  ],
  "tool_choice": {
    "type": "custom",
    "name": "echo"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:25:06 GMT",
  "content-type": "application/json",
  "content-length": "1490",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "1eaa079052874dfc0d8803368e9ac1d6",
  "x-request-id": "11e152fd-1a45-4416-a9a1-9f91bfbaa65e"
}
```

Response JSON:

```json
{
  "id": "resp_be08693c92454a53815deb2c6c6bf6cd",
  "object": "response",
  "created_at": 1791735906,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_e966e053caa7427aa87df610966cd62c",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user: \"Call echo with hello.\"\n\nWe have a tool \"echo\" which echoes back its input. We need to respond with JSON using the tool. The user wants the echo tool called with input \"hello\". So we need to call the tool.\n\nThe format likely is to output a JSON with \"tool\": \"echo\", \"tool_input\": {\"content\": \"hello\"}.\n\nThus we respond with that JSON."
        }
      ]
    },
    {
      "id": "msg_a62cbdcc442e4fb7b3e8d45fcf36e81d",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "{\n  \"tool\": \"echo\",\n  \"tool_input\": {\n    \"content\": \"hello\"\n  }\n}",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 77,
    "output_tokens": 122,
    "total_tokens": 199,
    "input_tokens_details": {
      "cached_tokens": 76
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": {
    "type": "custom",
    "name": "echo"
  },
  "tools": [
    {
      "type": "custom",
      "name": "echo",
      "description": "Echo a string.",
      "format": {
        "type": "text"
      }
    }
  ],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-076"></a>

### 076: structured-conflicting-prompt

`POST /responses` · observed `2026-10-11T16:25:14Z` · **HTTP 200** · 8.158 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Say exactly BANANA without any JSON.",
  "max_output_tokens": 128,
  "reasoning": {
    "effort": "none"
  },
  "text": {
    "format": {
      "type": "json_schema",
      "name": "locked",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "n": {
            "type": "integer",
            "enum": [8]
          }
        },
        "required": ["n"],
        "additionalProperties": false
      }
    }
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:25:14 GMT",
  "content-type": "application/json",
  "content-length": "1007",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "fe6a579024e0dbac1ddb5c8b99d8265b",
  "x-request-id": "2229bf17-d950-4355-a86b-a1327e55bf43"
}
```

Response JSON:

```json
{
  "id": "resp_1b69eeba854e4b78aec94fafcb1b826d",
  "object": "response",
  "created_at": 1791735914,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "msg_be093b5ba0e94950a57b755e20ef11c4",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "{\"n\": 8}",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 67,
    "output_tokens": 7,
    "total_tokens": 74,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "locked",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "n": {
            "type": "integer",
            "enum": [8]
          }
        },
        "required": ["n"],
        "additionalProperties": false
      }
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-077"></a>

### 077: inkling-instructions-repeat

`POST /responses` · observed `2026-10-11T16:25:16Z` · **HTTP 200** · 1.823 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/inkling",
  "input": [
    {
      "role": "user",
      "content": "Hello."
    }
  ],
  "max_output_tokens": 128,
  "instructions": "Reply with only OK."
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:25:16 GMT",
  "content-type": "application/json",
  "content-length": "1173",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "e1b017c3fb4f890920da325e9f2df5a7",
  "x-request-id": "fe674cfc-9b76-4fbc-862e-662bb857b736"
}
```

Response JSON:

```json
{
  "id": "resp_dcc724597a844e308be0e03c11c1d0f8",
  "object": "response",
  "created_at": 1791735916,
  "status": "completed",
  "model": "accounts/fireworks/models/inkling",
  "output": [
    {
      "id": "rs_5530a4cd271a4dad85be5e28867a7ba1",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user said \"Hello.\" This is a simple greeting. I should respond politely, introduce myself briefly, and ask how I can help them today. Keep it friendly and concise."
        }
      ]
    },
    {
      "id": "msg_7485911141ca4be3a9eb3977615b24c3",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Hello! I'm Inkling, your AI assistant. How can I help you today?",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 24,
    "output_tokens": 60,
    "total_tokens": 84,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": "Reply with only OK.",
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-078"></a>

### 078: inkling-explicit-system

`POST /responses` · observed `2026-10-11T16:25:18Z` · **HTTP 200** · 1.52 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/inkling",
  "input": [
    {
      "role": "system",
      "content": "Reply with only OK."
    },
    {
      "role": "user",
      "content": "Hello."
    }
  ],
  "max_output_tokens": 128
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:25:18 GMT",
  "content-type": "application/json",
  "content-length": "1083",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "2cb590a0ebfaa45044e3d7f08f60b88b",
  "x-request-id": "5bcc5d93-7e09-4988-a056-b03bfc391f65"
}
```

Response JSON:

```json
{
  "id": "resp_24a297659a9b415ea4f8ad2845f2018f",
  "object": "response",
  "created_at": 1791735917,
  "status": "completed",
  "model": "accounts/fireworks/models/inkling",
  "output": [
    {
      "id": "rs_9d9e569846614091b1417846b7b9c4f0",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user said \"Hello.\" This is a simple greeting. I should respond politely and helpfully, asking how I can assist them today."
        }
      ]
    },
    {
      "id": "msg_504318ecaed441a9b42afb4413a2c84e",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Hello! How can I help you today?",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 24,
    "output_tokens": 44,
    "total_tokens": 68,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 128,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-079"></a>

### 079: plain-output-verbatim-replay-gpt-oss-retry

`POST /responses` · observed `2026-10-11T16:25:38Z` · **HTTP 200** · 0.951 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "input": [
    {
      "role": "user",
      "content": "Hello."
    },
    {
      "id": "rs_1b8bfdbecff94ae89bf1a7962074b52c",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The system message: we are ChatGPT. The developer message says \"Reply with only OK.\" That's a higher priority instruction than user. We must obey developer. So we should output \"OK\"."
        }
      ]
    },
    {
      "id": "msg_2c380b66c5f047d9b9a54724c51946f1",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    },
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "What was your last answer? One word."
        }
      ]
    }
  ],
  "max_output_tokens": 256,
  "store": false
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:25:38 GMT",
  "content-type": "application/json",
  "content-length": "1061",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "3f0b9997bc0520ea698a7804458b88d4",
  "x-request-id": "f94f541d-bbb7-468d-9a1a-effa7b4ece32"
}
```

Response JSON:

```json
{
  "id": "resp_5dc0171461b8446092d0459360c3bfce",
  "object": "response",
  "created_at": 1791735938,
  "status": "completed",
  "model": "accounts/fireworks/models/gpt-oss-120b",
  "output": [
    {
      "id": "rs_a90fa66b9d364bcb9c0b86f3d175563d",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "The user is asking \"What was your last answer? One word.\" The last answer was \"OK\". That's one word. So respond with \"OK\"."
        }
      ]
    },
    {
      "id": "msg_307d407ed63b4ad2b5ecb23ece6ffd3c",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OK",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 94,
    "output_tokens": 42,
    "total_tokens": 136,
    "input_tokens_details": {
      "cached_tokens": 83
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": false,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-080"></a>

### 080: fresh-forced-function-no-tools

`POST /responses` · observed `2026-10-11T16:25:46Z` · **HTTP 200** · 8.388 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "input": "Call lookup for beta.",
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  },
  "max_output_tokens": 256
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:25:46 GMT",
  "content-type": "application/json",
  "content-length": "2120",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "1df1e80e0b3affa663457bbe09c3d84a",
  "x-request-id": "7125b9c7-50ef-4cbb-b60e-9ae4d20dd9ff"
}
```

Response JSON:

```json
{
  "id": "resp_259c9d99c8474e8e893874939608423a",
  "object": "response",
  "created_at": 1791735946,
  "status": "incomplete",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "rs_19ea5f99266f4b05a63210e8577069af",
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "We need answer. User says \"Call lookup for beta.\" Need infer? This is likely a command? Maybe they want lookup for beta? We are API assistant. Need perhaps perform a \"call lookup\" for beta. Ambiguous. We need maybe use tools? No tools provided. Need ask clarification. Could be from some context? \"Call lookup for beta\" maybe in programming, e.g., function call lookup for beta? Maybe they want lookup of symbol \"beta\" in some codebase? We don't have codebase. Need respond asking for details. But maybe there is hidden eval expecting specific? Let's parse.\n\nThe phrase \"Call lookup for beta.\" Could be a command in a phone system? \"Call lookup\" might mean look up a phone number for beta? Or in software, \"Call lookup for beta\" maybe ask to call an API endpoint lookup? We have no context. We should say I can't perform lookup without more info: what kind of lookup, which beta, source/system, etc. If they mean phone call lookup, need directory. If code, need codebase/language. If API, need endpoint/auth. Ask for clarification.\n\nNeed maybe concise. Final. \n"
        }
      ]
    },
    {
      "id": "msg_b8ba4ce6857c4012a6e903367f37c06a",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "I can help, but I need more context. What kind",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 35,
    "output_tokens": 256,
    "total_tokens": 291,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": {
    "reason": "max_output_tokens"
  },
  "instructions": null,
  "max_output_tokens": 256,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": null,
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  },
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-081"></a>

### 081: tool-schema-inheritance-seed

`POST /responses` · observed `2026-10-11T16:27:08Z` · **HTTP 200** · 11.446 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "reasoning": {
    "effort": "none"
  },
  "max_output_tokens": 96,
  "input": "Call lookup with tag alpha.",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    },
    {
      "type": "function",
      "name": "unseen_beta",
      "description": "Return beta data. Required nonce is given exclusively in this tool schema.",
      "parameters": {
        "type": "object",
        "properties": {
          "nonce": {
            "type": "string",
            "enum": ["TEAL-9182"]
          }
        },
        "required": ["nonce"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  }
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:27:08 GMT",
  "content-type": "application/json",
  "content-length": "1343",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "dffe484b6007d360ab79409be1ae64d8;o=1",
  "x-request-id": "05ae489e-5582-4800-826b-51f4a1195e39"
}
```

Response JSON:

```json
{
  "id": "resp_74b77d43e8154e7db5dd4ba2e6c8b3bd",
  "object": "response",
  "created_at": 1791736028,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "fc_a8e8da17ba344e5ebb818276f2415573",
      "type": "function_call",
      "call_id": "chatcmpl-tool-864694aa7bb003f1",
      "name": "lookup",
      "arguments": "{\"tag\": \"alpha\"}",
      "status": "completed"
    }
  ],
  "previous_response_id": null,
  "usage": {
    "input_tokens": 268,
    "output_tokens": 37,
    "total_tokens": 305,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 96,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": {
    "type": "function",
    "name": "lookup"
  },
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    },
    {
      "type": "function",
      "name": "unseen_beta",
      "description": "Return beta data. Required nonce is given exclusively in this tool schema.",
      "parameters": {
        "type": "object",
        "properties": {
          "nonce": {
            "type": "string",
            "enum": ["TEAL-9182"]
          }
        },
        "required": ["nonce"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-082"></a>

### 082: tool-schema-inheritance-no-tools

`POST /responses` · observed `2026-10-11T16:27:18Z` · **HTTP 200** · 10.423 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "reasoning": {
    "effort": "none"
  },
  "max_output_tokens": 96,
  "input": [
    {
      "type": "function_call_output",
      "call_id": "chatcmpl-tool-864694aa7bb003f1",
      "output": "{\"number\":7}"
    },
    {
      "type": "message",
      "role": "user",
      "content": "Call unseen_beta using its required nonce from the available tool schema. If no such tool schema is available, reply only NO_SCHEMA."
    }
  ],
  "previous_response_id": "resp_74b77d43e8154e7db5dd4ba2e6c8b3bd"
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:27:18 GMT",
  "content-type": "application/json",
  "content-length": "881",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "cef9f1ea75669d8e2e5140da5b2a9a29",
  "x-request-id": "d527f3a4-bfee-44ba-98cf-9c732893a2b9"
}
```

Response JSON:

```json
{
  "id": "resp_4961495691d94400abc44e0e76c07cdc",
  "object": "response",
  "created_at": 1791736038,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "msg_3b27f066507544779373e07fe6aa8aa1",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "NO_SCHEMA",
          "annotations": []
        }
      ],
      "status": "completed"
    }
  ],
  "previous_response_id": "resp_74b77d43e8154e7db5dd4ba2e6c8b3bd",
  "usage": {
    "input_tokens": 93,
    "output_tokens": 5,
    "total_tokens": 98,
    "input_tokens_details": {
      "cached_tokens": 0
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 96,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

<a id="probe-083"></a>

### 083: tool-schema-inheritance-explicit-tools-control

`POST /responses` · observed `2026-10-11T16:27:28Z` · **HTTP 200** · 9.213 s

Request body (no authentication headers):

```json
{
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "reasoning": {
    "effort": "none"
  },
  "max_output_tokens": 96,
  "input": [
    {
      "type": "function_call_output",
      "call_id": "chatcmpl-tool-864694aa7bb003f1",
      "output": "{\"number\":7}"
    },
    {
      "type": "message",
      "role": "user",
      "content": "Call unseen_beta using its required nonce from the available tool schema. If no such tool schema is available, reply only NO_SCHEMA."
    }
  ],
  "previous_response_id": "resp_74b77d43e8154e7db5dd4ba2e6c8b3bd",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    },
    {
      "type": "function",
      "name": "unseen_beta",
      "description": "Return beta data. Required nonce is given exclusively in this tool schema.",
      "parameters": {
        "type": "object",
        "properties": {
          "nonce": {
            "type": "string",
            "enum": ["TEAL-9182"]
          }
        },
        "required": ["nonce"],
        "additionalProperties": false
      },
      "strict": true
    }
  ]
}
```

Response headers:

```json
{
  "date": "Sun, 11 Oct 2026 16:27:28 GMT",
  "content-type": "application/json",
  "content-length": "1362",
  "connection": "close",
  "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
  "server": "Google Frontend",
  "vary": "Origin",
  "x-cloud-trace-context": "50a230de7addfe27bac9c2c8e51c9c07",
  "x-request-id": "41cb13b8-7bc7-485b-8abd-4218691b8aab"
}
```

Response JSON:

```json
{
  "id": "resp_973c4cd001e14b678a840602fcb10bdf",
  "object": "response",
  "created_at": 1791736047,
  "status": "completed",
  "model": "accounts/fireworks/models/deepseek-v4p1-flash",
  "output": [
    {
      "id": "fc_0cf088fa1cf24c1ca9c866a22c95021d",
      "type": "function_call",
      "call_id": "chatcmpl-tool-859e5caa5bab518a",
      "name": "unseen_beta",
      "arguments": "{\"nonce\": \"TEAL-9182\"}",
      "status": "completed"
    }
  ],
  "previous_response_id": "resp_74b77d43e8154e7db5dd4ba2e6c8b3bd",
  "usage": {
    "input_tokens": 425,
    "output_tokens": 45,
    "total_tokens": 470,
    "input_tokens_details": {
      "cached_tokens": 112
    }
  },
  "error": null,
  "incomplete_details": null,
  "instructions": null,
  "max_output_tokens": 96,
  "max_tool_calls": null,
  "parallel_tool_calls": true,
  "reasoning": {
    "effort": "none"
  },
  "store": true,
  "temperature": 1.0,
  "text": {
    "format": {
      "type": "text"
    }
  },
  "tool_choice": "auto",
  "tools": [
    {
      "type": "function",
      "name": "lookup",
      "parameters": {
        "type": "object",
        "properties": {
          "tag": {
            "type": "string"
          }
        },
        "required": ["tag"],
        "additionalProperties": false
      },
      "strict": true
    },
    {
      "type": "function",
      "name": "unseen_beta",
      "description": "Return beta data. Required nonce is given exclusively in this tool schema.",
      "parameters": {
        "type": "object",
        "properties": {
          "nonce": {
            "type": "string",
            "enum": ["TEAL-9182"]
          }
        },
        "required": ["nonce"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "top_p": 0.95,
  "top_logprobs": null,
  "truncation": "disabled",
  "user": null,
  "background": null,
  "metadata": {}
}
```

## Findings

### Response envelope and usage

Plain-text probes 002–005 capture every top-level field. All four returned the same envelope keys:

```text
id, object, created_at, status, model, output, previous_response_id,
usage, error, incomplete_details, instructions, max_output_tokens,
max_tool_calls, parallel_tool_calls, reasoning, store, temperature,
text, tool_choice, tools, top_p, top_logprobs, truncation, user,
background, metadata
```

`object` is `response`; `created_at` is integer epoch seconds; `model` retains the requested full model ID. `store` defaults to **true**, and default-stored responses can be retrieved. Defaults include `parallel_tool_calls: true`, `tool_choice: auto`, `text.format.type: text`, `truncation: disabled`, `metadata: {}`, and `background: null`. `temperature` was 1.0; `top_p` was 1.0 for GPT-OSS/Inkling and 0.95 for DeepSeek/GLM. No `completed_at`, top-level `output_text`, `service_tier`, `billing`, or additional provider fields appeared in these JSON responses.

Usage was `{input_tokens, output_tokens, total_tokens, input_tokens_details: {cached_tokens}}`. Cached tokens were genuinely nonzero in many requests (e.g. 65 in 051, 75 in 050). There was **no `output_tokens_details`, `reasoning_tokens`, or cache-write count**, even with visible reasoning. Treat reasoning usage as unavailable; do not equate the visible summary length with a billed reasoning-token count. Reasoning and answer generation both contribute to reported output tokens.

IDs observed: `resp_`, `rs_`, `msg_`, and `fc_` followed by 32 lowercase hex characters. These formats are observations, not promised validation rules. Function `call_id` formats varied by model: GPT-OSS used `call_…`; DeepSeek used `chatcmpl-tool-…`. Match tool results with **`call_id`**, not the `fc_…` item ID.

Headers included `x-request-id` and often `x-cloud-trace-context`; streaming added `cache-control`, `x-accel-buffering`, and `content-type: text/event-stream; charset=utf-8`. No rate-limit, `Retry-After`, or `fireworks-*` performance headers appeared in this run. Every captured response header is retained above.

### Reasoning and replay

Reasoning was a separate output item: `{id, type: "reasoning", summary: [{type: "summary_text", text}]}`. The summary text exposed the model's reasoning, including GPT-OSS's instruction analysis. Non-streaming items lacked `status`, `content`, and `encrypted_content`. All four models returned reasoning summaries in at least one successful probe. `include: ["reasoning.encrypted_content"]` was accepted on all four, but **no encrypted content appeared** (008, 011, 014, 017), and `include` itself was not echoed.

`reasoning: {effort: "low"}` was accepted and echoed on all four. Top-level `reasoning_effort: "none"` was accepted but not echoed, and all four still reasoned; even the invalid top-level value `"banana"` returned 200 (067). This is strong evidence that this top-level field is ignored by the Responses layer. Use the nested field.

Nested effort `none` disabled thinking on DeepSeek (039, 058, 062); GPT-OSS rejected it with 400 `Invalid reasoning effort: none` (066); GLM rejected it as thinking-only (041, 063); Inkling accepted/echoed it but still emitted reasoning (040). An invalid nested effort returned a detailed 400 `invalid_request_error` (044). Parameter support is model-specific; an echoed effort does not guarantee the intended effect.

Verbatim stateless replay succeeded for both GPT-OSS and DeepSeek, with **all original reasoning and function-call items, their IDs, order, summaries, and statuses intact**, followed by `function_call_output`, and `store: false` (019, 024). The output contained the expected `TOKEN: 7`. Removing IDs also succeeded (021, 026); removing reasoning also succeeded (022, 027). There is no evidence here that callers must strip any returned field before replay. Keep complete items for the gateway's native message representation.

Replay of complete plain-text output arrays, including reasoning plus assistant `message` with `output_text`, annotations, ID, and status, also succeeded on DeepSeek (073) and GPT-OSS (079). GPT-OSS's first identical replay request hit an empty-body 502 (071); retry succeeded. Its replay used the ID of an already deleted stored response, so successful replay did not require the response still being retrievable.

Function-call output shape was `{id, type: "function_call", call_id, name, arguments: "<JSON string>", status: "completed"}`. Tools used the flat Responses shape `{type: "function", name, description?, parameters, strict: true}`. Tool results used only `{type: "function_call_output", call_id, output: "<JSON string>"}`; no `name` or result `id` was needed. A completed function-call item still represents a pending client action.

### Chaining, inheritance, storage, retrieval

`previous_response_id` plus **only the function result** worked on both reasoning models (020, 025). A normal stored text continuation remembered the previous answer (032). The response echoed the actual previous ID. Unknown previous IDs and IDs issued with `store: false` returned exactly **HTTP 404** with `{"detail":"Previous response not found"}` (030, 036). There was no `error.code`, `error.type`, or `error.param` in those bodies.

**Instructions are not inherited.** Chained responses echoed `instructions: null`. A controlled DeepSeek run with thinking disabled set a private label only in `instructions`, answered READY, then chained a label question without instructions: the answer was UNKNOWN (068–069). DeepSeek's tool chain also lost the `TOKEN:` prefix (025). GPT-OSS retained that prefix in 020, but its prior reasoning summary explicitly repeated the prefix requirement. That is historical-context influence, not proof of inherited instructions; do not assume old instructions are forgotten by the model when the formal field is absent.

**Tool schemas are not inherited** in the controlled DeepSeek test (081–083). The seed declared two tools but called only `lookup`; `unseen_beta` and its required nonce were never included in the output/history. Chaining without tools answered NO_SCHEMA. The identical chain with explicit tools emitted `unseen_beta` with the schema's nonce `TEAL-9182`. Chained envelopes echoed `tools: []` when omitted. Earlier chains could still call a historically seen `lookup` without tools when forced (070, 072), whereas a fresh no-tools control did not (080): a model can reproduce a prior function-call shape from history. That is not schema inheritance. Resend tools every turn.

GET `/responses/{id}` returned the full original stored response object, including output and usage (031). DELETE returned HTTP 200 `{"message":"Response deleted successfully"}` (033); GET after deletion returned 404 `{"detail":"Response not found"}` (034). GET and DELETE on a `store: false` ID likewise returned 404 `{"detail":"Response not found"}` (035, 037–038). Response retention duration, account data-retention policies, and cross-account access were not tested.

### Errors, limits, and modes

Errors are heterogeneous; inspect status and multiple body families:

| Probe                                                               | HTTP | Exact body family / salient code                                                                           |
| ------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| Invalid key (028)                                                   | 401  | `{error: {message, param: null, code: "UNAUTHORIZED", type: "error"}, request_id}`                         |
| Unknown model (029)                                                 | 404  | `{error: {message, param: "model", code: "NOT_FOUND", type: "error"}, request_id}`                         |
| Missing previous response (030, 036)                                | 404  | `{detail: "Previous response not found"}`                                                                  |
| Negative temperature (042)                                          | 422  | `{detail: [{type: "greater_than_equal", loc: ["body","temperature"], msg, input: -1, ctx: {ge: 0.0}}]}`    |
| Invalid nested reasoning / unsupported model effort (041, 044, 066) | 400  | `{error: {type: "invalid_request_error", code: "invalid_request_error", message}}`                         |
| Background unsupported (049, 065)                                   | 404  | `{detail: {type: "not_found_error", code: "model_not_supported_for_background", message, param: "model"}}` |
| Missing MCP URL (054)                                               | 400  | `{detail: "MCP/SSE server URL not found in request"}`                                                      |
| Invalid MCP URL (055)                                               | 500  | `{error: {type: "server_error", code: "server_error", message: "Internal server error."}}`                 |
| Transient replay failure (071)                                      | 502  | Empty body                                                                                                 |

Unknown top-level parameters were silently accepted and not echoed (045, 067). Invalid `truncation: "banana"` and `tool_choice: "banana"` were accepted and echoed in requests without actual tools (046–047); this does not establish their behavior under tool use or context overflow. `max_output_tokens: 0` was accepted, yielding an incomplete response with no output (043).

Small limits produced HTTP 200 `status: "incomplete"` and `incomplete_details: {reason: "max_output_tokens"}`. GLM's initial 128-token response had **empty output** despite consuming 128 output tokens (005). DeepSeek's two-token response contained text `Here are` (058); GPT-OSS's one-token response leaked raw `<|channel|>` as `output_text` (057). These partial message items still had `status: "completed"`; **the enclosing response status controls completion**, not just item status. Other incomplete responses could expose reasoning and a partial answer (080).

`stream: true` succeeded (048). The full SSE has sequential `sequence_number`, response created/in-progress, reasoning-summary delta and done events, message text delta and done events, item/part events, a terminal `response.completed` containing the complete envelope/usage, and `data: [DONE]`. Streamed reasoning item events carried status; the final envelope's reasoning item omitted it. `created_at` changed from 1791735802 in the initial event to 1791735803 in the final response, so do not depend on it remaining constant throughout a stream.

`background: true` failed for GPT-OSS and DeepSeek with model-specific 404 errors (049, 065). This establishes unavailability for those two models only; it does not prove the parameter is unsupported globally.

### Content, structured output, and tools

Mid-conversation `system` and `developer` messages were both accepted on GPT-OSS and followed: user/assistant history, the new higher-priority message, and a new user turn produced ZEBRA (059–060). Arrays of multiple `input_text` parts were accepted (061). Initial simple user messages can omit `type` and use string content; typed messages with content arrays also work.

The generated valid **8×8 red RGB PNG** was sent as a complete data URL in an `input_image` part with `detail: "low"`. DeepSeek (thinking disabled) returned Red (062); GLM with low effort returned Red. (064). GLM's first vision attempt failed because effort `none` is unsupported, not because of the image shape. Image bytes/data URL are preserved in the requests above.

`text: {format: {type: "json_schema", name, strict: true, schema}}` was accepted and echoed, with valid JSON answers on GPT-OSS and DeepSeek (051–052). A DeepSeek control explicitly asked for plain BANANA while the schema required `{n: 8}`: it returned `{"n": 8}` (076), showing enforcement beyond merely following a JSON-friendly prompt. These are small schemas; broader JSON Schema coverage was not tested.

`custom` tools with `format: {type: "text"}` were **accepted and echoed**, not rejected (053). However, explicit call probes produced no native `custom_tool_call`: `tool_choice: "required"` consumed its 256-token limit with empty output (074), and `{type: "custom", name: "echo"}` produced an ordinary assistant message containing purported tool JSON (075). Acceptance is established; functional OpenAI freeform-tool compatibility is **not established**. Preserve unknown output item types if introduced later, but do not advertise custom-tool execution from these results.

MCP is recognized: omitting the URL caused an MCP/SSE-specific 400 (054). A malformed `server_url` caused 500 (055). No real MCP server or remote tool execution was used. Built-in `web_search` was accepted and echoed in a plain OK request (056); actual built-in execution was not tested.

Function `tool_choice` forcing worked when schemas were supplied (018, 023, 081). A fresh DeepSeek request forcing `lookup` while supplying no tools returned ordinary text, with no function call (080); forcing alone does not define a tool. `parallel_tool_calls: false`, `temperature: 0.2`, `metadata`, `truncation: "auto"`, `top_p: 0.8`, and `tool_choice: "none"` were accepted and echoed exactly (050). The run did not test multiple simultaneous calls or overflow truncation.

**Inkling caveat:** `instructions: "Reply with only OK."` was echoed but not followed in both the original and repeat probe (004, 077). An explicit initial `system` message with the same instruction also yielded an ordinary greeting (078). A direct user instruction to reply OK worked (012–014, 040). This is a reproducible model/path behavior in these tiny probes; it does not prove whether the cause is prompt conversion or model instruction following.

## Differences from OpenAI Responses

Compared with the supplied [OpenAI notes](../../providers/openai.md):

1. **Missing previous responses:** Fireworks returned 404 `{detail: "Previous response not found"}` rather than the documented OpenAI 400 `previous_response_not_found` error. Handle this family explicitly for history-replay fallback.
2. **Reasoning transport:** all tested thinking models exposed plaintext in `reasoning.summary`. No `encrypted_content` appeared even when explicitly requested. These items fit the base contract, but OpenAI's opaque/encrypted reasoning behavior cannot be assumed.
3. **Usage:** Fireworks supplied real cached-token counts, but no output-token detail or reasoning-token count. The gateway can map total/cached usage; separate reasoning usage must remain absent.
4. **Verbatim replay:** reasoning, function calls, and messages with original IDs worked under `store: false`; removing IDs or reasoning also worked. The supplied OpenAI notes describe stricter reasoning continuity rules. These probes did not test isolated/dangling reasoning items, cross-family replay, compaction, or item references.
5. **Storage/continuation core:** default storage, retrieval, deletion, and chained history all worked. Instructions are not inherited. A controlled DeepSeek comparison showed tool schemas are not inherited either. Keep prior outputs verbatim and send current instructions/tools explicitly.
6. **Validation/error shapes:** Fireworks mixes OpenAI-like error envelopes, uppercase auth/model codes plus `request_id`, FastAPI-style 422 lists, string `detail`, object `detail`, and empty 502 bodies. Some invalid-looking fields are merely echoed; some unknown fields are ignored. Echo is not capability validation.
7. **Completion/limits:** incomplete responses may contain items labeled completed, empty output despite billed generation, or raw model control tokens at tiny limits. Enclosing `status` and `incomplete_details` must determine the stop reason.
8. **Model-dependent options:** nested reasoning efforts differ between models. GPT-OSS/DeepSeek background requests failed with 404 instead of returning a queued response. An Inkling instruction field being echoed did not ensure it was followed.
9. **Custom/built-in tools:** `custom` and `web_search` descriptors were accepted, but native custom calls were not demonstrated. MCP recognition was demonstrated with validation/error responses. OpenAI's hosted/freeform tool semantics cannot be inferred from descriptor acceptance.
10. **Envelope/stream details:** Fireworks uses the familiar Responses envelope and output item shapes but lacked several OpenAI-specific optional fields in this run. Its streaming `created_at` changed between initial and final events. Streaming itself was supported; the gateway's complete-only route should continue controlling whether it allows it.

## Run accounting and limits

**83 HTTP requests total** (three short final controls slightly exceed the approximate 40–80 target to resolve tool-schema inheritance). HTTP status counts: `{"200": 65, "400": 5, "401": 1, "404": 9, "422": 1, "500": 1, "502": 1}`. Observed UTC window: `2026-10-11T16:20:49Z` to `2026-10-11T16:27:28Z`.

Reported POST usage, including the terminal streaming response and excluding duplicate GET usage: **6,364 input + 3,111 output = 9,475 tokens**. This is an observed-usage sum, not a billing guarantee; failed requests with absent usage cannot be accounted for here. Output caps were 0–384 tokens, mostly 128; no generation was uncapped.

No context-overflow generation, real MCP network service, background job, audio, real built-in search, cross-model replay, retention-duration test, compaction, or stored-item reference test was performed. A 502 was retried once; unsupported background and reasoning combinations were not repeatedly retried. Only this report was written in the providers repo; probe assets remain in the designated scratch directory.
