import { describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { seek } from "./engine";
import { checkFile, FileRefused } from "./conversationKit";
import { answerApproval } from "./routes/work";
import { buildWorld } from "../world/scenarios";
import { ORG } from "../world/default";
import type { World } from "./world";

/** The demo's conversation, files and capabilities (ARCH-011), held to the control plane's rules and words. */

const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};
const detail = (r: { body?: unknown }) => (r.body as { detail?: string }).detail;
const as = (persona = "owner", scenario = "default") => buildWorld(scenario, persona).world;

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

async function refused(file: File): Promise<string> {
  try {
    await checkFile(file);
    return "accepted";
  } catch (e) {
    return e instanceof FileRefused ? `${e.status} ${e.message}` : String(e);
  }
}

describe("a file is judged by its bytes, not its name", () => {
  it("refuses the hostile and the mislabelled, each in plain words", async () => {
    expect(await refused(new File(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], "logo.svg"))).toMatch(/^415 .*SVG images are not accepted/);
    expect(await refused(new File(['<?xml version="1.0"?><svg onload="alert(1)"></svg>'], "logo.png"))).toMatch(/^415 .*SVG/);
    expect(await refused(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], "notes.txt"))).toMatch(/^415 .*archive/);
    expect(await refused(new File([new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0])], "data.csv"))).toMatch(/^415 .*archive/);
    expect(await refused(new File([png(2, 2)], "picture.txt"))).toMatch(/^415 .*is an image, but its name says otherwise/);
    expect(await refused(new File(["just words"], "picture.png"))).toMatch(/^415 .*is not the image its name says/);
    expect(await refused(new File([new Uint8Array([104, 105, 0, 104])], "notes.txt"))).toMatch(/^415 .*is not text/);
    expect(await refused(new File([new Uint8Array([0xc3, 0x28])], "notes.txt"))).toMatch(/^415 .*not readable text/);
    expect(await refused(new File([png(100_000, 100_000)], "huge.png"))).toMatch(/^413 .*40 megapixels/);
    expect(await refused(new File([], "empty.md"))).toMatch(/^400 .*is empty/);
    expect(await refused(new File(["MZ"], "tool.exe"))).toMatch(/^415 .*not accepted/);
  });

  it("accepts an image, a PDF and text, and reads what each needs", async () => {
    expect(await checkFile(new File([png(2, 2)], "shot.png"))).toMatchObject({ kind: "image", contentType: "image/png" });
    expect(await checkFile(new File(["%PDF-1.4\n<< /Type /Page >>\n<< /Type /Page >>\n"], "rules.pdf"))).toMatchObject({ kind: "pdf", pages: 2 });
    expect(await checkFile(new File(["name,joined\nAda,2024"], "members.csv"))).toMatchObject({ kind: "text", characters: 20 });
  });
});

describe("files on a message", () => {
  it("are uploaded, sent by id with the message, echoed in the history and refused twice", async () => {
    const w = as();
    const up = await call(w, "POST", "conversations/attachments", { scope: ORG, file: new File(["# Rules\n- a waitlist"], "rules.md") });
    expect(up.status).toBe(201);
    const id = (up.body as { id: string }).id;
    const sent = await call(w, "POST", "conversations", { scope: ORG, message: "Read this", attachmentIds: [id] });
    expect(sent.status).toBe(201);
    const history = await call(w, "GET", `conversations?scope=${ORG}`);
    const mine = (history.body as { messages: { text: string; attachments: { name: string }[] }[] }).messages.find((m) => m.text === "Read this");
    expect(mine?.attachments.map((a) => a.name)).toEqual(["rules.md"]);
    const again = await call(w, "POST", "conversations", { scope: ORG, message: "Again", attachmentIds: [id] });
    expect(again.status).toBe(409);
    expect((await call(w, "DELETE", `conversations/attachments/${id}`)).status).toBe(409);
    const content = await call(w, "GET", `conversations/attachments/${id}/content`);
    expect(content.body).toBeInstanceOf(Blob);
  });

  it("refuses an image where whoever answers reads text only, before anything is started", async () => {
    const w = as();
    const up = await call(w, "POST", "conversations/attachments", { scope: ORG, file: new File([png(2, 2)], "shot.png") });
    const r = await call(w, "POST", "conversations", { scope: ORG, message: "What is this?", attachmentIds: [(up.body as { id: string }).id] });
    expect(r.status).toBe(422);
    expect(detail(r)).toMatch(/reads text only/);
  });

  it("refuses a Viewer an upload", async () => {
    const r = await call(as("viewer"), "POST", "conversations/attachments", { scope: ORG, file: new File(["x"], "a.txt") });
    expect(r.status).toBe(403);
  });
});

