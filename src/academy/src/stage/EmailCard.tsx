import type { EmailStep } from "../content/scripts.ts";
import { ScrollPane } from "./ScrollPane.tsx";

/** An e-mail as it arrives in the reader's inbox. */
export function EmailCard({ step }: { step: EmailStep }) {
  return (
    <ScrollPane className="bg-ground" testId="email">
    <div className="flex items-start justify-center p-4 sm:p-6">
      <article className="w-full max-w-read animate-rise rounded-md border bg-surface shadow-card">
        <header className="border-b px-5 py-4">
          <p className="font-display text-lg font-semibold text-ink">{step.subject}</p>
          <dl className="mt-2 grid grid-cols-chart-row gap-x-3 gap-y-0.5 text-xs text-ink-muted">
            <dt>From</dt><dd className="truncate text-ink-body">{step.from}</dd>
            <dt>To</dt><dd className="truncate text-ink-body">{step.to}</dd>
          </dl>
        </header>
        <div className="space-y-3 px-5 py-5 text-sm text-ink-body">
          {step.body.map((p, i) => <p key={i} className={/^[A-Z0-9]{6,}$/.test(p) ? "font-mono text-lg font-semibold tracking-widest text-ink" : ""}>{p}</p>)}
        </div>
      </article>
    </div>
    </ScrollPane>
  );
}
