import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, ME, renderWithStore, stubApi } from "@/test/harness";
import { currentViewport } from "@/lib/useViewport";
import { breakpoints, viewportQueries } from "@/lib/tokens";
import { AppShell } from "@/features/shell/AppShell";
import { Talk } from "@/features/shell/talk";
import { BottomNav } from "./BottomNav";
import { ClampedHeading, Disclosure, Fold } from "./Fold";
import { Sheet } from "./Sheet";

/**
 * The phone's primitives — the sheet, the fold, the bottom bar — and the shell that composes them,
 * with the viewport pretended through `matchMedia` (a test document has no layout of its own).
 */

type Size = { width: number; height: number };
let size: Size | null = null;

/** A `matchMedia` that answers the shell's own queries for a viewport of `size`. */
function pretend(next: Size | null) {
  size = next;
  if (!next) {
    vi.stubGlobal("matchMedia", undefined);
    return;
  }
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      const s = size ?? { width: 1440, height: 900 };
      if (query === viewportQueries.phone) return s.width < breakpoints.sm || (s.height < breakpoints.short && s.width < breakpoints.lg);
      if (query === viewportQueries.desktop) return s.width >= breakpoints.lg;
      return false;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const PHONE = { width: 375, height: 812 };
const LANDSCAPE = { width: 812, height: 375 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };

beforeEach(() => pretend(null));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the viewport", () => {
  it("is a desktop where nothing can say otherwise, as the console always was", () => {
    expect(currentViewport()).toBe("desktop");
  });

  it("follows the width of its own viewport, and a phone on its side is still a phone", () => {
    pretend(PHONE);
    expect(currentViewport()).toBe("phone");
    pretend(LANDSCAPE);
    expect(currentViewport()).toBe("phone");
    pretend(TABLET);
    expect(currentViewport()).toBe("tablet");
    pretend(DESKTOP);
    expect(currentViewport()).toBe("desktop");
  });
});

