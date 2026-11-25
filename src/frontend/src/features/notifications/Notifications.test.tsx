import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@/store/types";
import { NOTIFICATIONS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { AppShell } from "../shell/AppShell";
import { NotificationsView } from "./NotificationsView";
import { notificationHref, notificationLines } from "./notificationModel";

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

describe("notification model", () => {
  it("leads each kind to what needs the person", () => {
    const [security, verdict, budget] = NOTIFICATIONS.notifications as unknown as [NotificationItem, NotificationItem, NotificationItem];
    expect(notificationHref(security)).toBe("/runs/r9");
    expect(notificationHref(verdict)).toBe("/ideas/i1");
    expect(notificationHref(budget)).toBe("/credits");
    expect(notificationLines(budget).kind).toBe("Budget");
  });
});

describe("a top-up request, for operators", () => {
  it("is labelled as one and leads to where it is answered", () => {
    const item: NotificationItem = { id: "n9", kind: "topup.requested", severity: "info", title: "Acme asks for 250 credits", detail: "Launch week.", scope: "frostaura", subject: { kind: "topup_request", id: "q1" }, createdAt: "2026-11-25T01:00:00Z", read: false, emailedAt: null };
    expect(notificationLines(item).kind).toBe("Top-up request");
    expect(notificationHref(item)).toBe("/operator");
  });
});
