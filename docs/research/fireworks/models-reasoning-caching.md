# Fireworks AI research: models, reasoning, caching, pricing, limits, errors, structured output, vision, deployments, account

Research date: 2026-10-11. Scope: everything around inference for a Responses-API client except the request/response field reference (another agent covers that). Target: a Fireworks profile on the base OpenAI-Responses adapter of a stateless, non-streaming gateway.

## Method and caveats

- All docs pages were fetched as raw markdown (`https://docs.fireworks.ai/<path>.md`), not summarised. Model facts come from the public model-library pages (`app.fireworks.ai/models/fireworks/<slug>` and `fireworks.ai/models`), whose server-rendered data embeds the same `gateway.Model` object the List Models API returns (`contextLength`, `supportsImageInput`, `supportsTools`, `supportsServerless`, `skuInfos`, `deprecationDate`). No Fireworks inference or account API was called.
- The docs describe **chat completions** far better than **Responses**. Where a fact is only documented for chat completions it is labelled "chat completions" and whether it carries over to `/v1/responses` is flagged.
- No page documents a **maximum output tokens** per model. The model object has no such field (S25). The column is "not documented" throughout.
- The docs are visibly inconsistent in places (model-library flags vs. the recommended-models guide; Responses schema vs. Responses guide). Conflicts are called out in place and again in the last section.
- Prices are USD per 1M tokens.

### Sources

| ID  | URL                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------- |
| S1  | https://docs.fireworks.ai/guides/response-api.md (Responses API guide)                                         |
| S2  | https://docs.fireworks.ai/api-reference/post-responses.md (Responses reference)                                |
| S3  | https://docs.fireworks.ai/api-reference/post-chatcompletions.md (chat completions reference, OpenAPI)          |
| S4  | https://docs.fireworks.ai/guides/reasoning.md                                                                  |
| S5  | https://docs.fireworks.ai/guides/prompt-caching.md                                                             |
| S6  | https://docs.fireworks.ai/serverless/pricing.md                                                                |
| S7  | https://docs.fireworks.ai/serverless/overview.md                                                               |
| S8  | https://docs.fireworks.ai/serverless/serverless-modes.md                                                       |
| S9  | https://docs.fireworks.ai/serverless/rate-limits.md                                                            |
| S10 | https://docs.fireworks.ai/guides/inference-error-codes.md                                                      |
| S11 | https://docs.fireworks.ai/guides/reliability.md                                                                |
| S12 | https://docs.fireworks.ai/guides/quotas_usage/account-quotas.md                                                |
| S13 | https://docs.fireworks.ai/structured-responses/structured-response-formatting.md                               |
| S14 | https://docs.fireworks.ai/structured-responses/structured-output-grammar-based.md                              |
| S15 | https://docs.fireworks.ai/guides/querying-vision-language-models.md                                            |
| S16 | https://docs.fireworks.ai/faq-new/billing-pricing/how-many-tokens-per-image.md                                 |
| S17 | https://docs.fireworks.ai/guides/ondemand-deployments.md                                                       |
| S18 | https://docs.fireworks.ai/deployments/routers.md                                                               |
| S19 | https://docs.fireworks.ai/fine-tuning/deploying-loras.md                                                       |
| S20 | https://docs.fireworks.ai/accounts/zero-data-retention.md                                                      |
| S21 | https://docs.fireworks.ai/guides/security_compliance/data_handling.md                                          |
| S22 | https://docs.fireworks.ai/accounts/data-residency.md                                                           |
| S23 | https://docs.fireworks.ai/serverless/us-only-serverless.md                                                     |
| S24 | https://docs.fireworks.ai/updates/changelog.md                                                                 |
| S25 | https://docs.fireworks.ai/api-reference/list-models.md (model object schema)                                   |
| S26 | https://docs.fireworks.ai/guides/recommended-models.md (last updated September 2026)                           |
| S27 | https://docs.fireworks.ai/nexus/open-models.md (aliases snapshot 2026-09-27)                                   |
| S28 | https://docs.fireworks.ai/nexus/apis-and-sdks.md                                                               |
| S29 | https://docs.fireworks.ai/guides/batch-inference.md                                                            |
| S30 | https://docs.fireworks.ai/guides/querying-text-models.md                                                       |
| S31 | https://docs.fireworks.ai/tools-sdks/openai-compatibility.md                                                   |
| S32 | https://docs.fireworks.ai/faq-new/billing-pricing/is-prompt-caching-billed-differently.md                      |
| S33 | https://docs.fireworks.ai/faq-new/billing-pricing/are-there-extra-fees-for-serving-fine-tuned-models.md        |
| S34 | https://docs.fireworks.ai/faq-new/models-inference/how-to-check-if-a-model-is-available-on-serverless.md       |
| S35 | https://fireworks.ai/pricing                                                                                   |
| S36 | https://app.fireworks.ai/models/fireworks/`<slug>` (per-model pages; slug is the last segment of the model ID) |
| S37 | https://fireworks.ai/models (library listing)                                                                  |
| S38 | https://docs.fireworks.ai/guides/function-calling.md                                                           |
| S39 | https://docs.fireworks.ai/guides/rollout-inference.md (session affinity headers)                               |

---

## 1. Models

### Landscape, as of 2026-10-11

Serverless churns fast. Fireworks gives "at least 2 weeks advance notice" before removing a serverless model (S7). Removals in the last six months (S24):

