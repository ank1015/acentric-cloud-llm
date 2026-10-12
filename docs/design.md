# Design

One way to call many LLM providers without giving up what makes each of them
good. A stateless Cloudflare Worker gateway, and a small SDK for calling it
from anywhere, including handlers of agents deployed on acentric-cloud.

This document records what we are building and the decisions behind it. It is
updated as decisions change; the code follows it.

## The problem

Unified LLM libraries usually normalize every provider onto one shape: one
message format, one content model, one set of options. That is the lowest
common denominator. Providers really differ, and the best results come from
using each the way it is designed: its own request options, its own server
tools, and above all the conversation exactly as it produced it, with
encrypted reasoning, signatures, compaction items and server tool calls
replayed verbatim. A library that flattens those away makes every provider a
little worse.

## What we are building

- **One shared vocabulary** for the parts that really are common: user
  content, tool definitions, tool results, mid-conversation system
  messages, stop reasons, usage, errors.
- **Native everywhere else.** An assistant message is the provider's own
  output, kept verbatim and sent back as is. Request options are the
  provider's own request fields. Nothing provider-specific is abstracted.
- **One endpoint**, `complete`: one request in, one complete response out.
  Other endpoints (images, compaction, background retrieval) are added only
  if needed.
- **Switching providers is possible but explicit.** Client-side helpers
  convert a conversation from one provider to another and report what was
  lost. Performance may drop; that is accepted.

## Principles

1. **Native is the source of truth.** We never rewrite a provider's output
   and never silently rewrite a caller's input. Where a provider cannot do
   what was asked, the request fails with an error that says so; a helper
   may do an explicit transformation instead.
2. **The gateway is stateless.** It stores nothing, logs no credentials or
   content, and injects no defaults. It maps our shared shapes to the
   provider's, passes everything else through, and maps the result back.
3. **Light.** No runtime dependencies in the SDK or the worker. No official
   provider SDKs: we write the types we need ourselves.
4. **Fully typed, open at the edges.** Types narrow by provider: options,
   credentials, native items and model IDs. Unknown fields and new item
   types from a provider still pass through.
5. **No streaming.** Agents work in the background and nobody needs to watch
   tokens arrive. A complete response is simpler for the caller, the
   gateway and durable runtimes like acentric-cloud, where a handler returns
   one result.
6. **Callers own policy.** No retries in the SDK or the gateway. Errors are
   structured so the caller can decide.

## Decisions

### Messages and content

**D1. Assistant messages are native only.** An `AssistantMessage<P>` holds the
provider's output items verbatim, plus `provider`, `api` and `model`. There is
no normalized copy alongside it: duplicating content doubles what a harness
stores and sends, and the normal path is to send the whole message back.
Pure SDK helpers extract what a harness needs (tool calls, text, reasoning),
one extractor per API format. Items an extractor does not know are returned
as unknown rather than dropped, so new provider output never breaks it.

**D2. Native replay is safe for the same provider, API format and model.**
Each assistant message records all three. A request carrying an assistant
message from another provider is refused, by the types and by the gateway.
A message from another model of the same provider is passed through as is,
since some providers accept it, and the provider refuses it if it must.
Encrypted reasoning and signatures are often tied to the model, so the
conversion helpers (D13) are the safe path whenever the model changes. The
one exception is Anthropic, where signed thinking from another model never
errors but is read by some models and silently ignored by others: its
adapter leaves another model's thinking blocks out and replays the rest.

**D3. Two kinds of system instructions.** `instructions` on the request is the
provider's top-level system field (OpenAI `instructions`, Anthropic `system`,
Gemini `systemInstruction`). A `system` message is a mid-conversation
instruction. A provider without native mid-conversation system messages
refuses the request (principle 1); a helper may rewrite them explicitly.

