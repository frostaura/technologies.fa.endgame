import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { useMinWidth, useViewport, useWideHeader } from "@/lib/useViewport";
import { breakpoints } from "@/lib/tokens";
import { Link } from "@/components/Link";
import { Icon } from "@/components/Icon";
import { navigate, paths } from "@/lib/router";
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
import { AccountMenu, CreditsPill, ModeToggle, SignOut, SystemLink } from "./shellControls";
import { TalkInSheet } from "./talk";
import { DockLayoutContext, useDockState } from "../conversation/dockLayout";
import { askToOpenTalkOnArrival, ShellTalkContext, takeOpenTalkOnArrival } from "./talkContext";

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
 * Three layouts, by the width of the console's own viewport (`useViewport`), and one conversation
 * placement each (ARCH-012) for the pages that have one (`talk`):
 * - desktop: the header bar, the page column (capped and centred, its side cards beside or under the
 *   page), and the conversation docked at the window's right edge, full height under the header;
 * - tablet: the same header, the side panel under the page, and the conversation in a drawer from
 *   the right, opened from the header's icon;
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
  const tablet = viewport === "tablet";
  // A phone and a tablet draw the conversation in the shell's sheet; a desktop docks it.
  const compact = phone || tablet;
  const wideHeader = useWideHeader();
  // From xl the trail sits in the header's row; below it, on a row of its own. One trail either way.
  const trailInRow = useMinWidth(breakpoints.xl);

  // The conversation's sheet. "Talk" pressed on a page with none: home opens its conversation as it arrives.
  const [arrivedForTalk] = useState(takeOpenTalkOnArrival);
  const [talkChosen, setTalkOpen] = useState<boolean | null>(null);
  const [talkTarget, setTalkTarget] = useState<HTMLElement | null>(null);
  const openTalk = useCallback(() => setTalkOpen(true), []);
  const closeTalk = useCallback(() => setTalkOpen(false), []);
  const talkLabel = talk?.label ?? null;
  // Something in the conversation asked to be shown (the academy pointing into it): open its sheet.
  useEffect(() => {
    if (!talkTarget) return;
    const reveal = () => setTalkOpen(true);
    talkTarget.addEventListener("endgame:reveal", reveal);
    return () => talkTarget.removeEventListener("endgame:reveal", reveal);
  }, [talkTarget]);
  const talkOpen = talkChosen ?? (arrivedForTalk && compact && talkLabel !== null);
  const shell = useMemo(() => ({ compact, target: talkTarget, label: talkLabel, open: openTalk }), [compact, talkTarget, talkLabel, openTalk]);

  // A desktop docks the conversation at the window's right edge, full height under a header that stays put (ARCH-012).
  // A page that also has side cards keeps them in the page column: beside the page from 3xl, under it below that.
  const docked = viewport === "desktop" && !!talk;
  const dock = useDockState(me?.user.id ?? null);
  const chrome = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chrome.current;
    const root = document.documentElement;
    if (!docked || !el) return;
    const measure = () => root.style.setProperty("--shell-chrome", `${el.getBoundingClientRect().height}px`);
    measure();
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    sizes?.observe(el);
    return () => {
      sizes?.disconnect();
      root.style.removeProperty("--shell-chrome");
    };
  }, [docked]);

  // Every page's trail starts at the organisation and never names the same place twice in a row.
  const home = org && active.entered ? paths.homeOf(org.slug) : paths.home();
  const trail = normaliseCrumbs(crumbs, org ? { label: org.name, href: home } : null);
  // Beside the docked pane the page's side cards sit beside the page only from 3xl; collapsed to its rail, from lg.
  const besideFrom = !docked || dock.collapsed ? "lg" : "3xl";

  return (
    <ShellTalkContext.Provider value={shell}>
      {/* A phone on its side (`rail:`): the bar becomes a rail at the left, and the page is one full-width column beside it. */}
      <div data-shell={viewport} className={cn("flex min-h-dvh flex-col", phone && "pb-nav-safe rail:pb-0 rail:pl-rail")}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xs focus:bg-surface focus:px-4 focus:py-2">
          Skip to the content
        </a>
        <div ref={chrome} className={docked ? "sticky top-0 z-30" : "contents"}>
        {me?.isOperator && <GodModeBand />}
        {phone ? (
          <PhoneHeader crumbs={trail} signedIn={!!me} />
        ) : (
          <header className="border-b bg-surface">
            {/*
              Tablet and desktop: one bar that never wraps — the mark, where you are (on its own row below xl),
              and the controls, every one 44px. From hd (1,100) the mode switch and Sign out sit in the bar;
              below it they are in the account menu. The organisation switcher is always in the bar, and the
              set of icons is the same on every page. Beside the docked pane the bar (and the trail's row under
              it) runs the window's whole width, so its controls end over the pane's edge.
            */}
            <div className={cn("mx-auto flex w-full flex-nowrap items-center gap-2 px-4 py-3 sm:px-8 xl:gap-3", !docked && "max-w-frame")}>
              <Link href={paths.home()} aria-label="Endgame home" className="mr-1 flex min-h-touch min-w-touch shrink-0 items-center gap-2.5 rounded-xs text-ink">
                <img src="/brand/endgame-mark.svg" alt="" width={30} height={30} className="size-8" />
                <span className={cn("font-display text-lg font-bold tracking-tight", trail.length > 0 && "hidden xl:inline")}>Endgame</span>
              </Link>
              {trail.length > 0 && trailInRow && (
                <div className="flex min-w-0 flex-1">
                  <Breadcrumb crumbs={trail} />
                </div>
              )}
              <div className="ml-auto flex min-w-0 shrink items-center justify-end gap-2 xl:gap-3">
                {wideHeader && <ModeToggle />}
                {me && <OrganisationSwitcher compact className="min-w-0 max-w-56 shrink" />}
                {creditsScope && <CreditsPill scope={creditsScope} />}
                {tablet && <TalkHere label={talkLabel} open={talkOpen} onOpen={openTalk} home={home} />}
                {org && <NotificationsBell organisation={org.slug} />}
                {wideHeader && <SystemLink />}
                {me &&
                  (wideHeader ? (
                    <>
                      <Link href={paths.account()} aria-label="Your account" title="Your account" className="flex size-11 shrink-0 items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink">
                        <Icon name="employee" className="size-5" />
                      </Link>
                      <SignOut compact />
                    </>
                  ) : (
                    <AccountMenu />
                  ))}
              </div>
            </div>
            {trail.length > 0 && !trailInRow && (
              <div className={cn("mx-auto flex w-full px-4 pb-2.5 sm:px-8", !docked && "max-w-frame")}>
                <Breadcrumb crumbs={trail} />
              </div>
            )}
          </header>
        )}
        </div>
        {/* The device's safe area (a notch, in landscape) is kept clear of the page, outside its own gutter. */}
        <div className="flex w-full flex-1 flex-col pl-safe-l pr-safe-r lg:flex-row rail:pl-0">
          {/*
            The page column, capped and centred in the room the pane leaves; the pane itself is docked to the window's
            right edge at every width. Inside the page column, a page's side cards sit beside the page from 3xl (1,600 px:
            the page keeps at least 640 px beside a wide pane and the cards) and under it below that; with the pane
            collapsed they go beside the page from lg, as on any other page.
          */}
          <div data-page-frame="" className={cn("flex min-w-0 flex-1 flex-col", docked && dock.full && "hidden")}>
            <div data-page-column="" className={cn("mx-auto flex w-full min-w-0 max-w-frame flex-1 flex-col", besideFrom === "lg" ? "lg:flex-row" : "3xl:flex-row")}>
              <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 outline-none max-sm:gap-5 max-sm:py-5 sm:px-8 sm:py-8 lg:py-10 rail:gap-4 rail:px-5 rail:py-4">
                {children}
              </main>
              {aside && (
                <SidePanel beside={besideFrom} below={docked && !dock.collapsed}>
                  {aside}
                </SidePanel>
              )}
            </div>
          </div>
          {docked && talk && (
            <DockLayoutContext.Provider value={dock}>
              <aside
                aria-label="Conversation pane"
                data-dock={dock.full ? "full" : dock.collapsed ? "collapsed" : dock.wide || dock.overlay ? "wide" : "narrow"}
                data-overlay={dock.overlay || undefined}
                className={cn(
                  "sticky top-chrome z-20 flex h-dock shrink-0 flex-col self-start border-l bg-surface",
                  dock.full ? "flex-1" : dock.collapsed ? "w-dock-rail" : dock.wide ? "w-dock-wide" : "w-dock",
                )}
              >
                {/* Wider on a window under 1,500 px: a drawer over the page's edge, so the page keeps its width. */}
                {dock.overlay ? <div className="absolute inset-y-0 right-0 flex w-dock-wide flex-col border-l bg-surface shadow-raised">{talk.content}</div> : talk.content}
              </aside>
            </DockLayoutContext.Provider>
          )}
        </div>
        {compact && talk && <TalkInSheet>{talk.content}</TalkInSheet>}
        {compact && (
          // A phone: the whole screen. A tablet: a drawer from the right, the page still in sight behind it.
          <Sheet open={talkOpen} onClose={closeTalk} title={talkLabel ?? "Conversation"} side={phone ? "full" : "side"} keepMounted hideTitle fill testId="talk-sheet">
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
function SidePanel({ children, beside = "lg", below = false }: { children: ReactNode; beside?: "lg" | "3xl"; below?: boolean }) {
  const { ref, fits } = useFitsScreen<HTMLDivElement>();
  return (
    <aside
      aria-label="Beside this page"
      className={cn(
        "min-w-0 px-4 pb-8 sm:px-8 rail:px-5",
        beside === "lg" ? "lg:w-aside lg:shrink-0 lg:py-10 lg:pl-0 3xl:w-aside-wide" : "3xl:w-aside-wide 3xl:shrink-0 3xl:py-10 3xl:pl-0",
      )}
    >
      <div ref={ref} data-side-panel="" className={cn(
          // A tablet, and a phone on its side (one full-width column beside the rail): the cards under the page, two across.
          "flex flex-col gap-5 md:max-lg:grid md:max-lg:grid-cols-2 md:max-lg:items-start rail:gap-4",
          // Under the page beside the docked conversation (lg to 3xl): two across, as on a tablet.
          beside === "3xl" && "lg:max-3xl:grid lg:max-3xl:grid-cols-2 lg:max-3xl:items-start",
          // Every block a page puts here is drawn as a card that ends with its content.
          "[&>*]:min-w-0 [&>*]:rounded-md [&>*]:border [&>*]:bg-surface [&>*]:p-5 [&>*]:shadow-card max-sm:[&>*]:p-4",
          // A fold is its own card: no padding around it. A lone card under the page takes the whole row.
          "[&>[data-fold]]:!p-0 [&>*:only-child]:col-span-full",
          // A fieldset's legend would sit on the card's edge: it is the card's title instead.
          "[&>fieldset>legend]:float-left [&>fieldset>legend]:mb-3 [&>fieldset>legend]:w-full [&>fieldset>legend+*]:clear-both",
          fits && (below ? "3xl:sticky 3xl:top-chrome" : beside === "lg" ? "lg:sticky lg:top-6" : "3xl:sticky 3xl:top-6"),
        )}>
        {children}
      </div>
    </aside>
  );
}


/**
 * A tablet's "Talk": opens the conversation's drawer from the right, its message box ready. On a page with no
 * conversation it goes to the org chart and opens its conversation there, as the phone's bar does — so the
 * header's icons are the same on every page.
 */
function TalkHere({ label, open, onOpen, home }: { label: string | null; open: boolean; onOpen: () => void; home: string }) {
  const go = () => {
    if (label) {
      onOpen();
      return;
    }
    askToOpenTalkOnArrival();
    navigate(home);
  };
  const name = label ?? "Talk: open the conversation on the org chart";
  return (
    // An icon, as the bell beside it is: the bar has no room for another word on a tablet.
    <button
      type="button"
      onClick={go}
      aria-label={name}
      title={name}
      aria-haspopup={label ? "dialog" : undefined}
      aria-expanded={label ? open : undefined}
      className="flex size-11 shrink-0 items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink"
    >
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
