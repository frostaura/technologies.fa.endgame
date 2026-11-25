import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Icon } from "./Icon";

interface Props {
  /** What this boundary guards, in plain words: "The verdict", "The org chart". */
  name: string;
  /** `route` draws the whole screen's failure, with its own frame; `panel` keeps the rest of the page. */
  variant?: "route" | "panel";
  /** When this changes, a failed boundary tries again (e.g. the address). */
  resetKey?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A crash is never a blank screen. Each route and each major panel sits inside one of these: when
 * something inside throws, the page records what failed, in plain words, and offers a way on — try
 * again, or back to the org chart — while everything outside the boundary keeps working.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Recorded for whoever opens the console's own log; the page itself says what failed.
    console.error(`[console] ${this.props.name} failed:`, error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashNotice name={this.props.name} error={error} variant={this.props.variant ?? "panel"} onRetry={() => this.setState({ error: null })} />;
  }
}

export function CrashNotice({ name, error, variant, onRetry }: { name: string; error: Error; variant: "route" | "panel"; onRetry: () => void }) {
  const notice = (
    <div role="alert" data-state="crashed" className={cn("flex flex-col gap-3 rounded-md border border-attention-line bg-attention-tint p-5", variant === "route" && "max-w-form")}>
      <div className="flex items-start gap-3">
        <Icon name="verdict" className="mt-0.5 text-attention-text" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold text-attention-text">{name} stopped working.</p>
          <p className="text-sm text-ink">Something on this part of the page went wrong while it was drawn. Nothing you had done was lost, and nothing was changed.</p>
          <details className="text-sm text-ink-body">
            <summary className="min-h-touch cursor-pointer py-2">What failed</summary>
            <p className="break-words font-mono text-xs">{error.message || error.name}</p>
          </details>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
        {/* A plain anchor on purpose: a full load is the surest way back if the app itself is unwell. */}
        <a href="/" className="inline-flex min-h-touch items-center rounded-xs px-3 text-sm font-semibold text-primary-link hover:text-primary-hover">
          Back to the org chart
        </a>
      </div>
    </div>
  );
  if (variant === "panel") return notice;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b bg-surface px-4 py-3 sm:px-8">
        <img src="/brand/endgame-mark.svg" alt="" width={30} height={30} className="size-8" />
        <span className="font-display text-lg font-bold tracking-tight">Endgame</span>
      </header>
      <main id="main" className="flex flex-col gap-4 px-4 py-8 sm:px-8">
        {notice}
      </main>
    </div>
  );
}
