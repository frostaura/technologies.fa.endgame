// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { crc32, gitBundle, gzip, sha1, tar } from "./archive";
import { buildWorld } from "../world/scenarios";
import { IDS } from "../world/default";
import type { World } from "./world";

/** The app page's corners the academy's area-05 flows teach: asking, the graph, the export. */

const as = (persona: string, scenario = "default"): World => buildWorld(scenario, persona).world;
const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};
const body = <T,>(r: { body?: unknown }) => r.body as T;
const ask = (w: World, question: string) => call(w, "POST", `apps/${IDS.tableBookings}/ask`, { question });

describe("asking about an app", () => {
  it("answers with every kind of chart, from the question's own words", async () => {
    const w = as("builder", "app-busy");
    const kinds: Record<string, string> = {
      "How many visits today?": "number",
      "How many errors today?": "number",
      "Which days are busiest?": "bar",
      "What is the busiest hour?": "bar",
      "How did visits go this week?": "line",
      "Which pages are slowest?": "table",
    };
    for (const [q, kind] of Object.entries(kinds)) {
      const r = await ask(w, q);
      expect(r.status, q).toBe(200);
      expect(body<{ chart: { kind: string } }>(r).chart.kind, q).toBe(kind);
      expect(body<{ credits: { charged: number; estimate: number } }>(r).credits.charged).toBeLessThanOrEqual(0.42);
    }
  });

  it("cuts a long table short, and says a table with no rows has none", async () => {
    const w = as("builder", "app-busy");
    expect(body<{ truncated: boolean; rows: unknown[] }>(await ask(w, "List every booking made today")).truncated).toBe(true);
    const failed = body<{ rows: unknown[]; chart: { kind: string } }>(await ask(w, "Which requests failed today?"));
    expect(failed.chart.kind).toBe("table");
    expect(failed.rows).toEqual([]);
  });

  it("declines what the app does not record, in the model's own plain words", async () => {
    const r = await ask(as("builder", "app-busy"), "How much money did we take this month?");
    expect(r.status).toBe(422);
    expect(body<{ code: string; detail: string }>(r)).toMatchObject({ code: "ask_unanswerable", title: "That question cannot be answered from what this app records" });
    expect(body<{ detail: string }>(r).detail).toMatch(/does not record payments/);
  });

  it("still fails after the free repair with the control plane's words, and the query apart", async () => {
    const r = await ask(as("builder", "app-busy"), "Why do people cancel?");
    expect(r.status).toBe(422);
    expect(body<{ title: string; detail: string; technical: { sql: string; error: string } }>(r)).toMatchObject({
      title: "That question could not be answered",
      detail: "It could not be worked out from what this app records. Try asking it another way, or about its visits, requests, errors, events or measurements.",
      technical: { error: 'column "reason" does not exist' },
    });
  });

  it("times out on a question too wide to work out", async () => {
    const r = await ask(as("builder", "app-busy"), "Who has visited the most ever?");
    expect(body<{ code: string; title: string }>(r)).toMatchObject({ code: "query_timeout", title: "That question took too long to answer" });
  });

  it("refuses an estimate and a question when no model route is configured", async () => {
    const w = as("builder", "ask-unavailable");
    const estimate = await call(w, "POST", `apps/${IDS.tableBookings}/ask/estimate`, { question: "Which days are busiest?" });
    expect(estimate.status).toBe(503);
    expect(body<{ code: string }>(estimate).code).toBe("ask_unavailable");
    expect((await ask(w, "Which days are busiest?")).status).toBe(503);
  });
});

describe("what an app uses", () => {
  it("names graph nodes as the control plane does, and links an app to the services it has used", async () => {
    const r = await call(as("owner", "app-busy"), "GET", `ontology?scope=northwind/technologies/court-booking/web&view=all`);
    const g = body<{ nodes: { id: string; type: string }[]; edges: { from: string; to: string; type: string }[] }>(r);
    const services = g.edges.filter((e) => e.from === `app:${IDS.tableBookings}` && e.type === "depends-on").map((e) => e.to);
    expect(services).toEqual(expect.arrayContaining(["service:identity", "service:telemetry"]));
    expect(g.nodes.every((n) => n.id.includes(":"))).toBe(true);
  });
});

describe("the export", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "endgame-demo-export-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("checksums as the standards say", () => {
    const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    expect(hex(sha1(new TextEncoder().encode("abc")))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });

  it("is a gzipped tar that tar reads, holding a git bundle that git clones", () => {
    const bundle = gitBundle([
      { message: "First version", author: "The factory", email: "factory@northwind.example", at: 1_760_000_000, files: { "README.md": "# One\n" } },
      { message: "Second version", author: "Kasper", email: "kasper@northwind.example", at: 1_760_000_600, files: { "README.md": "# Two\n" } },
    ]);
    const file = path.join(dir, "x.tar.gz");
    writeFileSync(file, gzip(tar([{ name: "x/code.bundle", body: bundle }, { name: "x/manifest.json", body: new TextEncoder().encode("{}") }], 1_760_000_000), 1_760_000_000));
    execFileSync("tar", ["-xzf", file, "-C", dir]);
    expect(readFileSync(path.join(dir, "x/manifest.json"), "utf8")).toBe("{}");
    execFileSync("git", ["clone", "-q", path.join(dir, "x/code.bundle"), path.join(dir, "clone")]);
    expect(readFileSync(path.join(dir, "clone/README.md"), "utf8")).toBe("# Two\n");
    expect(execFileSync("git", ["-C", path.join(dir, "clone"), "log", "--format=%s"], { encoding: "utf8" }).trim().split("\n")).toEqual(["Second version", "First version"]);
  });

  it("is downloaded by the Owner as <slug>-export.tar.gz, with the control plane's manifest", async () => {
    const r = await call(as("owner", "app-busy"), "GET", `apps/${IDS.tableBookings}/export`);
    expect(r.status).toBe(200);
    expect(r.headers?.["content-disposition"]).toBe('attachment; filename="web-export.tar.gz"');
    const file = path.join(dir, "web-export.tar.gz");
    writeFileSync(file, new Uint8Array(await (r.body as Blob).arrayBuffer()));
    const out = path.join(dir, "export");
    execFileSync("mkdir", ["-p", out]);
    execFileSync("tar", ["-xzf", file, "-C", out]);
    const manifest = JSON.parse(readFileSync(path.join(out, "web/manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({ format: "endgame-app-export/1", code: { file: "code.bundle", format: "git bundle (git clone code.bundle)" }, platform: { file: "platform.json" } });
    const platform = JSON.parse(readFileSync(path.join(out, "web/platform.json"), "utf8")) as { shares: unknown[]; endUsers: unknown[] };
    expect(platform.shares).toHaveLength(3);
    expect(platform.endUsers).toHaveLength(2);
    execFileSync("git", ["clone", "-q", path.join(out, "web/code.bundle"), path.join(out, "code")]);
    expect(readFileSync(path.join(out, "code/README.md"), "utf8")).toMatch(/^# Court booking/);
  });

  it("is the Owner's alone", async () => {
    expect((await call(as("admin", "app-busy"), "GET", `apps/${IDS.tableBookings}/export`)).status).toBe(403);
  });
});
