import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { useViewport } from "@/lib/useViewport";
import { Link } from "@/components/Link";
import { Icon } from "@/components/Icon";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useFitsScreen } from "@/components/ui/page";
import { crumbShort, normaliseCrumbs } from "./crumbs";
import { highestGrant } from "@/lib/roles";
import { useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { useGetMeQuery } from "@/store/api";
import { GodModeBand } from "./GodModeBand";
import { NotificationsBell } from "./NotificationsBell";
import { OrganisationSwitcher } from "@/features/account/OrganisationSwitcher";
import { PhoneHeader, PhoneNav } from "./PhoneShell";
import { CreditsPill, ModeToggle, SignOut } from "./shellControls";
import { Talk } from "./talk";
import { ShellTalkContext, takeOpenTalkOnArrival } from "./talkContext";

export interface Crumb {
  label: string;
  /** A short name for the header and the trail, when the label is a long title (a run named for its whole idea). */
  short?: string;
  href?: string;
  /** Instead of a link: select this level in place (the home screen's breadcrumb). */
  onSelect?: () => void;
}

/** The conversation a screen holds beside it on a desktop, and in a sheet on a phone or a tablet. */
export interface ShellConversation {
  /** What the button that opens it says: "Talk to {the level}". */
  label: string;
  content: ReactNode;
}

/**
 * The console frame, as drawn: the mark, where you are, the mode toggle and the balance. The page
 * below is full width; each screen decides its own columns.
 *
 * Three layouts, by the width of the console's own viewport (`useViewport`):
 * - desktop: the header bar, the page, and beside it the side panel — or the conversation (`talk`);
 * - tablet: the same header; the side panel under the page; the conversation in a side sheet, opened
 *   from a button at the foot of the screen;
 * - phone: a one-row header (where you are, in full, with the way up), the bottom bar (Home, Talk,
 *   Alerts, Credits, More), and the conversation in a full-screen sheet. The mode, the organisation
 *   and signing out are under More.
 */
export function AppShell({ crumbs, aside, talk, children }: { crumbs: Crumb[]; aside?: ReactNode; talk?: ShellConversation; children: ReactNode }) {
  const { data: me } = useGetMeQuery(undefined);
  // The balance and the bell are the organisation's being shown: in God mode, the one entered.
  const active = useActiveOrganisation();
  const org = active.organisation;
  // Someone whose roles all sit below the organisation reads the balance at their own level, as the
  // Credits page does: it is still the organisation's balance, and the read is one they may make.
  const creditsScope = org && !active.entered && active.role === null ? (highestGrant(me?.memberships ?? [], org.slug)?.scope ?? org.slug) : org?.slug;
  const viewport = useViewport();
  const phone = viewport === "phone";
  // Only a phone moves the conversation into a sheet; a tablet keeps it in the page, as a desktop does.
  const compact = phone;
  const tablet = viewport === "tablet";

  // The conversation's sheet, and the pages' conversations that draw into it.
  // "Talk" pressed on a page with none: the org chart opens its conversation as it arrives, once it has one.
  const [arrivedForTalk] = useState(takeOpenTalkOnArrival);
  const [talkChosen, setTalkOpen] = useState<boolean | null>(null);
  const [talkTarget, setTalkTarget] = useState<HTMLElement | null>(null);
  const [registered, setRegistered] = useState<string[]>([]);
  const register = useCallback((label: string) => {
    setRegistered((was) => [...was, label]);
    return () =>
      setRegistered((was) => {
        const i = was.indexOf(label);
        return i < 0 ? was : [...was.slice(0, i), ...was.slice(i + 1)];
      });
  }, []);
  const openTalk = useCallback(() => setTalkOpen(true), []);
  const closeTalk = useCallback(() => setTalkOpen(false), []);
  const talkLabel = talk?.label ?? registered[0] ?? null;
  // Something in the conversation asked to be shown (the academy pointing into it): open its sheet.
  useEffect(() => {
    if (!talkTarget) return;
    const reveal = () => setTalkOpen(true);
    talkTarget.addEventListener("endgame:reveal", reveal);
    return () => talkTarget.removeEventListener("endgame:reveal", reveal);
  }, [talkTarget]);
  const talkOpen = talkChosen ?? (arrivedForTalk && compact && talkLabel !== null);
  const shell = useMemo(() => ({ compact, announce: tablet, target: talkTarget, open: openTalk, register }), [compact, tablet, talkTarget, openTalk, register]);

  const side = compact ? aside : aside ?? (talk && (tablet ? <Talk label={talk.label}>{talk.content}</Talk> : talk.content));
  // Every page's trail starts at the organisation and never names the same place twice in a row.
  const trail = normaliseCrumbs(crumbs, org ? { label: org.name, href: active.entered ? paths.homeOf(org.slug) : paths.home() } : null);

  return (
    <ShellTalkContext.Provider value={shell}>
      {/* A phone on its side (`rail:`): the bar becomes a rail at the left, and the page and its side panel sit side by side. */}
      <div data-shell={viewport} className={cn("flex min-h-dvh flex-col", phone && "pb-nav-safe rail:pb-0 rail:pl-rail")}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xs focus:bg-surface focus:px-4 focus:py-2">
          Skip to the content
        </a>
        {me?.isOperator && <GodModeBand />}
        {phone ? (
          <PhoneHeader crumbs={trail} signedIn={!!me} />
        ) : (
          <header className="border-b bg-surface">
            {/*
              Tablet and narrow desktop: the bar — the mark, then every control at the right — with where
              you are on a full-width row of its own beneath. Wide desktop (xl): one row, where you are
              between the mark and the controls. Every control is one height (44px). Where you are is always
              one line; a step is cut short only when the row is too narrow, the middle steps first. Below
              xl, Sign out and System are icons, so the bar never wraps.
            */}
            <div className="mx-auto flex w-full max-w-frame flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 sm:px-8 xl:gap-x-3">
              <Link href={paths.home()} aria-label="Endgame home" className="mr-1 flex min-h-touch shrink-0 items-center gap-2.5 rounded-xs text-ink">
                <img src="/brand/endgame-mark.svg" alt="" width={30} height={30} className="size-8" />
                <span className={cn("font-display text-lg font-bold tracking-tight", trail.length > 0 && "hidden xl:inline")}>Endgame</span>
              </Link>
              {trail.length > 0 && (
                <div className="flex min-w-0 flex-1 sm:order-last sm:basis-full xl:order-none xl:basis-0">
                  <Breadcrumb crumbs={trail} />
                </div>
              )}
              <div className="order-last flex w-full items-center justify-between gap-2 sm:order-none sm:ml-auto sm:w-auto sm:justify-end xl:gap-3">
                <ModeToggle />
                {me && <OrganisationSwitcher compact />}
                {creditsScope && <CreditsPill scope={creditsScope} />}
              </div>
              {tablet && talkLabel && <TalkHere label={talkLabel} />}
              {org && <NotificationsBell organisation={org.slug} />}
              {me && (
                <Link href={paths.account()} aria-label="Your account" title="Your account" className="flex size-11 shrink-0 items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink">
                  <Icon name="employee" className="size-5" />
                </Link>
              )}
              {me && <SignOut compact />}
            </div>
          </header>
        )}
        {/* The device's safe area (a notch, in landscape) is kept clear of the page, outside its own gutter. */}
        <div className="mx-auto flex w-full max-w-frame flex-1 flex-col pl-safe-l pr-safe-r lg:flex-row rail:flex-row rail:pl-0">
          <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 outline-none max-sm:gap-5 max-sm:py-5 sm:px-8 sm:py-8 lg:py-10 rail:gap-4 rail:px-5 rail:py-4">
            {children}
          </main>
          {aside ? (
            <SidePanel>{aside}</SidePanel>
          ) : (
            side && (
              // The conversation: a panel the height of the page beside it on a desktop; on a tablet, under the page.
              <aside className="flex min-w-0 flex-col gap-7 border-t bg-surface px-4 py-8 sm:px-8 lg:w-dock lg:shrink-0 lg:border-l lg:border-t-0 lg:py-10">{side}</aside>
            )
          )}
        </div>
        {compact && talk && (
          <Talk label={talk.label} launcher={false}>
            {talk.content}
          </Talk>
        )}
        {compact && (
          <Sheet open={talkOpen} onClose={closeTalk} title={talkLabel ?? "Conversation"} side="full" keepMounted hideTitle fill testId="talk-sheet">
            <div ref={setTalkTarget} data-talk-target="" className="flex h-full min-h-0 flex-col" />
          </Sheet>
        )}
        {phone && <PhoneNav creditsScope={creditsScope ?? null} talkLabel={talkLabel} talkOpen={talkOpen} onTalk={openTalk} />}
      </div>
    </ShellTalkContext.Provider>
  );
}

/**
 * The side panel: a column of cards (`SideCard`), each ending with its content, beside the page from
 * `lg` up and wider from `3xl`. While the column fits the screen it stays in view as the page scrolls;
 * a column taller than the screen scrolls with the page, so nothing in it is ever out of reach. On a
 * tablet the cards sit under the page, two across.
 */
function SidePanel({ children }: { children: ReactNode }) {
  const { ref, fits } = useFitsScreen<HTMLDivElement>();
  return (
    <aside aria-label="Beside this page" className="min-w-0 px-4 pb-8 sm:px-8 lg:w-aside lg:shrink-0 lg:py-10 lg:pl-0 3xl:w-aside-wide rail:w-aside rail:shrink-0 rail:py-4 rail:pl-0 rail:pr-5">
      <div ref={ref} data-side-panel="" className={cn(
          "flex flex-col gap-5 md:max-lg:grid md:max-lg:grid-cols-2 md:max-lg:items-start rail:!flex rail:gap-4",
          // Every block a page puts here is drawn as a card that ends with its content.
          "[&>*]:min-w-0 [&>*]:rounded-md [&>*]:border [&>*]:bg-surface [&>*]:p-5 [&>*]:shadow-card max-sm:[&>*]:p-4",
          fits && "lg:sticky lg:top-6",
        )}>
        {children}
      </div>
    </aside>
  );
}


/** A tablet's "Talk": the conversation is on the page, further down; this brings it into view, ready to type. */
function TalkHere({ label }: { label: string }) {
  const go = () => {
    const anchor = document.querySelector<HTMLElement>("[data-talk-anchor] section[aria-label='Conversation']");
    if (!anchor) return;
    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
    anchor.querySelector<HTMLInputElement>("form input")?.focus({ preventScroll: true });
  };
  return (
    // An icon, as the bell beside it is: the bar has no room for another word on a tablet.
    <button type="button" onClick={go} aria-label={label} title={label} className="flex min-h-touch min-w-touch items-center justify-center rounded-xs text-primary-link hover:bg-ground">
      <MessageCircle aria-hidden className="size-5" />
    </button>
  );
}

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  // On a phone only the last two steps show, after an ellipsis, so the header stays two rows.
  const firstShownOnPhone = Math.max(0, crumbs.length - 2);
  return (
    <nav aria-label="Where you are" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-2 text-ink-muted">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          const middle = i > 0 && !last;
          // A step is a name, not a paragraph: a run titled with its whole idea is cut to a line.
          const label = crumbShort(crumb, 48);
          return (
            <li
              key={`${i}-${crumb.label}`}
              title={label !== crumb.label || middle ? crumb.label : undefined}
              className={cn(
                "min-w-0 items-center gap-2",
                i < firstShownOnPhone ? "hidden sm:flex" : "flex",
                // Off a phone the row is one line: the first and last steps keep their words, and the
                // steps between take what room is left, each up to its own width, cut short only when
                // there is not enough.
                i === 0 && !last && "sm:shrink-0",
                middle && "sm:max-w-fit sm:shrink sm:grow sm:basis-0",
                // The steps hidden on a phone leave an ellipsis, drawn by CSS with empty alternative text so it is never read out.
                i === firstShownOnPhone && i > 0 && "before:shrink-0 before:[content:'…_/'_/_''] sm:before:[content:none]",
              )}
            >
              {i > 0 && <span aria-hidden className={cn("shrink-0 text-ink-muted", i === firstShownOnPhone && "hidden sm:inline")}>/</span>}
              {crumb.onSelect && !last ? (
                <button type="button" onClick={crumb.onSelect} className="min-h-touch min-w-0 truncate rounded-xs text-primary-link hover:text-primary-hover">
                  {label}
                </button>
              ) : crumb.href && !last ? (
                <Link href={crumb.href} className="min-w-0 truncate rounded-xs text-primary-link hover:text-primary-hover touch:min-h-touch touch:leading-touch">
                  {label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("min-w-0 truncate", last && "font-medium text-ink")}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
