import type { RequestStep } from "../content/scripts.ts";

function json(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

/** A request and its response, as an AI assistant or a script sends and receives it. */
export function RequestPanel({ step }: { step: RequestStep }) {
  const ok = step.response.status < 400;
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto rounded-lg border bg-surface p-5 shadow-raised" data-testid="request">
      <div>
        <p className="text-eyebrow font-semibold uppercase text-ink-muted">Request</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-sm">
          <span className="rounded-xxs bg-violet-tint px-2 py-0.5 font-semibold text-violet-text">{step.method}</span>
          <span className="break-all text-ink">{step.path}</span>
        </p>
        {step.headers && (
          <dl className="mt-2 space-y-0.5 font-mono text-xs text-ink-muted">
            {Object.entries(step.headers).map(([k, v]) => (
              <div key={k}><dt className="inline">{k}: </dt><dd className="inline">{v}</dd></div>
            ))}
          </dl>
        )}
        {step.body !== undefined && <pre className="mt-3 overflow-x-auto rounded-xs bg-ground p-3 font-mono text-xs text-ink">{json(step.body)}</pre>}
      </div>
      <div className="animate-rise animate-delay-2">
        <p className="text-eyebrow font-semibold uppercase text-ink-muted">Response</p>
        <p className="mt-2 font-mono text-sm">
          <span className={`rounded-xxs px-2 py-0.5 font-semibold ${ok ? "bg-success-tint text-success-text" : "bg-attention-tint text-attention-text"}`}>{step.response.status}</span>
        </p>
        {step.response.body !== undefined && <pre className="mt-3 overflow-x-auto rounded-xs bg-ground p-3 font-mono text-xs text-ink">{json(step.response.body)}</pre>}
      </div>
    </div>
  );
}
