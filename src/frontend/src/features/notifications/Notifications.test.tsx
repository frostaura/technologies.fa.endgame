import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { modeSet } from "@/store/uiSlice";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@/store/types";
import { notificationsGuard } from "@/store/guards";
import { NOTIFICATIONS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { AppShell } from "../shell/AppShell";
import { NotificationsView } from "./NotificationsView";
import { byDay, excerpt, notificationHref, notificationLines, phoneShown } from "./notificationModel";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stub(feed: Response | "pending", extra = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/notifications": feed, ...extra });
}

describe("the bell", () => {
  it("shows the unread count and opens the feed in place", async () => {
    stub(json(NOTIFICATIONS));
    renderWithStore(
      <AppShell crumbs={[{ label: "Home" }]}>
        <p>Page</p>
      </AppShell>,
    );
    const bell = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    fireEvent.click(bell);
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(within(panel).getByRole("link", { name: "The security review found 1 problem" }).getAttribute("href")).toBe("/runs/r9");
    expect(within(panel).getByRole("link", { name: "See all" }).getAttribute("href")).toBe("/notifications");
  });

  it("says nothing about a count it does not know", async () => {
    stub(problem(500, "No feed"));
    renderWithStore(
      <AppShell crumbs={[]}>
        <p>Page</p>
      </AppShell>,
    );
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Notifications" }).length).toBe(1));
  });
});

describe("NotificationsView", () => {
  it("shows a skeleton while loading", async () => {
    stub("pending");
    renderWithStore(<NotificationsView />);
    expect((await screen.findAllByText("Loading your notifications"))[0]?.closest("[data-state]")?.getAttribute("data-state")).toBe("loading");
  });

  it("records a failed read, and an empty feed as nothing needing the person", async () => {
    stub(problem(500, "The feed could not be read"));
    renderWithStore(<NotificationsView />);
    expect((await screen.findAllByText("Your notifications could not be loaded")).length).toBeGreaterThan(0);
    cleanup();
    stub(json({ organisation: "acme", unread: 0, notifications: [] }));
    renderWithStore(<NotificationsView />);
    expect((await screen.findAllByText("Nothing needs you")).length).toBeGreaterThan(0);
  });

  it("lists each with a short title, one line and where it leads; marking read is at once and rolls back when refused", async () => {
    stub(json(NOTIFICATIONS), { "POST /api/notifications/n2/read": () => new Promise<Response>((r) => setTimeout(() => r(problem(500, "Not saved")), 60)) });
    renderWithStore(<NotificationsView />);
    const main = await screen.findByRole("main");
    const list = await within(main).findByRole("list", { name: "Notifications" });
    const verdict = list.querySelector('[data-notification="n2"]') as HTMLElement;
    expect(within(verdict).getByRole("link").textContent).toBe("A verdict is waiting: A personal health trends app. A device or script posts my health…");
    expect(within(verdict).getByRole("link").getAttribute("href")).toBe("/ideas/i1");
    expect(verdict.textContent).toContain("This idea is three commodities bolted together.");
    expect(verdict.textContent).not.toContain("The case against first");
    fireEvent.click(within(verdict).getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(verdict.getAttribute("data-read")).toBe("true"));
    expect(await within(verdict).findByText(/Not marked read: Not saved/)).toBeTruthy();
    await waitFor(() => expect(verdict.getAttribute("data-read")).toBe("false"));
  });

  it("marks everything read", async () => {
    const api = stub(json(NOTIFICATIONS), { "POST /api/notifications/read-all": json({ marked: 2 }) });
    renderWithStore(<NotificationsView />);
    const main = await screen.findByRole("main");
    fireEvent.click(await within(main).findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(within(main).getByText("Nothing unread.")).toBeTruthy());
    expect(api.calls.some((c) => c.path === "/api/notifications/read-all?organisation=acme")).toBe(true);
  });
});

describe("an answered notice (D40)", () => {
  const ANSWERED = {
    organisation: "acme",
    unread: 1,
    notifications: [
      { id: "h1", kind: "hire", severity: "info", title: "Theo was hired as Software engineer", detail: "Builds keep briefing a contractor.", scope: "acme", subject: { kind: "hire", id: "x1" }, createdAt: "2026-11-25T02:08:25Z", read: true, emailedAt: null, resolved: true },
      { id: "a1", kind: "approval", severity: "info", title: "Approval needed: Publish the new version?", detail: "", scope: "acme", subject: { kind: "run", id: "r1" }, createdAt: "2026-11-25T02:00:00Z", read: false, emailedAt: null, resolved: false },
    ],
  };

  it("reads as answered on /notifications: no unread mark, nothing to mark, a quiet Answered", async () => {
    stub(json(ANSWERED));
    renderWithStore(<NotificationsView />);
    const main = await screen.findByRole("main");
    const list = await within(main).findByRole("list", { name: "Notifications" });
    const hire = list.querySelector('[data-notification="h1"]') as HTMLElement;
    expect(hire.getAttribute("data-resolved")).toBe("true");
    expect(within(hire).getByText("Answered")).toBeTruthy();
    expect(within(hire).queryByText("Unread")).toBeNull();
    expect(within(hire).queryByRole("button", { name: "Mark read" })).toBeNull();
    const open = list.querySelector('[data-notification="a1"]') as HTMLElement;
    expect(within(open).getByText("Unread")).toBeTruthy();
    expect(within(open).queryByText("Answered")).toBeNull();
  });

  it("reads as answered in the bell's popover too", async () => {
    stub(json(ANSWERED));
    renderWithStore(
      <AppShell crumbs={[{ label: "Home" }]}>
        <p>Page</p>
      </AppShell>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    const hire = panel.querySelector('[data-notification="h1"]') as HTMLElement;
    expect(within(hire).getByText("Answered")).toBeTruthy();
    expect(within(hire).queryByRole("button", { name: "Mark read" })).toBeNull();
  });

  it("reads an approval whose work ended unanswered as no longer waiting: closed, quietly, and never as answered (R3-2)", async () => {
    const expired = { id: "x2", kind: "approval", severity: "info", title: "No longer waiting: “Let this step search the web for kit list 1?” — the work ended before it was answered", detail: "", scope: "acme", subject: { kind: "run", id: "r1" }, createdAt: "2026-11-25T02:10:00Z", read: true, emailedAt: null, resolved: true };
    stub(json({ organisation: "acme", unread: 0, notifications: [expired] }));
    renderWithStore(
      <AppShell crumbs={[{ label: "Home" }]}>
        <p>Page</p>
      </AppShell>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    const row = screen.getByRole("dialog", { name: "Notifications" }).querySelector('[data-notification="x2"]') as HTMLElement;
    expect(within(row).getByRole("link").textContent).toBe("No longer waiting: “Let this step search the web for kit list 1?” — the work ended before it was answered");
    expect(within(row).getByText("Closed")).toBeTruthy();
    expect(within(row).queryByText("Answered")).toBeNull();
    expect(within(row).queryByText("Unread")).toBeNull();
    expect(within(row).queryByRole("button", { name: "Mark read" })).toBeNull();
    // A long question is what is cut; why it stopped waiting is always said.
    const long = notificationLines({ ...expired, title: `No longer waiting: “Let this step search the web for ${"every dive shop's kit list ".repeat(4)}?” — the work ended before it was answered` } as NotificationItem).title;
    expect(long).toMatch(/…” — the work ended before it was answered$/);
  });

  it("shows an approval's tool line in technical mode only", async () => {
    stub(json({ ...ANSWERED, notifications: [{ ...ANSWERED.notifications[1], technical: "change_app: acme/tools/ledger/web: Add star ratings." }] }));
    const { store } = renderWithStore(<NotificationsView />);
    const main = await screen.findByRole("main");
    await within(main).findByRole("list", { name: "Notifications" });
    expect(main.textContent).not.toContain("change_app");
    act(() => void store.dispatch(modeSet("technical")));
    expect(main.textContent).toContain("change_app: acme/tools/ledger/web: Add star ratings.");
  });

  it("an item from an older server with no resolved field is an open one", () => {
    expect(notificationsGuard({ organisation: "acme", unread: 0, notifications: [{ ...ANSWERED.notifications[1], resolved: undefined }] }, "$").notifications[0]?.resolved).toBe(false);
  });
});

describe("notification model", () => {
  it("leads each kind to what needs the person", () => {
    const [security, verdict, budget] = NOTIFICATIONS.notifications as unknown as [NotificationItem, NotificationItem, NotificationItem];
    expect(notificationHref(security)).toBe("/runs/r9");
    expect(notificationHref(verdict)).toBe("/ideas/i1");
    expect(notificationHref(budget)).toBe("/credits");
    expect(notificationLines(budget).kind).toBe("Budget");
  });
});

describe("a notice raised before the plain-detail fix (R2-5)", () => {
  const old = (detail: string, technical?: string | null): NotificationItem => ({ id: "n7", kind: "approval", severity: "info", title: "Change a setting here?", detail, ...(technical === undefined ? {} : { technical }), scope: "acme", subject: { kind: "approval", id: "a1" }, createdAt: "2026-11-25T01:00:00Z", read: false, emailedAt: null, resolved: false }) as NotificationItem;

  it("keeps its raw tool line out of normal mode and gives it to technical mode", () => {
    expect(notificationLines(old("adjust_setting: hire_checkpoint=false."))).toMatchObject({ line: null, technical: "adjust_setting: hire_checkpoint=false." });
    expect(notificationLines(old("try_again: 075ba848-…"))).toMatchObject({ line: null, technical: "try_again: 075ba848-…" });
  });

  it("leaves a plain detail, and a detail beside its own technical line, as they are", () => {
    expect(notificationLines(old("Hires here would no longer wait for you."))).toMatchObject({ line: "Hires here would no longer wait for you.", technical: null });
    expect(notificationLines(old("note: kept as written", "adjust_setting: x"))).toMatchObject({ line: "note: kept as written", technical: "adjust_setting: x" });
  });

  it("is drawn without the tool line in normal mode", async () => {
    stub(json({ organisation: "acme", unread: 1, notifications: [old("adjust_setting: hire_checkpoint=false.")] }));
    const { store } = renderWithStore(<NotificationsView />);
    expect((await screen.findAllByText("Change a setting here?")).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("adjust_setting");
    act(() => void store.dispatch(modeSet("technical")));
    expect(screen.getAllByText("adjust_setting: hire_checkpoint=false.").length).toBeGreaterThan(0);
  });
});

describe("a top-up request, for operators", () => {
  it("is labelled as one and leads to where it is answered", () => {
    const item: NotificationItem = { id: "n9", kind: "topup.requested", severity: "info", title: "Acme asks for 250 credits", detail: "Launch week.", scope: "frostaura", subject: { kind: "topup_request", id: "q1" }, createdAt: "2026-11-25T01:00:00Z", read: false, emailedAt: null, resolved: false };
    expect(notificationLines(item).kind).toBe("Top-up request");
    expect(notificationHref(item)).toBe("/operator");
  });
});

describe("the feed on a phone", () => {
  it("shows every unread notice and the newest ten, then ten more for each step older", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, read: i < 25 ? true : false, resolved: i === 29 }));
    const first = phoneShown(items, 0).map((n) => n.id);
    expect(first).toEqual([...Array.from({ length: 10 }, (_, i) => `n${i}`), "n25", "n26", "n27", "n28"]);
    expect(phoneShown(items, 10)).toHaveLength(24);
    expect(phoneShown(items, 20)).toHaveLength(30);
  });
});