| Date               | Removed from serverless                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-14         | DeepSeek V3.1, V3.2, GLM 4.7, GLM 5, Qwen3 8B, Qwen3 VL 30B A3B (Thinking and Instruct), Llama 3.3 70B Instruct                                                   |
| 2026-06-17 / 06-26 | MiniMax M2.5, Kimi K2.5, Qwen 3.6 Plus                                                                                                                            |
| 2026-08-14 / 08-27 | DeepSeek V4 Flash, MiniMax M2.7, GPT OSS 20B, Kimi K2.6 Turbo/Fast, Kimi K2.7 Code Fast, DeepSeek V4 Pro                                                          |
| 2026-09-25/26      | DeepSeek V4 Pro (0813), DeepSeek V4 Flash (0731), DeepSeek V4 Flash Vision Exp, Muse Glimmer 30B, Kimi K2.6, Kimi K2.7 Code, GLM 5.2 (incl. Fast and US variants) |

Consequences for the catalog: Llama 4, Qwen3-Coder, DeepSeek V3.x/R1, Kimi K2.x, GLM 4.x/5.0-5.2 and gpt-oss-20b are **no longer serverless** (they remain dedicated-deployment models). The model object carries `deprecationDate`, the date the serverless deployment is taken down (S25), so the catalog can be refreshed from `GET /v1/accounts/fireworks/models?filter=supports_serverless=true` (S34). The `serverlessModes[]` field of the same object gives, per mode, the `usageIdentifier` (the value to send as `model`, e.g. `accounts/fireworks/routers/kimi-k3-fast`) and `serviceTier` (`priority`) (S25).

### Current serverless flagships

Context, vision and function calling come from the model object (S36, S25). Prices are the Standard row of the serverless pricing table (S6), input / cached input / output. Max output is not documented for any of them.

| Model ID                                                       | Context                                                                                                    | Vision                                                                        | Reasoning                                                               | Fn calling | Std price in / cached / out                                         | Priority in / cached / out |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------- | -------------------------- |
| `accounts/fireworks/models/kimi-k3`                            | 1,048,576                                                                                                  | yes                                                                           | yes (low/high/max, default max)                                         | yes        | 3.00 / 0.30 / 15.00                                                 | 3.75 / 0.375 / 18.75       |
| `accounts/fireworks/models/ember-1`                            | 1,048,576                                                                                                  | yes                                                                           | yes (Kimi K3 derivative, ~40% shorter traces)                           | yes        | 3.00 / 0.30 / 15.00                                                 | 3.75 / 0.375 / 18.75       |
| `accounts/fireworks/models/deepseek-v4p1-flash`                | 1,048,576                                                                                                  | yes                                                                           | yes (low/high/max, default high)                                        | yes        | 0.30 / 0.006 / 1.20                                                 | 0.375 / 0.0075 / 1.50      |
| `accounts/fireworks/models/glm-5p3`                            | 1,048,576                                                                                                  | no                                                                            | yes (effort map not documented for 5.3)                                 | yes        | 1.40 / 0.26 / 4.40                                                  | 1.75 / 0.325 / 5.50        |
| `accounts/fireworks/models/glm-5p3-flash`                      | 1,048,576                                                                                                  | yes                                                                           | yes (effort map not documented)                                         | yes        | 0.15 / 0.03 / 0.50                                                  | 0.1875 / 0.0375 / 0.625    |
| `accounts/fireworks/models/qwen3p8-max`                        | not documented (API returns 0, page shows "N/A")                                                           | yes                                                                           | yes (none/low/medium/high/xhigh/max with budgets)                       | yes        | 2.00 / 0.25 / 6.00                                                  | 3.00 / 0.375 / 9.00        |
| `accounts/fireworks/models/minimax-m3`                         | 512,000 on the model page and API. The model description says "1M context"; treat 512,000 as the API value | no (API `supportsImageInput: false`; description says "native multimodality") | yes (adaptive default)                                                  | yes        | 0.30 / 0.06 / 1.20                                                  | 0.45 / 0.09 / 1.80         |
| `accounts/fireworks/models/gpt-oss-120b`                       | 131,072                                                                                                    | no                                                                            | yes (low/medium/high only, cannot be turned off)                        | yes        | 0.15 / 0.015 / 0.60                                                 | 0.18 / 0.018 / 0.72        |
| `accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b`     | 262,144                                                                                                    | no                                                                            | yes (trace always generated; toggle via chat-template flag)             | yes        | 0.05 / 0.01 / 0.20                                                  | 0.0625 / 0.0125 / 0.25     |
| `accounts/fireworks/models/nemotron-3-ultra-nvfp4` ("Preview") | 262,144                                                                                                    | no                                                                            | yes (described as agentic and reasoning model; controls not documented) | yes        | 0.60 / 0.12 / 2.40                                                  | 0.75 / 0.15 / 3.00         |
| `accounts/fireworks/models/inkling`                            | 1,048,576                                                                                                  | yes (also audio)                                                              | yes ("controllable thinking effort")                                    | yes        | 1.00 / 0.17 / 4.05 (model page only; not in the docs pricing table) | not documented             |

Variants of the same models (S6, S8, S23):

| Variant                | Model ID                                                                                                                                                                        | Price in / cached / out | Notes                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| Kimi K3 Fast           | `accounts/fireworks/routers/kimi-k3-fast`                                                                                                                                       | 4.50 / 0.45 / 22.50     | +50%, targets 100+ tok/s; no Priority                                               |
| GLM 5.3 Fast           | `accounts/fireworks/routers/glm-5p3-fast`                                                                                                                                       | 2.10 / 0.39 / 6.60      | +50%; no Priority                                                                   |
| Kimi K3 US             | `accounts/fireworks/routers/kimi-k3-us`                                                                                                                                         | 4.50 / 0.45 / 22.50     | 1.5x; host `us.api.fireworks.ai`                                                    |
| DeepSeek V4.1 Flash US | `accounts/fireworks/routers/deepseek-v4p1-flash-us`                                                                                                                             | 0.45 / 0.009 / 1.80     | 1.5x                                                                                |
| GLM 5.3 US             | `accounts/fireworks/routers/glm-5p3-us`                                                                                                                                         | 2.10 / 0.39 / 6.60      | 1.5x                                                                                |
| GLM 5.3 Flash US       | `accounts/fireworks/routers/glm-5p3-flash-us`                                                                                                                                   | 0.225 / 0.045 / 0.75    | 1.5x                                                                                |
| Aliases                | `accounts/fireworks/routers/kimi-latest`, `glm-latest`, `glm-flash-latest`, `deepseek-flash-latest`, `minimax-latest`, `qwen-max-latest`, `kimi-fast-latest`, `glm-fast-latest` | follows the target      | Snapshot of 2026-09-27; aliases move (S27). Do not put aliases in a pricing catalog |

