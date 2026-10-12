# OpenRouter: routing, account features and errors

Verified 2026-10-12 against current OpenRouter documentation, its public
OpenAPI schema, npm `@openrouter/sdk` **1.4.25**, and the official
`OpenRouterTeam/typescript-sdk` source at
[`ebfdb60e293ce4758eadfc3638e808fff362e0f0`](https://github.com/OpenRouterTeam/typescript-sdk/tree/ebfdb60e293ce4758eadfc3638e808fff362e0f0).
No chat, completion, Responses, or Messages calls were made. Inference
behavior below is documented behavior, not a live inference result.

The primary request format discussed here is
`POST https://openrouter.ai/api/v1/chat/completions`, with `stream: false`.
OpenRouter also exposes Responses and Anthropic Messages formats. These
are separate API formats, with different error locations and replay shapes.
OpenRouter itself normalizes upstream requests and output; its native wire
format is not the upstream provider's original wire format.

Sources: [complete docs](https://openrouter.ai/docs/llms-full.txt),
[docs index](https://openrouter.ai/docs/llms.txt),
[OpenAPI](https://openrouter.ai/openapi.json),
[npm package metadata](https://registry.npmjs.org/@openrouter%2fsdk/latest),
[API overview](https://openrouter.ai/docs/api_reference/overview).

## Provider routing

The request's `provider` object selects endpoints for the requested model.
These are OpenRouter request fields, with snake_case wire names. SDK examples
often use camelCase names because the official SDK serializes them.

| Field                      | Shape/default                          | Effect                                                                                                                                                                          |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order`                    | Provider slug array; absent by default | Try named providers in order. Without further restrictions, other providers remain fallbacks. Explicit order takes precedence over sorting and cache affinity.                  |
| `only`                     | Provider slug array                    | Hard allowlist within the account's allowed providers. Account and request restrictions both apply; an empty intersection can produce 404.                                      |
| `ignore`                   | Provider slug array                    | Exclude these providers plus the account's exclusions.                                                                                                                          |
| `allow_fallbacks`          | Boolean; `true`                        | Permit backup providers. `false` confines routing to the primary/custom ordered pool; an ordered list can still contain several attempts.                                       |
| `require_parameters`       | Boolean; `false`                       | Hard-filter providers by support for supplied parameters. Otherwise unsupported parameters may be ignored.                                                                      |
| `data_collection`          | `"allow"` or `"deny"`; `"allow"`       | Filter by provider data-collection/training policy. Separate from retention enforcement below.                                                                                  |
| `zdr`                      | Boolean                                | Require zero-retention inference endpoints. Account/guardrail/request enforcement is an OR; `false` cannot relax another layer.                                                 |
| `enforce_distillable_text` | Boolean                                | Require models whose author permits text distillation.                                                                                                                          |
| `quantizations`            | String array                           | Hard-filter by endpoint quantization.                                                                                                                                           |
| `sort`                     | String or `{by, partition}`            | `price`, `throughput`, `latency`, or `exacto`. Explicit sort disables the default randomized load balancing.                                                                    |
| `preferred_min_throughput` | Number or percentile object            | Prefer endpoints meeting tokens/second thresholds; slower endpoints remain eligible.                                                                                            |
| `preferred_max_latency`    | Number or percentile object            | Prefer endpoints meeting latency thresholds in seconds; slower endpoints remain eligible.                                                                                       |
| `max_price`                | Object                                 | Hard price filter, not an absolute total-call budget. Fields: `prompt`, `completion`, `request`, `image`, `audio`.                                                              |
| `options`                  | Objects keyed by provider slug         | Forward the matched provider's options. Other providers' entries are ignored; unrecognized keys can be silently dropped. This is distinct from our gateway's `providerOptions`. |

Sources: [routing guide](https://openrouter.ai/docs/guides/routing/provider-selection),
[SDK provider preferences](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/providerpreferences.ts),
[SDK provider options](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/provideroptions.ts),
[SDK sort enum](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/providersort.ts).

Important details:

- Default routing prefers endpoints without significant outages in the last
  30 seconds, then chooses among inexpensive stable endpoints with weights
  proportional to inverse price squared. Other endpoints are fallbacks.
  Setting `order` or `sort` removes this randomized selection.
- Tool requests also get **Auto Exacto** ordering by throughput, tool-call
  reliability, and benchmark signals. It runs by default, can override sticky
  cache routing, and can be bypassed with `sort: "price"` or `:floor`.
- Even with `require_parameters: false`, `tools`, `response_format`, and
  `verbosity` favor supporting endpoints within a model. If none supports
  a parameter, OpenRouter can still serve that model while ignoring it.
- `sort.partition` defaults to `"model"`: exhaust the primary model's
  endpoints before fallback models. `"none"` sorts endpoints across all
  candidates and can choose a fallback model immediately.
- Performance threshold objects accept `p50`, `p75`, `p90`, `p99`.
  A number means p50. Metrics use a rolling five-minute window; every
  specified cutoff must pass to join the preferred group. These are soft
  preferences, not per-call deadlines or performance guarantees.
- `max_price.prompt` and `.completion` are USD per million tokens;
  `.request` is USD/request, `.image` USD/image, `.audio` USD/audio unit.
  The guide uses numeric values, but OpenAPI and SDK type all five as
  strings. Preserve the caller's values; probe both representations.
- Quantizations currently include `int4`, `int8`, `fp4`, `mxfp4`, `nvfp4`,
  `fp6`, `fp8`, `mxfp8`, `fp16`, `bf16`, `fp32`, `unknown`.
  `fp4` includes the specialized fp4 forms; `fp8` includes mxfp8.
- A base slug such as `google-vertex` matches its region/variant endpoints;
  `google-vertex/us-east5` pins that endpoint. Nonstandard service-tier
  endpoints require separate opt-in. A base provider slug does not admit
  its fast/flex endpoints automatically.

Sources: [provider selection](https://openrouter.ai/docs/guides/routing/provider-selection),
[Auto Exacto](https://openrouter.ai/docs/guides/routing/auto-exacto),
[quantization schema](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/quantization.ts),
[performance guide](https://openrouter.ai/docs/guides/best-practices/latency-and-performance).

### Model fallbacks and actual serving identity

`models: ["author/model-a", "author/model-b", ...]` requests ordered model
fallbacks. With both `model` and `models`, the explicit `model` is primary
and the array supplies alternatives. Fallback can follow context validation,
moderation, rate limits, or availability errors. It happens inside OpenRouter,
even if our gateway and SDK make only one HTTP request. Billing follows the
model that answered; response `model` identifies it.

The provider fallback flag should not be assumed to disable model routing
or plugin retries. For strict caller-controlled attempts, use one concrete
model, one endpoint, and `allow_fallbacks: false`, then verify the behavior.

On the Messages format, `fallbacks: [{model: "..."}]` maps to OpenRouter
model routing, not Anthropic's native fallback feature. At most three entries
are accepted; per-attempt overrides and combining `fallbacks` with `models`
produce 400.

For serving identity, retain response `model`, response `provider` when
present, and `X-Provider-Name` when returned. The current `ChatResult` SDK
schema omits `provider` and `native_finish_reason` even though other official
docs show them. Decode raw JSON permissively rather than treating SDK types
as a complete response contract.

`X-OpenRouter-Metadata: enabled` adds `openrouter_metadata` to success and
many error bodies. It reports the requested alias, strategy, edge region,
attempt number, BYOK status, candidate endpoints, optional attempt history,
and pipeline stages. Pipeline data can identify compression, guardrails,
file parsing, healing, and server tools. Early edge failures and masked 500
errors can omit it. Response-cache hits strip it. The older
`X-OpenRouter-Experimental-Metadata` header remains accepted.

Sources: [fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks),
[router metadata](https://openrouter.ai/docs/guides/features/router-metadata),
[SDK ChatResult](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/chatresult.ts).

## Variants, routers and presets

| Model suffix | Current status             | Meaning                                                                                                      |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `:free`      | Active catalog variant     | Distinct catalog entry, endpoints, limits, and sometimes context length. Exists only when listed.            |
| `:batch`     | Active catalog variant     | Batch pricing/endpoints; Batch API resolves it from the base slug. Outside our synchronous `complete` scope. |
| `:thinking`  | Deprecated catalog variant | Dedicated reasoning endpoint on models that offered it; use `reasoning` today.                               |
| `:extended`  | Deprecated catalog variant | Larger context; no current model offers it.                                                                  |
| `:nitro`     | Active routing variant     | Sort by throughput **and admit priority-tier endpoints**. Not just a throughput sort.                        |
| `:floor`     | Active routing variant     | Sort by price **and admit flex-tier endpoints**. Not just a price sort.                                      |
| `:exacto`    | Active routing variant     | Quality-first endpoint sorting, particularly tool-call reliability.                                          |
| `:online`    | Deprecated routing variant | Enable the web plugin. Prefer the web-search server tool.                                                    |

Routing variants work at request time without separate catalog rows. Keep
catalog suffixes when looking up metadata; remove routing suffixes only for
metadata lookup, never from the outgoing requested model. Suffixes combine
in either order, with at most one catalog variant. The last sorting suffix
wins. The current docs say only these suffixes are supported variants.

Service tiers are also native top-level options: `default`, `flex`,
`priority`/`fast`, and `ultrafast`. The schema additionally accepts `auto`
and `scale`; their presence is not a guarantee of support on every model.
`ultrafast` requires explicit selection and is not enabled by `:nitro`.
Fallback may use a different tier, so record response `service_tier` and
actual cost instead of pricing from the requested suffix.

Sources: [variant rules](https://openrouter.ai/docs/guides/routing/model-variants/overview),
[service tiers](https://openrouter.ai/docs/guides/features/service-tiers),
[ChatRequest schema](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/chatrequest.ts).

| Router/alias                                   | Current behavior and caveat                                                                                                                                                                                 | Source                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `openrouter/auto`, `openrouter/auto-beta`      | Classify task, rank models by trailing seven-day market spend, apply cost band and restrictions, then choose/fallback. No routing fee. Session stickiness is best effort.                                   | [Auto](https://openrouter.ai/docs/guides/routing/routers/auto-router)                    |
| `openrouter/free`                              | Random eligible free model, filtered for required capabilities.                                                                                                                                             | [Free router](https://openrouter.ai/docs/guides/routing/routers/free-router)             |
| `~author/family-latest`                        | Resolve newest eligible family model; response names concrete version. Can rewrite unsupported reasoning settings.                                                                                          | [Latest resolution](https://openrouter.ai/docs/guides/routing/routers/latest-resolution) |
| `openrouter/pareto-code`                       | Coding-quality floor via `pareto-router.min_coding_score` (0–1); choose cheapest eligible shortlisted model, or fastest with `:nitro`. No router fee.                                                       | [Pareto](https://openrouter.ai/docs/guides/routing/routers/pareto-router)                |
| `nvidia/switchyard`                            | Choose efficient/capable tier among up to three models, or a market-derived pair. Plugin chooses algorithm; default `stage` may call a judge. No router fee; judge calls are separately billed generations. | [Switchyard](https://openrouter.ai/docs/guides/routing/routers/switchyard-router)        |
| `typesafe/jev-router`                          | Select model and reasoning effort; cost tiers `low`, `medium`, `high`. Include preferences that match nothing are ignored; exclusions remain hard. Global-region/workspace restrictions apply.              | [Jev](https://openrouter.ai/docs/guides/routing/routers/jev-router)                      |
| `openrouter/fusion`, `openrouter/fusion-flash` | Outer model can call a panel plus analyst, with search/fetch enabled. Extra model/tool work is billed.                                                                                                      | [Fusion](https://openrouter.ai/docs/guides/routing/routers/fusion-router)                |
| `openrouter/bodybuilder`                       | Generate JSON request bodies from prose; the client executes them separately. Body generation is free.                                                                                                      | [Body Builder](https://openrouter.ai/docs/guides/routing/routers/body-builder)           |

Auto configuration lives in `plugins: [{id: "auto-router", ...}]`; the beta
slug reads `auto-beta-router` instead. `allowed_models` and `excluded_models`
accept wildcard patterns. `cost_tier` accepts `low`, `medium`, `high`, `xhigh`,
`max`; default is roughly the low band. `cost_quality_tradeoff` is deprecated.
Using the other slug's plugin ID silently ignores its settings. Cost bands
are not absolute spending caps; `provider.max_price` still filters endpoints.

Presets can be referenced through `model: "@preset/slug"`,
`preset: "@preset/slug"`, or a combined `model@preset/slug` string. A bare
`preset` slug is ignored. They can inject model, system prompt, tools,
sampling, routing, and response caching. Request fields override matching
preset fields with a shallow merge. Tools merge by identity rather than
replacing the whole array. The API always uses the latest designated version;
it is mutable account configuration, not a reproducibility guarantee.

Sources: [Auto settings](https://openrouter.ai/docs/guides/routing/routers/auto-router),
[presets](https://openrouter.ai/docs/guides/features/presets).

## Plugins, search and pricing

Plugins use the native `plugins` array. Account defaults apply when a request
does not override them; locked settings can prevent overrides. An entry with
`enabled: false` disables an unlocked default. Plugins can mutate input or
output. Server tools instead use `tools` and may run zero to many times.

| Plugin ID                 | Behavior/options                                                                                                                                               | Price or billing consequence                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `web`                     | Deprecated search augmentation; `engine`, `mode`, `max_results`, `search_prompt`, domain filters, `max_uses`, `user_location`, `x_search`.                     | Search-engine fees plus input tokens; free models do not make search free.                                                                |
| `file-parser`             | `pdf.engine`: `native`, `cloudflare-ai`, `mistral-ocr`; legacy `pdf-text` redirects to `cloudflare-ai`. Default prefers native file support, then Mistral OCR. | Cloudflare parsing free; native billed as input; OCR **$2/1,000 pages**, **$2.20/1,000 pages** in US region. OCR fees also apply to BYOK. |
| `response-healing`        | Repair/extract malformed JSON with `response_format` JSON object/schema; non-streaming only. Cannot reliably repair token-truncated JSON.                      | No separate price specified on its current page; do not invent a guaranteed free-service contract.                                        |
| `context-compression`     | Middle-out message removal/truncation to fit context. Default on endpoints with context ≤8,192 tokens.                                                         | No separate fee specified; changes the prompt.                                                                                            |
| `alignment` (beta)        | Check rules in `audit`/`enforce`; defaults `threshold: 0.7`, `max_retries: 1`, `instruct: true`, mode `enforce`.                                               | Evaluator free; every generation/retry billed and summed in usage, including blocked output. Rejects ZDR/regional requests.               |
| Router configuration IDs  | `auto-router`, `auto-beta-router`, `pareto-router`, `fusion`, `jev-router`, `switchyard-router`.                                                               | Router-specific behavior as above; some cause additional model calls.                                                                     |
| `moderation`, `web-fetch` | Present in current ChatRequest plugin union, beyond the overview's list. Web-fetch schema includes domain restrictions and content/use limits.                 | No general fee/behavior contract established from the plugin overview; use dedicated tool docs/catalog and live probes.                   |

Sources: [plugins](https://openrouter.ai/docs/guides/features/plugins),
[PDFs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs),
[healing](https://openrouter.ai/docs/guides/features/plugins/response-healing),
[compression](https://openrouter.ai/docs/guides/features/message-transforms),
[alignment](https://openrouter.ai/docs/guides/features/plugins/alignment),
[OpenAPI plugin union](https://openrouter.ai/openapi.json).

PDF parsing annotations should remain in the native assistant message:
replaying them avoids repeated parsing. Errors after successful parsing can
also carry `error.metadata.file_annotations`. Deduplicate by `file.hash`.
OCR forwards at most eight extracted images per PDF/request and strips images
entirely for text-only models. This is another upstream fidelity limit.

### Web search surfaces

Prefer `tools: [{type: "openrouter:web_search", parameters: {...}}]`.
It lets the model choose queries and perform multiple searches. OpenRouter
can execute a server-side agent loop, which means one HTTP call can contain
several billable model calls. The outer server-tool budget defaults to 30
steps; `max_tool_calls` caps it and `stop_server_tools_when` overrides it.

| Server-tool parameter                 | Meaning                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine`                              | `auto` (default), `native`, `exa`, `firecrawl`, `parallel`, `perplexity`. Native-preferred tool execution can fall back to Exa; admin engine restrictions can make it fail instead. |
| `mode`                                | Exa: `instant`, `fast`, `auto`, `deep-lite`, `deep`, `deep-reasoning`. Parallel: `turbo`, `fast`, `basic`, `advanced`.                                                              |
| `max_results`                         | Default 5; 1–25, Perplexity 1–20. Ignored by native search.                                                                                                                         |
| `max_uses`, `max_total_results`       | Per-request search/result budgets. Native `max_uses` is forwarded only to Anthropic; other native providers ignore it.                                                              |
| `search_context_size`                 | `low`, `medium`, `high`; engine-specific content budgets. Ignored for native/Firecrawl.                                                                                             |
| `max_characters`                      | 1–100,000 per result; supported by Exa/Parallel/Perplexity; takes precedence over context-size setting.                                                                             |
| `allowed_domains`, `excluded_domains` | Engine/provider-dependent filtering. Plugin names are instead `include_domains`, `exclude_domains`.                                                                                 |
| `user_location`                       | Approximate location for supported native search; other engines ignore it.                                                                                                          |
| `x_search`                            | Explicit xAI X/Twitter search opt-in; handles/dates/media options.                                                                                                                  |

Legacy `web_search_options.search_context_size` configures native search
context on the plugin surface. Do not rename it into server-tool parameters.
The plugin and tool have different fallback semantics and settings; send
the caller's chosen surface unchanged.

Domain caveats: Exa accepts both include/exclude; Parallel, Firecrawl, and
Anthropic require one list; Perplexity lets include win; native OpenAI ignores
exclude. Google native search does not support domain filters: auto plugin
selection can fall back to Exa, while explicit native plugin selection errors.
The tool's regional engine availability is stricter: US uses Exa; EU has no
search engine available. ZDR does not generally cover search backends.

| Search engine            | Current OpenRouter-listed price, excluding LLM tokens                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Exa instant/fast/auto    | $0.007/search, includes ten results; $0.001/additional result.                                                                         |
| Exa deep-lite/deep       | $0.012/search, same result allowance.                                                                                                  |
| Exa deep-reasoning       | $0.015/search, same result allowance.                                                                                                  |
| Parallel turbo/fast      | $0.001/search; ten results included, then $0.001/result.                                                                               |
| Parallel basic/advanced  | $0.005/search; same result allowance.                                                                                                  |
| Perplexity search engine | $0.005/search. Distinct from a Perplexity model's native-search billing.                                                               |
| Firecrawl                | Own Firecrawl credits: two credits/ten search results plus five credits/result scraped with highlights; no OpenRouter search fee.      |
| Native model search      | Provider-specific charges passed through; there is no universal OpenRouter price. See linked provider pricing on the search page.      |
| xAI native X search      | Since 2026-09-21: $5/1,000 posts fetched and $10/1,000 profiles fetched. Requires explicit opt-in; old per-tool-call billing is stale. |

Sources: [search plugin](https://openrouter.ai/docs/guides/features/plugins/web-search),
[search tool and pricing](https://openrouter.ai/docs/guides/features/server-tools/web-search),
[server tools and budgets](https://openrouter.ai/docs/guides/features/server-tools).
The plugin page has an older sentence saying xAI enables both searches; its
later opt-in section and the server-tool page explicitly require `x_search`.

Other server tools include web fetch, datetime, image generation, shell/bash,
apply patch, model/tool search, fusion, advisor, and subagent. Some are
format-specific. Consult `GET /api/v1/tools` and endpoint `native_tools` rather
than assuming every tool has a native upstream execution path or one fee.

## Authentication, headers, attribution and account policy

Use `Authorization: Bearer <OpenRouter API key>` and
`Content-Type: application/json`. Attribution is optional for inference.
Management keys cannot call inference; they authorize administrative APIs.
OAuth PKCE supports user-owned OpenRouter keys. Workload Identity Federation
can exchange external identity for an OpenRouter inference token; it is a
separate credential workflow, not an upstream BYOK key in a completion body.

| Header                                                                     | Purpose                                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `HTTP-Referer`                                                             | App URL/identity for attribution; required to create an attributed app page.           |
| `X-OpenRouter-Title`                                                       | App display title; legacy `X-Title` accepted. Title alone does not create attribution. |
| `X-OpenRouter-Categories`                                                  | Recognized comma-separated marketplace categories; unknown values dropped.             |
| `X-OpenRouter-App-Visibility: hidden`                                      | Create a new attributed app privately. Does not change an existing app's visibility.   |
| `x-session-id`                                                             | Session grouping/cache affinity; body `session_id` wins.                               |
| `X-OpenRouter-Metadata: enabled`                                           | Include routing/pipeline metadata.                                                     |
| `X-OpenRouter-Cache`, `X-OpenRouter-Cache-TTL`, `X-OpenRouter-Cache-Clear` | Full-response caching controls, below.                                                 |
| `x-anthropic-beta`                                                         | Selected supported Anthropic betas; not arbitrary upstream header forwarding.          |

For Anthropic strict tool use, current routing docs require
`x-anthropic-beta: structured-outputs-2025-11-13`; without it OpenRouter
strips `strict`. Interleaved thinking beta is also documented. JSON-schema
response format gets the appropriate beta automatically.

`user` is a stable end-user ID for abuse detection and usage/tracing, limited
to 128 characters. Current SDK descriptions say it is folded into a hashed
upstream identity when required, never forwarded raw; omission uses an
account identity, so provider policy blocks can affect other account traffic.
`session_id` is up to 256 characters. `trace` accepts an
arbitrary JSON object for Broadcast; common keys include `trace_id`,
`trace_name`, `span_name`, `generation_name`, `parent_span_id`. These fields
have different meanings and should not be combined into our response ID.

Sources: [authentication](https://openrouter.ai/docs/api_reference/authentication),
[management keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys),
[federation](https://openrouter.ai/docs/guides/overview/auth/workload-identity-federation),
[attribution](https://openrouter.ai/docs/app-attribution),
[provider headers](https://openrouter.ai/docs/guides/routing/provider-selection#provider-specific-headers),
[Broadcast](https://openrouter.ai/docs/guides/features/broadcast),
[SDK user/trace fields](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/chatrequest.ts).

### BYOK and billing

Upstream keys are encrypted and configured in OpenRouter workspace settings
or its management API. Completion authentication still uses an OpenRouter
key. Do not invent a per-call upstream credential field.

The current pricing page lists **$25,000/month of list-price inference** with
no BYOK fee on Standard and Business, then **5%** of equivalent OpenRouter
model/provider cost, deducted from OpenRouter credits. Enterprise allowance
is custom. This is a spend-based allowance, not the old request-count rule.
The upstream provider separately bills the caller's own account; paid
plugins still charge OpenRouter credits.

Prioritized BYOK keys normally precede shared capacity; fallback BYOK keys
follow shared capacity. Explicit `provider.order` determines provider slots,
with matching keys tried within each slot. Shared-capacity fallback can be
disabled for matching models (`is_required`) or the whole provider
(`is_byok_only`). A failed own key can otherwise lead to paid shared capacity.
Multiple keys can be filtered by model, OpenRouter key hash, and member.

BYOK still follows data policy. A declared private provider ZDR agreement
can change that key's retention eligibility, but not its training policy.
Budget options decide whether external BYOK spend counts toward key,
guardrail, or workspace caps. Usage reports `is_byok` and separate upstream
cost fields; a BYOK endpoint alone does not imply a zero OpenRouter bill.

Sources: [BYOK](https://openrouter.ai/docs/guides/overview/auth/byok),
[current plan pricing](https://openrouter.ai/pricing),
[usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).

### Observability and data handling

OpenRouter says prompt/output storage and product use are opt-in; metadata
is retained by default. Private input/output logging is separate from the
product-use opt-in (which gives a 1% discount). Logging retains content for
at least three months and possibly longer; deletion is requested through
support. Regional requests currently skip this logging feature.

Broadcast is workspace/account configuration that exports requests, outputs,
usage, costs, timing, model/provider, and tool data to configured systems:
OTEL collectors, Langfuse, LangSmith, Braintrust, Datadog, S3, webhooks, and
others. Per-destination Privacy Mode strips prompt/output content but retains
custom metadata, so callers must keep secrets out of `trace`. Sampling can preserve
whole sessions. `trace` enriches exports. Optional Cost metadata exports
additional billing quantities and raw provider usage; raw usage is not an
invoice calculation and may be unavailable or suppressed.

`data_collection: "deny"` concerns collection/training; `zdr: true` concerns
retention at inference endpoints. ZDR can be enforced globally, per model
group, by guardrail, or per request. In-memory prompt caching is allowed under
OpenRouter's ZDR definition. Plugins/tool backends are generally outside this
inference restriction, although Firecrawl is rejected under account/guardrail
ZDR, and alignment rejects request/workspace ZDR. Regional APIs use fixed
EU/US hostnames and require the corresponding plan/access.

The older Provider Logging page says retention does not affect routing;
the dedicated ZDR page explicitly documents retention filtering. Use the
dedicated ZDR rules and endpoint policy data for implementation.

Sources: [data collection](https://openrouter.ai/docs/guides/privacy/data-collection),
[logging](https://openrouter.ai/docs/guides/features/input-output-logging),
[Broadcast](https://openrouter.ai/docs/guides/features/broadcast),
[ZDR](https://openrouter.ai/docs/guides/features/zdr),
[provider policies](https://openrouter.ai/docs/guides/privacy/provider-logging),
[regions](https://openrouter.ai/docs/guides/features/in-region-routing).

## Prompt caching and response caching

| Upstream                            | OpenRouter prompt-cache controls                                                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                              | Automatic at eligible prefix sizes. GPT-5.6+ also accepts text-block `prompt_cache_breakpoint` and root `prompt_cache_options` (`mode`, `ttl`); automatic writes can cost 1.25× input. Explicit mode with no breakpoints disables caching.         |
| Anthropic/Claude providers          | Root `cache_control` enables automatic moving breakpoint; per-block controls give up to four explicit breakpoints. Five-minute default or `ttl: "1h"`. Root controls now work across Anthropic, Vertex, Azure, Bedrock and Claude Platform on AWS. |
| Gemini                              | Implicit caching on eligible models; explicit `cache_control` uses the last breakpoint and managed cache storage. Explicit five-minute TTL does not refresh.                                                                                       |
| Alibaba                             | Explicit `cache_control` on supported models/endpoints, five-minute writes.                                                                                                                                                                        |
| DeepSeek, xAI, Moonshot, Groq, Z.AI | Automatic on supported models/endpoints; provider-specific prices and thresholds. Z.AI affinity uses account/session identity.                                                                                                                     |

OpenRouter translates cache markers between formats/providers: Anthropic-style
`cache_control` becomes an OpenAI breakpoint on supporting models; an OpenAI
breakpoint becomes a default five-minute control toward Anthropic/Google.
TTL values are not translated. Responses supports root `cache_control` but
uses `prompt_cache_breakpoint` for block markers instead of Anthropic block
controls. Keep these transformations visible in our documentation.

Provider affinity is account/model/conversation scoped, expires after ten
minutes idle, and prefers the previous provider when cached input is cheaper.
By default the conversation fingerprint hashes the first system/developer
and first non-system messages. Explicit body/header `session_id` takes
precedence; `prompt_cache_key` is the fallback explicit key. Explicit sessions
activate affinity after any success; implicit sessions wait for a cache hit.
`provider.order` wins over affinity, and Auto Exacto can reorder away from a
warm endpoint. Router-model stickiness is also best effort, not a model pin.

Read `usage.prompt_tokens_details.cached_tokens` and `.cache_write_tokens`
(Responses: `input_tokens_details`). Prompt totals include cache quantities;
do not add cached tokens to `prompt_tokens` again. Preserve `usage.cost`,
`cost_details`, and `is_byok`. Generation metadata adds `native_tokens_cached`
and `cache_discount`; writes can make the discount negative. Missing detail
fields do not prove caching was disabled.

Sources: [prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching),
[Auto Exacto/cache interaction](https://openrouter.ai/docs/guides/routing/auto-exacto#interaction-with-prompt-caching),
[usage](https://openrouter.ai/docs/cookbook/administration/usage-accounting),
[SDK usage fields](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/chatusage.ts).

Full-response caching is different: opt in with `X-OpenRouter-Cache: true`
or a preset. TTL defaults to 300 seconds, range 1–86,400.
`X-OpenRouter-Cache: false` overrides a preset; `...-Cache-Clear: true`
refreshes the matching entry when caching is enabled. Cache keys include API
key, endpoint, model, streaming mode, and body; JSON property ordering matters,
but attribution/provider headers are excluded. Each hit gets a new generation
ID and zero billable usage. Response headers report `...-Cache-Status`,
`...-Cache-Age`, `...-Cache-TTL`, `...-Cache-Source-Id`. No current inference
provider served a hit; routing metadata is stripped.

Source: [response caching](https://openrouter.ai/docs/guides/features/response-caching).

## Errors

### Bodies, metadata and HTTP 200 failures

The usual Chat error envelope is:

```ts
{
  error: {
    code: number,
    message: string,
    metadata?: Record<string, unknown> | null
  },
  id?: string,
  openrouter_metadata?: unknown,
  usage?: unknown
}
```

Decode `metadata` as open data. Relevant fields include:

| Field                                          | Meaning                                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error_type`                                   | Canonical OpenRouter provider-error category; preferable to numeric status alone.                                                                                                   |
| `provider_code`                                | Original upstream error code when available.                                                                                                                                        |
| `provider_name`, `raw`                         | Provider attribution and verbatim upstream payload, explicitly documented for policy/refusal errors. Do not assume present on every failure or assume `raw` is already parsed JSON. |
| `reasons`, `flagged_input`, `model_slug`       | Moderation details. Flagged text is limited to 100 characters with middle truncation. It is still prompt content.                                                                   |
| `limit_source`, `reason`, `remedy_hint`        | Credit/budget source and remediation; branch on machine fields, not human hints.                                                                                                    |
| `scope`, `limit_usd`, `spend_usd`, `resets_at` | Budget layer, amounts, reset timestamp; lifetime budgets can have null reset.                                                                                                       |
| `patterns`                                     | Guardrail block details.                                                                                                                                                            |
| `alignment`, `file_annotations`                | Plugin results, possibly rejected content or parsed files.                                                                                                                          |

HTTP status alone is insufficient. OpenRouter commits 200 after upstream
acceptance, before output exists. A later non-streaming failure can be
`{id, error}` with no choices, or a final response with partial content and
`choices[i].error`, `finish_reason: "error"`. **Yes, errors inside choices are
documented.** Inspect top-level and choice errors before declaring success.
If all fallback attempts fail after status commitment, HTTP can still be 200.

The SDK's `ChatResult`/`ChatChoice` types omit these non-streaming error forms,
although docs explicitly describe them. Its normal 200 parsing path can
misclassify them as schema failures or drop unmodeled fields. Our adapter
should inspect raw JSON itself.

500 failures are masked to generic messages, with provider code and routing
metadata omitted; canonical `server` remains. Do not depend on always having
raw upstream details. Successful refusal output is a normal completion:
Chat may use `message.refusal` and `content_filter`, Responses a refusal part
with completed status. This differs from explicit policy/refusal errors.

Sources: [error handling](https://openrouter.ai/docs/api_reference/errors-and-debugging),
[choice error types](https://openrouter.ai/docs/api_reference/overview),
[SDK choice schema](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/models/chatchoice.ts),
[SDK HTTP/200 parsing](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/funcs/chatSend.ts).

### HTTP statuses

| Status   | Documented meaning / important distinction                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 200      | Success **or body/choice failure after headers were committed**.                                                                    |
| 400      | Invalid/missing parameters, invalid prompt/image, context/length errors, CORS; metadata refines meaning.                            |
| 401      | Missing/invalid/disabled/revoked/expired credentials.                                                                               |
| 402      | Insufficient balance/key credits, or estimated in-flight spending limit; one variant is transient.                                  |
| 403      | Permission failure, moderation/refusal, guardrail/alignment block, **or exhausted configured budget**.                              |
| 404      | Unknown/inaccessible resource, or no eligible models/endpoints after restrictions.                                                  |
| 408      | Request timeout.                                                                                                                    |
| 412      | Failed precondition such as `If-Match`; canonical error table, not a listed Chat operation response.                                |
| 413      | Request payload too large.                                                                                                          |
| 422      | Semantically unprocessable request.                                                                                                 |
| 429      | OpenRouter free-request/platform limit or upstream request/token throttling.                                                        |
| 500      | Internal/unmapped provider error, masked details.                                                                                   |
| 502      | Upstream unavailable/down, invalid/empty response, or provider failure.                                                             |
| 503      | Temporary overload/unavailability; older summary also uses this for unmet routing requirements. Specific no-endpoint docs show 404. |
| 504      | Canonical provider timeout; some formats/operations explicitly list it even though Chat's operation list does not.                  |
| 524      | Edge-network timeout, explicitly listed for Chat. No fixed deadline follows from the code.                                          |
| 529      | Provider overload, explicitly listed for Chat.                                                                                      |
| 409, 410 | Also exist in administrative APIs (conflict, removed resource/API); not normal documented Chat completion statuses.                 |

Chat's current operation response list is 200, 400, 401, 402, 403, 404,
408, 413, 422, 429, 500, 502, 503, 524, 529. This is not an exhaustive
guarantee against additional HTTP statuses or edge HTML bodies.

Sources: [OpenAPI operation/error schemas](https://openrouter.ai/openapi.json),
[SDK Chat status handling](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/funcs/chatSend.ts),
[canonical errors](https://openrouter.ai/docs/api_reference/errors-and-debugging#typed-error-codes),
[404 routing example](https://openrouter.ai/docs/guides/features/router-metadata#no-providers-available-404).

### Canonical provider error types

The current error reference defines this complete vocabulary. Status below
is the logical status; after commitment it is in `error.code`, with HTTP 200.

| Canonical `error_type`                                                            | Logical status | Meaning                                                                         |
| --------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `context_length_exceeded`                                                         | 400            | Combined input/output exceeds context.                                          |
| `max_tokens_exceeded`                                                             | 400            | Output token ceiling reached as an error.                                       |
| `token_limit_exceeded`                                                            | 400            | Enforced token budget, potentially credit-related.                              |
| `string_too_long`                                                                 | 400            | Per-field character ceiling, not necessarily total context.                     |
| `authentication`                                                                  | 401            | Bad/missing/revoked key.                                                        |
| `permission_denied`                                                               | 403            | Access denied or guardrail block.                                               |
| `payment_required`                                                                | 402            | Insufficient credits.                                                           |
| `rate_limit_exceeded`                                                             | 429            | Request/token throttle.                                                         |
| `provider_overloaded`                                                             | 503            | Provider capacity.                                                              |
| `provider_unavailable`                                                            | 502            | Invalid/empty upstream response.                                                |
| `invalid_request`, `invalid_prompt`                                               | 400            | Request/message validation.                                                     |
| `not_found`                                                                       | 404            | Missing resource.                                                               |
| `precondition_failed`                                                             | 412            | Conditional request failed.                                                     |
| `payload_too_large`                                                               | 413            | Oversized body.                                                                 |
| `unprocessable`                                                                   | 422            | Semantically invalid request.                                                   |
| `content_policy_violation`, `refusal`                                             | 403            | Filter block or model refusal reported as an error.                             |
| `invalid_image`, `image_too_large`, `image_too_small`, `unsupported_image_format` | 400            | Image validation.                                                               |
| `image_not_found`                                                                 | 404            | Missing image URL/file.                                                         |
| `image_download_failed`                                                           | 400            | URL fetching failed; underlying cause may be network, timeout, or HTTP failure. |
| `server`, `unmapped`                                                              | 500            | Generic/unknown failure.                                                        |
| `timeout`                                                                         | 504            | Provider deadline.                                                              |

The docs' text/Markdown export drops dynamic status components. Values above
were recovered from the official page's embedded MDX/HTTPStatus constants,
then checked against OpenAPI error schemas where available. They are not
guesses from conventional HTTP meanings.

On Responses failures, canonical `error_type` is **top-level**; native
`error.code` is a reduced string vocabulary (`invalid_prompt`,
`rate_limit_exceeded`, `image_content_policy_violation`, `server_error`).
On Messages it is `error.error_type`; native `error.type` is Anthropic-shaped.
Messages pre-router failures can have `request_id: null`; post-router failures
use the generation ID. Each adapter needs its own reader.

Some limit errors during generation are deliberately transformed into
successful `length` completions (`context_length_exceeded`,
`max_tokens_exceeded`, `token_limit_exceeded`, `string_too_long`). A normal
`length` stop is not by itself an exception. Empty content with `length`
can mean all output budget went to reasoning; repeated retries do not fix it.

Sources: [canonical and format-specific errors](https://openrouter.ai/docs/api_reference/errors-and-debugging),
[Responses errors](https://openrouter.ai/docs/api_reference/responses/error-handling),
[reasoning budget](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#reasoning-tokens-and-max_tokens).

Context-overflow message wording is not standardized across upstreams.
Prefer `context_length_exceeded`; retain `raw` and `provider_code` when present.
The compression guide promises a reduce-length/enable-compression suggestion,
but no universal exact text. Any fallback message patterns such as
`maximum context length` or `context length exceeded` remain candidate
adapter rules requiring recorded live fixtures, not verified universal codes.

### Credits, budgets, rate limits and IDs

402 has at least two materially different in-flight-budget cases:

| Metadata                                                                              | Meaning                                                                                                     | Caller action                                                                  |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `limit_source: "openrouter_in_flight_budget"`, `reason: "in_flight_budget_exhausted"` | Running/recently settling requests filled a temporary cost reservation pool. Balance can still be positive. | Transient; use `Retry-After`.                                                  |
| `limit_source: "openrouter_credits"`, `reason: "weight_exceeds_budget"`               | This request alone exceeds the reservation budget.                                                          | Reduce prompt/output allowance or add funds; retrying unchanged will not help. |
| `limit_source: "openrouter_credits"` otherwise                                        | Balance cannot cover work. Negative balance can also block free models.                                     | Add credits/change request.                                                    |
| `limit_source: "openrouter_key_limit"`                                                | Key spend ceiling.                                                                                          | Raise limit or wait for configured reset.                                      |

The temporary pool applies to a subset of low-balance/new prepaid accounts;
its fractional budget, ceiling, eligibility threshold, and settlement window
are not numerically published. Estimates reserve token costs, not every
plugin/image/request fee. Entirely own-key requests without paid plugins,
free models, and specified enterprise/subscription/invoice accounts are
excluded. Do not hard-code a concurrency count from this mechanism.

Configured budget failures are 403 with `limit_source` equal to
`openrouter_guardrail_budget`, `openrouter_workspace_budget`, or
`openrouter_key_limit`. Metadata gives reset time; no Retry-After because
these windows are usually long. Daily/weekly/monthly windows use UTC;
weekly starts Monday. A lifetime budget never resets.

Free model limits: **20 requests/minute**; **50/day** below $10 lifetime
credits purchased, **1,000/day** at/above $10. Current implementation grants
the larger tier from nine credits to absorb fees/rounding. The daily counter
is account-level, resets at UTC midnight, and is independent of
`is_free_tier`. Exempt accounts/endpoints and BYOK are not gated by it.
Paid variants have no documented platform request cap, but upstream capacity
and Cloudflare DDoS protection still apply. More keys/accounts do not promise
more capacity.

On OpenRouter platform 429, headers include `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`. Successful inference does not
include these. Upstream throttling need not use the same header contract.
The docs do not fix the units/encoding of `X-RateLimit-Reset`; verify it.
Retry-After may accompany 429, 503, and transient in-flight 402; the limits
guide says an aggregate retry hint is returned when every attempted provider
gave one. Do not assume the header is always present.

Use `Retry-After` seconds/date to derive `retryAfterMs`; SDK source also
understands `retry-after-ms`, but its existence in the client is not proof
OpenRouter emits it. Preserve transport HTTP status separately from body code.

`X-Generation-Id` and JSON `id` identify a generation. The generation record
also has `request_id` (groups generations from one API request) and
`upstream_id`. Public GET CORS headers expose `X-Generation-Id`,
`X-Provider-Name`, `request-id`, `cf-ray`; this does **not** prove every
response includes their values. Our unauthenticated GETs had `cf-ray` but
no request/generation/provider ID. No universal `x-request-id` guarantee was
found. Record actual header presence; never fabricate IDs.

Sources: [limits and in-flight budget](https://openrouter.ai/docs/api_reference/limits),
[SDK retry-header parser](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/lib/retries.ts),
[generation schema](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation),
[response-cache generation headers](https://openrouter.ai/docs/guides/features/response-caching).

## Account and catalog endpoints

All paths below are under `https://openrouter.ai/api/v1`.

| GET endpoint                        | Auth and usefulness                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/key`                              | Current inference key's details and spending headroom. Use before a long task; no separate management credential required.                             |
| `/credits`                          | **Management key required today.** Account totals `{data: {total_credits, total_usage}}`. Balance is their difference; not the key's available budget. |
| `/generation?id=gen-...`            | Bearer-authenticated generation metadata, tokens, cost, routing, timing. Query ID is required, max 128 characters, `gen-` pattern.                     |
| `/models`                           | Public catalog; current authenticated org settings can filter it. Pricing, capabilities, parameter superset, limits, endpoint links.                   |
| `/model/{author}/{slug}`            | Single-model metadata; suffix resolution is handled server-side.                                                                                       |
| `/models/{author}/{slug}/endpoints` | Per-endpoint pricing, capability/parameter support, quantization, native tools, performance. More precise than a model-level union.                    |
| `/models/user`                      | Authenticated catalog filtered by key/workspace policies; use regional hostname for regional eligibility.                                              |
| `/providers`                        | Public provider slugs and policy/status links.                                                                                                         |
| `/endpoints/zdr`                    | Public endpoint-level ZDR catalog.                                                                                                                     |
| `/tools`, `/tools/{name}`           | Server-tool catalog including format spellings, engines/pricing and native execution availability. Our unauthenticated `/tools` returned 401.          |
| `/keys`, `/keys/{hash}`             | Management-key account/key administration. Ordinary inference keys cannot enumerate/manage others.                                                     |
| `/activity`, `/analytics/meta`      | Management-key usage/analytics; richer querying is a separate POST administrative API.                                                                 |
| `/generation/content?id=...`        | Stored input/output/error-attempt content when available/authorized, for opt-in diagnostics. Do not add it to ordinary gateway responses/logs.         |

Sources: [current key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key),
[credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits),
[generation](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation),
[management API](https://openrouter.ai/docs/guides/overview/auth/management-api-keys),
[OpenAPI endpoint definitions](https://openrouter.ai/openapi.json).

`/key.data` includes:

- `label`, `expires_at`, `is_free_tier`, `is_management_key`;
  `is_provisioning_key` is the deprecated management-key name.
- `limit`, `limit_remaining`, `limit_reset`, `include_byok_in_limit`.
- `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`, and separate
  `byok_usage` totals for the same windows, all USD.
- `budgets` and `effective_budget`, including scope, IDs, USD spent/remaining,
  reset interval/time, and `include_byok`. Effective budget is the blocking
  spent entry, otherwise the smallest remaining headroom. Key limit alone
  does not describe all caps.
- `free_model_daily_requests: {used, limit, remaining}`.
- `creator_user_id`, `organization_id`, `workspace_id`,
  `allowed_data_regions`.
- Deprecated `rate_limit`: do not use it as current capacity. Schema prose
  says it always returns -1, while its example still shows 1,000/hour.

Generation `data` includes:

| Group            | Fields                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/routing | `id`, `request_id`, `upstream_id`, `model`, `provider_name`, `provider_responses`, `router`, `is_byok`, `service_tier`, `data_region`, `session_id`, `workspace_id`, `preset_id`.                                       |
| Tokens           | `tokens_prompt`, `tokens_completion`; `native_tokens_prompt`, `native_tokens_completion`, `native_tokens_reasoning`, `native_tokens_cached`, `native_tokens_completion_images`. Keep native and legacy counts distinct. |
| Accounting       | `usage`, `total_cost`, `cache_discount`, `upstream_inference_cost`, `response_cache_source_id`. Upstream cost is documented as available for BYOK, otherwise zero/null.                                                 |
| Timing/stops     | `created_at`, `latency`, `generation_time`, `moderation_latency`, `finish_reason`, `native_finish_reason`, `streamed`, `cancelled`. Times are milliseconds where stated.                                                |
| Tools/media      | `num_search_results`, `num_fetches`, `web_search_engine`, media/audio counters.                                                                                                                                         |
| Attribution      | `app_id`, `origin`, `http_referer`, `external_user`, `user_agent`.                                                                                                                                                      |

Responses include usage automatically now. Old `usage.include` and
`stream_options.include_usage` controls are deprecated/no-op. Prefer actual
reported cost over a catalog estimate; plugins, model selection, tier,
cache writes, and server-side loops make requested-model estimates incomplete.
Generation lookup is a caller-side audit helper, not a mandatory extra hop
inside `complete`.

Sources: [generation response fields](https://openrouter.ai/openapi.json),
[usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).

### Read-only observations

Public GETs on 2026-10-12 returned 200 for `/models` (458 entries),
`/providers` (112), and `/endpoints/zdr` (936). Counts are snapshots.
There were 15 `:free` and 76 `:batch` entries, no `:thinking`/`:extended`
entries, and no routing-variant rows, consistent with current variant rules.
Unauthenticated `/key`, `/credits`, `/generation?id=gen-research-no-such-generation`,
and `/tools` returned 401 with
`{"error":{"message":"No cookie auth credentials found","code":401}}`.
This does not establish behavior with a valid key.

Snapshots, downloaded docs/schema, npm archive and source are outside the repo
in the requested scratch directory, under `scratchpad/openrouter/routing/`.

## Timeouts and long non-streaming calls

The alignment guide explicitly documents **whitespace sent while a
non-streaming model call runs**. JSON parsers must accept leading whitespace,
and HTTP 200 commitment can precede the final JSON. This gives a documented
keep-alive mechanism; it is not SSE streaming or partial assistant output.
The page does not specify heartbeat cadence or a maximum call duration.
It keeps the OpenRouter-to-gateway connection active. Because our gateway
buffers the complete result, it does not keep the separate caller-to-gateway
connection active. Verify both transport legs with the intended deployment.

SSE streams separately use `: OPENROUTER PROCESSING` comments to prevent
connection timeouts. Provider integration docs ask upstreams to send SSE
keep-alives during reasoning, otherwise OpenRouter may cancel with a fetch
timeout and try a fallback. No general numeric inference/read/idle timeout
guarantee was found in the current reference. Do not infer one from Cloudflare
524 or unrelated sandbox/evaluator deadlines.

The SDK's generated Chat transport uses `timeoutMs: -1` unless configured;
that is a client default, not OpenRouter's server deadline. It also defaults
to backoff on 5xx and connection errors, with a one-hour retry budget. We must
not import that retry policy into this gateway. Its source retry list is
`["5XX"]`; the docs' broad statement about SDK rate-limit retries should not
override the inspected Chat implementation.

For non-streaming cancellation the current streaming guide says upstream work
continues and the completed response is billed. Aborting our fetch can return
`cancelled` to the caller without stopping provider charges. A timeout may
have the same unresolved-billing consequence; preserve any generation ID for
later caller-side reconciliation.

Sources: [non-streaming whitespace](https://openrouter.ai/docs/guides/features/plugins/alignment#error-instead-of-a-retry),
[streaming keep-alives/cancellation](https://openrouter.ai/docs/api_reference/streaming),
[provider integration](https://openrouter.ai/docs/guides/providers/integration),
[SDK Chat transport defaults](https://github.com/OpenRouterTeam/typescript-sdk/blob/ebfdb60e293ce4758eadfc3638e808fff362e0f0/src/funcs/chatSend.ts).

## Implications for our gateway

Treat OpenRouter as its own provider profile on a chosen API format. Our
`providerOptions` must contain **OpenRouter's native request fields**:
`provider`, `models`, `plugins`, `reasoning`, caching controls, `user`,
`session_id`, `trace`, service tier, and native server tools. Do not flatten
the nested `provider` object or rename it into our provider selection field.
The caller's model string, including aliases/suffixes/presets, travels
unchanged. Unknown fields pass through; owned model/messages/stream fields
still get the existing collision checks.

Headers need an explicit native-header facility or documented profile option;
do not forward arbitrary credentials/hosts. Forward the OpenRouter Bearer key
only to a fixed authorized OpenRouter origin. BYOK setup remains account
configuration. A regional origin, if supported, should be another fixed
profile choice rather than a caller-controlled URL.

Document OpenRouter's own transformations prominently. `require_parameters`
is useful caller policy, but does not prove byte-preserving upstream behavior:
provider-specific options, strict-tool headers, cache TTL translation, latest
reasoning remapping, PDF image limits, default compression, plugins, and
account settings can change semantics. Do not silently inject routing flags
to claim full fidelity. If we promise strict semantics, unsupported cases
must be refused or require an explicit caller choice.

No gateway or SDK retries. OpenRouter's internal provider/model fallback,
alignment retries, and server-tool loops are native caller-visible options
and account policy. A helper could return an explicit configuration for one
model/endpoint, `require_parameters: true`, no fallback, compression disabled,
and no mutating plugins, while reporting the remaining upstream limitations.
It must not silently alter a normal request.

Responses has an additional mismatch with stateful upstream usage:
`store: true` and non-null `previous_response_id` currently fail with 400.
Always replay full history on that format; do not claim OpenAI stored-response
semantics. Native Chat assistant messages should retain reasoning details,
signatures, tool calls, citations and file annotations unchanged as returned
by OpenRouter. Record the **actual resolved model** for replay; best-effort
router/session stickiness cannot guarantee model-bound reasoning remains valid.

### Proposed error mapping

Apply specific metadata first, then canonical type, then body code/status,
then narrowly tested provider-specific message rules. This table is our
proposal, not an OpenRouter contract.

| Signal                                                                                                                                | Our kind                                                                            | Retryable                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 402 `openrouter_in_flight_budget` / `in_flight_budget_exhausted`                                                                      | `rate_limited`                                                                      | Yes; capacity reservation, not exhausted permanent credits.                             |
| Credit/key/guardrail/workspace spend exhaustion; `payment_required`                                                                   | `quota_exceeded`                                                                    | No. Preserve reset metadata; do not convert long budget windows into automatic retries. |
| `context_length_exceeded`                                                                                                             | `context_overflow`                                                                  | No.                                                                                     |
| `authentication`; credential/permission-only 401/403                                                                                  | `auth`                                                                              | No.                                                                                     |
| `content_policy_violation`, error `refusal`, moderation/guardrail/alignment content block                                             | `policy_violation`                                                                  | No. Distinguish from budget and access 403.                                             |
| `rate_limit_exceeded`; other throttling 429                                                                                           | `rate_limited`                                                                      | Yes. Preserve daily-limit/reset information.                                            |
| `not_found`, `image_not_found`; no eligible endpoints/model 404                                                                       | `not_found`                                                                         | No by default; providerParam can identify the routing filter when evidenced.            |
| `provider_overloaded`; capacity 503/529                                                                                               | `overloaded`                                                                        | Yes.                                                                                    |
| Routing-constraints 503 with no eligible endpoint                                                                                     | `not_found`                                                                         | No; avoid endless retries for a hard restriction.                                       |
| `timeout`; 408/504/524                                                                                                                | `timeout`                                                                           | Yes. A retry may duplicate billable work.                                               |
| `invalid_request`, `invalid_prompt`, image validation, `string_too_long`, `payload_too_large`, `unprocessable`, `precondition_failed` | `invalid_request`                                                                   | No.                                                                                     |
| Error `max_tokens_exceeded`                                                                                                           | `invalid_request`                                                                   | No; a successful `length` stop remains a success.                                       |
| `token_limit_exceeded`                                                                                                                | `quota_exceeded` if credit evidence, otherwise `invalid_request`                    | No. Do not assume every token limit is context overflow.                                |
| `provider_unavailable`, generic upstream 502                                                                                          | `provider_error`                                                                    | Yes; OpenRouter may already have exhausted its fallbacks.                               |
| `server`, `unmapped`, other provider 5xx                                                                                              | `provider_error`                                                                    | Yes.                                                                                    |
| `image_download_failed`                                                                                                               | `invalid_request` by default; refine only with explicit transient download evidence | Usually no.                                                                             |
| Our transport cannot reach OpenRouter                                                                                                 | `network_error`                                                                     | Yes.                                                                                    |
| Invalid/truncated/unreadable response, or error finish with no intelligible details                                                   | `invalid_response`                                                                  | No. Inspect embedded errors before deciding parsing failed.                             |
| Caller abort                                                                                                                          | `cancelled`                                                                         | No.                                                                                     |

For HTTP-200 failures keep `httpStatus: 200` and the distinct provider body
code/type. Retain generation ID, available request ID, retry delay, failed
usage/cost, and safe structured metadata. `providerParam` is not a universal
OpenRouter error field: copy it from explicit upstream evidence, or infer a
specific routing/input field only when the error proves it. `metadata.raw`,
`flagged_input`, rejected alignment messages, and file annotations can contain
content; secrets must never be echoed, and none of these belong in gateway logs.

### Response envelope

Keep requested model and reported concrete model separate. Keep provider ID
`openrouter` for adapter/replay identity; put actual upstream provider/name or
endpoint identity in native response metadata. Preserve response `provider`
and `X-Provider-Name` evidence, opt-in routing metadata, reported service tier,
BYOK status, and cache-hit/source information without inventing missing values.
A response-cache hit represents prior output, not a new upstream generation.

Use the OpenRouter generation ID as response ID. Record `request-id` if
actually returned, and expose generation-record `request_id`/`upstream_id`
through optional caller-side audit results. Keep native stop reason and unknown
response fields; avoid duplicating assistant output and request echoes.
Reported OpenRouter cost should remain distinguishable from our token-only
estimate and from upstream BYOK expenditure.

### Live probes once a key exists

Use short synthetic prompts and explicit spend/output caps. Record raw bodies
and headers locally as fixtures; never include keys in fixtures or logs.

| Probe                  | Concrete setup and evidence to collect                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serving identity       | One concrete model, `only` one endpoint, `allow_fallbacks: false`, metadata header. Compare `model`, `provider`, provider/generation/request headers, and `/generation`. Repeat without metadata.                                                                      |
| Parameter support      | A known unsupported parameter with `require_parameters` false/true. Confirm ignored behavior versus error; test unsupported provider-specific option and strict-tool beta header.                                                                                      |
| Model fallback         | Unavailable primary plus valid `models` fallback; then primary context overflow. Confirm actual model, attempts, cost and whether `allow_fallbacks: false` affects model fallback.                                                                                     |
| Restriction errors     | Unknown model; nonexistent `only`; tiny max-price; incompatible ZDR/parameter/quantization filters. Capture 404 versus 503 and infer only evidenced providerParam. Test numeric/string max-price.                                                                      |
| Error bodies           | Malformed input, bad key, context overflow, moderation and upstream failure with fallback disabled. Look for top-level error, `choices[].error`, canonical type, raw provider details, IDs and failed usage. Replay recorded late-failure fixtures through the parser. |
| Budget classifications | Separate capped inference key/workspace. Distinguish 402 credits from 403 key/guardrail/workspace budget; capture `limit_source`, reset metadata. On a low-balance test account probe in-flight 402 safely with small concurrent requests.                             |
| Rate limits            | Controlled free-model test, limited to an intentional small 429 probe. Compare `/key` daily counter and error headers; establish reset units and Retry-After. Avoid a paid-model load test.                                                                            |
| Long reasoning         | `stream: false`, modest paid budget, long reasoning. Measure headers, first whitespace and later byte times with a streaming **HTTP body reader**, then parse final JSON. Measure idle cadence and actual deadline without requesting SSE.                             |
| Cancellation           | Abort one bounded non-stream call after receiving a generation ID; audit final cost/status later. Establish continued billing and error envelope behavior.                                                                                                             |
| Prompt cache           | Repeated eligible prefix pinned to one provider, then unpinned with fixed session. Compare native cache metrics, root/block controls, TTL behavior, Auto Exacto with tools, and explicit price sort.                                                                   |
| Response cache         | Repeat identical request with caching enabled. Check unique hit IDs, zero cost, source ID and absence of routing metadata; change property order/provider headers to test key semantics.                                                                               |
| Routers/presets        | Auto/beta correct and incorrect plugin IDs; fixed session across turns; `~latest` reasoning remapping; preset request precedence and mutable model selection. Avoid expensive Fusion until separately budgeted.                                                        |
| Plugins                | PDF native/Cloudflare/OCR, annotation replay and error annotations; JSON healing; search tool versus deprecated plugin. Capture tool loops/cost, citations, file/image fidelity and account-default overrides.                                                         |
| Own-key accounting     | BYOK-only endpoint with shared capacity prohibited. Compare `usage.cost`, `is_byok`, upstream cost and generation/key totals. Test normal-key versus management-key `/credits` access.                                                                                 |
| Other formats          | If adopting Responses/Messages, verify their canonical error locations, full-history replay, state-field rejection, and native reasoning preservation separately.                                                                                                      |
