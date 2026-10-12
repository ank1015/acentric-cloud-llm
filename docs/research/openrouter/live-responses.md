# OpenRouter Responses: live probes

**Verified 2026-10-12.** Model: `meta/muse-spark-1.3-contributor`, served by Meta. Rates observed: $0.10/M uncached input, $0.20/M output, $0.002/M cached input. **Total spend: $0.003886002**, summed from every response's `usage.cost`; generation lookup costs are not counted again. There were 58 API probes: 55 POSTs and three GETs. No streaming API requests were made. Findings apply to this model and endpoint on this date.

Raw evidence: [probe directory](/private/tmp/claude-501/-Users-notacoder-Desktop-acentric-cloud-reducers/69f52ece-5d01-471b-afe7-4effb16cd0e9/scratchpad/openrouter/probe/), with [manifest.json](/private/tmp/claude-501/-Users-notacoder-Desktop-acentric-cloud-reducers/69f52ece-5d01-471b-afe7-4effb16cd0e9/scratchpad/openrouter/probe/manifest.json). Each probe name below identifies five files: `.request.json`, `.request-headers.json` (authorization redacted), `.response.body` (original bytes), `.response.headers` (all headers), and `.meta.json` (status/timing). Scripts and image/PDF fixtures are in that directory. Response ciphertext is retained in raw bodies, not reproduced here. The credential was read in memory and never logged or copied. The final credential scan passed.

