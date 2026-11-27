import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modeSet } from "@/store/uiSlice";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { RunView } from "./RunView";
import { flushRunStreams } from "./useRunStream";

/** The run page as the real-stack walk of 2026-11-26 found it (D12, D13, D15, D16, D19, D20, D31, D56, D59). */

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const RUN = { id: "r1", kind: "research", title: "Researching Pager", scope: "acme", status: "running", startedAt: "2026-11-24T10:00:00Z", finishedAt: null, lastSeq: 0, ideaId: "i1", estimateCredits: 12, spentCredits: 0 };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Technical mode is remembered between visits; each test starts in normal mode.
  localStorage.clear();
});

function base(run: Record<string, unknown> | (() => Record<string, unknown>) = RUN) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/runs/r1": () => json(typeof run === "function" ? run() : run) });
}

function feed(events: [string, Record<string, unknown>?][]) {
  act(() => {
    const es = FakeEventSource.latest();
    es.open();
    events.forEach(([type, payload], i) => es.emit(i + 1, type, payload ?? {}));
    flushRunStreams();
  });
}

async function open(run: Record<string, unknown> | (() => Record<string, unknown>) = RUN) {
  const api = base(run);
  renderWithStore(<RunView runId="r1" />);
  await screen.findByRole("heading", { level: 1 });
  return api;
}

const stat = (label: string) => screen.getByText(label).parentElement as HTMLElement;

