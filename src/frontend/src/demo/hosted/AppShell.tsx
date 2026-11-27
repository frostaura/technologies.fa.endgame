import type { ReactNode } from "react";
import { authRest } from "./gate";
import { KitLink, NotFoundState } from "./kit";
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

/** The kit's `PAGE_FRAME`: the header and the page share one width, so their edges line up. */
const PAGE_FRAME = "mx-auto w-full max-w-page px-4 sm:px-6 lg:px-8";

/**
 * The chrome every app built on the kit's template has — the kit's `AppHeader` and `AppMain`: its name, linking home, and
 * the current user (initial, name) with "Sign out" — or "Sign in" for an anonymous visitor — above the app's own page.
 */
export function HostedAppShell({
  testId,
  page,
  children,
  ...props
}: AppPageProps & { testId: string; page: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-1 flex-col bg-ground font-sans text-ink"
      data-testid={testId}
      data-page={page}
    >
      <header className="border-b bg-surface">
        <div
          className={`${PAGE_FRAME} flex min-h-16 flex-wrap items-center gap-x-6 gap-y-1 py-2`}
        >
          <nav aria-label="Main" className="min-w-0 shrink">
            <KitLink
              plain
              href={props.addressOf("")}
              onFollow={() => props.navigate("")}
              data-testid="nav-home"
              className="flex min-h-11 items-center truncate font-display text-lg font-semibold text-ink hover:text-primary"
            >
              {props.appName}
            </KitLink>
          </nav>
          <div className="ml-auto flex shrink-0 items-center">
            <UserMenu {...props} />
          </div>
        </div>
      </header>
      <main className={`${PAGE_FRAME} flex flex-1 flex-col pb-10 pt-6 sm:pt-8`}>
        {children}
      </main>
    </div>
  );
}

function UserMenu({ me, here, addressOf, navigate }: AppPageProps) {
  if (me === null) {
    const signIn = authRest("sign-in", here);
    return (
      <KitLink
        variant="outline"
        size="sm"
        href={addressOf(signIn)}
        onFollow={() => navigate(signIn)}
      >
        Sign in
      </KitLink>
    );
  }
  const signOut = authRest("sign-out");
  return (
    <div className="flex min-w-0 items-center gap-3 text-sm">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-tint font-semibold text-primary-hover"
      >
        {me.displayName.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <span
        className="max-w-48 truncate font-medium text-ink max-sm:sr-only"
        data-testid="signed-in-as"
      >
        {me.displayName}
      </span>
      <KitLink
        variant="outline"
        size="sm"
        href={addressOf(signOut)}
        onFollow={() => navigate(signOut)}
      >
        Sign out
      </KitLink>
    </div>
  );
}

/** An address inside the app that it has no page for. */
export function AppNotFound({
  addressOf,
  navigate,
  backTo,
}: Pick<AppPageProps, "addressOf" | "navigate"> & { backTo: string }) {
  return (
    <section data-testid="page-not-found" className="flex flex-1 flex-col">
      <NotFoundState
        title="There is nothing at this address"
        action={
          <KitLink href={addressOf("")} onFollow={() => navigate("")}>
            Back to {backTo}
          </KitLink>
        }
      >
        It may have been removed, or the address is wrong.
      </NotFoundState>
    </section>
  );
}

/** The kit's `PageHeader`: a page's one heading and its one-line summary, with its action beside them (under, on a phone). */
export function PageHeading({
  title,
  summary,
  children,
}: {
  title: string;
  summary: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 max-w-prose flex-col gap-1.5">
        <h1 className="break-words font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        <p className="text-ink-muted">{summary}</p>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-3 max-sm:w-full max-sm:[&>*]:flex-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}
