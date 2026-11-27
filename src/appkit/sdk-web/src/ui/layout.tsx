import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { useCurrentUser } from "../hooks.js";
import { signInUrl, signOutUrl } from "../router.js";
import { Button, buttonVariants } from "./button.js";
import { Card } from "./card.js";
import { cn } from "./cn.js";
import { Checkbox } from "./field.js";

/**
 * The page layouts every app is built from (AGENTS.md, "What good looks like"). They hold the decisions a page should not
 * make again: one frame width shared by the header and the page, so their edges line up; a page title in one size; a side
 * panel beside the page on a desktop and under it on a phone; lists that use the width; forms with a title, a measured
 * column and Cancel beside the main action.
 *
 * Links are the app's own (a router `Link`): the components that take one render it through `Slot`, so the kit never
 * imports the router.
 */

/** The width and gutters of the header and of every page: the same, so the header's edges line up with the content's. */
export const PAGE_FRAME = "mx-auto w-full max-w-page px-4 sm:px-6 lg:px-8";

// ---------------------------------------------------------------------------------------------
// The frame: header and main
// ---------------------------------------------------------------------------------------------

/**
 * The app's one header: its name (linking home), its navigation, and who is signed in with the way out. Every app has the
 * same one, at the same height. `home` is the app's own link to its first page, holding the app's name:
 * `<AppHeader home={<Link to="/">{APP_NAME}</Link>}>` with `<NavItem>`s as children when the app has more than one place to go.
 *
 * On a desktop or tablet it is one row. On a phone it is two compact rows: the app's name (cut short if long) and the
 * person's avatar, which opens who is signed in and "Sign out"; then the places, on one line that scrolls sideways when
 * they do not fit — never wrapping.
 */
export function AppHeader({
  home,
  children,
  className,
}: {
  home: React.ReactElement<{ children?: React.ReactNode }>;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("sticky top-0 z-20 border-b bg-surface pt-safe-t", className)} data-slot="app-header">
      <div className={cn(PAGE_FRAME, "flex min-h-16 flex-wrap items-center gap-x-6 gap-y-1 py-2 max-sm:gap-x-3")}>
        <Slot className="flex min-h-11 min-w-0 shrink items-center font-display text-lg font-semibold text-ink hover:text-primary max-sm:flex-1 max-sm:basis-0">
          {React.cloneElement(home, undefined, <span className="truncate">{home.props.children}</span>)}
        </Slot>
        {children ? (
          <nav aria-label="Main" className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto max-sm:order-last max-sm:-mx-2 max-sm:w-full">
            {children}
          </nav>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * A place in the app's navigation. Give it the app's own link: `<NavItem><NavLink to="/trips">Trips</NavLink></NavItem>`.
 * The router marks the current one (`aria-current="page"`), and it is drawn as chosen.
 */
export function NavItem({ children }: { children: React.ReactElement }) {
  return (
    <Slot className="inline-flex min-h-11 shrink-0 items-center rounded-sm px-3 text-sm font-semibold text-ink-muted hover:bg-ground hover:text-ink current:bg-primary-tint current:text-primary-hover">
      {children}
    </Slot>
  );
}

const AVATAR = "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-tint font-semibold text-primary-hover";

/**
 * Who is signed in — their initial and name — and "Sign out"; or "Sign in" for a visitor. The same in every app. On a phone
 * the name and "Sign out" wait behind the avatar, a 44px button that opens them.
 */
export function UserMenu() {
  const me = useCurrentUser();
  if (me.status === "loading") return <span aria-hidden className="block h-9 w-24 animate-pulse rounded-sm bg-ground max-sm:size-11 max-sm:rounded-full" />;
  if (me.status === "failed") return <span className="text-sm text-attention-text">Could not check who is signed in</span>;
  if (me.data === null) {
    return (
      <Button asChild variant="outline" size="sm">
        <a href={signInUrl()}>Sign in</a>
      </Button>
    );
  }
  const name = me.data.displayName || me.data.email;
  return (
    <div className="relative flex min-w-0 items-center gap-3 text-sm">
      <span aria-hidden className={cn(AVATAR, "max-sm:hidden")}>
        {initial(name)}
      </span>
      <span className="max-w-48 truncate font-medium text-ink max-sm:sr-only" data-testid="signed-in-as">
        {name}
      </span>
      <Button asChild variant="outline" size="sm" className="max-sm:hidden">
        <a href={signOutUrl()}>Sign out</a>
      </Button>
      <AccountMenu name={name} email={me.data.email} />
    </div>
  );
}

/** The phone's account button: the avatar, opening who is signed in and "Sign out". Escape or a tap outside closes it. */
function AccountMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((now) => !now)}
        className="flex size-11 items-center justify-center rounded-full hover:bg-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span aria-hidden className={cn(AVATAR, "size-9")}>
          {initial(name)}
        </span>
        <span className="sr-only">Your account</span>
      </button>
      {open ? (
        <div id={id} ref={panel} data-testid="user-menu" className="absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-1 rounded-md border bg-surface p-2 shadow-raised">
          <div className="flex min-w-0 flex-col border-b px-3 pb-3 pt-2">
            <span className="truncate font-semibold text-ink">{name}</span>
            {email && email !== name ? <span className="truncate text-ink-muted">{email}</span> : null}
          </div>
          <a href={signOutUrl()} className="flex min-h-11 items-center rounded-sm px-3 font-semibold text-ink hover:bg-ground">
            Sign out
          </a>
        </div>
      ) : null}
    </div>
  );
}