describe("RunView after the real-stack walk", () => {
  it("D13: a conversation's outcome is its reply, drawn from its markdown", async () => {
    await open({ ...RUN, kind: "conversation", title: "What do I run?", ideaId: null });
    feed([
      ["message", { from: "owner", text: "What do I run?" }],
      ["message", { from: "assistant", text: "You run **1 app**: the `book-club` one." }],
      ["message", { from: "runner", title: "Finished", milestone: "finished", text: "The work is finished; technical mode has the details." }],
      ["run.finished", { outcome: "succeeded", summary: "You run **1 app**: the `book-club` one." }],
    ]);
    const outcome = screen.getByRole("heading", { name: "Outcome" }).parentElement as HTMLElement;
    expect(outcome.textContent).toContain("You run 1 app: the book-club one.");
    expect(outcome.textContent).not.toContain("technical mode");
    expect(screen.getAllByText("1 app")[0]?.tagName).toBe("STRONG");
  });

  it("D12 + D16: small amounts are never 0, and the share of the estimate is the true one", async () => {
    await open({ ...RUN, kind: "conversation", estimateCredits: 0.5 });
    feed([
      ["estimate.made", { credits: 0.5 }],
      ["model.replied", { settledCredits: 0.045 }],
    ]);
    expect(stat("Spent so far").textContent).toContain("0.05 credits");
    // Under a 1-credit estimate a percentage says nothing: none is shown, and no bar raises an alarm (ARCH-011).
    expect(stat("Spent so far").textContent).toContain("Under 1 credit, as estimated");
    expect(stat("Spent so far").textContent).not.toContain("%");
    expect(within(stat("Spent so far")).queryByRole("img")).toBeNull();
    cleanup();
    FakeEventSource.instances = [];
    await open({ ...RUN, estimateCredits: 12.3 });
    feed([
      ["estimate.made", { credits: 12.3 }],
      ["model.replied", { settledCredits: 16 }],
    ]);
    expect(stat("Spent so far").textContent).toContain("130% of the estimate");
    expect(within(stat("Spent so far")).getByRole("img").getAttribute("aria-label")).toBe("130% of the 12 estimated");
  });

  it("ARCH-011: finished work says Spent, with no bar, and a tiny estimate is never scored as a percentage", async () => {
    await open({ ...RUN, kind: "conversation", estimateCredits: 0.05 });
    feed([
      ["estimate.made", { credits: 0.05 }],
      ["model.replied", { settledCredits: 0.11 }],
      ["estimate.scored", { expectedCredits: 0.05, actualCredits: 0.11 }],
      ["run.finished", { outcome: "succeeded", summary: "Done." }],
    ]);
    await waitFor(() => expect(screen.queryByText("Spent so far")).toBeNull());
    expect(stat("Spent").textContent).toContain("0.11 credits");
    expect(within(stat("Spent")).queryByRole("img")).toBeNull();
    const scored = stat("Estimate against actual");
    expect(scored.textContent).not.toContain("%");
    expect(scored.textContent).toContain("Under 1 credit, as estimated: cost 0.11");
  });

  it("R2-8: the estimate shown before the work began stands, with the plan's re-estimate beside it, and each share names its figure", async () => {
    await open({ ...RUN, kind: "build", estimateCredits: 4.8 });
    feed([
      ["estimate.made", { credits: 10, stage: "start" }],
      ["estimate.made", { credits: 4.8, stage: "plan" }],
      ["model.replied", { settledCredits: 2.4 }],
    ]);
    const tile = stat("Estimate");
    expect(tile.textContent).toContain("10 credits");
    expect(tile.textContent).toContain("Shown before the work began");
    expect(tile.textContent).toContain("4.8 once planned");
    expect(stat("Spent so far").textContent).toContain("50% of the 4.8 estimated once planned");
    cleanup();
    FakeEventSource.instances = [];
    await open({ ...RUN, kind: "build", estimateCredits: 4.8 });
    feed([
      ["estimate.made", { credits: 10, stage: "start" }],
      ["estimate.made", { credits: 4.8, stage: "plan" }],
      ["model.replied", { settledCredits: 5.4 }],
      ["estimate.scored", { expectedCredits: 4.8, actualCredits: 5.4 }],
    ]);
    expect(stat("Estimate against actual").textContent).toContain("Against the 4.8 estimated once planned: cost 5.4");
  });

  it("R2-8: the server's two figures stand over the log", async () => {
    await open({ ...RUN, kind: "build", estimateCredits: 4.8, firstEstimateCredits: 10, planEstimateCredits: 4.8 });
    feed([["model.replied", { settledCredits: 2.4 }]]);
    expect(stat("Estimate").textContent).toContain("10 credits");
    expect(stat("Estimate").textContent).toContain("4.8 once planned");
    expect(stat("Spent so far").textContent).toContain("50% of the 4.8 estimated once planned");
  });

  it("R2-8: a run with one estimate (or the old single field) reads as before", async () => {
    await open({ ...RUN, estimateCredits: 12 });
    feed([["model.replied", { settledCredits: 6 }]]);
    expect(stat("Estimate").textContent).toContain("12 credits");
    expect(stat("Estimate").textContent).not.toContain("once planned");
    expect(stat("Spent so far").textContent).toContain("50% of the estimate shown before the work began");
  });

  it("R2-6: a run stopped because an answer was too long to finish says so, and offers Try again", async () => {
    let reads = 0;
    const build = { ...RUN, kind: "build", title: "Build: Pager" };
    await open(() => {
      reads += 1;
      return reads === 1 ? build : { ...build, status: "failed", reason: "answer_cut_off", canTryAgain: true };
    });
    feed([["run.finished", { outcome: "failed", reason: "answer_cut_off", summary: "The answer was too long to finish: it stopped at its output limit, and again when asked once more with twice the room." }]]);
    await waitFor(() => expect(screen.getByTestId("try-again").textContent).toContain("too long to finish, even when asked again with twice the room"));
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("D15: work under way is in the present tense", async () => {
    await open();
    feed([
      ["run.started", {}],
      ["subagent.started", { subagent: "s1", title: "Looked for existing products" }],
    ]);
    const row = screen.getByText("Looking for existing products").closest("[data-group]") as HTMLElement;
    expect(row.textContent).toContain("Working");
    expect(screen.getByTestId("action-count").textContent).toBe("1 action taken");
  });

  it("D15: a run that only talked shows its steps without a false \"0 actions taken\"", async () => {
    await open({ ...RUN, kind: "conversation" });
    feed([
      ["run.started", {}],
      ["message", { from: "owner", text: "Hello" }],
      ["message", { from: "assistant", text: "Hi." }],
      ["run.finished", { outcome: "succeeded" }],
    ]);
    expect(screen.getByTestId("action-count").textContent).toBe("");
  });

  it("D59: a cancelled research run links to the idea, and its unfinished pieces are Stopped", async () => {
    await open();
    feed([
      ["run.started", {}],
      ["subagent.started", { subagent: "s1", title: "Looked for existing products" }],
      ["run.finished", { outcome: "cancelled" }],
    ]);
    expect(screen.queryByText("See what research found")).toBeNull();
    expect(screen.getByText("See the idea")).toBeTruthy();
    expect(screen.getByText("Looked for existing products")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
  });

  it("D15: a re-run's You row says the change that was asked for", async () => {
    await open();
    feed([["message", { from: "owner", text: "A pager for: on-call teams", change: "Make it for small clinics instead" }]]);
    // Said under the heading as the request, and in the steps as what the owner asked.
    expect(screen.getByTestId("run-request").textContent).toBe("Make it for small clinics instead");
    expect(within(screen.getByRole("list", { name: "Steps" })).getByText("Make it for small clinics instead")).toBeTruthy();
  });

  it("D19 + D20: a build declined at its start reads as declined, is not scored, shows the note and offers Try again", async () => {
    let reads = 0;
    const build = { ...RUN, kind: "build", title: "Build: Pager" };
    await open(() => {
      reads += 1;
      return reads === 1 ? build : { ...build, status: "failed", summary: "The owner declined to start this work at its estimate.", canTryAgain: true };
    });
    feed([
      ["estimate.made", { credits: 12 }],
      ["approval.requested", { approvalId: "a1", title: "Start this work? Estimated 12 credits.", onDecline: "stops" }],
      ["approval.answered", { approvalId: "a1", answer: "rejected", comment: "Not this month" }],
      ["message", { from: "runner", title: "Stopped", milestone: "finished", text: "You declined to start this work at its estimate, so nothing was done and nothing was charged." }],
      ["estimate.scored", { expectedCredits: 12, actualCredits: 0 }],
      ["run.finished", { outcome: "failed", summary: "The owner declined to start this work at its estimate." }],
    ]);
    expect(screen.getByText("You declined to start this")).toBeTruthy();
    expect(screen.queryByText("Did not succeed")).toBeNull();
    expect(screen.queryByText("Estimate against actual")).toBeNull();
    expect(screen.getByText("You answered: declined")).toBeTruthy();
    expect(screen.getByText("Not this month")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("try-again").textContent).toContain("You declined to start this at its estimate"));
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("a declined start now finishes cancelled with reason declined_at_start: declined, never cancelled or failed, and unscored", async () => {
    let reads = 0;
    const build = { ...RUN, kind: "build", title: "Build: Pager" };
    await open(() => {
      reads += 1;
      return reads === 1 ? build : { ...build, status: "cancelled", summary: "Declined at the start checkpoint.", canTryAgain: true };
    });
    feed([
      ["estimate.made", { credits: 12 }],
      ["approval.requested", { approvalId: "a1", title: "Start this work? Estimated 12 credits.", detail: "4 credits are left in the budget.", onDecline: "stops" }],
      ["approval.answered", { approvalId: "a1", answer: "rejected", comment: "Not this month" }],
      ["message", { from: "runner", title: "You declined", milestone: "finished", text: "You declined to start this work at its estimate, so nothing was done and nothing was charged." }],
      ["run.finished", { outcome: "cancelled", reason: "declined_at_start", summary: "Declined at the start checkpoint." }],
    ]);
    expect(screen.getByText("You declined to start this")).toBeTruthy();
    expect(screen.queryByText("Cancelled")).toBeNull();
    expect(screen.queryByText("Did not succeed")).toBeNull();
    expect(screen.queryByText("Estimate against actual")).toBeNull();
    expect(screen.getByText("You answered: declined")).toBeTruthy();
    expect(screen.getByText("Not this month")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("try-again").textContent).toContain("You declined to start this at its estimate"));
  });

  it("no AI model reachable: the plain outcome with Try again; run.finished's detail in technical mode only", async () => {
    let reads = 0;
    const SAID = "Endgame could not reach its AI models, so no research was done and nothing was charged. Try again; if it keeps happening, tell FrostAura.";
    const store = (await (async () => {
      const api = base(() => {
        reads += 1;
        return reads === 1 ? RUN : { ...RUN, status: "failed", summary: SAID, canTryAgain: true };
      });
      const r = renderWithStore(<RunView runId="r1" />);
      await screen.findByRole("heading", { level: 1 });
      void api;
      return r.store;
    })());
    feed([
      ["message", { from: "runner", title: "Stopped", milestone: "finished", text: SAID }],
      ["run.finished", { outcome: "failed", summary: SAID, detail: "OpenRouter answered 401: No auth credentials found" }],
    ]);
    expect(screen.getAllByText(SAID).length).toBeGreaterThan(0);
    expect(screen.queryByText(/OpenRouter answered 401/)).toBeNull();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    act(() => void store.dispatch(modeSet("technical")));
    expect(screen.getAllByText(/OpenRouter answered 401: No auth credentials found/).length).toBeGreaterThan(0);
  });

  it("an approval's plain detail is the owner's sentence; its tool line is technical mode's", async () => {
    const r = base();
    void r;
    const { store } = renderWithStore(<RunView runId="r1" />);
    await screen.findByRole("heading", { level: 1 });
    feed([["approval.requested", { approvalId: "a1", title: "Let this step search the web: Looked for competitors?", detail: "Your rules for this stage ask before the web is searched. If you decline, this step works without searching.", technical: "web_search. Asks you first at research. Checkpoint: web_search.", onDecline: "continues" }]]);
    const card = await screen.findByTestId("approval-card");
    expect(card.textContent).toContain("Let this step search the web: Looked for competitors?");
    expect(card.textContent).toContain("Your rules for this stage ask before the web is searched.");
    expect(card.textContent).not.toContain("web_search");
    act(() => void store.dispatch(modeSet("technical")));
    expect(screen.getByTestId("approval-card").textContent).toContain("web_search. Asks you first at research.");
  });

  it("D56: a pause's reason code is said in words in normal mode", async () => {
    await open();
    feed([["run.paused", { by: "runner", reason: "estimate_over_budget" }]]);
    expect(screen.queryByText("estimate_over_budget")).toBeNull();
    expect(screen.getByText(/more than the budget has left/)).toBeTruthy();
  });

  it("D31: what was asked for starts each requirement with a capital", async () => {
    await open({ ...RUN, kind: "build" });
    feed([["plan.proposed", { summary: "Kit lists", items: [], requirements: [{ id: "R1", text: "tick off their own kit for a trip" }] }]]);
    expect(screen.getByText("Tick off their own kit for a trip")).toBeTruthy();
  });

  it("R2-11: the plan panel says a part for people who do not sign in works once the app is public", async () => {
    await open({ ...RUN, kind: "build" });
    feed([
      ["plan.proposed", { summary: "Packing lists", items: [{ id: "i1", text: "A shared trip link", check: "check_preview signed out" }], requirements: [{ id: "R1", text: "packers tick off kit, all without signing in" }] }],
      ["message", { from: "builder", title: "The plan", milestone: "planned", text: "Packing lists. 1 part, each built, then checked in the running app against what you asked for. All 1 things the idea asks for are covered. People can use it without signing in only once you make the app public, which only you can do on its page." }],
    ]);
    expect(screen.getByTestId("plan-public-only").textContent).toBe("People can use it without signing in only once you make the app public, which only you can do on its page.");
  });

  it("R2-11: a plan with nothing for signed-out people carries no such note", async () => {
    await open({ ...RUN, kind: "build" });
    feed([
      ["plan.proposed", { summary: "Kit lists", items: [], requirements: [{ id: "R1", text: "tick off their own kit" }] }],
      ["message", { from: "builder", title: "The plan", milestone: "planned", text: "Kit lists. 0 parts. All 1 things the idea asks for are covered." }],
    ]);
    expect(screen.queryByTestId("plan-public-only")).toBeNull();
  });
});
