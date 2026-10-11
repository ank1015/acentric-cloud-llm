# Fireworks Responses API: ecosystem research

Researched 2026-10-11. "Not found" means no evidence was located; nothing is guessed. Items marked "search snippet" were seen in search results but not opened.

## Fireworks official docs (baseline)

- Endpoint `https://api.fireworks.ai/inference/v1/responses`; OpenAI SDK base URL `https://api.fireworks.ai/inference/v1`. Only `model` and `input` are required; `model` must be a full resource name. https://docs.fireworks.ai/guides/response-api
- `store` defaults to true. `store=false` responses cannot be referenced by `previous_response_id`. https://docs.fireworks.ai/guides/response-api
- Endpoints: `GET /v1/responses/{id}`, `GET /v1/responses` (described as a Fireworks extension), `DELETE /v1/responses/{id}`. Deletion is permanent. https://docs.fireworks.ai/guides/response-api
- Server-executed tools: `mcp`, `sse`, `web_search`, `python`. Client-executed: `function` (returned as `function_call` items). `web_search` requires account enablement (403 otherwise). https://docs.fireworks.ai/guides/response-api
- `function_call_output` input format is not documented: the guide says only "You run them and send the results back." https://docs.fireworks.ai/guides/response-api
- The POST reference input schema is loosely typed (`additionalProperties: true`); `function_call_output` is not in the request schema. Documented `previous_response_id` behavior does not cover combining it with function outputs. https://docs.fireworks.ai/api-reference/post-responses
- Reasoning: `reasoning.effort` supported; `reasoning.summary` not configurable (summaries always included). Structured output via `text.format` (`json_schema`, `json_object`). https://docs.fireworks.ai/guides/response-api
- Codex CLI config uses `wire_api = "responses"` with the Fireworks base URL. https://docs.fireworks.ai/guides/response-api
- Cookbook: the guide links a notebook "Conversational History with previous_response_id"; not opened. Cookbook top-level folders (training, eval, archived) show no Responses notebook. https://github.com/fw-ai/cookbook (Not found in top-level listing; the notebook was not verified.)
- Fireworks' OpenAI-compatibility page lists only chat completions and completions; Responses is not mentioned there. https://docs.fireworks.ai/tools-sdks/openai-compatibility

## Vercel AI SDK (@ai-sdk/fireworks)

- Uses Chat Completions (`OpenAICompatibleChatLanguageModel`); no Responses path found in the provider source. https://raw.githubusercontent.com/vercel/ai/main/packages/fireworks/src/fireworks-provider.ts
- Fireworks-specific provider options map to snake_case: `promptCacheKey` to `prompt_cache_key`, `serviceTier` to `service_tier`, `thinking` to `{type, budget_tokens}` (minimum 1024), `reasoningHistory` to `reasoning_history`. https://ai-sdk.dev/providers/ai-sdk-providers/fireworks (redirected from sdk.vercel.ai)
- Reasoning remap: top-level `minimal` to `low`; `xhigh`/`max` to `high`, with a compatibility warning. Source comment: "Fireworks supports low, medium, and high reasoning levels." https://raw.githubusercontent.com/vercel/ai/main/packages/fireworks/src/fireworks-provider.ts
- Tool streaming listed only for `firefunction-v1` and `llama-v3p1-405b-instruct`; several models show no tool usage. https://ai-sdk.dev/providers/ai-sdk-providers/fireworks
- Error parsing fix in `@ai-sdk/fireworks` 3.0.22 (errors degraded to the HTTP reason phrase). https://releases.sh/release/rel_rpsKu3hMRBrwmUTEwdVL0-fireworks-error-messages-now-surface-to-callers (search snippet, not opened)

## LiteLLM (fireworks_ai/)

- Provider page table lists `/chat/completions`, `/responses`, `/embeddings`, `/completions`, `/audio/transcriptions`, `/rerank`. https://docs.litellm.ai/docs/providers/fireworks_ai
- Blog dated 2026-09-22: `/v1/responses` for `fireworks_ai/` models reaches the native Fireworks Responses API; "server-side MCP tools and response chaining work through the gateway." https://docs.litellm.ai/blog/fireworks-getting-started
- Model prefix: `fireworks_ai/`; bare slugs expand to `accounts/fireworks/models/`; `routers/` prefix; slugs ending `-fast` are treated as routers. https://docs.litellm.ai/docs/providers/fireworks_ai
- Documented Responses behavior: multi-turn tool calling via `function_call_output` items plus `previous_response_id`; `developer` input items converted to `system`. Page says a developer item after the first input is rejected for qwen3.8. https://docs.litellm.ai/docs/providers/fireworks_ai
- LiteLLM sends a `user` field and `x-session-affinity` header to Fireworks. https://docs.litellm.ai/docs/providers/fireworks_ai
- Response-format and tool-quirk handling: not covered in the page. (Not found.)

## pi-mono / earendil-works

