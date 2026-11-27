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
  // Outside the desktop dock (a tablet, an app's or an employee's page) it is a framed pane of its own height, never the page's:
  // taking the page's height there left a blank band the height of the whole page above everything after it.
  it("is a framed pane of its own height when placed in a page", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} fill={false} />);
    const pane = await screen.findByRole("region", { name: "Conversation" });
    expect(pane.dataset.variant).toBe("framed");
    expect(pane.className).toContain("h-pane");
    expect(pane.className).not.toContain("min-h-full");
  });

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

describe("what a message costs (D77)", () => {
  it("never says 'about 0', and says a far ceiling as its own sentence", () => {
    expect(messageCostLine(0, 169)).toBe("Usually well under 1 credit. It can never cost more than 169, the most its steps could cost; it is charged at what it actually costs.");
    expect(messageCostLine(0.05, 0.9)).toBe("A message here costs at most 0.9 credits, usually less than 0.1 credits; it is charged at what it actually costs.");
    expect(messageCostLine(0.5, 1.38)).toBe("A message here costs at most 1.38 credits, usually about 0.5 credits; it is charged at what it actually costs.");
    expect(messageCostLine(4, 120)).toBe("Usually about 4 credits. It can never cost more than 120, the most its steps could cost; it is charged at what it actually costs.");
    expect(messageCostLine(0.5, null)).toBe("A message here is estimated at 0.5 credits.");
  });
});
