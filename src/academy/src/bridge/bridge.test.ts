import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoBridge, type BridgeState } from "./bridge.ts";
import { isEnvelope } from "./protocol.ts";

/** A fake frame window: records what the academy posts, and can answer as the demo. */
function fakeFrame() {
  const sent: { id: string; op: string; args?: Record<string, unknown> }[] = [];
  const win = { postMessage: (m: { id: string; op: string }) => sent.push(m) } as unknown as Window;
  const reply = (data: unknown, source: unknown = win) => window.dispatchEvent(new MessageEvent("message", { data, source: source as Window }));
  return { win, sent, reply };
}

afterEach(() => vi.useRealTimers());

describe("the bridge", () => {
  it("is ready only when the frame itself says so", () => {
    const f = fakeFrame();
    const states: BridgeState[] = [];
    const b = new DemoBridge(() => f.win, { onState: (s) => states.push(s) });
    f.reply({ source: "endgame-demo", id: "r", op: "ready" }, {}); // another window: ignored
    expect(b.state).toBe("loading");
    f.reply({ source: "endgame-demo", id: "r", op: "ready" });
    expect(states).toEqual(["ready"]);
    b.dispose();
  });

  it("sends each op in the envelope and resolves on the echoed id", async () => {
    const f = fakeFrame();
    const b = new DemoBridge(() => f.win);
    f.reply({ source: "endgame-demo", id: "r", op: "ready" });
    const done = b.send("goto", { route: "/" });
    expect(f.sent[0]).toMatchObject({ source: "endgame-academy", op: "goto", args: { route: "/" } });
    f.reply({ source: "endgame-demo", id: f.sent[0]?.id, op: "goto" });
    await expect(done).resolves.toMatchObject({ op: "goto" });
    b.dispose();
  });

  it("waits for step-done before an act counts as finished", async () => {
    const f = fakeFrame();
    const b = new DemoBridge(() => f.win);
    f.reply({ source: "endgame-demo", id: "r", op: "ready" });
    let finished = false;
    const done = b.send("act", { actions: [] }).then(() => (finished = true));
    const id = f.sent[0]?.id;
    f.reply({ source: "endgame-demo", id, op: "act" });
    await Promise.resolve();
    expect(finished).toBe(false);
    f.reply({ source: "endgame-demo", id: "x", op: "step-done", args: { id } });
    await done;
    expect(finished).toBe(true);
    b.dispose();
  });

  it("rejects on an error reply, and reports route changes", async () => {
    const f = fakeFrame();
    const routes: string[] = [];
    const b = new DemoBridge(() => f.win, { onRoute: (r) => routes.push(r) });
    f.reply({ source: "endgame-demo", id: "r", op: "ready" });
    const p = b.send("highlight", { text: "Nope" });
    f.reply({ source: "endgame-demo", id: "q", op: "route", args: { route: "/credits" } });
    f.reply({ source: "endgame-demo", id: f.sent[0]?.id, op: "error", args: { message: "No such control" } });
    await expect(p).rejects.toThrow("No such control");
    expect(routes).toEqual(["/credits"]);
    b.dispose();
  });

  it("gives up, once, when the demo never answers", () => {
    vi.useFakeTimers();
    const f = fakeFrame();
    const states: BridgeState[] = [];
    const b = new DemoBridge(() => f.win, { onState: (s) => states.push(s) }, { ready: 100, op: 100, act: 100 });
    vi.advanceTimersByTime(150);
    b.fail("again");
    expect(states).toEqual(["unavailable"]);
    return expect(b.send("reset")).rejects.toThrow(/unavailable/);
  });

  it("accepts only well-formed envelopes", () => {
    expect(isEnvelope({ source: "endgame-demo", id: "1", op: "ready" })).toBe(true);
    expect(isEnvelope({ source: "someone-else", id: "1", op: "ready" })).toBe(false);
    expect(isEnvelope({ source: "endgame-demo", id: 1, op: "ready" })).toBe(false);
    expect(isEnvelope("ready")).toBe(false);
  });
});
