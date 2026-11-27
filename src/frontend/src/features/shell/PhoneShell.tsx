import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Ellipsis, House, MessageCircle } from "lucide-react";
import { BottomNav, type NavItem } from "@/components/BottomNav";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Sheet } from "@/components/Sheet";
import type { IconName } from "@/components/iconNames";
import { formatNumber } from "@/lib/format";
import { effectiveRole, highestGrant, roleRank } from "@/lib/roles";
import { navigate, paths, useLocation } from "@/lib/router";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useAppSelector } from "@/store";
import { useGetCreditsQuery, useGetMeQuery } from "@/store/api";
import { OrganisationSwitcher } from "@/features/account/OrganisationSwitcher";
import { BellIcon } from "../notifications/NotificationFeed";
import { useUnread } from "../notifications/useUnread";
import type { Crumb } from "./AppShell";
import { crumbShort } from "./crumbs";
import { ModeToggle, SignOut } from "./shellControls";
import { askToOpenTalkOnArrival } from "./talkContext";

/**
 * The phone's header: one row. The way up a level (or the mark, at the top), where you are — the
 * place's name in full, the levels above it in small type over it — and your account. Tapping where
 * you are lists every level above, each one tap away.
 */
export function PhoneHeader({ crumbs, signedIn }: { crumbs: Crumb[]; signedIn: boolean }) {
  const [trail, setTrail] = useState(false);
  const tucked = useTuckOnScroll();
  const titleAway = useTitleScrolledAway();
  const here = crumbs[crumbs.length - 1];
  const above = crumbs.slice(0, -1);
  const parent = above[above.length - 1];
  const up = [...above].reverse().find((c) => c.href || c.onSelect);
  // One name, never the page's own title twice: the parent while the page's title is in view, then — once the
  // title has scrolled under the header — this place's short name.
  const shown = titleAway ? (here ? crumbShort(here) : null) : parent ? crumbShort(parent) : null;
  const titleBody = here && (
    <span data-phone-title={titleAway ? "here" : "parent"} className={cn("max-w-full truncate font-display text-base font-semibold leading-snug", titleAway ? "text-ink" : "text-ink-body")}>
      {shown ?? "Endgame"}
    </span>
  );
  return (
    // Sticky, and tucked away while the page is read downward: it comes back as soon as the person scrolls up.
    <header
      data-tucked={tucked || undefined}
      className={cn("sticky top-0 z-30 border-b bg-surface pl-safe-l pr-safe-r pt-safe-t transition-transform duration-200 motion-reduce:transition-none", tucked && "-translate-y-full")}
    >
      <div className="flex min-h-bar items-center gap-1 px-1.5 py-1 short:min-h-touch short:py-0">
        {up ? (
          <Step crumb={up} className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-xs text-ink hover:bg-ground" label={`Up to ${up.label}`}>
            <ChevronLeft aria-hidden className="size-6" />
          </Step>
        ) : (
          <Link href={paths.home()} aria-label="Endgame home" className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-xs">
            <img src="/brand/endgame-mark.svg" alt="" width={28} height={28} className="size-7" />
          </Link>
        )}
        {!here ? (
          <span className="flex-1 px-1 font-display text-lg font-bold tracking-tight">Endgame</span>
        ) : above.length > 0 ? (
          <button
            type="button"
            onClick={() => setTrail(true)}
            aria-haspopup="dialog"
            aria-label={`Where you are: ${crumbs.map((c) => c.label).join(", then ")}`}
            className="flex min-h-touch min-w-0 flex-1 flex-col items-start justify-center rounded-xs px-1 text-left"
          >
            {titleBody}
          </button>
        ) : (
          <div aria-current="page" className="flex min-h-touch min-w-0 flex-1 flex-col items-start justify-center px-1">
            {titleBody}
          </div>
        )}
        {signedIn && (
          <Link href={paths.account()} aria-label="Your account" className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-xs text-ink-muted hover:text-ink">
            <Icon name="employee" className="size-5" />
          </Link>
        )}
      </div>
      <Sheet open={trail} onClose={() => setTrail(false)} title="Where you are">
        <nav aria-label="Where you are">
          <ol className="flex flex-col">
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1;
              const row = "flex min-h-touch w-full items-center gap-3 rounded-xs py-2 text-left";
              return (
                <li key={`${i}-${crumb.label}`} className="border-b last:border-b-0">
                  {!last && (crumb.href || crumb.onSelect) ? (
                    <Step crumb={crumb} className={cn(row, "font-medium text-primary-link")} onDone={() => setTrail(false)}>
                      <span className="min-w-0 flex-1 break-words">{crumb.label}</span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
                    </Step>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className={cn(row, last ? "font-semibold text-ink" : "text-ink")}>
                      <span className="min-w-0 flex-1 break-words">{crumb.label}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </Sheet>
    </header>
  );
}

/**
 * Whether the header is tucked away: the page has been scrolled down past the header's own height and
 * the last move was down. Any move up, the top of the page, or a sheet opening brings it back.
 */
function useTuckOnScroll() {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 6) return;
      setTucked(y > last && y > 80 && !document.documentElement.hasAttribute("data-sheet-open"));
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return tucked;
}

/**
 * Whether the page's own title (its h1) has scrolled up under the header. A page with no title counts as
 * scrolled, so the header names the place.
 */
function useTitleScrolledAway() {
  const { pathname, search } = useLocation();
  const [away, setAway] = useState(false);
  useEffect(() => {
    let watch: IntersectionObserver | null = null;
    let seen: Element | null = null;
    const attach = () => {
      const h1 = document.querySelector("main h1");
      if (h1 === seen) return;
      seen = h1;
      watch?.disconnect();
      if (!h1) return setAway(true);
      if (typeof IntersectionObserver === "undefined") return setAway(false);
      watch = new IntersectionObserver(([e]) => setAway(!!e && !e.isIntersecting && e.boundingClientRect.top < 64), { rootMargin: "-64px 0px 0px 0px" });
      watch.observe(h1);
    };
    attach();
    const appear = typeof MutationObserver === "undefined" ? null : new MutationObserver(attach);
    const main = document.querySelector("main");
    if (main) appear?.observe(main, { childList: true, subtree: true });
    return () => {
      watch?.disconnect();
      appear?.disconnect();
    };
  }, [pathname, search]);
  return away;
}

/** A level of where you are: a link to it, or — on the org chart — selecting it in place. */
function Step({ crumb, className, label, onDone, children }: { crumb: Crumb; className: string; label?: string; onDone?: () => void; children: ReactNode }) {
  if (crumb.onSelect)
    return (
      <button
        type="button"
        aria-label={label}
        className={className}
        onClick={() => {
          crumb.onSelect?.();
          onDone?.();
        }}
      >
        {children}
      </button>
    );
  return (
    <Link href={crumb.href ?? paths.home()} aria-label={label} className={className} onClick={onDone}>
      {children}
    </Link>
  );
}

/**
 * The phone's bottom bar: the org chart, the conversation, what is new, the balance and everything
 * else. "Talk" opens this page's conversation; a page without one goes to the org chart and opens its.
 */
export function PhoneNav({ creditsScope, talkLabel, talkOpen, onTalk }: { creditsScope: string | null; talkLabel: string | null; talkOpen: boolean; onTalk: () => void }) {
  const { pathname } = useLocation();
  const active = useActiveOrganisation();
  const org = active.organisation;
  const [more, setMore] = useState(false);
  const unread = useUnread(org?.slug ?? null);
  const credits = useGetCreditsQuery(creditsScope ?? "", { skip: !creditsScope, pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const home = org && active.entered ? paths.homeOf(org.slug) : paths.home();
  const balance = credits.data?.balance;
  const items: NavItem[] = [
    { key: "home", label: "Home", icon: <House className="size-5" />, href: home, current: pathname === "/" && !talkOpen && !more },
    {
      key: "talk",
      label: "Talk",
      icon: <MessageCircle className="size-5" />,
      name: talkLabel ?? "Talk: open the conversation on the org chart",
      current: talkOpen,
      onClick: () => {
        if (talkLabel) onTalk();
        else {
          askToOpenTalkOnArrival();
          navigate(home);
        }
      },
    },
    ...(org
      ? [
          {
            key: "alerts",
            label: "Alerts",
            icon: <BellIcon unread={unread} />,
            href: paths.notifications(),
            name: unread ? `Alerts: ${unread} unread notifications` : "Alerts: notifications",
            current: pathname === paths.notifications(),
          },
        ]
      : []),
    ...(creditsScope
      ? [
          {
            key: "credits",
            // The tab is "Credits"; the balance stays in sight as a small value on its icon, red only at a real limit.
            label: "Credits",
            badge: balance !== undefined ? { text: compactNumber(balance), tone: credits.data && !credits.data.neverToppedUp && credits.data.available <= 0 ? ("bad" as const) : ("neutral" as const) } : undefined,
            icon: <Icon name="credits" className="size-5" />,
            href: paths.credits(),
            name: balance !== undefined ? `Credits: ${formatNumber(balance)} left` : credits.isError ? "Credits: the balance could not be read" : "Credits",
            current: pathname === paths.credits(),
          },
        ]
      : []),
    { key: "more", label: "More", icon: <Ellipsis className="size-5" />, name: "More: every page, your account and the mode", expanded: more, onClick: () => setMore(true), current: more },
  ];
  return (
    <>
      <BottomNav items={items} />
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </>
  );
}

/** A balance short enough for a badge on an icon: "1,840", "12k", "−120". */
function compactNumber(n: number): string {
  return Math.abs(n) >= 10_000 ? `${n < 0 ? "\u2212" : ""}${Math.round(Math.abs(n) / 1000)}k` : formatNumber(n);
}

interface Destination {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  note?: string;
}

/** Everything the bar has no room for: the organisation's pages, then you — your account, the mode, signing out. */
function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useGetMeQuery(undefined);
  const active = useActiveOrganisation();
  const tree = useActiveTree();
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const org = active.organisation;
  // The organisation, or for someone granted only part of it, the highest level they hold.
  const scope = org ? (!active.entered && active.role === null ? (highestGrant(me.data?.memberships ?? [], org.slug)?.scope ?? org.slug) : org.slug) : null;
  const role = scope ? effectiveRole(tree.data, me.data, scope) : null;
  const admin = roleRank(role) >= roleRank("admin");
  const ownerOfOrganisation = org ? effectiveRole(tree.data, me.data, org.slug) === "owner" && !active.entered : false;
  const entered = active.entered ? org?.slug : undefined;
  const pages: Destination[] = scope
    ? [
        { key: "manage", label: "Manage the organisation", icon: "organisation", href: paths.manage(scope, entered), note: "Divisions, projects and apps" },
        { key: "hiring", label: "Hiring", icon: "contractors", href: paths.hires(scope) },
        { key: "autonomy", label: "Autonomy", icon: "plan", href: paths.autonomy(scope), note: "What runs without asking" },
        { key: "ideas", label: "Ideas from your portfolio", icon: "research", href: paths.suggestions(scope) },
        ...(admin ? [{ key: "people", label: "People", icon: "employee" as const, href: paths.people(scope) }] : []),
        ...(admin ? [{ key: "secrets", label: "Secrets", icon: "secrets" as const, href: paths.secrets(scope) }] : []),
        { key: "assistants", label: technical ? "MCP access" : "AI assistants", icon: "assistants", href: paths.assistants() },
        ...(ownerOfOrganisation ? [{ key: "operator-access", label: "Operator access", icon: "god-mode" as const, href: paths.operatorAccess() }] : []),
      ]
    : [];
  if (me.data?.isOperator) pages.push({ key: "operator", label: "God mode: every organisation", icon: "god-mode", href: paths.operator() });
  if (technical) pages.push({ key: "system", label: "System status", icon: "health", href: paths.system() });
  return (
    <Sheet open={open} onClose={onClose} title="More">
      <div className="flex flex-col gap-5">
        {/* You first — your account, the mode, signing out — so they are on the first screen of the sheet; the pages follow. */}
        <section aria-label="You" className="flex flex-col gap-3 rounded-md bg-ground p-4">
          {me.data && (
            <Link href={paths.account()} onClick={onClose} className="flex min-h-touch items-center gap-3 rounded-xs">
              <Icon name="employee" tinted className="size-5" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">Your account</span>
                <span className="truncate text-sm text-ink-muted">{me.data.user.email}</span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
            </Link>
          )}
          <OrganisationSwitcher />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Mode</span>
            <ModeToggle />
          </div>
          {me.data && <SignOut className={cn(buttonVariants({ variant: "secondary" }), "w-full")} />}
        </section>
        {pages.length > 0 && (
          <nav aria-label="Pages">
            <ul className="flex flex-col">
              {pages.map((p) => (
                <li key={p.key} className="border-b last:border-b-0">
                  <Link href={p.href} onClick={onClose} className="flex min-h-touch items-center gap-3 rounded-xs py-2.5 text-ink">
                    <Icon name={p.icon} tinted className="size-5" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{p.label}</span>
                      {p.note && <span className="text-sm text-ink-muted">{p.note}</span>}
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </Sheet>
  );
}