describe("what it can use here", () => {
  it("is read from the world: who answers, the work it can start, the assistants, the limits", async () => {
    const r = await call(as(), "GET", `conversations/capabilities?scope=${ORG}`);
    const caps = r.body as { answerer: { kind: string; tier: string }; tools: string[]; actions: string[]; webSearch: { available: boolean }; attachments: { images: boolean; maxFiles: number }; skills: unknown[] };
    expect(caps.answerer).toMatchObject({ kind: "assistant", tier: "chat" });
    expect(caps.tools).toContain("read_organisation");
    expect(caps.actions).toContain("change_app");
    expect(caps.webSearch.available).toBe(false);
    expect(caps.attachments).toMatchObject({ images: false, maxFiles: 10 });
    expect(caps.skills).toHaveLength(6);
  });

  it("lets an employee who researches search the web and look at pictures", async () => {
    const w = as();
    const wren = w.employees.find((e) => e.name === "Wren");
    const r = await call(w, "GET", `conversations/capabilities?scope=${ORG}&employeeId=${wren?.id}`);
    const caps = r.body as { tools: string[]; webSearch: { available: boolean; rule: string }; attachments: { images: boolean }; narrowing: { noWebSearch: boolean } };
    expect(caps.webSearch).toMatchObject({ available: true, rule: "may" });
    expect(caps.tools).toContain("web_search");
    expect(caps.attachments.images).toBe(true);
    expect(caps.narrowing.noWebSearch).toBe(true);
  });
});

describe("work a conversation starts", () => {
  it("is named in the conversation's own log once approved, and listed with its turn after a reload", async () => {
    const w = as();
    const sent = await call(w, "POST", "conversations", { scope: ORG, message: "Please change the Court booking app: let members join a waitlist" });
    const runId = (sent.body as { id: string }).id;
    seek(w, "conversation:approval", () => undefined);
    const approval = w.approvals.find((a) => a.runId === runId && a.answer === null);
    expect(approval).toBeTruthy();
    answerApproval(w, approval?.id ?? "", "approve", "owner");
    const started = w.runs.find((r) => r.run.id === runId)?.events.find((e) => e.type === "message" && e.payload.kind === "work.started");
    expect(started?.payload).toMatchObject({ workKind: "change" });
    const history = await call(w, "GET", `conversations?scope=${ORG}`);
    const turn = (history.body as { turns: { runId: string; toolCalls: number; started: { runId: string }[] }[] }).turns.find((t) => t.runId === runId);
    expect(turn?.toolCalls).toBeGreaterThan(0);
    expect(turn?.started[0]?.runId).toBe(started?.payload.runId);
  });

  it("starts nothing when the message asked for an answer only", async () => {
    const w = as();
    const sent = await call(w, "POST", "conversations", { scope: ORG, message: "Please change the Court booking app: let members join a waitlist", narrow: { answerOnly: true } });
    const runId = (sent.body as { id: string }).id;
    seek(w, "conversation:replied", () => undefined);
    expect(w.approvals.some((a) => a.runId === runId)).toBe(false);
    expect(w.runs.find((r) => r.run.id === runId)?.events[0]?.payload).toMatchObject({ narrow: { answerOnly: true } });
  });
});