**D4. Shared content is small.** User messages, system messages and tool
results carry content parts: text, image and file, with a source that is a
URL, base64 data, or a provider file ID. A file ID is a handle in one
provider's own storage and works only with that provider. Anything
provider-specific (Anthropic `cache_control`, OpenAI image `detail` or cache
breakpoints, Gemini media resolution) goes in the part's `providerOptions`,
which the adapter merges into the provider's block. A key there that the
adapter owns (the block's type or source fields) is refused, never
overwritten. A provider that takes no files, or has no file storage for file
IDs, refuses those parts; some would drop them without an error. Provider-specific input items (compaction items, results of
provider-defined tools, approvals) travel in a `native` message.

**D5. Tool results carry their tool type.** A result says whether it answers
a `function` or a `custom` tool call, instead of the adapter looking the tool
up by name. With `previous_response_id` the original call is not in the
request, and tools may change between turns. For the same reason a result
has its own `providerOptions`, merged into the provider's result item, for
fields a provider requires on results (OpenAI's `caller` for programmatic tool
calls). The SDK's `toolResult(call, content)` copies them from the extracted
call. `isError` is sent only where the provider has a field for it; where it
has none (OpenAI), it is not sent, and that is documented rather than
rewritten into the content. Custom tools, and results for them, are refused
by providers whose models cannot call them. Results of provider-defined tools the caller
executes (computer use, shell, apply_patch, approvals) are not tool results;
they are `native` items.

**D6. Application messages never reach a provider.** A `custom` message holds
the application's own data in the same history. The SDK strips custom
messages before sending; the gateway refuses them.

### Requests and providers

**D7. Provider options are the provider's own request fields.** Typed per
provider by hand, as the provider's request body minus the fields we own
(model, input or messages, instructions, our tools, streaming). The gateway
passes them through, never through an allowlist, and the provider rejects
what is invalid. An owned field in `providerOptions` is refused, not
silently overwritten. Hosted or server tools are native tool
definitions in `providerOptions.tools`, merged with ours.

**D8. Nothing is portable in the request beyond D4's shared shapes.** No
common `maxTokens`, `temperature` or reasoning level. Switching provider
means the caller forms the new provider's options. Optional SDK helpers that
return native options (for example a reasoning level for a given provider)
can come later; they never change the wire format.

**D9. State is the caller's choice.** `store`, `include`,
`previous_response_id` and every similar field are passed through untouched.
`previous_response_id` matters: a harness on one provider sends only the new
items, which saves memory, bytes and latency. When it is invalid the provider
errors, the error comes back as `not_found` with `providerParam`, and the
harness falls back to the full history. Every adapter reports it this way,
even where the provider's error does not name the field (Fireworks answers a
bare 404). Switching provider or model also means sending the full history.

`complete` returns only finished responses. Options that would make it return
something else are refused: streaming, and background execution that answers
with a queued response. Background runs, retrieval and standalone compaction
may become their own routes later. Server-side compaction inside a normal
request works as is.

**D10. API formats are separate from providers.** An adapter implements one
API format (OpenAI Responses, Anthropic Messages, Gemini generateContent,
later OpenAI Chat Completions). Each format has its own profile shape: the
Messages profile is only a URL, credentials and headers, since Anthropic is
its one provider so far. A provider is a profile on a format: base
URL, credentials and headers, fields it forbids or requires, capability
flags (file parts, file IDs, custom tools), and small hooks for what is really
its own (reading errors, the price multiplier or the cost it reports, fields
it reports on output but refuses on input). Native item types are the
format's, extended by the provider. One provider ID uses one API format; a
provider reachable through two formats gets two IDs.

**D11. Any model ID is accepted.** The catalog is metadata (name, limits,
modalities, pricing) used for autocomplete and cost. A model missing from it
works, without a cost estimate. New models need no gateway or SDK release.
For a gateway provider with hundreds of models (OpenRouter) the catalog is
curated: only the models we use there, which have no provider of their own
here.

### Conversion, errors, usage

**D12. Stop reasons are derived where a provider has none.** OpenAI reports
only a status; the adapter derives `tool_use`, `refusal`, `pause_turn` and the
rest from the status and the output items, and always keeps the provider's
own reason in `providerStopReason`.

**D13. Conversion between providers is client-side and explicit.**
`convert(messages, { provider, model }, { reasoning })` returns the
conversation for the target and a record of every change it made. It works
on the whole conversation, since tool call IDs and the results that answer
them change together. Assistant messages for the target's own provider and
model are kept; another provider or model in the same API format is filtered
(the fast path); another format goes through a provider-neutral form that is
never stored (the hub): each format reads into it and writes from it, so a
new format adds one converter, not one per pair. Reasoning bound to a model
is dropped, or kept as text by policy; provider items are dropped; options
other providers own are stripped from shared parts and never translated.
See [conversion.md](conversion.md).

**D14. Errors are structured.** One `LlmError` with a `kind`, a `retryable`
flag, the provider's code, type, param and error body, its HTTP status,
`retryAfterMs`, request and response IDs, and usage for failed generations
the provider may bill. Kinds:

| kind               | meaning                                                   | retryable by default |
| ------------------ | --------------------------------------------------------- | -------------------- |
| `invalid_request`  | the gateway or the provider refused the request           | no                   |
| `auth`             | credentials missing, invalid or not permitted             | no                   |
| `rate_limited`     | throttled                                                 | yes                  |
| `quota_exceeded`   | out of credits or over a billing limit                    | no                   |
| `context_overflow` | the prompt is too long for the model                      | no                   |
| `policy_violation` | a provider safety policy refused it; do not resend as is  | no                   |
| `not_found`        | unknown model, or an expired or invalid previous response | no                   |
| `overloaded`       | provider capacity                                         | yes                  |
| `provider_error`   | any other provider failure                                | yes                  |
| `invalid_response` | the provider answered with something we cannot read       | no                   |
| `network_error`    | the provider or gateway could not be reached              | yes                  |
| `timeout`          | the call took longer than allowed                         | yes                  |
| `cancelled`        | the caller aborted                                        | no                   |
| `internal_error`   | a gateway bug                                             | no                   |

Adapters classify from the HTTP status and the provider's error codes, and
read every error shape a provider answers with (Fireworks also answers
FastAPI's `detail` forms). Where a provider gives no code (some
context-overflow errors), matching its message is that adapter's job, with
tests, never a global pattern list. A provider's reading may also name the
request field at fault (`providerParam`) when the error itself does not.

**D15. The response envelope is small and never duplicates.** The assistant
message, the response ID, the requested and the provider-reported model, a
stop reason and the provider's own stop reason, usage with a cost, timing,
and `native`: the provider's
response fields that say something new, such as an Anthropic container or
the OpenAI service tier actually used. `native` leaves out the output (it is
the message), everything already in the envelope, and every echo of the
request (instructions, tools, sampling and caching settings): a long
conversation would otherwise store its instructions and tools once per turn.

A provider that reports what it charged (OpenRouter, whose price depends on
the endpoint that served the request) gives the cost: `source: "reported"`,
usually a total only. Otherwise the cost is estimated (`source:
"estimated"`): tokens only, at the catalog's standard rates, adjusted for a
service tier only where the multiplier is documented, and omitted when the
model is not in the catalog. Where a provider prices cache writes by time to live (Anthropic),
the catalog has a separate one-hour rate; `usage.cacheWrite` and
`cost.cacheWrite` still hold every write together. When the response does not say which tier served it, a request for
a tier other than the default gets no estimate. Per-call fees for hosted tools are not estimated.

### Shape of the code

**D16. Packages.**

| Package              | What it is                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts` | Types only, plus `LlmError` and route names. Pure, no dependencies. Includes the hand-written native types per provider.                |
| `packages/providers` | The adapters: request mapping, response mapping and extractors per API format, provider profiles, the catalog, cost. Uses only `fetch`. |
| `packages/sdk`       | The client: gateway mode, and direct mode that runs the adapters in-process. Re-exports the extractors and conversion helpers.          |
| `workers/gateway`    | A thin Cloudflare Worker around `packages/providers`.                                                                                   |

Direct mode means the same code can run without the gateway: no extra hop and
keys never leave the caller. The gateway remains useful for browsers (CORS),
small bundles and fixing adapters without redeploying agents.

**D17. Pure where it can be.** Types, extractors and conversion helpers have
no I/O, no clock, no randomness and no module state, so an acentric-cloud
reducer's pure `step` can use them. Only the transport calls `fetch`.

**D18. Credentials travel in the request body**, are forwarded only to the
provider's fixed URL, and are never logged, stored or echoed in errors. The
same holds for secrets inside native tool definitions (MCP authorization,
shell domain secrets): the gateway never logs request bodies.

## How we add a provider

One at a time, in order: **OpenAI** (done), **Fireworks** (done),
**Anthropic** (done), **OpenRouter** (done, for models without a provider
of their own), **Google Gemini.** For each:

1. Research the provider's current docs and API reference: request fields,
   output items, what must be replayed and how, state (`store`, previous
   response IDs), errors and codes, usage fields, limits.
2. Write a short research note in `docs/providers/<provider>.md`, with
   source links and the date verified.
3. Write its native types in `packages/contracts`.
4. Implement the adapter or profile and the extractors, and add the
   provider to conversion (D13): its capabilities and option keys, and a
   converter for a new API format.
5. Test against recorded responses; check live with a real key.

## Tooling

TypeScript 7 with `NodeNext` and `exactOptionalPropertyTypes`. Sources import
with `.ts` extensions, rewritten to `.js` on build, so Node runs sources and
tests directly. Tests use `node --test`. Type behavior is checked by
compiling test files that include expected errors.

## Open questions

- The npm scope and package names (`@acentric-llm/*` for now).
- Typing `providerOptions` on content parts, tools and messages per provider
  instead of as an open record.
- A license before publishing.
- Provider request headers. Fireworks' `x-session-affinity` and
  `x-prompt-cache-isolation-key` are headers; `prompt_cache_key` in the body
  covers affinity for now. Anthropic's `anthropic-beta` header has its own
  option, `providerOptions.betas`, which the adapter moves into the header.
