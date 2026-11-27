import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationCapabilities, Tree } from "@/store/types";
import { FakeEventSource, ME, json, renderWithStore, stubApi } from "@/test/harness";
import { ConversationDock } from "../home/ConversationDock";
import { formatBytes, limitsSentence, refusalFor } from "./attachments";
import { contentsOf, suggestedPrompts, targetsOf } from "./scopeModel";

const WORKER = { id: "e1", name: "Kasper", role: "Software engineer", kind: "employee" as const, activity: null, status: "idle" as const, idle: true, standing: null, briefedBy: null };
const APP = { id: "app1", slug: "booking", name: "Court booking", health: "down" as const, running: "awake" as const, access: "private" as const, sharedWith: 0, visitsToday: 4, lastVisitAt: null, spend: { monthCredits: 42 }, workers: [WORKER] };
const TREE: Tree = {
  generatedAt: "2026-11-27T10:00:00Z",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 50 }, workers: [] },
  divisions: [
    {
      id: "d1",
      slug: "ops",
      name: "Operations",
      spend: { monthCredits: 50 },
      workers: [],
      projects: [{ id: "p1", slug: "courts", name: "Courts", stage: "live", ideaId: null, note: null, progress: null, spend: { monthCredits: 42 }, workers: [], apps: [APP] }],
    },
  ],
  needsYou: [{ kind: "idle", id: "n1", employeeId: "e1", title: "Kasper has had no work", detail: null }],
};

const LIMITS = { maxFiles: 10, maxFileBytes: 10 * 1024 * 1024, maxMessageBytes: 25 * 1024 * 1024, images: false, extensions: [".png", ".pdf", ".txt", ".md", ".csv"] };

const CAPS: ConversationCapabilities = {
  scope: "acme",
  answerer: { kind: "assistant", name: null, role: null, employeeId: null, tier: "chat" },
  tools: ["read_organisation", "start_idea", "change_app", "adjust_setting"],
  asks: ["start_idea", "change_app", "adjust_setting"],
  actions: ["start_idea", "change_app", "adjust_setting"],
  skills: [{ name: "write-a-screen", trigger: "Writing or changing a page in an app.", usedBy: "builders" }],
  services: [
    { id: "identity", detail: "4 people have accounts in the apps here" },
    { id: "secrets", detail: "2 secrets set here" },
  ],
  apps: 1,
  webSearch: { available: false, rule: "may", setAtPath: null },
  assistants: [{ id: "k1", name: "Claude on my laptop", role: "builder", prefix: "eg_ab", lastUsedAt: null }],
  narrowing: { noWebSearch: false, answerOnly: true },
  attachments: LIMITS,
};

const RUN = { id: "r1", kind: "conversation", title: "", scope: "acme", status: "running", startedAt: "", finishedAt: null, lastSeq: 0, ideaId: null, estimateCredits: null, spentCredits: 0 };