describe("a notice's words, cut for the feed (real-stack 23)", () => {
  it("cuts at a word boundary, never mid-word", () => {
    const cut = excerpt("Tracking where staff go outside working hours, from their own phones, to find out who else they work for", 60);
    expect(cut).toBe("Tracking where staff go outside working hours, from their…");
  });

  it("drops the broken last word of text the server already cut", () => {
    expect(excerpt("The research found a working definition of sur...", 150)).toBe("The research found a working definition of…");
    expect(excerpt("Kept as it is", 150)).toBe("Kept as it is");
  });

  it("never ends inside a quotation it opened", () => {
    const cut = excerpt("In the build of the reading list, the review asked “Does the export of every reader's history need a signed-in owner first?”", 80);
    expect(cut).toBe("In the build of the reading list, the review asked…");
  });

  it("groups the feed by day, newest first", () => {
    const now = new Date("2026-11-27T15:00:00");
    const at = (iso: string) => ({ createdAt: iso });
    const groups = byDay([at("2026-11-26T09:00:00"), at("2026-11-27T14:00:00"), at("2026-11-08T10:00:00"), at("2026-11-27T09:00:00")], now);
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
      ["Sunday 8 November", 1],
    ]);
    expect(groups[0]?.items[0]?.createdAt).toBe("2026-11-27T14:00:00");
  });
});