Notes:

- The Kimi K3 page text says the US endpoint is "+10% from standard", while the docs and pricing table give 1.5x (S23, S6, S36). The table and the US doc agree with each other; use 1.5x.
- Model-page flags that disagree with the recommended-models guide (S26): `qwen3p7-plus` (Qwen3.7 Plus, "customized model", closed, 0.40 / 0.08 / 1.60 on its page, context "N/A"), `step-3p7-flash-nvfp4` (262,144, vision, 1.20 / 0.60 / 1.20 on its page), `gemma-4-31b-it` (262,144, vision), `qwen3-8b` and `qwen3-omni-30b-a3b-instruct` all show `supportsServerless: false` on their model pages, yet the guide recommends them. `qwen3-8b` has `deprecationDate` 2026-05-14 (S36). Treat all five as dedicated-only until the serverless listing (S34) says otherwise. The pricing page's size-based rule (below) would price any serverless model not listed individually.
- Provider-side catalog hygiene: `glm-5p2`, `kimi-k2p6`, `kimi-k2p7-code`, `deepseek-v4-pro-0813` and `minimax-m2p7` still exist as library entries but are removed from serverless (S24). Keep them in the catalog only if dedicated deployments matter.

### Responses API compatibility, per model

Not documented. The Responses guide says `model` is "a Fireworks model resource name" and uses `accounts/fireworks/models/qwen3-235b-a22b` (not a current serverless model) in every example (S1). The Nexus docs state the same model IDs work on Chat Completions, Messages and Responses (S28), and Codex is configured against Fireworks with `wire_api = "responses"` (S1, S28). There is no per-model support table, no list of models that fail Responses, and the only model-specific Responses error documented is `model_not_supported_for_background` (S1).

---

## 2. Reasoning

### Control

| Mechanism           | Where                                   | Values                                                                                                                                                                                          | Source |
| ------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `reasoning_effort`  | chat completions body                   | string `low`, `medium`, `high`, `xhigh`, `max`, `none`, and `adaptive` (MiniMax M3 only); boolean (`true` becomes `medium`, `false` becomes `none`); positive integer = hard thinking-token cap | S3     |
| `thinking`          | chat completions body (Anthropic-style) | `{type:"enabled", budget_tokens>=1024, keep:"all", effort, budget_end_str}`, `{type:"disabled"}` (= `none`), `{type:"adaptive"}` (MiniMax M3 default)                                           | S3, S4 |
| `reasoning_history` | chat completions body                   | `disabled`, `interleaved`, `preserved`                                                                                                                                                          | S3     |
| `reasoning.effort`  | **Responses body**                      | free-form object. The guide shows `{"effort":"high"}` only. `reasoning.summary` is "not configurable, always on when reasoning content exists"                                                  | S1, S2 |

- `thinking` and `reasoning_effort` together is a validation error (S4). `thinking.effort`, when set, overrides `reasoning_effort` (S3).
- `thinking.keep: "all"` equals `reasoning_history: "preserved"` (S3).
- The Responses docs do not say which `reasoning.effort` values are accepted or how they map to `reasoning_effort`. Assume a direct mapping of the same strings, and treat `none`, `xhigh`, `max`, integers and `adaptive` through `reasoning.effort` as **unverified**. `thinking` and `reasoning_history` are not in the Responses supported-fields list (S1), so Responses callers cannot select `preserved` history, only the model default.
- Unsupported-value behaviour: models that cannot disable reasoning reject `none` and `false` (the error string in the docs is `Invalid reasoning effort: none`, S3). The boolean is normalised to `none` before model validation, so `false` produces an error that mentions `'none'`.
- Coming from vLLM or NIM: `chat_template_kwargs.enable_thinking` is mapped onto `reasoning_effort` automatically (S4).

### Per-model effort behaviour (S3, verbatim semantics condensed)

| Model                                                                            | Behaviour                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimi K3                                                                          | Tiers Low, High, Max. Default on, vendor default effort Max. `medium` is promoted to `high`, `xhigh` to `max`, `true` = vendor default, `none`/`false` disables                                                                                                                          |
| DeepSeek V4.1                                                                    | `low`; `medium`/`high`/`xhigh` select `high` (default); `max`; `none`/`false` disables. Integer 1 to 100 is passed as the vendor prompt scale (no cap); 101 to 1023 is sent as `low` with no cap; >= 1024 is `high` and a hard thinking-token budget. `minimal` and `ultra` are rejected |
| GLM 5.2 (5.3 not documented)                                                     | High and Max only; `low`/`medium` collapse to `high`; `max`/`xhigh` select Max; omitted = Max; `none`/`false` disables                                                                                                                                                                   |
| Qwen 3.8 / 3.8 Max                                                               | `none`/`false` disables. Omitted or `true` = `xhigh` with a 131,072-token budget. `low` = 4,096, `medium` = 16,384, `high`/`xhigh`/`max` = 262,144 tokens. Integer = explicit hard budget                                                                                                |
| MiniMax M2                                                                       | Always on; `low`/`medium`/`high`, default `medium`; `none` and booleans rejected. M3 accepts `adaptive` (its default); other M3 values not documented                                                                                                                                    |
| GPT-OSS 120B/20B (Harmony)                                                       | Only `low`/`medium`/`high`, default `medium`; `none`, `false`, integers all error                                                                                                                                                                                                        |
| GLM 4.5 to 5.1, DeepSeek V3.2                                                    | Binary: `none`/`false` disables, effort values have no effect                                                                                                                                                                                                                            |
| Step 3.7 Flash                                                                   | "three selectable reasoning levels (low, medium, high)" per model page (S36)                                                                                                                                                                                                             |
| Ember-1, GLM 5.3, GLM 5.3 Flash, Nemotron Lightning/Ultra, Inkling, Qwen3.7 Plus | **Not documented**                                                                                                                                                                                                                                                                       |

