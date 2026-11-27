import * as React from "react";
import { Button } from "./button.js";
import { FailedState } from "./states.js";

/** The first argument of the one report a boundary makes of what it caught (the error and where it was follow). */
export const PAGE_ERROR_LOG = "[endgame] A page failed to render:";

export interface AppErrorBoundaryProps {
  children: React.ReactNode;
  /** When it changes (the address the page is at), a failed page is tried afresh: a link to another page shows that page. */
  resetKey?: unknown;
  /** Where "Back to the start" goes; the app's own start (`./`, resolved against `<base>`) by default. */
  startHref?: string;
}

/**
 * The kit's error boundary (R7-1). A page that throws while it renders — a date no formatter can show, a missing field —
 * is replaced by a plain "Something went wrong on this page" with "Try again" and "Back to the start", while what is
 * around it (the header, the navigation) stays. Without one, React unmounts the whole app: a white page with no way back
 * but reload. The template mounts one at the root and one around the routed page. What it caught is reported once, to
 * the console: the browser side of the kit sends no telemetry of its own (the server records errors without any code).
 */
export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error(PAGE_ERROR_LOG, error, info.componentStack ?? "");
  }

  override componentDidUpdate(previous: AppErrorBoundaryProps): void {
    if (this.state.failed && !Object.is(previous.resetKey, this.props.resetKey)) this.setState({ failed: false });
  }

  private readonly retry = () => this.setState({ failed: false });

  override render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div data-endgame-error="page">
        <FailedState title="Something went wrong on this page" message="It could not be shown. Nothing you saved is lost: try it again, or go back to the start." onRetry={this.retry}>
          <Button asChild size="sm" className="max-sm:w-full">
            <a href={this.props.startHref ?? "./"}>Back to the start</a>
          </Button>
        </FailedState>
      </div>
    );
  }
}

/**
 * Options for `createRoot(element, rootOptions)`: an error the kit's boundary caught is reported by the boundary alone,
 * once; any other is logged as React would.
 */
export const rootOptions = {
  onCaughtError(error: unknown, info: { componentStack?: string; errorBoundary?: React.Component<unknown> | null }): void {
    if (info.errorBoundary instanceof AppErrorBoundary) return;
    console.error(error);
  },
};
