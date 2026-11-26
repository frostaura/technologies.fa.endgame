import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeRequest } from "@/features/apps/ChangeRequest";
import { ConversationDock } from "@/features/home/ConversationDock";
import { VerdictView } from "@/features/verdict/VerdictView";
import { RESEARCH_VERDICT, ideaFixture } from "@/test/fixtures";
import { FakeEventSource, ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { answeredText, deriveRun } from "./runModel";
import { RunView } from "./RunView";
import { flushRunStreams } from "./useRunStream";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TREE = { generatedAt: "2026-11-24T10:00:00Z", viewerRole: "owner", organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [], needsYou: [] };
const BUILD = { id: "b1", kind: "build", title: "Build: Pager", scope: "acme/tools", status: "failed", startedAt: "2026-11-24T10:00:00Z", finishedAt: "2026-11-24T11:00:00Z", lastSeq: 3, ideaId: "i1", estimateCredits: 20, spentCredits: 12, budgetExhausted: true, canTryAgain: true };
const NEW_RUN = { ...BUILD, id: "b2", status: "queued", finishedAt: null, budgetExhausted: false, canTryAgain: false };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function feed(events: [string, Record<string, unknown>?][], source = FakeEventSource.latest()) {
  act(() => {
    source.open();
    events.forEach(([type, payload], i) => source.emit(i + 1, type, payload ?? {}));
    flushRunStreams();
  });
}

describe("trying again", () => {
  it("says a budget stop plainly, shows what was not charged, and starts again only after showing what it costs and keeps", async () => {
    const api = stubApi({
      "GET /api/me": json(ME),
      "GET /api/credits": json(CREDITS),
      "GET /api/runs/b1": json(BUILD),
      "POST /api/runs/b1/retry/estimate": json({ runId: "b1", what: "build", credits: 10, basis: "Only 1 of its 2 parts are left to build.", partsDone: 1, parts: 2 }),
      "POST /api/runs/b1/retry": json(NEW_RUN, 201),
    });
    renderWithStore(<RunView runId="b1" />);
    await screen.findByRole("heading", { name: "Build: Pager" });
    feed([
      ["estimate.made", { credits: 20 }],
      ["estimate.scored", { expectedCredits: 20, actualCredits: 12, nonBillableCredits: 3.5, modelCalls: 9 }],
      ["run.finished", { outcome: "failed", summary: "The credit budget ran out, so the work stopped." }],
    ]);
    const panel = await screen.findByTestId("try-again");
    expect(panel.textContent).toContain("The credit budget ran out, so this work stopped.");
    expect(within(panel).getByRole("link", { name: "See credits" })).toBeTruthy();
    expect(screen.getByText("Not charged").nextSibling?.textContent).toBe("3.5 credits");

    fireEvent.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(api.calls.some((c) => c.path === "/api/runs/b1/retry")).toBe(false);
    expect(await within(panel).findByText("1 of its 2 parts are already built and checked; they are kept, not built or charged again.")).toBeTruthy();
    expect(within(panel).getByText("Estimated 10 credits")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Start it again" }));
    await waitFor(() => expect(window.location.pathname).toBe("/runs/b2"));
    expect(api.calls.filter((c) => c.path === "/api/runs/b1/retry")).toHaveLength(1);
  });

  it("marks the parts an earlier attempt finished as kept", () => {
    const run = deriveRun([
      { seq: 1, type: "plan.accepted", at: "", payload: { summary: "S", items: [{ id: "a", text: "Log a dive.", detail: "" }, { id: "b", text: "See the log.", detail: "" }] } },
      { seq: 2, type: "message", at: "", payload: { kind: "plan.carried", items: ["a"] } },
    ]);
    expect(run.carried).toEqual(["a"]);
    expect(run.plan?.items.map((i) => i.result)).toEqual(["passed", null]);
    expect(run.plan?.items[0]?.outcome).toContain("kept, not built or charged again");
    expect(run.messages).toEqual([]);
  });

  it("offers to research again when research did not finish, and keeps earlier decisions in the history", async () => {
    stubApi({
      "GET /api/me": json(ME),
      "GET /api/credits": json(CREDITS),
      "GET /api/tree": json(TREE),
      "GET /api/ideas/i1": json(
        ideaFixture({
          status: "failed",
          verdict: null,
          tryAgain: { runId: "r1", what: "research", why: "cancelled" },
          history: [{ verdict: "change", headline: "Close", choice: "change", note: "Only for dive centres", by: "Owner", at: "2026-11-24T10:00:00Z", runId: "r1" }],
        }),
      ),
    });
    renderWithStore(<VerdictView ideaId="i1" />);
    const panel = await screen.findByTestId("try-again");
    expect(panel.textContent).toContain("This work was cancelled.");
    const history = screen.getByRole("region", { name: "Earlier decisions" });
    expect(history.textContent).toContain("Owner asked for the idea to be changed after a “change” verdict");
    expect(history.textContent).toContain("“Only for dive centres”");
  });

  it("builds a change verdict with research's change applied only when asked to", async () => {
    const api = stubApi({
      "GET /api/me": json(ME),
      "GET /api/credits": json(CREDITS),
      "GET /api/tree": json(TREE),
      "GET /api/ideas/i1": json(ideaFixture({ verdict: { ...RESEARCH_VERDICT, outcome: "change", suggestedChange: "Lead with dive centres." } })),
      "POST /api/ideas/i1/decision": json(ideaFixture({ status: "decided", decision: { choice: "build", at: "2026-11-24T10:00:00Z", by: "Owner", overruled: false, runId: null, via: "person" } })),
    });
    renderWithStore(<VerdictView ideaId="i1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Build it with this change" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ choice: "build", applyChange: true }));
  });
});