function initial(name: string): string {
  const first = name.trim().codePointAt(0);
  return first === undefined ? "?" : String.fromCodePoint(first).toUpperCase();
}

/** The page's own area under the header: the same frame, room at the foot, clear of a phone's home indicator. */
export function AppMain({ children, className }: { children: React.ReactNode; className?: string }) {
  return <main className={cn(PAGE_FRAME, "flex flex-1 flex-col pb-safe-b pt-6 sm:pt-8", className)}>{children}</main>;
}

// ---------------------------------------------------------------------------------------------
// A page: its header and its layout
// ---------------------------------------------------------------------------------------------

/**
 * The top of every page: a way back (on any page below the first), the page's one `<h1>`, a line on what it is, and the
 * page's actions on the right (on a phone, under the title, full width).
 */
export function PageHeader({
  title,
  description,
  back,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The app's link to the page above: `<Link to="/">All dives</Link>`. */
  back?: React.ReactElement;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 pb-6 sm:pb-8", className)}>
      {back ? <BackLink>{back}</BackLink> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 max-w-prose flex-col gap-1.5">
          <h1 className="break-words font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
          {description ? <p className="text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3 max-sm:w-full max-sm:[&>*]:flex-1">{actions}</div> : null}
      </div>
    </div>
  );
}

/** "← All dives": the way back to the page above, a 44px target. Give it the app's own link. */
export function BackLink({ children }: { children: React.ReactElement }) {
  return (
    <Slot
      data-slot="back-link"
      className="-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm px-1 text-sm font-semibold text-primary before:content-back hover:text-primary-hover"
    >
      {children}
    </Slot>
  );
}

/**
 * A page and its side panel: the page's content, and beside it on a desktop (under it on a phone) what helps — a summary of
 * the list, the record's details, a live preview of a form, a word on what happens next. The panel stays in view while the
 * page scrolls. Without `aside`, the content takes the whole width.
 */
export function PageLayout({
  children,
  aside,
  asideLabel = "Summary",
  form = false,
  className,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  asideLabel?: string;
  /** A form page: the form keeps its measured column and the side panel sits right beside it. */
  form?: boolean;
  className?: string;
}) {
  if (!aside) return <div className={cn("flex flex-col gap-6", className)}>{children}</div>;
  return (
    <div className={cn("grid grid-cols-1 items-start gap-6 lg:gap-8", form ? "lg:grid-cols-form-aside" : "lg:grid-cols-page-aside", className)}>
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
      <aside aria-label={asideLabel} className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
        {aside}
      </aside>
    </div>
  );
}

/** A titled card in the side panel, or anywhere a section needs one. */
export function Panel({ title, children, className, actions }: { title: React.ReactNode; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <Card className={cn("flex flex-col gap-3 p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        {actions}
      </div>
      <div className="flex flex-col gap-3 text-ink-body">{children}</div>
    </Card>
  );
}

/** A short set of figures and facts — "Dives this month 4", "Seats left 2" — as label and value, one per row. */
export function Facts({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("flex flex-col divide-y", className)}>
      {items.map((item, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="text-sm text-ink-muted">{item.label}</dt>
          <dd className="text-right font-semibold tabular-nums text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

/**
 * Cards that use the width: as many columns of at least 17rem as the page has room for — one on a phone, three or four on
 * a desktop. Each child is one `<li>`. Put the list's test id on it (`data-testid="dive-list"`).
 */
export const CardGrid = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(({ className, ...props }, ref) => (
  <ul ref={ref} className={cn("grid grid-cols-cards gap-4", className)} {...props} />
));
CardGrid.displayName = "CardGrid";

/**
 * One item of a list as a card that opens it: its title, a line of facts, and a status tag. The whole card is the link (the
 * app's own `Link`, passed as `link`), so it is one large target.
 */
export function ItemCard({
  link,
  title,
  meta,
  status,
  children,
  className,
}: {
  link: React.ReactElement;
  title: React.ReactNode;
  meta?: React.ReactNode;
  status?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Slot
      className={cn(
        "flex h-full flex-col gap-2 rounded-md border bg-surface p-5 text-ink shadow-card transition-shadow hover:border-border-strong hover:shadow-raised",
        className,
      )}
    >
      {React.cloneElement(
        link,
        undefined,
        <>
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 break-words font-display text-base font-semibold leading-snug">{title}</span>
            {status}
          </span>
          {meta ? <span className="text-sm text-ink-muted">{meta}</span> : null}
          {children ? <span className="text-sm text-ink-body">{children}</span> : null}
        </>,
      )}
    </Slot>
  );
}

// ---------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------

/**
 * A form's body: its fields in a measured column (a form across a whole desktop is hard to read), on a card, with the
 * actions at its foot. Put it in a {@link PageLayout} whose `aside` shows what helps — a live preview, what happens next.
 */
export function FormCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Card className={cn("flex w-full max-w-form flex-col gap-5 p-5 sm:p-6", className)}>{children}</Card>;
}

/**
 * The foot of every form: the main action, and Cancel beside it — a person can always leave without saving. `cancel` is the
 * app's own link back (`<Link to="/">Cancel</Link>`); on a phone both are full width, the main action first.
 */
export function FormActions({ submit, cancel, children }: { submit: React.ReactElement; cancel: React.ReactElement; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t pt-5 max-sm:flex-col max-sm:items-stretch">
      {submit}
      <Slot className={buttonVariants({ variant: "outline" })}>{cancel}</Slot>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Checklists and progress
// ---------------------------------------------------------------------------------------------

/** A list of things to tick: each row a real check box with its words, the whole row the target. */
export function Checklist({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("flex flex-col divide-y rounded-md border bg-surface", className)} {...props} />;
}

/**
 * One row of a {@link Checklist}: a check box, its label, and an optional detail on the right ("Rental", "2 left"). Ticked,
 * the words go quiet and are struck through, so what is left stands out.
 */
export function ChecklistItem({
  id,
  label,
  detail,
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: {
  id: string;
  label: React.ReactNode;
  detail?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
} & Omit<React.LiHTMLAttributes<HTMLLIElement>, "onChange">) {
  return (
    <li className={className} {...props}>
      <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-ground">
        <Checkbox id={id} checked={checked} disabled={disabled} onChange={(e) => onCheckedChange(e.target.checked)} />
        <span className={cn("min-w-0 flex-1 break-words text-ink", checked && "text-ink-muted line-through")}>{label}</span>
        {detail ? <span className="shrink-0 text-sm text-ink-muted">{detail}</span> : null}
      </label>
    </li>
  );
}

/** How far along something is — "7 of 12 packed" — as words and a bar. */
export function Progress({ value, max, label, className }: { value: number; max: number; label: React.ReactNode; className?: string }) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="text-sm font-semibold text-ink">{label}</div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-quiet">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Sharing a link
// ---------------------------------------------------------------------------------------------

/**
 * A link to hand to someone: shown short (host and path, never a raw field of characters), with "Copy link" beside it.
 * The whole address is copied, and is the tooltip.
 */
export function CopyLink({ url, label = "Copy link", className }: { url: string; label?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const shown = React.useMemo(() => shortAddress(url), [url]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-3", className)}>
      <span title={url} className="min-w-0 flex-1 break-all rounded-sm bg-ground px-3 py-2.5 font-mono text-sm text-ink-body">
        {shown}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-live="polite" className="max-sm:w-full">
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}

/** `https://acme.example/dives/checklist/c8ff…642b` → `acme.example/dives/checklist/c8ff…642b`: no scheme, long tokens cut. */
export function shortAddress(url: string): string {
  let text: string;
  try {
    const u = new URL(url);
    text = `${u.host}${u.pathname}${u.search}`;
  } catch {
    text = url.replace(/^[a-z]+:\/\//i, "");
  }
  return text.replace(/\/$/, "").replace(/[0-9a-f]{20,}/gi, (token) => `${token.slice(0, 6)}…${token.slice(-4)}`);
}
