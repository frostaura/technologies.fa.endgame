import { useState, type ReactNode } from "react";
import { Button } from "./ui/button";

/**
 * Something shown once and never again — an invitation code, an assistant's token. It lives only in
 * the component that received it: never in the store, never in the address, gone when dismissed.
 */
export function OneTime({ label, value, children, onDone }: { label: string; value: string; children: ReactNode; onDone: () => void }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <div role="status" aria-label={label} className="flex min-w-0 flex-col gap-3 rounded-sm border border-success-text bg-success-tint px-4 py-3">
      <div className="text-ink">{children}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="min-w-0 max-w-full break-all rounded-xs bg-surface px-3 py-2 font-mono text-base">{value}</code>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied === "yes" ? "Copied" : "Copy"}
        </Button>
      </div>
      {copied === "failed" && <p className="text-sm text-attention-text">It could not be copied; select it and copy it by hand.</p>}
      <p className="font-semibold text-success-text">It will not be shown again.</p>
      <Button size="sm" variant="ghost" className="self-start" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
