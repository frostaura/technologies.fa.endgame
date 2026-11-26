# ARCH-003 — The model gateway

Endgame's own gateway is the only component that talks to OpenRouter. These rules come from a
spike run against the live API on 2026-11-24 (about US$0.02 spent; chat completions only). The
gateway is not built yet; this is the design it must follow.

## What OpenRouter gives us

| Need | Answer |
| --- | --- |
| Cost before a call | No estimate endpoint and no tokenizer. Prices per token, per provider, come from the models and per-model endpoints listings. **One model id can cost ten times more on one provider than another.** |
| Cost after a call | Every response carries its cost in `usage`, streaming included (in the last chunk). It matched token arithmetic exactly on 19 of 20 calls. The separate generation record appears 6 to 11 seconds later. |
| A price ceiling | `provider.max_price` is enforced by the server: a call no provider can serve under the ceiling fails with no charge. It caps **per-token rates, not the total cost of a call**. |
| Routers | The auto router honours a hard allow-list and tool calling. **The Jev router treats its model list as a preference and ignored ours.** |
| Web search | A server-side tool on any model, usable alongside our own tools, billed per search inside the same cost figure. No third service is needed. |
| Attribution | A `user` field and session id per request are recorded. OpenRouter has no organisation tree; ours lives in our ledger. |

## Rules

1. **Reserve against the worst eligible provider, then send that same ceiling as `max_price`.** The
   server then cannot route to anything dearer than what was reserved.
2. **Reservation formula.** Prompt tokens are estimated as bytes ÷ 2, plus 16 per message, plus 64.
   Output is clamped to the provider's maximum — OpenRouter does not clamp it. Add search fees
   (`max uses × engine fee`) and the prompt growth search results cause. In the spike the
   reservation was never below the actual cost; it ran 1.06 to 44 times above it, median 10.
3. **Settle from the response's own cost figure**, refund the difference, and reconcile against the
   generation record later. Our own arithmetic is a sanity check only; nothing is billed from it.
4. **Always clamp `max_tokens`.** Ten million was accepted and served.
5. **Always set reasoning explicitly.** A model with reasoning on by default returned empty
   answers with every token spent on reasoning — and billed.
6. **Route ourselves.** The gateway picks the model list per task type and always sends
   `max_price`, a sort order and `require_parameters`. A router is used only with a hard allow-list;
   never rely on Jev's model list as a restriction. *This sharpens the spec's "Jev is the intended
   router": Jev may choose within our list, it may not be the limit.*
7. **Never put an unvalidated model id in a fallback list.** One bad id fails the whole request.
8. **Treat tool-call ids as opaque** and echo them exactly; their shape differs by provider behind
   one model id. Read the normalised finish reason, not the native one.
9. **Do not assume parallel tool calls, or a forced tool choice.** Both vary by model and provider.
10. **An error can arrive inside a successful response** once output has started. Check every
    response body and every stream chunk for an error, not only the status code.
11. **Research defaults to the cheap search engine;** the dearer one where quality matters. Citations
    are not anchored to spans of the answer.
12. **Work FrostAura does for itself is a platform cost, never an organisation's.** Screening a new
    organisation against the red lines (UC-111) happens before it exists, so `PlatformModelCalls`
    prepares the call exactly as every call is prepared (`ModelGateway.Prepare`: the route's models,
    ceiling, `max_price` and limits) and sends it through the same provider adapter, but reserves in no
    ledger: the reported cost is written to `platform_costs` (append-only) with what the call was for.
    The screening asks for `response_format: json_object` with 3000 tokens of room (the `classify`
    route's models reason first; at 400 they spent the budget thinking and the answer was cut off),
    reads the first whole JSON object in the answer — bare, fenced or after prose — and asks once more
    when it cannot (with twice the room when the first was cut off); two unreadable answers leave only
    the operator's screening by hand.
13. **Every answer code reads as JSON is guarded against being cut off (R2-6).** Reasoning models spend
    output tokens thinking before they answer, so a structured answer can stop at `max_tokens` mid-object
    (`finish_reason: length`; the memory review stopped at exactly 2,000 of 2,000). Each such call asks for
    a cap sized for its largest realistic answer, and the routes they use leave room for twice that
    (`classify` 8,000, `summarise` and `research` and `evaluate` 16,000, `plan` 32,000, `ask` 6,000). A
    cut-off answer is never read as a malformed one: it is asked for once more with twice the room and
    `repair` set, so the owner never pays for the platform's limit, and a second cut is reported as "too
    long to finish". In the harness this is `AgentDefinition.StructuredAnswer` (every researcher, the
    judge, screens, memory review, suggestions, the evaluator, the security reviewer and the planner's
    `propose_plan`); with no tools on the call it also sets `preferJson`, which the gateway turns into
    `response_format: json_object` wherever every model on the route takes one — never a refusal.

## Routing table shape

Each task type maps to: an ordered list of validated models; the provider ceiling and sort; an
explicit reasoning setting; `max_tokens`; whether parallel tool calls are allowed; any server tools
with their limits; and a ceiling in dollars for one call, checked against the reservation before
sending. The models for building work are set from the harness benchmark, not from this document.

## Not verified

A live out-of-credit or rate-limit response from OpenRouter itself, an error mid-stream, key
provisioning (documentation only), prompt-cache write premiums on the models that charge them, and
the batch-priced model variants.
