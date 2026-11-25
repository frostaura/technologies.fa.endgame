import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tree } from "@/store/types";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { ConversationDock } from "./ConversationDock";

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
  it("fills the column it is docked in", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} />);
    expect((await screen.findByRole("region", { name: "Conversation" })).className).toContain("min-h-full");
  });

  // On an app's page it sits among the page's sections: taking the page's height there left a
  // blank band the height of the whole page above everything after it.
  it("takes only the height of what it holds when placed inline", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={{ scope: "acme", kind: "organisation", trail: ["Acme"] }} fill={false} />);
    expect((await screen.findByRole("region", { name: "Conversation" })).className).not.toContain("min-h-full");
  });
});