describe("a sheet", () => {
  function Harness({ keep = false }: { keep?: boolean }) {
    const [open, setOpen] = useState(false);
    const [n, setN] = useState(0);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Things" keepMounted={keep}>
          <button type="button" onClick={() => setN((x) => x + 1)}>
            Counted {n}
          </button>
        </Sheet>
      </>
    );
  }

  it("is a named modal dialog that takes the focus, closes on Escape and gives the focus back", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open it" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Things" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialog);
    expect(document.documentElement.dataset.sheetOpen).toBe("");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.dataset.sheetOpen).toBeUndefined();
  });

  it("closes from its own button", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    fireEvent.click(screen.getByRole("button", { name: "Close: Things" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kept mounted, holds on to what happened inside it while it is closed", () => {
    render(<Harness keep />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    fireEvent.click(screen.getByRole("button", { name: "Counted 0" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.getByRole("button", { name: "Counted 1" })).toBeTruthy();
  });
});

describe("a fold", () => {
  it("is not there on a desktop: what it holds shows as it always did", () => {
    render(
      <Fold title="History">
        <p>Every version</p>
      </Fold>,
    );
    expect(screen.queryByRole("button", { name: /History/ })).toBeNull();
    expect(screen.getByText("Every version")).toBeTruthy();
  });

  it("on a phone is a named row that opens to what it holds, and stays in the page while folded", () => {
    pretend(PHONE);
    render(
      <Fold title="History" summary="12 versions">
        <p>Every version</p>
      </Fold>,
    );
    const toggle = screen.getByRole("button", { name: /History/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("12 versions")).toBeTruthy();
    const body = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(body?.hidden).toBe(true);
    expect(body?.textContent).toBe("Every version");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hidden).toBe(false);
  });

  it("opens when something inside it asks to be shown (the academy's spotlight)", () => {
    render(
      <Disclosure title="Sharing">
        <button type="button">Invite</button>
      </Disclosure>,
    );
    const invite = screen.getByText("Invite");
    act(() => {
      invite.dispatchEvent(new CustomEvent("endgame:reveal", { bubbles: true }));
    });
    expect(screen.getByRole("button", { name: /Sharing/ }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("a clamped heading", () => {
  it("keeps every word in the heading, and offers no control while nothing is cut", () => {
    render(<ClampedHeading>Build: a members’ locker booking app for the club</ClampedHeading>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Build: a members’ locker booking app for the club");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the bottom bar", () => {
  it("draws places as links and acts as buttons, each named, the current one marked", () => {
    const talk = vi.fn();
    render(
      <BottomNav
        items={[
          { key: "home", label: "Home", icon: null, href: "/", current: true },
          { key: "talk", label: "Talk", icon: null, onClick: talk, name: "Talk to Northwind" },
        ]}
      />,
    );
    const bar = screen.getByRole("navigation", { name: "Main" });
    expect(within(bar).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(bar).getByRole("button", { name: "Talk to Northwind" }));
    expect(talk).toHaveBeenCalledOnce();
  });
});

describe("the shell on a phone", () => {
  const TREE = { generatedAt: "t", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [], role: "owner" }, divisions: [], needsYou: [] };
  const CREDITS = { scope: "acme", balance: 1840, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
  function stub() {
    return stubApi({
      "GET /api/me": json({ ...ME, organisation: { id: "o1", slug: "acme", name: "Acme" } }),
      "GET /api/tree": json(TREE),
      "GET /api/credits": json(CREDITS),
      "GET /api/notifications": json({ organisation: "acme", unread: 3, notifications: [] }),
    });
  }

  it("names where you are in full with the way up, and keeps Home, Talk, Alerts, the balance and More one tap away", async () => {
    pretend(PHONE);
    stub();
    renderWithStore(
      <AppShell crumbs={[{ label: "Acme", href: "/" }, { label: "Build: a members’ locker booking app for the club" }]}>
        <p>Page</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Up to Acme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Where you are: Acme, then Build: a members’ locker booking app for the club/ })).toBeTruthy();
    const bar = screen.getByRole("navigation", { name: "Main" });
    expect(within(bar).getByRole("link", { name: "Home" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: /^Talk/ })).toBeTruthy();
    expect(await within(bar).findByRole("link", { name: "Alerts: 3 unread notifications" })).toBeTruthy();
    expect(await within(bar).findByRole("link", { name: "Credits: 1,840 left" })).toBeTruthy();
    // The desktop's controls are not drawn: the mode and signing out live under More.
    expect(screen.queryByRole("group", { name: "Mode" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: /^More/ }));
    const more = screen.getByRole("dialog", { name: "More" });
    expect(within(more).getByRole("group", { name: "Mode" })).toBeTruthy();
    expect(within(more).getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(within(more).getByRole("link", { name: /Hiring/ })).toBeTruthy();
  });

  it("lists every level above in a sheet, each one tap away", () => {
    pretend(PHONE);
    stub();
    const select = vi.fn();
    renderWithStore(
      <AppShell crumbs={[{ label: "Acme", onSelect: select }, { label: "Technologies", onSelect: select }, { label: "Court booking" }]}>
        <p>Page</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Where you are/ }));
    const trail = screen.getByRole("dialog", { name: "Where you are" });
    fireEvent.click(within(trail).getByRole("button", { name: /Technologies/ }));
    expect(select).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Where you are" })).toBeNull();
  });

  it("puts the page's conversation in a sheet one tap away, leaving a button where it stood", async () => {
    pretend(PHONE);
    stub();
    renderWithStore(
      <AppShell crumbs={[{ label: "Court booking" }]}>
        <Talk label="Talk to Court booking">
          <label>
            Message Court booking
            <input />
          </label>
        </Talk>
      </AppShell>,
    );
    // Where it stood (the bar's own "Talk" carries the same name).
    const launcher = (await screen.findAllByRole("button", { name: "Talk to Court booking" })).find((b) => b.hasAttribute("data-talk-launcher"));
    expect(launcher).toBeTruthy();
    fireEvent.click(launcher as HTMLElement);
    const sheet = screen.getByRole("dialog", { name: "Talk to Court booking" });
    expect(within(sheet).getByLabelText("Message Court booking")).toBeTruthy();
    // The bar's Talk opens the same conversation.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Talk to Court booking" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Talk to Court booking" })).toBeTruthy());
  });

  it("keeps the desktop's header, and the conversation where the page put it, on a desktop", () => {
    pretend(DESKTOP);
    stub();
    renderWithStore(
      <AppShell crumbs={[{ label: "Court booking" }]}>
        <Talk label="Talk to Court booking">
          <p>The conversation</p>
        </Talk>
      </AppShell>,
    );
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(screen.getByRole("group", { name: "Mode" })).toBeTruthy();
    expect(screen.getByText("The conversation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Talk to Court booking" })).toBeNull();
  });

  it("on a tablet, keeps the conversation in the page, and the header's Talk brings it into view", () => {
    pretend(TABLET);
    stub();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    renderWithStore(
      <AppShell crumbs={[{ label: "Acme" }]} talk={{ label: "Talk to Acme", content: <section aria-label="Conversation"><form><input aria-label="Message Acme" /></form></section> }}>
        <p>Page</p>
      </AppShell>,
    );
    expect(screen.getByRole("group", { name: "Mode" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    const box = screen.getByLabelText("Message Acme");
    fireEvent.click(screen.getByRole("button", { name: "Talk to Acme" }));
    expect(scrolled).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(box);
  });
});
