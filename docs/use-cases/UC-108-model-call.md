# UC-108 — Call a model through the gateway

| Field | Value |
| --- | --- |
| **ID** | UC-108 |
| **Title** | An employee's harness asks for a completion, within budget, at a known worst case |
| **Primary actor** | employee (agent) via the Runner · system |
| **Scope** | Control plane `POST /internal/model/chat` → OpenRouter |
| **Cascade level** | The call's scope; every `monthly_credits` cap on its chain, the employee's cap, the organisation balance |
| **Status** | Built |

## Main flow

1. The Runner posts `{ taskType, scope, runId?, employeeId?, messages, tools?, toolChoice?, responseFormat?, limits { maxTokens? }, stream, repair, idempotencyKey? }` with the service token.
2. The route for the task type fixes the models (validated catalogue only), the price ceiling, sort, explicit
   reasoning, the output clamp, parallel tool calls, any web search, and the most one call may cost.
3. The worst case is reserved under lock (UC-103) and the same ceiling is sent as `provider.max_price`, with
   `require_parameters`, `usage.include` and the clamped `max_tokens`. `model.requested { callId, model, reservedCredits, ... }` is logged.
4. The reply is passed through untouched (tool-call ids opaque); non-streamed, with `Endgame-Reservation-Id`,
   `Endgame-Reserved-Credits` and `Endgame-Settled-Credits` headers; streamed, line by line, with an
   `event: endgame.settlement` before the upstream's `[DONE]`.
5. Settlement comes from the reply's own cost; without one, from the generation record; `model.replied { callId, tokens { input, output }, settledCredits, ... }` is logged.

## Alternate and failure flows

- **A1 — over budget.** 402 `budget_exhausted`, terminal. **A2 — over the route's per-call ceiling, or no provider under `max_price`.** 422 `ceiling_unreachable`, not terminal.
- **A3 — an error inside a 200 or mid-stream.** Detected in every body and chunk; settled; 502 `upstream_error` (or the error in the settlement event).
- **A4 — unknown task type** 400; **no key** 503 `model_provider_unconfigured`; **no service token** 401.

## Rules this use case must honour

- ARCH-003 rules 1–10. The control plane is the only holder of `OPENROUTER_API_KEY`; the key is never logged.

## Acceptance

- See TEST-101: request shape, settlement, streaming, mid-stream error, error-in-200, ceiling refusal, budget exhaustion, repair, concurrency; one opt-in live call.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `ModelGatewayTests`, `RoutingTableTests`, `LiveModelTests`.