describe("a long feed (real-stack 21: thirty notices, long titles)", () => {
  it("opens on the unread and the newest ten, by day, and shows older ones ten at a time", async () => {
    const base = NOTIFICATIONS.notifications[0] as NotificationItem;
    const feed = Array.from({ length: 30 }, (_, i) => ({
      ...base,
      id: `x${i}`,
      title: `Long notice ${i}: the research on the reading list's “definition of success for a small club” ran far past what one line holds...`,
      createdAt: new Date(Date.UTC(2026, 10, 25 - Math.floor(i / 4), 12 - (i % 4))).toISOString(),
      read: i !== 25,
      resolved: false,
    }));
    stub(json({ organisation: "acme", unread: 1, notifications: feed }));
    renderWithStore(<NotificationsView />);
    const list = await within(await screen.findByRole("main")).findByRole("list", { name: "Notifications" });
    expect(list.querySelectorAll("li[data-notification]")).toHaveLength(11);
    expect(list.querySelector('[data-notification="x25"]')).toBeTruthy();
    expect(within(list).getAllByRole("heading").length).toBeGreaterThan(2);
    for (const link of within(list).getAllByRole("link")) {
      expect(link.textContent).toMatch(/…$/);
      expect(link.textContent).not.toMatch(/“[^”]*…$/);
    }
    fireEvent.click(screen.getByRole("button", { name: "Show older (10 of 19)" }));
    expect(list.querySelectorAll("li[data-notification]")).toHaveLength(21);
  });
});
