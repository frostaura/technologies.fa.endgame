import type { ReactNode } from "react";
import { authRest } from "./gate";
import { cn } from "@/lib/utils";
import { AccountMenu, KitLink, NotFoundState } from "./kit";
import { AVATAR, HEADER_ROW, HOME_LINK, initial, MENU_ROW, NAV, navItemClass, PAGE_FRAME } from "./kitParts";
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

/** A place in the app's navigation: its words and the path inside the app it opens. */
export interface Place {
  label: string;
  rest: string;
}

/**
 * The chrome every app built on the kit's template has — the kit's `AppHeader` and `AppMain`: its name, linking home, the
 * places to go (when it has more than one), and the current user with "Sign out" — or "Sign in" for an anonymous visitor —
 * above the app's own page. On a phone the header is two compact rows: the name and a 44px avatar button that opens the
 * person's name, e-mail and "Sign out"; then the places, on one line that scrolls sideways.
 */
export function HostedAppShell({
  testId,
  page,
  places,
  children,
  ...props
}: AppPageProps & { testId: string; page: string; places?: Place[]; children: ReactNode }) {
  const here = props.rest.replace(/^\/+|\/+$/g, "").split("?")[0] ?? "";
  return (
    <div
      className="flex flex-1 flex-col bg-ground font-sans text-ink"
      data-testid={testId}
      data-page={page}
    >
      <header className="sticky top-0 z-20 border-b bg-surface" data-slot="app-header">
        <div className={cn(PAGE_FRAME, HEADER_ROW)}>
          <KitLink
            plain
            href={props.addressOf("")}
            onFollow={() => props.navigate("")}
            data-testid="nav-home"
            className={HOME_LINK}
          >
            <span className="truncate">{props.appName}</span>
          </KitLink>
          {places && places.length > 1 ? (
            <nav aria-label="Main" className={NAV}>
              {places.map((place) => (
                <KitLink
                  key={place.rest}
                  plain
                  href={props.addressOf(place.rest)}
                  onFollow={() => props.navigate(place.rest)}
                  aria-current={here === place.rest ? "page" : undefined}
                  className={navItemClass(here === place.rest)}
                >
                  {place.label}
                </KitLink>
              ))}
            </nav>
          ) : null}
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
  const name = me.displayName || me.id;
  return (
    <div className="relative flex min-w-0 items-center gap-3 text-sm">
      <span aria-hidden className={cn(AVATAR, "max-sm:hidden")}>
        {initial(name)}
      </span>
      <span
        className="max-w-48 truncate font-medium text-ink max-sm:sr-only"
        data-testid="signed-in-as"
      >
        {name}
      </span>
      <KitLink
        variant="outline"
        size="sm"
        className="max-sm:hidden"
        href={addressOf(signOut)}
        onFollow={() => navigate(signOut)}
      >
        Sign out
      </KitLink>
      <AccountMenu
        name={name}
        email={me.id}
        signOut={
          <KitLink plain className={MENU_ROW} href={addressOf(signOut)} onFollow={() => navigate(signOut)}>
            Sign out
          </KitLink>
        }
      />
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