### How reasoning comes back

- Chat completions: `choices[].message.reasoning_content` (and `delta.reasoning_content` streaming), separate from `content`. For some models the reasoning "may instead be included directly in the content field" (S4), so the adapter must not assume the split.
- Usage: `usage.completion_tokens_details.reasoning_tokens` and `usage.output_tokens_details.reasoning_tokens` (`CompletionTokensDetails` has only that field) (S3).
- Responses: reasoning appears as `reasoning` output items with `summary_text` parts; streaming has `response.reasoning_summary_text.*` events (S1). The Responses reference schema instead says the top-level `reasoning` field "contains 'content' and 'type' fields" (S2). No `encrypted_content`: `include` accepts only `message.output_text.logprobs` (S1). Whether the `summary_text` is the full raw trace or a summary is not documented.
- `response_format: json_schema` **disables reasoning output** (S13): to get both reasoning and JSON, put the schema in the prompt and omit `response_format`. The same restriction on Responses `text.format` is not documented.

### Replay across turns

- Documented for chat completions: "you MUST include the `reasoning_content` from previous assistant turns" when doing multi-turn tool calling with interleaved-thinking models (Kimi, MiniMax, GLM). Interleaved thinking is triggered when the **last message has role `tool`**. If the model does not support it, the extra field is ignored, so it is safe to send always. Omitting `reasoning_content` from a hand-built assistant message means the model never sees its prior reasoning (S4). Mechanism: send `{role:"assistant", content, reasoning_content, tool_calls}` back verbatim.
- `reasoning_history` controls what is kept in the rendered prompt (S3):

| Model                                                 | Default                                                            | Allowed                          |
| ----------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| Kimi K2.7                                             | preserved                                                          | disabled, interleaved, preserved |
| Kimi K2.6                                             | interleaved                                                        | disabled, interleaved, preserved |
| Kimi K2 Instruct                                      | preserved                                                          | all three                        |
| MiniMax M2                                            | interleaved                                                        | disabled, interleaved            |
| GLM-5.2, GLM-4.7                                      | interleaved                                                        | all three                        |
| GLM-4.6                                               | interleaved                                                        | disabled, interleaved            |
| Qwen 3.6                                              | preserved                                                          | disabled, preserved              |
| DeepSeek V4                                           | interleaved                                                        | interleaved only                 |
| Kimi K3, GLM 5.3, DeepSeek V4.1, MiniMax M3, Qwen 3.8 | **not documented** ("refer to the model provider's documentation") |

`interleaved` strips reasoning up to and including the last user message; `preserved` keeps all; `disabled` strips all. This changes prompt formatting only; to stop reasoning compute use `reasoning_effort: none` (S3). Changing it changes the prompt prefix and therefore the cache.

- For Responses: replay of `reasoning` items in `input` (stateless, `store:false`) is **not documented**. The only documented statelessness is "pass prior turns in `input`" (S1). Given the missing `encrypted_content`, reasoning continuity through Responses is unverified; chat completions with `reasoning_content` is the documented path. Flag for the live-probe agent.

---

## 3. Prompt caching

| Topic               | Fact                                                                                                                                                                                                                                                                                                    | Source      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Default             | On for all models and deployments; no opt-in, no explicit breakpoints                                                                                                                                                                                                                                   | S5          |
| Mechanism           | Exact **prefix** match; longest cached prefix found automatically; "even a single-token difference" invalidates from that token on. Tools count as part of the prompt                                                                                                                                   | S5          |
| Locality            | Cache lives on **one replica**. Send a stable key so repeated prompts hit the same replica                                                                                                                                                                                                              | S5, S7      |
| Routing keys        | `x-session-affinity` header, or `user` body field. `prompt_cache_key` body field is "the preferred field" and takes priority over `user` (chat completions). `x-multi-turn-session-id` header (RL trajectories) wins over `x-session-affinity` when both are present                                    | S3, S5, S39 |
| Isolation           | `x-prompt-cache-isolation-key` header or `prompt_cache_isolation_key` body field: extra cache key, no sharing across different values. Serverless already keeps a separate cache **per account**                                                                                                        | S3, S5      |
| Responses support   | Supported Responses fields include `user` and `prompt_cache_key`; `prompt_cache_isolation_key` is not in the list, so use the header. `x-session-affinity` is a header and should work on any route, but is documented only on chat completions examples                                                | S1, S5      |
| TTL                 | "at least several minutes", up to several hours depending on model and load; oldest evicted first. No documented minimum prefix length, no TTL options                                                                                                                                                  | S5          |
| Discount            | Cached input is billed at a lower rate. "Default 50%", but per model: Kimi K3/Ember 90% off, DeepSeek V4.1 Flash 98%, GPT OSS 120B 90%, GLM 5.3 81%, GLM 5.3 Flash 80%, MiniMax M3 80%, Qwen 3.8 Max 87.5%, Nemotron Lightning 80%. Models priced by size (no individual row) have **no cached rate**   | S6, S7, S32 |
| Cache writes        | No separate charge or reported field. No cache-write tokens exist                                                                                                                                                                                                                                       | S6          |
| Reporting (body)    | `usage.prompt_tokens_details.cached_tokens` (chat completions). `usage.prompt_tokens` includes the cached part                                                                                                                                                                                          | S3          |
| Reporting (headers) | `fireworks-prompt-tokens` and `fireworks-cached-prompt-tokens` (documented as response headers for dedicated deployments in S5 and listed for Serverless responses in S7). Not sent on streaming responses                                                                                              | S5, S7      |
| Responses usage     | The Responses schema says `usage` "contains `prompt_tokens`, `completion_tokens`, `total_tokens`" (S2) and the overview says billing source of truth is those three fields (S7). Whether `/v1/responses` returns OpenAI-style `input_tokens`/`input_tokens_details.cached_tokens` is **not documented** | S2, S7      |
| Privacy             | KV caches held in memory only; ZDR policy does not affect caching                                                                                                                                                                                                                                       | S5, S20     |
| Rate limits         | Cached tokens count toward Total Prompt TPM but not Uncached Prompt TPM                                                                                                                                                                                                                                 | S9          |
| Batch               | Batch jobs use caching: "additional 50% savings on cached tokens"                                                                                                                                                                                                                                       | S29         |