let stub: ReturnType<typeof stubApi>;
beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  stub = stubApi({
    "GET /api/me": json(ME),
    "GET /api/tree": json(TREE),
    "GET /api/conversations": json({ scope: "acme", conversationId: null, employeeId: null, messages: [], turns: [] }),
    "GET /api/conversations/capabilities": json(CAPS),
    "POST /api/conversations/estimate": json({ credits: 0.5, ceiling: 1.4, basis: "" }),
    "POST /api/conversations": json(RUN, 201),
    "POST /api/conversations/attachments": json({ id: "f1", name: "rules.md", contentType: "text/plain", kind: "text", bytes: 12, pages: null, characters: 12, runId: null }, 201),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ORG = { scope: "acme", kind: "organisation" as const, trail: ["Acme"] };

async function box() {
  const input = (await screen.findByLabelText("Message Acme")) as HTMLTextAreaElement;
  await waitFor(() => expect(screen.getByTestId("message-estimate").textContent).toContain("at most"));
  return input;
}

describe("the composer", () => {
  it("sends on Enter, keeps a new line on Shift+Enter", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={ORG} />);
    const input = await box();
    fireEvent.change(input, { target: { value: "First line" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(stub.calls.some((c) => c.method === "POST" && c.path === "/api/conversations")).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(stub.calls.find((c) => c.method === "POST" && c.path === "/api/conversations")?.body).toMatchObject({ scope: "acme", message: "First line" }));
    expect(input.value).toBe("");
  });

  it("offers the actions it can take here under /, and puts the chosen one's words in the box", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={ORG} />);
    const input = await box();
    fireEvent.change(input, { target: { value: "/", selectionStart: 1 } });
    const menu = await screen.findByRole("listbox", { name: "Actions" });
    expect([...menu.querySelectorAll("[role=option]")].map((o) => o.querySelector("span span")?.textContent)).toEqual(["Start an idea", "Change an app", "Change a setting", "Propose a hire"]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Change the app ");
  });

  it("sends a narrowing with the one message it was set for, and never again", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={ORG} />);
    const input = await box();
    fireEvent.click(screen.getByRole("button", { name: "What it can use here" }));
    expect(screen.getByText("Claude on my laptop")).toBeTruthy();
    expect(screen.getByText("2 secrets set here")).toBeTruthy();
    expect(screen.getByText("It answers from what Endgame holds here; it does not search the web.")).toBeTruthy();
    expect(screen.queryByText("Don’t search the web")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /Answer only/ }));
    fireEvent.change(input, { target: { value: "How is it going?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(stub.calls.filter((c) => c.method === "POST" && c.path === "/api/conversations")).toHaveLength(1));
    expect(stub.calls.find((c) => c.path === "/api/conversations" && c.method === "POST")?.body).toMatchObject({ narrow: { answerOnly: true } });
    expect(screen.queryByText("Answer only")).toBeNull();
  });

  it("uploads a file as it is added and sends it by id; refuses an SVG before uploading it", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={ORG} />);
    const input = await box();
    const picker = document.querySelector("input[type=file]") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(picker, { target: { files: [new File(["<svg onload=alert(1)>"], "logo.svg", { type: "image/svg+xml" })] } });
    });
    expect(screen.getByRole("alert").textContent).toContain("SVG images are not accepted");
    await act(async () => {
      fireEvent.change(picker, { target: { files: [new File(["# Rules"], "rules.md", { type: "text/markdown" })] } });
    });
    await waitFor(() => expect(document.querySelector("[data-attachment-chip=ready]")).toBeTruthy());
    expect(stub.calls.filter((c) => c.path === "/api/conversations/attachments")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "Read this" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(stub.calls.find((c) => c.path === "/api/conversations" && c.method === "POST")?.body).toMatchObject({ attachmentIds: ["f1"] }));
  });

  it("keeps a menu open with nothing matching, and Escape closes only the menu (findings 26, 29)", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={ORG} />);
    const input = await box();
    fireEvent.change(input, { target: { value: "/zzq", selectionStart: 4 } });
    expect(screen.getByText("No action here matches that.")).toBeTruthy();
    const reachedDocument = vi.fn();
    document.addEventListener("keydown", reachedDocument);
    fireEvent.keyDown(input, { key: "Escape" });
    document.removeEventListener("keydown", reachedDocument);
    expect(screen.queryByText("No action here matches that.")).toBeNull();
    // The layer below (a sheet) never hears it.
    expect(reachedDocument).not.toHaveBeenCalled();
  });

  it("keeps a refused file as a chip in its error state, its reason on it, beside the others (findings 16–18)", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={ORG} />);
    await box();
    const picker = document.querySelector("input[type=file]") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(picker, { target: { files: [new File(["MZ"], "setup.exe"), new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })] } });
    });
    const refused = document.querySelectorAll("[data-attachment-chip=failed]");
    expect(refused).toHaveLength(2);
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/not accepted/);
    expect(screen.queryByText("Wait for the files to be added.")).toBeNull();
  });

  it("says before sending that an image cannot go to an answerer that reads text only", async () => {
    renderWithStore(<ConversationDock tree={TREE} selection={ORG} />);
    await box();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
    stub = stubApi({
      "GET /api/me": json(ME),
      "GET /api/tree": json(TREE),
      "GET /api/conversations": json({ scope: "acme", conversationId: null, employeeId: null, messages: [], turns: [] }),
      "GET /api/conversations/capabilities": json(CAPS),
      "POST /api/conversations/estimate": json({ credits: 0.5, ceiling: 1.4, basis: "" }),
      "POST /api/conversations/attachments": json({ id: "f2", name: "shot.png", contentType: "image/png", kind: "image", bytes: 70, pages: null, characters: null, runId: null }, 201),
    });
    const picker = document.querySelector("input[type=file]") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(picker, { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" })] } });
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("reads text only"));
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the limits, said before anyone tries", () => {
  it("refuses what the control plane would, in the same words", () => {
    expect(refusalFor({ name: "a.svg", size: 10 }, LIMITS, [])).toMatch(/SVG images are not accepted/);
    expect(refusalFor({ name: "a.exe", size: 10 }, LIMITS, [])).toMatch(/this kind of file is not accepted/);
    expect(refusalFor({ name: "a.txt", size: 0 }, LIMITS, [])).toMatch(/is empty/);
    expect(refusalFor({ name: "a.pdf", size: 11 * 1024 * 1024 }, LIMITS, [])).toMatch(/at most 10 MB/);
    const held = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, name: "x.txt", bytes: 1, kind: null, state: "ready" as const, attachment: null, problem: null, preview: null }));
    expect(refusalFor({ name: "b.txt", size: 1 }, LIMITS, held)).toMatch(/at most 10 files/);
    const big = [0, 1, 2].map((i) => ({ key: `b${i}`, name: "x.pdf", bytes: 9 * 1024 * 1024, kind: "pdf" as const, state: "ready" as const, attachment: null, problem: null, preview: null }));
    expect(refusalFor({ name: "c.pdf", size: 1024 * 1024 }, LIMITS, big)).toMatch(/at most 25 MB/);
    expect(refusalFor({ name: "ok.md", size: 10 }, LIMITS, [])).toBeNull();
    expect(formatBytes(830 * 1024)).toBe("830 KB");
    expect(limitsSentence(LIMITS)).toBe("Up to 10 files, 10 MB each and 25 MB in all: images, PDFs and text files. Whoever answers here reads text only, so images cannot be sent.");
  });
});

describe("what the conversation reads from the tree", () => {
  it("suggests from what is really there: an app that is down, what waits, what costs", () => {
    expect(suggestedPrompts(TREE, ORG)).toEqual(["Why is Court booking down, and what would fix it?", "One thing waits for me. Which comes first?", "Why has Court booking cost 42 credits this month?"]);
  });

  it("lists the employees and apps beneath a level for @, never the one already addressed", () => {
    const targets = targetsOf(contentsOf(TREE, "acme"), { scope: "acme" });
    expect(targets.map((t) => [t.kind, t.label, t.scope])).toEqual([
      ["employee", "Kasper", "acme/ops/courts/booking"],
      ["app", "Court booking", "acme/ops/courts/booking"],
    ]);
    expect(targetsOf(contentsOf(TREE, "acme"), { scope: "acme", employeeId: "e1" }).map((t) => t.label)).toEqual(["Court booking"]);
  });
});
