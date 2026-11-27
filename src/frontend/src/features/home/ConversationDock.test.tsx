import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tree } from "@/store/types";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { ConversationDock } from "./ConversationDock";
import { messageCostLine } from "./conversationModel";

const TREE: Tree = {
  generatedAt: "2026-11-24T10:00:00Z",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: "All apps healthy", spend: { monthCredits: 0 }, workers: [] },
  divisions: [],
  needsYou: [],
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  stubApi({ "GET /api/me": json(ME), "GET /api/tree": json(TREE), "GET /api/conversations": json({ scope: "acme", conversationId: null, employeeId: null, messages: [] }) });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConversationDock", () => {
  it("says who it is talking to and at which level, with its log, its composer pinned beneath", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} />);
    expect(await screen.findByRole("heading", { name: "Talking to Acme" })).toBeTruthy();
    expect(screen.getByText("Organisation")).toBeTruthy();
    const log = screen.getByRole("log");
    const composer = document.querySelector("[data-composer]");
    expect(composer && log.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  async function sendAndStream(emit: (es: FakeEventSource) => void) {
    stubApi({
      "GET /api/me": json(ME),
      "GET /api/tree": json(TREE),
      "GET /api/conversations": json({ scope: "acme", conversationId: null, employeeId: null, messages: [] }),
      "POST /api/conversations/estimate": json({ credits: 0.05, ceiling: 1, basis: "" }),
      "POST /api/conversations": json({ id: "r1", kind: "conversation", title: "", scope: "acme", status: "running", startedAt: "", finishedAt: null, lastSeq: 0, ideaId: null, estimateCredits: null, spentCredits: 0 }, 201),
    });
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} />);
    fireEvent.change(await screen.findByLabelText("Message Acme"), { target: { value: "What do I run?" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    act(() => {
      const es = FakeEventSource.latest();
      es.open();
      es.emit(1, "message", { from: "owner", text: "What do I run?" });
      emit(es);
    });
  }

  // D9 + D10: the reply's markdown is drawn, and the runner's closing word is not printed beside it as a failure.
  it("draws a reply's markdown and leaves out the closing word once it has replied", async () => {
    await sendAndStream((es) => {
      es.emit(2, "message", { from: "assistant", text: "You run **1 app**: the **Club Reading List**." });
      es.emit(3, "message", { from: "runner", title: "Finished", milestone: "finished", text: "The work is finished; technical mode has the details." });
      es.emit(4, "run.finished", { outcome: "succeeded" });
    });
    expect(screen.getByText("1 app").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.queryByText(/technical mode has the details/)).toBeNull();
    expect(document.querySelector('[data-tone="attention"]')).toBeNull();
  });

  // D49 + D13 (failed answer): the same words are said once, not as a reply and again as a notice.
  it("says a decline or a failed answer once", async () => {
    await sendAndStream((es) => {
      es.emit(2, "message", { from: "assistant", text: "I could not finish answering that. Please ask again." });
      es.emit(3, "message", { from: "runner", title: "Stopped", milestone: "finished", text: "I could not finish answering that. Please ask again." });
      es.emit(4, "run.finished", { outcome: "failed" });
    });
    expect(screen.getAllByText("I could not finish answering that. Please ask again.")).toHaveLength(1);
  });

  it("keeps a budget notice, styled as the stop it is", async () => {
    await sendAndStream((es) => {
      es.emit(2, "message", { from: "runner", code: "budget_exhausted", title: "No reply", text: "The credit budget ran out." });
      es.emit(3, "run.finished", { outcome: "failed" });
    });
    const notice = screen.getByText(/The credit budget ran out\./).closest("[data-tone]");
    expect(notice?.getAttribute("data-tone")).toBe("attention");
    expect(screen.getByRole("link", { name: "See credits" })).toBeTruthy();
  });

  it("leaves the closing word out of what was said before when the run replied", async () => {
    stubApi({
      "GET /api/me": json(ME),
      "GET /api/tree": json(TREE),
      "POST /api/conversations/estimate": json({ credits: 0.05, ceiling: 1, basis: "" }),
      "GET /api/conversations": json({
        scope: "acme",
        conversationId: "c1",
        employeeId: null,
        messages: [
          { runId: "r0", seq: 1, at: "", from: "owner", text: "Hello", by: null, code: null },
          { runId: "r0", seq: 2, at: "", from: "assistant", text: "Understood. It *was not* done.", by: null, code: null },
          { runId: "r0", seq: 3, at: "", from: "runner", text: "Understood. It *was not* done.", by: null, code: null },
        ],
      }),
    });
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} />);
    expect(await screen.findByText("was not")).toBeTruthy();
    expect(screen.getAllByText(/Understood\./)).toHaveLength(1);
  });
});