How to maximise hits (S5): static content first (system prompt, tools, examples), dynamic content last; no timestamps or per-request IDs in the prefix; append to history, never rewrite it; keep tool list and order stable; keep `reasoning_effort`/`reasoning_history` stable (they alter the rendered prompt; inferred, not stated); send one stable session key per conversation (`x-session-affinity`, or `prompt_cache_key`); when migrating traffic between deployments, route by hash of the session key, not randomly.

Gateway implication: our gateway is stateless, so it should accept a caller-supplied session key and forward it as `x-session-affinity` and/or `prompt_cache_key`. Without it, serverless hit rates degrade across replicas.

---

## 4. Pricing details

| Rule                                           | Detail                                                                                                                                                                                                                                                                                                                                          | Source        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Billing model                                  | Pre-paid credits. Per token for serverless, per GPU-second for on-demand, per training token for managed training                                                                                                                                                                                                                               | S35, S12      |
| Serverless dimensions                          | Input (uncached), cached input, output. Embeddings: input only. Reasoning tokens are part of output                                                                                                                                                                                                                                             | S6            |
| Modes                                          | Standard (default), Priority (`service_tier: "priority"`, chat completions and Anthropic Messages; Responses support **not documented**; +25% typical, +50% on some models), Fast (swap `model` to a `.../routers/<name>-fast` ID, +50%). Priority and Standard share rate limits; Fast has separate limits                                     | S8, S9, S6    |
| Long-context tiers                             | **None documented.** Models with 1M context (Kimi K3, DeepSeek V4.1 Flash, GLM 5.3) list a single rate                                                                                                                                                                                                                                          | S6            |
| Size-based rule (models without their own row) | `<4B` 0.10; `4B-16B` 0.20; `>16B` 0.90; MoE up to 56B 0.50; MoE 56.1B-176B 1.20. One rate for input and output, **no cached rate**. (Contradiction: Gemma 4 31B's page shows 0.90 / 0.45 cached / 0.90.)                                                                                                                                        | S6, S36       |
| Batch                                          | 50% of serverless price on input and output; extra 50% off cached tokens. Input is `body.messages` or `prompt_token_ids` JSONL, i.e. chat-shaped, not Responses-shaped. Batch jobs are rejected under enforced ZDR                                                                                                                              | S6, S29, S20  |
| US-only                                        | 1.5x base serverless price from 2026-09-01                                                                                                                                                                                                                                                                                                      | S23           |
| Image tokens                                   | Billed as input tokens; count is model-specific (Qwen2.5-VL example: 336x336 = 144, 1024x1024 = 1,369, 1920x1080 = 2,769, 3840x2160 = 10,549). Other families "typically 1,000 to 2,500" per image                                                                                                                                              | S16           |
| On-demand                                      | Billed per GPU-second, no token charge, no extra start-up charge: H100/H200 $8.00/h, B200 $13.00/h, B300 $15.00/h, GB300 $20.00/h. Region-restricted deployments 1.5x. Scale to zero after 1 h idle by default; billed only while replicas are active                                                                                           | S35, S17      |
| Cached tokens on dedicated                     | "close to free" in resources, but no per-token price applies                                                                                                                                                                                                                                                                                    | S5            |
| Fine-tuned / LoRA                              | LoRA models cannot run serverless; they need an on-demand deployment (live-merge, or multi-LoRA addons on a BF16 base deployment) billed per GPU-second. The pricing page also says "Serve fine-tuned models for the same price as base models" (S35), which conflicts with S33 and S19; the per-GPU-second reading matches the deployment docs | S19, S33, S35 |
| Deprecation of a price                         | DeepSeek V4.1 Flash changed on 2026-10-01 from 0.22 / 0.007 / 0.66 to 0.30 / 0.006 / 1.20. Prices change without a new model ID, so the catalog needs an effective date                                                                                                                                                                         | S24           |

Cost estimation for a catalog entry: `(prompt_tokens - cached_tokens) * in + cached_tokens * cached + completion_tokens * out`, with `completion_tokens` including reasoning. For Priority or Fast, apply that mode's row.

---

## 5. Rate limits and errors

### Serverless rate limits (S9, S12)

- Scope: per account, per model. Three metrics, all tokens/minute: Total Prompt TPM (cached + uncached), Uncached Prompt TPM, Generated TPM. Each adapts independently.
- Ceilings by total model parameters (2026-10-07 changelog doubled Small):

| Tier   | Params        | Total Prompt | Uncached Prompt | Generated |
| ------ | ------------- | ------------ | --------------- | --------- |
| Small  | <600B         | 216M         | 54M             | 2.16M     |
| Medium | 600B to <1.6T | 43.2M        | 10.8M           | 432k      |
| Large  | >=1.6T        | 21.6M        | 5.4M            | 216k      |

Small: DeepSeek V4.1 Flash, GLM 5.3 Flash, MiniMax M3, Nemotron 3 Ultra, GPT OSS 120B, Nemotron Lightning. Medium: GLM 5.3. Large: Ember-1, Kimi K3, Qwen 3.8 Max. These are maxima at spend Tier 3+; lower tiers are lower (values not published).

- Adaptive: +25% when usage over the last minute exceeds 50% of the current limit, at most every 15 minutes; -20% after 3 days below 33%; reset after 72 h idle. Ramping too fast produces 429s.
- Account-wide request cap: 6,000 RPM maximum, fixed; 10 RPM with no payment method or no credits (S12). Spend tiers: Tier 1 payment method, Tier 2 $50, Tier 3 $500, Tier 4 $5,000.
- Monthly spend limit: at 100% "all API requests pause"; the status code this produces is not documented. Enterprise accounts are not paused (S12).
- Dedicated and on-demand: no account-level token limits; a 429 means the deployment is saturated. A deployment scaled to zero returns **503** immediately while it scales up (S10, S17).

### Headers

Request: `Authorization: Bearer fw_...`, `x-session-affinity`, `x-prompt-cache-isolation-key` (S7, S5). Response: `X-Ratelimit-Limit-Tokens-Prompt`, `X-Ratelimit-Limit-Tokens-Cache-Adjusted-Prompt`, `X-Ratelimit-Limit-Tokens-Generated` (current limits only), `fireworks-prompt-tokens`, `fireworks-cached-prompt-tokens`, `fireworks-server-time-to-first-token` and other perf headers on non-streaming chat responses, `fireworks-sampling-options` (S7, S30). **No** remaining-tokens or reset headers and **no** `Retry-After` are documented; the guidance is exponential backoff with jitter (S9, S11).

### Status codes (S10, S11)

| Status   | Documented meaning                                                                                                                                                          | Retry        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 400      | Invalid input or malformed request                                                                                                                                          | no           |
| 401      | Invalid API key or insufficient permissions                                                                                                                                 | no           |
| 402      | Account not on a paid plan or usage limits exceeded. This is the nearest thing to "insufficient balance"                                                                    | no           |
| 403      | "Authentication issues". Also Responses `web_search` not enabled for the account (S1); training `quota_exceeded`/`tier_required` (S12); bare annotation keys (S24)          | no           |
| 404      | Endpoint path, model, deployment missing or inaccessible. Responses text: "Model not found, inaccessible, and/or not deployed" (S1). Nexus text: `Model id not found` (S28) | no           |
| 405, 408 | Wrong method; request timeout                                                                                                                                               | 408 yes      |
| 412      | Account suspended, or a LoRA model failed to load                                                                                                                           | no           |
| 413      | Payload too large                                                                                                                                                           | no           |
| 422      | Validation error. Body is FastAPI-style `{"detail":[...]}` (`HTTPValidationError`, S2, S3)                                                                                  | no           |
| 429      | Serverless rate limit, or dedicated capacity saturated                                                                                                                      | yes, backoff |
| 500      | Server error                                                                                                                                                                | yes          |
| 502, 504 | Bad gateway, gateway timeout                                                                                                                                                | yes          |
| 503      | Overloaded/load-shed ("Service Overloaded"), maintenance, or scaled-to-zero deployment. Priority tier is less likely to be shed                                             | yes, backoff |
| 520      | Unknown error                                                                                                                                                               | yes          |

### Error body shapes

- Responses: OpenAI envelope `{"error":{"type":"invalid_request_error","code":"model_not_supported_for_background","message":"...","param":null}}`. Status codes are preserved from the underlying inference call. In streaming and background mode, errors are embedded in the response object or an SSE error event (S1). Failed responses carry `error {type, code, message}` and `incomplete_details.reason` of `max_output_tokens`, `max_tool_calls` or `content_filter` (S2).
- Chat completions / generic inference: **error body shape is not documented** on any page read. Only fragments exist: 422 `{detail:[...]}`; a prompt-too-long condition surfaced as a "prompt too long" error (S3).
- Documented error codes: `model_not_supported_for_background` (S1), `no_credential` (FireRouter, S28), `quota_exceeded`, `tier_required` (training, S12). The docs give **no** code or message text for insufficient balance, spend limit reached, or context length exceeded.

### Context overflow behaviour (important for the gateway)

On chat completions the default `context_length_exceeded_behavior` is `truncate`: when prompt + `max_tokens` exceeds the window, `max_tokens` is silently lowered rather than erroring (S3, S31). Setting `error` gives an OpenAI-like failure. The default `max_tokens` when omitted is 2048 (S30). A prompt that alone exceeds the window still fails ("prompt too long", S3). `prompt_truncate_len` can evict oldest messages. For Responses, the reference says omitted `max_output_tokens` means "up to its maximum context length" (S2), which contradicts the chat default of 2048; treat Responses default as unverified. Responses `truncation` is `auto` or `disabled`, default `disabled` (S2). Consequence: a `length` stop can come from the context cap, not the requested cap.

---

## 6. Structured output and grammars

| Feature       | Chat completions                                                                                                                                       | Responses                                                                                       | Source      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------- |
| `json_schema` | `response_format: {type:"json_schema", json_schema:{name, schema}}` (a top-level `schema` field also exists on `ResponseFormat`)                       | `text.format: {type:"json_schema", name, strict:true, schema}` documented as supported          | S13, S3, S1 |
| `json_object` | `{type:"json_object"}`                                                                                                                                 | `text.format: {type:"json_object"}` supported                                                   | S13, S1     |
| `grammar`     | `{type:"grammar", grammar:"<GBNF>"}`; enum on `ResponseFormat` is `json_object`, `json_schema`, `grammar`, `text`. "All Fireworks models support this" | **Not documented** for `text.format`; Responses guide mentions only json_schema and json_object | S14, S3, S1 |
| Tool calling  | JSON mode is enabled automatically for function calling                                                                                                | n/a                                                                                             | S13         |

Constraints and gotchas (S13):

- Mapping `text.format.type:"json_schema"` to Fireworks `response_format` is the obvious chat-completions translation; the Responses endpoint accepts it natively, so a Responses profile needs no mapping.
- `strict` is shown in the Responses example, but enforcement is always on in the grammar engine; behaviour of `strict:false` is not documented.
- Supported: JSON Schema 2020-12 constructs and Draft-7 `definitions`, `anyOf`/`allOf`/`oneOf`, `$ref` to in-document fragments only, recursive refs, `pattern` (best-effort; unsupported regex features are silently ignored). Not supported: external `$ref`. Schemas with `properties` are treated as `unevaluatedProperties:false` (extra fields are blocked even if the caller did not set `additionalProperties:false`).
- Always also instruct the model to produce JSON in the prompt, otherwise it may emit whitespace until the token limit. Truncation (`finish_reason: length`) yields invalid JSON.
- `json_schema` disables reasoning output on reasoning models (see section 2).
- `text.verbosity` (OpenAI) is not in the Responses supported-field list (S1).

---

## 7. Vision and documents

- Image input is per model: `supportsImageInput` (S25). Vision-capable among the flagships: Kimi K3, Ember-1, DeepSeek V4.1 Flash, GLM 5.3 Flash, Qwen 3.8 Max, Inkling. Text-only: GLM 5.3, MiniMax M3 (API flag), GPT OSS 120B, Nemotron models. `glm-latest` is text-only; `glm-flash-latest` has vision (S27).
- Chat completions format: `{type:"image_url", image_url:{url}}` with an HTTPS URL or `data:image/<type>;base64,...` (S15). Responses `input_image` handling is covered by the other agent; the Responses guide does not discuss images.
- Limits (S15): max **30 images** per request; total base64 payload under **10 MB**; each URL image under **5 MB** and must download within **1.5 s**; formats `.png .jpg .jpeg .gif .bmp .tiff .ppm`. Prefer URLs over base64 for long conversations. Image and text parts both benefit from prompt caching. Llama 3.2 Vision wants images before text (irrelevant for current models).
- A 413 is returned for oversize payloads (S10).
- **PDFs: not natively supported.** The docs say to render each page to an image and send images (counts toward the 30-image cap) (S15). **`#transform=inline` document inlining is deprecated and no longer available** (changelog entry dated 2025-06-30, S24); do not map `input_file` to it. `input_file` on Responses is not documented for Fireworks. File IDs: no Files API for inference inputs is documented.
- Audio/video: only specific multimodal models (Qwen3 Omni, Nemotron 3 Nano Omni, Inkling audio) via chat completions; audio inference and image generation are deprecated (2026-06-10, S24). Not relevant to the Responses profile.

---

## 8. Deployments, LoRA, routing

| Item                                           | Naming and facts                                                                                                                                                                                                                                                            | Source        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Serverless                                     | `accounts/fireworks/models/<slug>`. Short IDs and aliases (`glm-latest`, `firerouter/opus`) are accepted by the Nexus-enabled gateway; `accounts/fireworks/routers/<alias>` is the full form                                                                                | S27, S28      |
| Fast / US / FireRouter                         | `accounts/fireworks/routers/<name>`; `firerouter/...` and `auto` are model routers; the response `model` names the model that actually served the turn                                                                                                                      | S8, S23, S28  |
| On-demand deployment, direct                   | `accounts/<ACCOUNT_ID>/deployments/<DEPLOYMENT_ID>` as `model`                                                                                                                                                                                                              | S17           |
| On-demand deployment, base model + deployment  | `accounts/fireworks/models/<model>#<DEPLOYMENT_NAME>` (the doc example uses `gpt-oss-120b#<DEPLOYMENT_NAME>`)                                                                                                                                                               | S17           |
| Fine-tuned model, live merge                   | `accounts/<ACCOUNT_ID>/models/<FINE_TUNED_MODEL_ID>` as `model`                                                                                                                                                                                                             | S19           |
| LoRA addon on a multi-LoRA deployment          | `accounts/<ACCOUNT_ID>/models/<LORA_ID>#accounts/<ACCOUNT_ID>/deployments/<DEPLOYMENT_ID>`. The older `deployedModel` request key is deprecated. The `accounts/<acct>/deployedModels/...` form is a **resource name in the management API**, not an inference `model` value | S19, S25      |
| Deployment router                              | `accounts/<ACCOUNT_ID>/routers/<ROUTER_ID>`; weighted-random by replica count; multi-region deployments only; swap deployments without client changes                                                                                                                       | S18           |
| LoRA constraints                               | Serverless not supported; BF16 shapes only for `--enable-addons` (FP8/FP4 shapes cannot); up to 100 LoRAs per deployment, default LoRA quota 100; invoking a LoRA that failed to load returns 412                                                                           | S19, S12, S10 |
| Scale to zero                                  | Idle 1 h; deployments with min replicas 0 deleted after 7 days idle; scaled-to-zero requests get 503                                                                                                                                                                        | S17           |
| Quotas                                         | GLOBAL default 16 each of H100, H200, B200, B300; other regions by request                                                                                                                                                                                                  | S12           |
| Responses API with deployments, routers, LoRAs | **Not documented.** All the examples above are chat completions. The Responses guide's 404 troubleshooting implies any resource name the account can reach is valid                                                                                                         | S1            |

Per-token cost is zero for on-demand; a cost estimator should return "unknown" (no per-token price) for any `accounts/<acct>/...` model ID and not guess.

---

## 9. Account, auth, regions, retention

- Auth: `Authorization: Bearer <key>`. The key format is `fw_...` (S28). `X-Fireworks-Api-Key` is accepted as an alternate header, needed only when the `Authorization` header carries another provider's key (S28). `FIREWORKS_API_KEY` is the conventional env var.
- Base URL: `https://api.fireworks.ai/inference/v1` (OpenAI SDK base URL; SDK appends `/responses`). US-only: `https://us.api.fireworks.ai/inference/v1` (S1, S23). Management API: `https://api.fireworks.ai/v1/accounts/...`. List serverless models: `GET /v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue` or `GET /v1/serverless/models?use_cases=coding` (returns aliases) (S34, S27).
- No `OpenAI-Organization`-style header; the account is part of the model path.
- Regions: the default endpoint serves from a global fleet. Data residency (Enterprise only) restricts the whole account to one region; today only US (`us.api.fireworks.ai`, US-only models); EU-only serverless requires sales. Once set, requests to non-compliant models or hosts are **rejected** (S22, S23). `inference_geo` body field and `Fireworks-Inference-Geo` header are deprecated (S22).
- Retention:
  - Default for open-model inference (chat completions, completions, embeddings, Anthropic Messages): prompts and generations are not logged or stored; exist in volatile memory only; metadata (token counts) is logged (S21).
  - **Responses API stores by default** (`store: true`): user prompts, model responses and tool calls, kept **30 days**, deletable with `DELETE /v1/responses/{id}`. `store:false` opts out and makes the response unusable with `previous_response_id` (S1, S21).
  - Enterprise **ZDR policy** (account-wide) rejects: Responses with `store:true` (the default), Responses with `background:true`, FireRouter, batch jobs, training, uploads. Responses with `store:false`, chat completions, Messages, and embeddings are allowed (S20).
  - Gateway implication: always send `store:false` on Responses; otherwise every request on a ZDR account is rejected and, elsewhere, content is kept 30 days.
  - Web search and MCP traffic go to third parties under their own policies (S20).
- Responses features the stateless gateway should not use: `previous_response_id`, `background`, hosted `mcp`/`sse`/`web_search`/`python` tools (server-executed; web search is `403` unless enabled for the account), `GET/DELETE /v1/responses/{id}`. `defer_loading` has no effect; no tool-search protocol (S1).
- Compatibility gaps that matter (S1): unsupported `code_interpreter`, `file_search`, `image_generation` tools; no `refusal` parts; no `input_items` route; `include` accepts only logprobs; no `service_tier`, `prompt_cache_retention`, `safety_identifier`, `conversation`, `prompt_cache_options` in the supported list.

---

## Not documented / unclear

1. **Max output tokens** for every model: no field in the model object or any page. Chat default `max_tokens` is 2048 (S30); Responses default contradicts it (S2). A catalog entry must either leave `maxOutput` empty or use a value the live probe confirms.
2. **Context length** of Qwen 3.8 Max and Qwen3.7 Plus: API returns 0 or "N/A". MiniMax M3: API says 512,000, description says 1M.
3. **Whether `/v1/responses` works per model**, with deployments, routers, LoRA addons, and with `service_tier: "priority"`: no support matrix.
4. **Responses reasoning details**: accepted `reasoning.effort` values and mapping; whether `none` works; whether `reasoning` input items replay into the prompt; whether the `summary_text` is raw reasoning; why the reference schema says `reasoning` has `content`/`type` instead. No `encrypted_content`.
5. **Responses `usage` shape**: reference says `prompt_tokens`/`completion_tokens`/`total_tokens`; OpenAI shape (`input_tokens`, `input_tokens_details.cached_tokens`) unconfirmed. Cached-token reporting on Responses is unconfirmed (headers may be the fallback).
6. **Error bodies and codes** for chat completions and for Responses non-validation errors; text for context-length exceeded, insufficient balance, spend-limit pause (status unknown, possibly 402 or 412), invalid API key; whether `Retry-After` is ever sent. No remaining/reset rate-limit headers.
7. **Reasoning controls** for Ember-1, GLM 5.3 and 5.3 Flash, Nemotron Lightning and Ultra, Inkling, Qwen3.7 Plus; **`reasoning_history` defaults** for Kimi K3, GLM 5.3, DeepSeek V4.1, MiniMax M3, Qwen 3.8.
8. **Serverless status of** Qwen3.7 Plus, Step 3.7 Flash, Gemma 4 31B, Qwen3 8B, Qwen3 Omni: model pages say not serverless; the Sept 2026 guide recommends them. Qwen3 8B's page carries a 2026-05-14 deprecation date.
9. **Inkling** pricing and rate-limit tier: only on its model page, absent from the docs pricing table.
10. **Cache details**: minimum cacheable length, exact TTL, whether `reasoning_content` placement affects hits, whether Priority/Fast share caches with Standard.
11. **Long-context pricing**: none documented; confirm with the live probe that 1M-token prompts bill at the single rate.
12. **`grammar` through Responses `text.format`**, and `strict:false` semantics.
13. **`input_file` / PDF on Responses**, image detail levels, per-model image token counts other than the Qwen2.5-VL table.
14. **Kimi K3 US surcharge**: +10% on the model page vs 1.5x in the docs and pricing table.
15. **Fine-tuned model serving price**: "same as base" on the pricing page vs per-GPU-second in the deployment docs.
16. **API key format details** beyond the `fw_` prefix (length, charset), and any per-key scoping headers.