describe("approvals say what happens", () => {
  it("tells the truth after a decline", () => {
    expect(answeredText("approve", "stops")).toBe("Approved. The work carries on from here.");
    expect(answeredText("reject", "continues")).toBe("Declined. It was not done; the work continues without it.");
    expect(answeredText("reject", "stops")).toBe("Declined. It was not done, so the work has stopped.");
  });
});

describe("the conversation", () => {
  const SELECTION = { scope: "acme/tools/pager/web", kind: "app" as const, trail: ["Acme", "Tools", "Pager", "Pager"] };

  it("a reply that stopped because no AI model could be reached says so plainly and offers Try again, which sends it again", async () => {
    const SAID = "Endgame could not reach its AI models, so the work stopped before it was finished. What was done is kept; try again, and if it keeps happening, tell FrostAura.";
    const api = stubApi({
      "GET /api/me": json(ME),
      "GET /api/conversations": json({ scope: SELECTION.scope, conversationId: "c1", employeeId: null, messages: [] }),
      "POST /api/conversations/estimate": json({ credits: 0.5, ceiling: 4, basis: "B" }),
      "POST /api/conversations": json({ ...NEW_RUN, id: "c-run", kind: "conversation", status: "running" }, 201),
    });
    renderWithStore(<ConversationDock tree={TREE as never} selection={SELECTION} />);
    fireEvent.change(await screen.findByLabelText("Message Pager"), { target: { value: "Is it up?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    feed([
      ["message", { from: "owner", text: "Is it up?" }],
      ["message", { from: "runner", title: "Stopped", milestone: "finished", text: SAID }],
      ["run.finished", { outcome: "failed", summary: SAID, detail: "gateway: 503" }],
    ]);
    expect(await screen.findByText(SAID)).toBeTruthy();
    expect(screen.queryByText(/gateway: 503/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST" && c.path === "/api/conversations").length).toBe(2));
  });

  it("shows the cost first, answers its own approval inline with a note, names who spoke, and says when the budget stopped a reply", async () => {
    const api = stubApi({
      "GET /api/me": json(ME),
      "GET /api/conversations": json({
        scope: SELECTION.scope,
        conversationId: "c1",
        employeeId: null,
        messages: [
          { runId: "r0", seq: 1, at: "", from: "owner", text: "Is it up?", by: "Sam", code: null },
          { runId: "r0", seq: 2, at: "", from: "assistant", text: "Yes.", by: null, code: null },
          { runId: "r9", seq: 3, at: "", from: "runner", text: "The credit budget ran out before a reply could be written.", by: null, code: "budget_exhausted" },
        ],
      }),
      "POST /api/conversations/estimate": json({ credits: 0.5, ceiling: 4, basis: "B" }),
      "POST /api/conversations": json({ ...NEW_RUN, id: "c-run", kind: "conversation", status: "running" }, 201),
      "POST /api/runs/c-run/approvals/a1": new Response(null, { status: 204 }),
    });
    renderWithStore(<ConversationDock tree={TREE as never} selection={SELECTION} />);
    expect(await screen.findByText("About Pager only: ask about it, or ask for a change to it.")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("message-estimate").textContent).toContain("at most 4 credits"));
    expect(await screen.findByText("Sam")).toBeTruthy();
    expect(screen.getByText("Endgame")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See credits" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Message Pager"), { target: { value: "Add star ratings." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    feed([
      ["message", { from: "owner", text: "Add star ratings." }],
      ["approval.requested", { approvalId: "a1", title: "Change the app: Add star ratings?", detail: "change_app: …", onDecline: "continues" }],
    ]);
    const card = await screen.findByTestId("approval-card");
    expect(within(card).getByText("Change the app: Add star ratings?")).toBeTruthy();
    expect(within(card).queryByText(/change_app/)).toBeNull();
    expect(screen.getByText("Waiting for your answer")).toBeTruthy();
    fireEvent.change(within(card).getByLabelText("Add a note (optional)"), { target: { value: "Not this week." } });
    fireEvent.click(within(card).getByRole("button", { name: "Decline" }));
    expect(await within(card).findByText("Declined. It was not done; the work continues without it.")).toBeTruthy();
    expect(api.calls.find((c) => c.path === "/api/runs/c-run/approvals/a1")?.body).toEqual({ decision: "reject", note: "Not this week." });
  });

  it("names the employee who answers", async () => {
    stubApi({
      "GET /api/me": json(ME),
      "GET /api/conversations": json({ scope: "acme", conversationId: "c1", employeeId: "e1", messages: [{ runId: "r0", seq: 2, at: "", from: "assistant", text: "Three apps log dives.", by: "Iris", code: null }] }),
      "POST /api/conversations/estimate": problem(503, "No route"),
    });
    renderWithStore(<ConversationDock tree={TREE as never} selection={{ scope: "acme", kind: "employee", trail: ["Acme", "Iris"], employeeId: "e1" }} />);
    expect(await screen.findByText("Three apps log dives.")).toBeTruthy();
    expect(screen.getAllByText("Iris").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId("message-estimate").textContent).toContain("What a message costs could not be worked out"));
  });
});

describe("changing a built app", () => {
  it("shows the estimate first and then starts the change", async () => {
    const api = stubApi({
      "GET /api/me": json(ME),
      "POST /api/apps/app1/changes/estimate": json({ credits: 10, basis: "The measured starting figure for change runs." }),
      "POST /api/apps/app1/changes": json({ ...NEW_RUN, id: "t1", kind: "factory", title: "Change: Add star ratings." }, 201),
    });
    renderWithStore(<ChangeRequest appId="app1" appName="Pager" />);
    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "Add star ratings." } });
    fireEvent.click(screen.getByRole("button", { name: "See what it costs" }));
    expect(await screen.findByText("Estimated 10 credits")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/api/apps/app1/changes")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Make this change" }));
    await waitFor(() => expect(window.location.pathname).toBe("/runs/t1"));
    expect(api.calls.find((c) => c.path === "/api/apps/app1/changes")?.body).toEqual({ request: "Add star ratings." });
  });

  it("says why a change was not started", async () => {
    stubApi({
      "GET /api/me": json(ME),
      "POST /api/apps/app1/changes/estimate": json({ credits: 10, basis: "B" }),
      "POST /api/apps/app1/changes": problem(409, "This app is already being worked on"),
    });
    renderWithStore(<ChangeRequest appId="app1" appName="Pager" />);
    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "Add star ratings." } });
    fireEvent.click(screen.getByRole("button", { name: "See what it costs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Make this change" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The change was not started: This app is already being worked on");
  });
});