- `packages/ai/src/providers/fireworks.ts` registers two adapters: `anthropic-messages` and `openai-completions`. Neither is Responses. Base URL `https://api.fireworks.ai/inference` (no `/v1` in config). Which adapter each model uses is not shown in the file. https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/fireworks.ts
- No Fireworks-specific options or workarounds in that file; no comments. Responses: not found.
- Community extension `pi-fireworks` is marked deprecated because pi now has native Fireworks support. https://cdn.jsdelivr.net/npm/pi-fireworks@0.1.2/README.md (search snippet)

## LangChain

- `ChatFireworks` uses `chat.completions.create`; issue #41016 (opened 2026-10-03) concerns dropped gateway headers, not Responses. https://github.com/langchain-ai/langchain/issues/41016

## llama-stack (mirror)

- Commit ac7c35f (PR #3614, "fix: don't pass default response format in Responses"): Fireworks rejects `response_format` when tools are in use; the default `text` format is now omitted. https://git.kvant.cloud/phoenix-oss/llama-stack-mirror/commit/ac7c35fbe69afd8576865a6ba7341298131c2289 (mirror of meta-llama/llama-stack, not upstream GitHub)
- A recorded test shows a request to `.../inference/v1/v1/embeddings` (doubled `/v1`). Single recording; not confirmed as a bug. https://git.kvant.cloud/phoenix-oss/llama-stack-mirror/src/branch/rc-0.2.24-dev.20251001/tests/integration/recordings (search snippet, not opened)

## GitHub issues and community posts

- dvergr issue #60 (2026-08-28): proposes a provider-aware Responses adapter with "verified Fireworks contracts." It names no Fireworks-specific quirks and reports no test evidence. https://github.com/replikativ/dvergr/issues/60
- openai-agents-python, openai-python with Fireworks `base_url`: Not found.
- GitHub issues on Fireworks + `previous_response_id`, `function_call_output`, `reasoning`, or `store`: Not found.
- OpenAI-only 400 errors (not Fireworks, context only): "No tool call found for function call output with call_id" https://community.openai.com/t/issue-with-new-responses-api-400-no-tool-call-found-for-function-call-output-with-call-id/1142327 ; reasoning item without following item https://community.openai.com/t/how-to-solve-badrequesterror-400-item-rs-of-type-reasoning-was-provided-without-its-required-following-item-error-in-responses-api/1151686 . Whether Fireworks shares these semantics is unverified.

## Known quirks

1. `store` defaults to true; `store=false` responses cannot be chained with `previous_response_id`, so history must be resent. https://docs.fireworks.ai/guides/response-api
2. `DELETE /v1/responses/{id}` is permanent. https://docs.fireworks.ai/guides/response-api
3. `code_interpreter`, `file_search`, `image_generation` tools unsupported; `web_search` returns 403 unless enabled. https://docs.fireworks.ai/guides/response-api
4. `function_call_output` request format is undocumented (no schema or example). https://docs.fireworks.ai/guides/response-api , https://docs.fireworks.ai/api-reference/post-responses
5. `response_format` plus tools is rejected; the default format must be omitted. https://git.kvant.cloud/phoenix-oss/llama-stack-mirror/commit/ac7c35fbe69afd8576865a6ba7341298131c2289
6. `reasoning.summary` not configurable; `include` accepts only `message.output_text.logprobs`. https://docs.fireworks.ai/guides/response-api
7. `background=true` cannot be combined with `stream`; unsupported models return `model_not_supported_for_background`. https://docs.fireworks.ai/guides/response-api
8. `defer_loading` has no effect on Responses; `refusal` content parts, `GET .../input_items`, and `code_interpreter`/`file_search`/`image_generation` unsupported. https://docs.fireworks.ai/guides/response-api
9. Default for `max_tool_calls` not stated. https://docs.fireworks.ai/guides/response-api
10. Model must be `accounts/<account>/models/<model>`; undeployed or invalid model returns 404. https://docs.fireworks.ai/guides/response-api
11. Codex namespaces are flattened to `<namespace>__<tool>`; name collisions rejected; reserved namespaces pass through. https://docs.fireworks.ai/guides/response-api
12. Error envelope follows OpenAI shape; upstream status codes preserved; streaming/background errors embedded or sent as SSE error event. https://docs.fireworks.ai/guides/response-api
13. Retention: "different data retention policy" from chat completions; details not in the guide. https://docs.fireworks.ai/guides/response-api
14. Chat Completions only: `reasoning_effort` accepts low/medium/high (minimal and xhigh/max remapped by AI SDK and LiteLLM). https://raw.githubusercontent.com/vercel/ai/main/packages/fireworks/src/fireworks-provider.ts
15. Chat Completions: `max_tokens` auto-truncates by default; `context_length_exceeded_behavior=error` restores OpenAI-style error. Streaming usage arrives in the final chunk. https://docs.fireworks.ai/tools-sdks/openai-compatibility
16. Documentation disagreement: Fireworks' OpenAI-compatibility page omits Responses while the Responses guide documents it. https://docs.fireworks.ai/tools-sdks/openai-compatibility , https://docs.fireworks.ai/guides/response-api