describe("the thread after a reload (ARCH-012, finding 32)", () => {
  const history = (turns: unknown[], messages: unknown[]) =>
    stubApi({
      "GET /api/me": json(ME),
      "GET /api/tree": json(TREE),
      "POST /api/conversations/estimate": json({ credits: 0.05, ceiling: 1, basis: "" }),
      "GET /api/conversations": json({ scope: "acme", conversationId: "c1", employeeId: null, messages, turns }),
    });

  it("picks up a reply still being written, then draws it when it comes", async () => {
    history([{ runId: "r9", status: "running", toolCalls: 0, started: [] }], [{ runId: "r9", seq: 1, at: "2026-11-27T10:00:00Z", from: "owner", text: "What did each app cost?", by: null, code: null }]);
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} />);
    expect(await screen.findByText("What did each app cost?")).toBeTruthy();
    expect(await screen.findByText("Working on it")).toBeTruthy();
    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url.includes("r9"))).toBe(true));
    act(() => {
      const es = FakeEventSource.instances.find((e) => e.url.includes("r9")) as FakeEventSource;
      es.open();
      es.emit(1, "message", { from: "owner", text: "What did each app cost?" });
      es.emit(2, "message", { from: "assistant", text: "Court booking cost 12 credits." });
      es.emit(3, "run.finished", { outcome: "succeeded" });
    });
    expect(await screen.findByText("Court booking cost 12 credits.")).toBeTruthy();
    expect(screen.queryByText("Working on it")).toBeNull();
  });

  it("says a turn that ended with nothing said was interrupted, and asks again in one press", async () => {
    history(
      [{ runId: "r8", status: "failed", toolCalls: 0, started: [], replied: false, endedWithoutReply: true, interruption: "Its worker stopped before it answered." }],
      [{ runId: "r8", seq: 1, at: "", from: "owner", text: "Hello?", by: null, code: null }],
    );
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} />);
    expect(await screen.findByText("The reply was interrupted.")).toBeTruthy();
    expect(screen.getByText(/Its worker stopped before it answered/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("one turn's order (findings 33–35, C-2)", () => {
  it("keeps the author, the steps, the reply, the approval's receipt, the reply after it in a bubble of its own, then the card", async () => {
    stubApi({
      "GET /api/me": json(ME),
      "GET /api/tree": json(TREE),
      "POST /api/conversations/estimate": json({ credits: 0.05, ceiling: 1, basis: "" }),
      "GET /api/conversations": json({
        scope: "acme",
        conversationId: "c1",
        employeeId: null,
        messages: [
          { runId: "r1", seq: 1, at: "", from: "owner", text: "Add a waiting list", by: null, code: null },
          { runId: "r1", seq: 3, at: "", from: "assistant", text: "I can ask the factory for that.", by: null, code: null },
          { runId: "r1", seq: 7, at: "", from: "assistant", text: "I have asked the factory to change it.", by: null, code: null },
        ],
        turns: [{ runId: "r1", status: "finished", toolCalls: 2, started: [{ runId: "w1", kind: "change", title: "Change: waiting list" }] }],
      }),
      "GET /api/runs/w1": json({ id: "w1", kind: "change", title: "Change: waiting list", scope: "acme", status: "running", startedAt: "", finishedAt: null, lastSeq: 0, ideaId: null, estimateCredits: 10, spentCredits: 0 }),
    });
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} />);
    await screen.findByText("I can ask the factory for that.");
    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url.includes("/r1/"))).toBe(true));
    act(() => {
      const es = FakeEventSource.instances.find((e) => e.url.includes("/r1/")) as FakeEventSource;
      es.open();
      es.emit(1, "message", { from: "owner", text: "Add a waiting list" });
      es.emit(2, "tool.requested", { name: "read_organisation", arguments: { what: "contents" } });
      es.emit(3, "message", { from: "assistant", text: "I can ask the factory for that." });
      es.emit(4, "approval.requested", { approvalId: "a1", title: "Change Court booking: “Add a waiting list”", detail: "Approving starts it." });
      es.emit(5, "approval.answered", { approvalId: "a1", answer: "rejected", comment: "Not this week", byName: "Dean" });
      es.emit(6, "message", { kind: "work.started", runId: "w1", workKind: "change", title: "Change: waiting list" });
      es.emit(7, "message", { from: "assistant", text: "I have asked the factory to change it." });
      es.emit(8, "run.finished", { outcome: "succeeded" });
    });
    const receipt = await waitFor(() => {
      const r = document.querySelector("[data-receipt]");
      if (!r) throw new Error("no receipt yet");
      return r as HTMLElement;
    });
    expect(receipt.textContent).toContain("Declined");
    expect(receipt.textContent).toContain("by Dean");
    expect(receipt.textContent).toContain("Not this week");
    const turn = receipt.closest("[data-turn]") as HTMLElement;
    const order = [...turn.querySelectorAll("[data-steps], [data-reply], [data-receipt], [data-work-card]")].map((el) =>
      el.hasAttribute("data-steps") ? "steps" : el.hasAttribute("data-receipt") ? "receipt" : el.hasAttribute("data-work-card") ? "card" : "bubble",
    );
    expect(order).toEqual(["steps", "bubble", "receipt", "bubble", "card"]);
  });
});

describe("what a message costs (D77)", () => {
  it("never says 'about 0', and says a far ceiling as its own sentence", () => {
    expect(messageCostLine(0, 169)).toBe("Usually well under 1 credit. It can never cost more than 169, the most its steps could cost; it is charged at what it actually costs.");
    expect(messageCostLine(0.05, 0.9)).toBe("A message here costs at most 0.9 credits, usually less than 0.1 credits; it is charged at what it actually costs.");
    expect(messageCostLine(0.5, 1.38)).toBe("A message here costs at most 1.38 credits, usually about 0.5 credits; it is charged at what it actually costs.");
    expect(messageCostLine(4, 120)).toBe("Usually about 4 credits. It can never cost more than 120, the most its steps could cost; it is charged at what it actually costs.");
    expect(messageCostLine(0.5, null)).toBe("A message here is estimated at 0.5 credits.");
  });
});
