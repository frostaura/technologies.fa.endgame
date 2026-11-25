import type { ReactNode } from "react";
import { authRest } from "./gate";
import { EmptyState, KitLink } from "./kit";
import type { Person } from "./readingList";

/** What every hosted app's page is given: who is signed in, where it is, and how to move. */
export interface AppPageProps {
  appId: string;
  appName: string;
  /** Who the Edge says is signed in; null for an anonymous visitor of a public app. */
  me: Person | null;
  /** The path inside the app, e.g. "" or "books/new". */
  rest: string;
  /** The current address's path and query on its host, for the sign-in page's `returnTo`. */
  here: string;
  /** The full address of a path inside the app, for real `href`s. */
  addressOf(rest: string): string;
  navigate(rest: string): void;
}

/**
 * The chrome every app built on the kit's template has: its name, linking home, and the current
 * user with "Sign out" — or "Sign in" for an anonymous visitor — above the app's own page.
 */
export function HostedAppShell({ testId, page, children, ...props }: AppPageProps & { testId: string; page: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-ground font-sans text-ink" data-testid={testId} data-page={page}>
      <header className="border-b bg-surface">
        <div className="mx-auto flex w-full max-w-page items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <nav aria-label="Main">
            <KitLink plain href={props.addressOf("")} onFollow={() => props.navigate("")} data-testid="nav-home" className="font-display text-lg font-semibold text-ink">
              {props.appName}
            </KitLink>
          </nav>
          <UserMenu {...props} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-page flex-1 px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}

function UserMenu({ me, here, addressOf, navigate }: AppPageProps) {
  if (me === null) {
    const signIn = authRest("sign-in", here);
    return (
      <KitLink variant="outline" size="sm" href={addressOf(signIn)} onFollow={() => navigate(signIn)}>
        Sign in
      </KitLink>
    );
  }
  const signOut = authRest("sign-out");
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-ink-muted" data-testid="signed-in-as">
        {me.displayName}
      </span>
      <KitLink variant="ghost" size="sm" href={addressOf(signOut)} onFollow={() => navigate(signOut)}>
        Sign out
      </KitLink>
    </div>
  );
}

/** An address inside the app that it has no page for. */
export function AppNotFound({ addressOf, navigate, backTo }: Pick<AppPageProps, "addressOf" | "navigate"> & { backTo: string }) {
  return (
    <section data-testid="page-not-found">
      <EmptyState title="There is nothing at this address">
        <KitLink plain href={addressOf("")} onFollow={() => navigate("")} className="font-semibold text-primary hover:text-primary-hover">
          Back to {backTo}
        </KitLink>
      </EmptyState>
    </section>
  );
}

/** A page's heading and its one-line summary, with an optional action beside them. */
export function PageHeading({ title, summary, children }: { title: string; summary: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-ink-muted">{summary}</p>
      </div>
      {children}
    </div>
  );
}