The [official Responses overview](https://openrouter.ai/docs/api_reference/responses/overview) documents stateless requests. This report checks that claim and the local research against actual calls. Accepted fields alone do not prove their upstream effect. No inference is made about other models, BYOK, video, custom tools, or stored file IDs.

## 1. Basic text, reasoning, envelope and headers

Sent `input:[{type:"message",role:"user",content:[{type:"input_text",text:"Reply with exactly PROBE_OK."}]}]`, `instructions:"Follow the user exactly."`, and `max_output_tokens:2000`.

| Probe                      | Reasoning / include                            | HTTP / result              | Input / output / reasoning tokens | Cost USD  |
| -------------------------- | ---------------------------------------------- | -------------------------- | --------------------------------- | --------- |
| `01-basic-low`             | `{effort:"low"}`, no include                   | 200, completed, `PROBE_OK` | 32 / 164 / 151                    | 0.000036  |
| `02-basic-low-include`     | low; `include:["reasoning.encrypted_content"]` | 200, completed, `PROBE_OK` | 32 / 219 / 206                    | 0.000047  |
| `03-basic-summary`         | `{summary:"auto"}`, no include                 | 200, completed, `PROBE_OK` | 32 / 305 / 275                    | 0.0000642 |
| `04-basic-summary-include` | auto summary; encrypted include                | 200, completed, `PROBE_OK` | 32 / 310 / 277                    | 0.0000652 |

All four report `model:"meta/muse-spark-1.3-contributor"`, matching the requested ordinary ID. Encrypted reasoning appears **with and without include**. Low effort returns `summary:[]`; auto summary returns objects such as `{type:"summary_text",text:"Evaluating a literal string output request against developer instructions and system constraints."}`. Auto summary adds `effort:"medium"` to the returned `reasoning` object. The summary is descriptive text, not the full reasoning trace.

Every envelope field from `01-basic-low`:

| Field(s)                                                        | Returned value                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `id`, `object`, `model`                                         | `gen-1791788188-9R6ZXTBUhoniP5R4clFj`, `response`, requested ordinary ID       |
| `created_at`, `completed_at`, `status`                          | 1791788188, 1791788190, `completed`                                            |
| `output`, `usage`                                               | Complete native items and usage described below; raw body preserves all fields |
| `error`, `incomplete_details`                                   | null, null                                                                     |
| `tools`, `tool_choice`, `parallel_tool_calls`                   | `[]`, `auto`, true                                                             |
| `max_output_tokens`, `max_tool_calls`                           | 2000, null                                                                     |
| `temperature`, `top_p`, `top_logprobs`                          | 1, 1, 0                                                                        |
| `presence_penalty`, `frequency_penalty`                         | 0, 0                                                                           |
| `metadata`, `background`, `previous_response_id`                | `{}`, false, null                                                              |
| `service_tier`, `truncation`, `store`                           | `auto`, `disabled`, false                                                      |
| `instructions`, `text`, `reasoning`                             | Sent instructions, `{format:{type:"text"}}`, `{effort:"low"}`                  |
| `safety_identifier`, `prompt_cache_key`, `prompt_cache_options` | null, null, null                                                               |

No `provider`, `openrouter_metadata`, `error_type`, `output_text`, or `include` field in the basic envelope. Output fields, including those seen later in the tool probe:

| Item            | Every observed field and value shape                                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasoning`     | `id` (e.g. `rs_6acc849d8361ad10ab8748d9:rs_01a12ee605bd734ba15be5211a8e08c2`), `type:"reasoning"`, `status:"completed"`, `summary:[]` or summary-text objects, `encrypted_content` (opaque string; 2879 characters in each basic call), `format:"meta-responses-v1"`. **No `content`, `signature`, or `created_by`.** |
| `message`       | `id` (e.g. `msg_tmp_00vmnddxpfeq`), `type:"message"`, `role:"assistant"`, `status:"completed"`, `content:[{type:"output_text",text:"PROBE_OK",annotations:[],logprobs:[]}]`. Basic/final messages have no `phase`; pre-tool message has `phase:"commentary"`. No `created_by`.                                        |
| `function_call` | `id`, `type:"function_call"`, `status:"completed"`, `call_id`, `name:"get_weather"`, `arguments` (exact JSON string). No namespace, async, subagent fields, or `created_by`.                                                                                                                                          |

Complete basic usage:

```json
{
  "input_tokens": 32,
  "input_tokens_details": { "cached_tokens": 0 },
  "output_tokens": 164,
  "output_tokens_details": { "reasoning_tokens": 151 },
  "total_tokens": 196,
  "cost": 0.000036,
  "is_byok": false,
  "cost_details": {
    "upstream_inference_cost": 0.000036,
    "upstream_inference_input_cost": 0.0000032,
    "upstream_inference_output_cost": 0.0000328
  }
}
```

Responses never reported `cache_write_tokens`, audio/video/image token counters, or server-tool usage in these probes. Reasoning is included in output tokens and charged. `cost` equals the upstream inference cost for all these non-BYOK calls.

Basic response header names: `date`, `content-type`, `access-control-allow-origin`, `x-generation-id`, `access-control-expose-headers`, `set-cookie`, `permissions-policy`, `referrer-policy`, `x-content-type-options`, `server`, `cf-ray`. The original values, including cookies, are retained only in raw header files. `x-generation-id` matches the body `id`. **No actual `x-request-id`, `request-id`, `x-provider-name`, or `retry-after` appeared anywhere in the 58 API responses.** The CORS expose list naming a header does not mean it was returned. Several routing/upstream errors also have `x-generation-id`, even when their body lacks an ID; validation/auth failures often do not.

`41-metadata` and `42-experimental-metadata`: both `X-OpenRouter-Metadata: enabled` and `X-OpenRouter-Experimental-Metadata: enabled` work, HTTP 200. They add `openrouter_metadata` with `requested`, `strategy:"direct"`, `region:"DEL"`, `summary:"available=1, selected=Meta"`, `attempt:1`, `is_byok:false`, `endpoints:{total:1,available:[{provider:"Meta",model:"meta/muse-spark-1.3-contributor-20260902",selected:true}]}`, and `generation_time`. No `attempts[]` or `pipeline[]` in these calls. Default Responses bodies do not name the upstream.

## 2. Function replay and parallel calls

Sent one strict JSON-schema function `get_weather(city)`, asked for Paris and Tokyo, with `parallel_tool_calls:true`. `06-tool-start` used `tool_choice:"required"`: **400**, numeric code 400, wrapper message `Provider returned error`; `error.metadata.raw` contains Meta's message that only `"auto"` is supported and none/required/named choices are not currently supported. This contradicts the live endpoint catalog (`05-model-endpoints`), which advertises all four choices as supported. Chat also rejects required (`47-chat-required`).

`06b-tool-start-auto` succeeds: 200/completed, reasoning, commentary message, then **two function calls** with arguments `{"city":"Paris"}` and `{"city":"Tokyo"}`. Both native `call_id`s were answered with string-valued `function_call_output`, containing 18°C and 24°C. Subsequent requests contain full earlier history and the exact returned output items, with no changes to IDs, status, phase, arguments, or ordering.

| Replay variant                                                       | Final probe: HTTP / input tokens               | Third-turn probe: HTTP / input tokens                | Result                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Entire output verbatim                                               | `07-tool-final-verbatim`: 200 / 871            | `08-tool-third-verbatim`: 200 / 972                  | Paris 18°C, Tokyo 24°C; Tokyo warmer by 6°C                                          |
| Remove first-turn reasoning                                          | `07-tool-final-no-reasoning`: 200 / 738        | `08-tool-third-no-reasoning`: 200 / 835              | Same answer; this third turn still included the newly returned second-turn reasoning |
| Remove **all** earlier reasoning                                     | Same second turn as above                      | `08b-tool-third-no-reasoning-all`: 200 / 773         | Same correct answer                                                                  |
| Replace ciphertext with `ALTERED_OPAQUE_CONTENT`                     | `07-tool-final-altered-encrypted`: 200 / 744   | `08-tool-third-altered-encrypted`: 200 / 848         | Silently accepted; same answer                                                       |
| Mutate one ciphertext character, preserve length and endpoint suffix | `07b-tool-altered-valid-ciphertext`: 200 / 744 | `08c-tool-third-altered-valid-ciphertext`: 200 / 843 | Silently accepted; same answer                                                       |

All successful turns are completed, with null error. Replaying intact reasoning adds **133 input tokens** over removing it, close to the prior 127 reasoning tokens plus framing. Both corruption tests instead add only six tokens over removing it. This is strong evidence that intact reasoning is forwarded/accounted for and invalid ciphertext is discarded or replaced; it does not independently prove the model relied on that reasoning to answer this easy question. Silent corruption acceptance is not a reason to rewrite native history.

No returned item has `created_by`. `09-synthetic-created-by` adds `created_by:"synthetic-probe"` to every first-turn output item: 200/completed, 871 input tokens, correct final answer. **OpenRouter does not refuse this field in this test.** There is no evidence supporting the adapter's current unconditional removal for this provider.

## 3. State controls

| Probe / field                                     | HTTP | Body / conclusion                                                                                                  |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `10-store-true`: `store:true`                     | 400  | `error.code:"invalid_prompt"`; `store: true is not supported on this proxy. Each response request is independent.` |
| `11-store-false`: `store:false`                   | 200  | completed; echoes false                                                                                            |
| `12-previous-id`: `previous_response_id:"resp_x"` | 400  | `invalid_prompt`; `previous_response_id is not supported on this proxy. Each response request is independent.`     |
| `13-previous-null`: `previous_response_id:null`   | 200  | completed; echoes null                                                                                             |
| `14-background`: `background:true`                | 200  | completed synchronously; returns **`background:false`**. Accepted and rewritten, not a background job.             |

These two stateless errors contain only `error:{code,message}`; no metadata, error type, response object, or usage. Full error bodies are in the named raw files.

## 4. Strictness and supported parameters

All requests otherwise use the basic prompt and low reasoning.

| Probe / sent field                                                    | HTTP / observation                                                                   | Conclusion                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `15-unknown-top`: `foo:1`                                             | 400, numeric 400, upstream raw message ``unknown parameter `foo` ``; raw param `foo` | Unknown top-level field reaches upstream validation; rejected here                      |
| `16-unknown-item`: message item `foo:1`                               | 200, correct text; 32 input tokens                                                   | Accepted without visible effect; forwarding versus stripping is not observable          |
| `17-unknown-part`: input_text part `foo:1`                            | 200, correct text; 32 input tokens                                                   | Same limitation                                                                         |
| `18-invalid-max`: `max_output_tokens:"x"`                             | 400, `invalid_prompt`, `Invalid Responses API request`                               | Gateway type validation rejects                                                         |
| `19-temperature`: `temperature:0.3`                                   | 200; echoes 0.3                                                                      | Accepted supported parameter; this prompt does not measure sampling effect              |
| `20-presence`: `presence_penalty:0.3`                                 | 200; echoes 0.3                                                                      | Accepted despite absence from endpoint supported-parameter list; actual effect unproven |
| `21-presence-require`: same plus `provider:{require_parameters:true}` | 200; echoes 0.3                                                                      | Require-parameters does **not** reject this unsupported-listed parameter                |

Do not promise unknown-field strictness or unsupported-parameter rejection. An echo alone cannot distinguish application from silent ignoring.

## 5. Errors and output limits

No error body includes top-level `error_type` in this run. No `retry-after` header. No top-level error or `choices[].error` arrived with HTTP 200. This does not disprove the documented late-failure cases; these probes mainly trigger errors before generation starts.

| Probe / sent condition                                       | HTTP / real `error.code` | Message / metadata excerpt                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `22-bad-key`: intentionally invalid credential               | 401 / 401                | `User not found.`; no metadata                                                                                                                                                                                                          |
| `23-unknown-model`: `meta/does-not-exist`                    | 400 / 400                | `meta/does-not-exist is not a valid model ID`; no metadata. **Not 404.**                                                                                                                                                                |
| `24-malformed`: raw `{"model":`                              | 400 / `invalid_prompt`   | `Invalid Responses API request`; no metadata                                                                                                                                                                                            |
| `25-missing-input`: omit input                               | 400 / `invalid_prompt`   | `No input provided`; no metadata                                                                                                                                                                                                        |
| `26-max-one`: `max_output_tokens:1`                          | 400 / 400                | `Provider returned error`; metadata raw: `` `max_output_tokens` The number must be `>= 16`. ``; upstream param `max_output_tokens`, type `invalid_request_error`, code null; provider Meta, is_byok false                               |
| `27-no-provider`: `provider:{only:["nonexistent-provider"]}` | 404 / 404                | `No allowed providers are available for the selected model...`; metadata: `available_providers:["meta"]`, `requested_providers:["nonexistent-provider"]`, initial endpoint count 1, `failed_routing_step:"Filter by Allowed Providers"` |
| `28-low-price`: `provider:{max_price:{prompt:0.0000001}}`    | 404 / 404                | `No endpoints found that satisfy the max price for this request`; metadata initial endpoint count 1, `failed_routing_step:"Filter by Max Price"`                                                                                        |

`26b-max-sixteen`, the legal minimum, returns 200 with `status:"incomplete"`, `incomplete_details:{reason:"max_output_tokens"}`, `error:null`, **`output:[]`**, 16 output tokens (13 reasoning), cost $0.0000064. This is a length stop, not an error or zero-cost empty answer.

Unknown-top and required-tool errors have the same numeric-400 wrapper and `metadata:{raw:<JSON string>,provider_name:"Meta",is_byok:false}` shape. Preserve raw JSON strings and the complete wrapper; upstream `param` is not a top-level `error.param`.

## 6. Mid-conversation system messages

`29-late-system` and `29-late-developer`: a user item, previously returned assistant reasoning/message items, a late message with the tested role containing a new exact-output instruction, then another user item. Both 200/completed. Answers: `LATE_SYSTEM_742` and `LATE_DEVELOPER_742`, respectively; these strings occur only in the late instruction. Both roles work and influence the answer. Input tokens: 221/224. Either system-role profile choice has evidence for this model.

## 7. Image and file inputs

| Probe / input                                                                                                                                                 | HTTP / output excerpt                                                                                                          | Input tokens / cost USD |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `30-image-url`: `input_image.image_url`, public [Wikimedia PNG](https://upload.wikimedia.org/wikipedia/commons/7/70/Example.png)                              | 200; describes pale cream/yellow image and text “This is just an example”                                                      | 77 / 0.0000831          |
| `31-image-data`: 64×64 solid-red PNG as base64 data URL                                                                                                       | 200; `The image is a solid bright red square.`                                                                                 | 50 / 0.0000734          |
| `32-file-data`: small valid one-page PDF, `file_data:"data:application/pdf;base64,..."`, `filename:"secret.pdf"`                                              | 200; extracts fixture-only word `ORCHID742`                                                                                    | 447 / 0.0000805         |
| `33-file-url`: `file_url` pointing to W3C dummy PDF                                                                                                           | 400; `Invalid file URL: Received 403 when fetching URL: https://www.w3.org`; numeric code 400, metadata `{provider_name:null}` | No usage                |
| `33b-file-url-github`: same schema, public [PDF.js hello-world PDF](https://raw.githubusercontent.com/mozilla/pdf.js/master/examples/learning/helloworld.pdf) | 200; `Hello, world!`                                                                                                           | 243 / 0.0000495         |

Both file fields are recognized, and both image encodings work. Multimodal requests report charged input tokens and positive cost, but expose no separate image/file token breakdown. No parser plugin was explicitly requested; the probes do not distinguish native PDF ingestion from gateway parsing. External URL fetch failures are request errors, not proof that URL inputs are unsupported. The small PDF/PNG fixtures and successful source download are saved with the probes.

## 8. Cache

`34-cache-first` / `35-cache-second`: exactly the same 240-record text prefix and final `CACHE_OK` request, **3157 input tokens**, low reasoning, no cache flags.

| Call             | cached_tokens | cache_write_tokens | Input cost | Output tokens / total cost USD |
| ---------------- | ------------- | ------------------ | ---------- | ------------------------------ |
| First            | 0             | absent             | 0.0003157  | 112 / 0.0003381                |
| Immediate repeat | 0             | absent             | 0.0003157  | 94 / 0.0003345                 |

No cache hit on this pair. The small total-cost drop is entirely shorter output, not caching. However, ordinary replay calls **did** report cache hits: `08-tool-third-verbatim` has 497 cached tokens, with input cost $0.000048494 = `(972−497)×0.0000001 + 497×0.000000002`. Thus cache reads are included in total input and are discounted when reported. The catalog's `supports_implicit_caching:false` is not a reliable prediction of observed cache hits. Cache population/timing is not established by these two prefix calls.

## 9. Generation lookup

`36-generation-source`: 200, ID `gen-1791788447-mGgEezjmTElffhX01owz`, 32 input / 180 output / 167 reasoning tokens, cost $0.0000392. `37-generation-immediate`: GET `/api/v1/generation?id=<id>` immediately after completion, **404**, `{error:{message:"Generation gen-1791788447-mGgEezjmTElffhX01owz not found",code:404}}`. `38-generation-delayed`: GET approximately 10 seconds after the first lookup began, **200** with `data`.

| Generation data                | Observed                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                       | `id` matches; `model:"meta/muse-spark-1.3-contributor-20260902"`; `provider_name:"Meta"`; `upstream_id:"resp_6acc85a08db4db8ee1804942"`; `request_id:"req-1791788447-gKS7fKa8GVLB5rzfF7l4"`                                                                                                                                                                   |
| Counts                         | `tokens_prompt:14`, `tokens_completion:2` (gateway counts); `native_tokens_prompt:32`, `native_tokens_completion:180`, `native_tokens_reasoning:167`, `native_tokens_cached:0`, `native_tokens_completion_images:0`                                                                                                                                           |
| Cost                           | `usage:0.0000392`, `total_cost:0.0000392` equal response `usage.cost`; `cache_discount:null`; **`upstream_inference_cost:0`**, unlike response usage's positive upstream cost                                                                                                                                                                                 |
| Stop/timing                    | `finish_reason:"stop"`, `native_finish_reason:"completed"`, `latency:2649`, `generation_time:2649`, `service_tier:"auto"`                                                                                                                                                                                                                                     |
| Transport labels               | `streamed:true`, `api_type:"completions"`, despite a non-streaming Responses request; these apparently describe internal gateway transport, not the caller's API                                                                                                                                                                                              |
| Upstream attempt               | `provider_responses:[{endpoint_id,id,is_byok:false,latency:1269,model_permaslug:<canonical slug>,provider_name:"Meta",status:200}]`                                                                                                                                                                                                                           |
| Other fields, all retained raw | `created_at`, `app_id`, `external_user`, `cancelled`, `moderation_latency`, `num_media_prompt`, `num_input_audio_prompt`, `num_media_completion`, `num_search_results`, `num_fetches`, `web_search_engine`, `origin`, `is_byok`, `router`, `user_agent`, `http_referer`, `session_id`, `preset_id`, `response_cache_source_id`, `data_region`, `workspace_id` |

Use native counts when reconciling usage. Generation records are eventually available. Do not substitute their zero `upstream_inference_cost` for response cost, or infer client streaming/API format from their transport labels.

## 10. Chat Completions comparison

`43-chat-tool-start`, `44-chat-tool-final`, `45-chat-tool-third`: same instructions, weather function/prompt/results, low reasoning, `max_tokens:2000`, auto choice, full assistant messages replayed verbatim. All 200; two parallel tool calls, correct final weather and 6°C comparison. Chat wraps the function definition inside `function`, and tool results use `role:"tool"`, `tool_call_id`, `content`.

| Field             | Observed Chat shape                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envelope          | `id`, `object:"chat.completion"`, `created`, ordinary `model` ID, **`provider:"Meta"`**, `system_fingerprint:null`, `service_tier:"auto"`, `choices`, `usage`                                                                                           |
| Assistant message | `role:"assistant"`, `content` string, `refusal:null`, `reasoning` string on the first turn/null later, `reasoning_details` array; first turn also `tool_calls`                                                                                          |
| Tool call         | `{type:"function",index,id,function:{name:"get_weather",arguments:<exact JSON string>}}`                                                                                                                                                                |
| Summary detail    | `{type:"reasoning.summary",summary:<string>,format:"meta-responses-v1",index:0}` on first turn                                                                                                                                                          |
| Encrypted detail  | `{type:"reasoning.encrypted",data:<opaque string>,format:"meta-responses-v1",id:<reasoning ID>,index}`; data lengths 5610/1514/1514. **No signature** in any detail.                                                                                    |
| Choice            | `index:0`, `logprobs:null`, `finish_reason:"tool_calls"` initially then `"stop"`; `native_finish_reason:"completed"` all three turns                                                                                                                    |
| Usage             | `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost`, `is_byok:false`; `prompt_tokens_details:{cached_tokens,cache_write_tokens:0,audio_tokens:0,video_tokens:0}`; `completion_tokens_details:{reasoning_tokens,image_tokens:0,audio_tokens:0}` |
| Cost detail names | `upstream_inference_cost`, **`upstream_inference_prompt_cost`**, **`upstream_inference_completions_cost`**                                                                                                                                              |

| Turn       | Input / output / reasoning / cached tokens | Cost USD    |
| ---------- | ------------------------------------------ | ----------- |
| Tool start | 564 / 565 / 426 / 113                      | 0.000158326 |
| Final      | 1173 / 71 / 50 / 0                         | 0.0001315   |
| Third      | 1264 / 62 / 44 / 497                       | 0.000090094 |

`46-chat-no-provider` gives the same 404 routing shape as Responses; `47-chat-required` the same 400 upstream tool-choice rejection. No HTTP-200 error or `choices[].error` observed. Chat exposes the upstream directly and more usage detail, including an explicit cache-write zero. It returned a visible reasoning summary with low effort where the Responses low-effort tool-start item had an empty summary. Responses can return summaries with `summary:"auto"`; this is an observed default difference, not proof of a missing capability. No tested execution capability was available only in Chat.

## 11. Model IDs

`39-canonical-model`: requested `meta/muse-spark-1.3-contributor-20260902`, **200/completed**, but response `model` is **`meta/muse-spark-1.3-contributor`**, the ordinary ID. Both IDs route. Generation data and optional router metadata expose the dated upstream identity; Responses/Chat envelopes normalize to the ordinary ID. Do not assume the returned model is the literal requested ID or the canonical slug.

## 12. Long reasoning without streaming

`40-long-high`: `stream:false`, `reasoning:{effort:"high"}`, `max_output_tokens:4000`, a combinatorial counting puzzle about 6×6 binary matrices. An HTTP body reader recorded each received chunk without changing the bytes.

| Measurement                            | Result                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| HTTP                                   | 200                                                                                                           |
| Headers / first body byte              | 1.093 seconds / 1.093 seconds after starting                                                                  |
| First non-whitespace JSON / completion | 39.725 seconds / 39.726 seconds                                                                               |
| Leading body bytes                     | **1034 whitespace bytes**; repeated 11-byte `\n         \n` blocks, generally about 0.4 seconds apart         |
| Parsed result                          | response object; incomplete, `incomplete_details:{reason:"max_output_tokens"}`, `error:null`, **`output:[]`** |
| Usage                                  | 92 input, 4000 output, 3997 reasoning, cost $0.0008092                                                        |

Whitespace is a non-streaming keep-alive, not SSE or assistant content. TTFB mostly measures the keep-alive; it does not measure time to the answer. JSON parsing accepts the leading whitespace. The entire budget can be charged while no output item is returned. The puzzle's answer was not obtained or evaluated; this probe tests transport and output-limit behavior.

## Adapter consequences

1. **Replay exceptions must be provider-specific.** `request.ts` currently removes `created_by` from every assistant item. Disable that removal for OpenRouter: native outputs did not contain it, and synthetic values were accepted. Preserve IDs, status, phase, reasoning format/ciphertext/summary, and exact tool arguments. Corrupted reasoning is silently accepted here; never use that as permission to alter or omit intact history. Existing pending-call and commentary extraction handles the observed items.
2. **Support inline and URL files.** Set profile `fileData` to the complete `data:<mediaType>;base64,<data>` URL; existing image and file-URL mappings work. File IDs and custom tools were not tested, so do not enable those capabilities based on this report. Keep explicit rejection of `background:true` in `buildRequest`: the provider silently rewrites it. Full history is required; `store:true` and non-null `previous_response_id` should either fail locally with a clear provider-param error or surface the gateway's 400. Do not silently remove requested state fields. Both system and developer roles work.
3. **Use reported cost and retain raw usage.** `response.ts` currently discards usage extras and calls `estimateCost`. Add a reported-cost/profile path: `usage.cost` → `cost.total`, with no invented input/output cost buckets or catalog fallback. Preserve raw usage (including `is_byok`, `cost_details`, and any future counters) in native data. `input_tokens` → totalInput; subtract cached reads and reported writes for uncached input; output includes reasoning. Keep missing cache-write distinct from zero. BYOK semantics remain untested. A profile `priceMultiplier` alone cannot implement authoritative reported cost.
4. **Record resolved model identity.** Keep requested model in the request/envelope, but attach the returned model to the assistant message used for replay/conversion. The existing `responseModel` field records a discrepancy but leaves `message.model` equal to the request; change that for this profile. Retain optional router metadata and canonical upstream identity as native data. Do not derive canonical identity by appending a date.
5. **Read generation IDs from headers.** Extend transport beyond `x-request-id` / `request-id` to retain **`x-generation-id`**, including error responses; use it as the generation lookup ID. Keep `cf-ray` for debugging if desired. No provider/request-ID header was observed; opt-in metadata or eventual generation lookup supplies the upstream. Generation's `request_id` is a different ID. Do not require a generation lookup for each completion, or count its cost twice.
6. **Inspect errors before validating the success envelope.** `parseResponse` currently checks `object/output` before `body.error`, so a documented HTTP-200 `{id,error}` would become `invalid_response`. Handle the error wrapper first and preserve the full body plus any usage. Extend error/profile input to include top-level `error_type`, `error.metadata`, and full body; `classifyError` currently cannot inspect them. Give canonical types priority over lossy native `server_error` when present. This run verified numeric/string HTTP error shapes, but did not reproduce a late HTTP-200 failure.

Error classification from **observed** responses:

| HTTP / code / discriminator                                          | Kind                                      | Provider parameter / handling                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 401 / `401` / `User not found.`                                      | `auth`                                    | No param                                                                                                                               |
| 400 / `400` / `... is not a valid model ID`                          | `invalid_request`                         | `model`; do not classify as not_found                                                                                                  |
| 400 / `invalid_prompt` / store unsupported                           | `invalid_request`                         | `store`                                                                                                                                |
| 400 / `invalid_prompt` / previous response unsupported               | `invalid_request`                         | `previous_response_id`; not a missing stored resource                                                                                  |
| 400 / `invalid_prompt` / `No input provided`                         | `invalid_request`                         | `input`                                                                                                                                |
| 400 / `invalid_prompt` / generic request validation                  | `invalid_request`                         | Param unavailable in returned body; do not invent one                                                                                  |
| 400 / `400` / upstream `metadata.raw` invalid_request_error          | `invalid_request`                         | Decode for diagnostics and optional raw upstream `param`: observed `foo`, `tool_choice`, `max_output_tokens`; preserve original string |
| 400 / `400` / invalid file URL, fetch 403                            | `invalid_request`                         | File URL; upstream host denial does not mean caller auth failure                                                                       |
| 404 / `404` / routing metadata failed allowed providers or max price | `not_found`                               | Optionally attribute `provider.only` / `provider.max_price`; no eligible endpoint, not unknown model                                   |
| GET 404 / `404` / generation not found                               | `not_found`                               | Generation lookup; may be temporary due to record publication lag                                                                      |
| 200 / no error / incomplete max_output_tokens                        | Successful response, stop reason `length` | Preserve nonzero usage even when output is empty                                                                                       |

Keep the broader documented error-type mapping from [routing-and-errors.md](routing-and-errors.md) for unobserved auth/policy/quota/rate/timeout/overload/context cases; do not claim those mappings were exercised here. Provider options remain native fields. Catalog support flags and `require_parameters` did not provide strict guarantees for this model; preserve caller options, surface real rejections, and document accepted-but-unproven behavior.
