import { describe, expect, it } from "vitest";
import type { RunEvent } from "@/store/types";
import { buildTimeline, factoryAgentTitle, groupTitle, outcomeOf, type TimelineGroup, type TimelineItem } from "./timeline";

let seq = 0;
const at = "2026-11-24T10:00:00Z";
const ev = (type: string, payload: Record<string, unknown> = {}): RunEvent => ({ seq: ++seq, type, at, payload });

/** A research run's log in the shapes the Runner writes today (read from a running stack), with invented content. */
function researchLog(): RunEvent[] {
  seq = 0;
  return [
    ev("message", { from: "owner", text: "A pager for small teams.", change: null, constraints: "Works on a phone" }),
    ev("estimate.made", { basis: "research", credits: 32 }),
    ev("run.started", { holder: "runner-1" }),
    ev("message", { kind: "workflow.step", step: "estimate.gate", agent: "workflow", data: { autonomy: "auto" } }),
    ev("message", { kind: "agent.start", agent: "contractor-existing", task: "Research your strand now.", system: "You are a market researcher…", taskType: "research" }),
    ev("message", { kind: "agent.start", agent: "contractor-demand", task: "Research your strand now.", system: "…", taskType: "research" }),
    ev("model.requested", { model: "vendor/model-small", callId: "k1", taskType: "research", reservedCredits: 4 }),
    ev("model.requested", { model: "vendor/model-small", callId: "k2", taskType: "research", reservedCredits: 4 }),
    ev("model.replied", { model: "vendor/model-small", callId: "k1", settledCredits: 1.3, tokens: { input: 900, output: 200 } }),
    ev("message", { kind: "agent.reply", agent: "contractor-demand", final: true, text: 'I will look for demand.\n\n{"findings": ["One", "Two", "Three"]}', accounting: { settledCredits: 1.3 } }),
    ev("model.replied", { model: "vendor/model-small", callId: "k2", settledCredits: 1.5, tokens: { input: 900, output: 200 } }),
    ev("message", { kind: "agent.reply", agent: "contractor-existing", final: true, text: '```json\n{"findings": ["Beeper Co"]}\n```', accounting: { settledCredits: 1.5 } }),
    ev("message", { kind: "agent.start", agent: "judge", task: "Weigh the research.", system: "…", taskType: "research" }),
    ev("model.requested", { model: "vendor/model-small", callId: "k3", reservedCredits: 4 }),
    ev("model.replied", { model: "vendor/model-small", callId: "k3", settledCredits: 1.6 }),
    ev("message", { kind: "agent.reply", agent: "judge", final: true, text: '{"outcome": "do-not-build", "headline": "Already sold, and nobody asked"}', accounting: { settledCredits: 1.6 } }),
    ev("message", { kind: "workflow.step", step: "verdict.recorded", agent: "workflow", data: {} }),
    ev("message", { from: "researcher", text: "Verdict: do not build. Already sold, and nobody asked.", verdict: "do-not-build" }),
    ev("estimate.scored", { ratio: 0.14, modelCalls: 3, actualCredits: 4.4, expectedCredits: 32, nonBillableCredits: 0 }),
    ev("message", { from: "runner", text: "Verdict: do not build. Already sold, and nobody asked.", outcome: "succeeded" }),
    ev("run.finished", { totals: { credits: 4.4, modelCalls: 3 }, outcome: "succeeded", summary: "Verdict: do not build. Already sold, and nobody asked." }),
  ];
}

const flat = (items: TimelineItem[]): string[] => items.flatMap((i) => (i.kind === "group" ? [`[${i.title}]`, ...flat(i.items).map((t) => `  ${t}`)] : [`${i.title}${i.detail ? `: ${i.detail}` : ""}`]));
const groups = (items: TimelineItem[]) => items.filter((i): i is TimelineGroup => i.kind === "group");

describe("buildTimeline — normal mode", () => {
  it("reads a research run plainly: messages as written, each strand one titled line with its outcome, every milestone once", () => {
    const t = buildTimeline(researchLog(), "normal");
    const lines = flat(t.items);
    expect(lines[0]).toBe("You: A pager for small teams.");
    // Workflow steps are the harness's bookkeeping (ARCH-004): normal mode leaves them out.
    expect(lines).not.toContain("Checked the estimate against your budget");
    expect(lines).not.toContain("Recorded the verdict");
    // The same verdict line was written twice (by research and by the runner): it is said once.
    expect(lines.filter((l) => l.includes("Verdict: do not build")).length).toBe(1);
    const g = groups(t.items);
    expect(g.map((x) => x.title)).toEqual(["Looked for products that already do this", "Looked for people who want it", "Weighed the evidence and wrote the verdict"]);
    expect(g.map((x) => x.outcome)).toEqual(["Reported 1 finding", "Reported 3 findings", "Already sold, and nobody asked"]);
    expect(g.every((x) => x.status === "done")).toBe(true);
    expect(g[0]?.credits).toBe(1.5);
    // Its own steps fold beneath it, summarised.
    expect(flat(g[0]?.items ?? [])).toEqual(["Thought it through"]);
  });

  it("never shows a payload, a model, a tool's arguments or bookkeeping", () => {
    const t = buildTimeline(researchLog(), "normal");
    const text = flat(t.items).join("\n");
    expect(text).not.toContain("vendor/model-small");
    expect(text).not.toContain("market researcher");
    expect(text).not.toContain("agent.start");
    expect(text).not.toContain("contractor");
    expect(t.items.every((i) => i.kind === "group" || i.raw === null)).toBe(true);
  });

  it("counts actions as ARCH-004 does — tool calls plus contractors briefed — and an older run's strands as contractors", () => {
    const t = buildTimeline(researchLog(), "normal");
    expect(t).toMatchObject({ modelCalls: 3, toolCalls: 0, actions: 3, denials: 0 });
  });

  it("reads the agreed event shapes: titled messages, a milestone once, contractors briefed with a title and their searches", () => {
    seq = 0;
    const log = [
      ev("run.started"),
      ev("subagent.started", { subagent: "s1", title: "Looked for existing products", brief: "Find every product that does this.", role: "researcher" }),
      ev("model.replied", { agent: "s1", searches: 4, settledCredits: 1 }),
      ev("subagent.finished", { subagent: "s1", title: "Looked for existing products", summary: "Found six, two of them free.", stopReason: "completed", searches: 5, report: '{"raw":"report"}' }),
      ev("message", { from: "researcher", title: "The verdict", text: "Do not build it.", milestone: "verdict" }),
      ev("message", { from: "runner", title: "The verdict", text: "Do not build it, again.", milestone: "verdict" }),
      ev("tool.requested", { name: "read_file", arguments: { path: "a" } }),
    ];
    const t = buildTimeline(log, "normal");
    const lines = flat(t.items);
    expect(lines).toEqual(["Work started", "[Looked for existing products]", "Research · The verdict: Do not build it.", "Read 1 file"]);
    const g = groups(t.items)[0];
    expect(g?.outcome).toBe("Found six, two of them free.");
    expect(g?.searches).toBe(5);
    expect(JSON.stringify(t.items)).not.toContain("report");
    expect(t.actions).toBe(2);
  });

  it("summarises tool work — files read, tests run — and keeps a refusal on its own line", () => {
    seq = 0;
    const log = [
      ev("run.started"),
      ev("tool.requested", { agent: "main", callId: "c1", name: "read_file", arguments: '{"path":"src/a.ts"}', accounting: { settledCredits: 0.2 } }),
      ev("tool.permitted", { agent: "main", callId: "c1", name: "read_file", rule: "allow read_file" }),
      ev("tool.result", { agent: "main", callId: "c1", name: "read_file", content: "…" }),
      ev("tool.requested", { agent: "main", callId: "c2", name: "read_file", arguments: { path: "src/b.ts" } }),
      ev("tool.requested", { agent: "main", callId: "c3", name: "read_file", arguments: { path: "src/a.ts" } }),
      ev("tool.requested", { agent: "main", callId: "c4", name: "run", arguments: { command: "npm test" } }),
      ev("tool.result", { agent: "main", callId: "c4", name: "run", content: "[exit code 0]\nTests  12 passed (12)", verified: true }),
      ev("tool.requested", { agent: "main", callId: "c5", name: "run", arguments: { command: "curl x" } }),
      ev("tool.denied", { agent: "main", callId: "c5", name: "run", rule: "deny run(curl *)", reason: "No outbound calls." }),
      ev("tool.requested", { agent: "main", callId: "c6", name: "edit_file", arguments: { path: "src/a.ts" } }),
    ];
    const t = buildTimeline(log, "normal");
    const lines = flat(t.items);
    expect(lines).toEqual([
      "Work started",
      "Read 2 files · Ran the tests — 12 passed · Thought it through",
      "An action was refused by your rules: It was not carried out. The work continues without it.",
      "Changed 1 file",
    ]);
    expect(JSON.stringify(t.items)).not.toContain("curl");
    expect(JSON.stringify(t.items)).not.toContain("deny run");
    expect(t).toMatchObject({ toolCalls: 6, denials: 1, actions: 6 });
  });

  it("groups a sub-agent's steps under its brief, with its outcome, and marks one that stopped", () => {
    seq = 0;
    const log = [
      ev("run.started"),
      ev("subagent.started", { agent: "main", subagent: "main.sub-1", brief: { objective: "Survey the payment code. Report every entry point.", outputFormat: "A list", boundaries: "Read only" } }),
      ev("tool.requested", { agent: "main.sub-1", name: "list_files", arguments: {} }),
      ev("message", { agent: "main.sub-1", kind: "agent.reply", final: true, text: "Found four entry points." }),
      ev("subagent.finished", { agent: "main", subagent: "main.sub-1", stopReason: "completed", summary: "Four entry points, all in one folder.", steps: 3, credits: 0.8 }),
      ev("subagent.started", { agent: "main", subagent: "main.sub-2", brief: { objective: "Fix the export." } }),
      ev("subagent.finished", { agent: "main", subagent: "main.sub-2", stopReason: "max_steps", summary: "Ran out of steps." }),
    ];
    const g = groups(buildTimeline(log, "normal").items);
    expect(g.map((x) => [x.title, x.outcome, x.status])).toEqual([
      ["Survey the payment code.", "Four entry points, all in one folder.", "done"],
      ["Fix the export.", "Ran out of steps.", "stopped"],
    ]);
    expect(flat(g[0]?.items ?? [])).toEqual(["Looked through the files · Thought it through"]);
    expect(g[0]?.credits).toBe(0.8);
  });
});

describe("buildTimeline — technical mode", () => {
  it("shows every event with its raw payload, still grouped under the sub-agent that wrote it", () => {
    const t = buildTimeline(researchLog(), "technical");
    const text = JSON.stringify(t.items);
    expect(text).toContain("vendor/model-small");
    const judge = groups(t.items).find((g) => g.agent === "judge");
    expect(judge?.items.map((i) => i.title)).toEqual(["agent.start · judge", "agent.reply · judge"]);
    const top = t.items.filter((i) => i.kind === "step");
    expect(top.some((i) => i.kind === "step" && i.title.startsWith("Model call: vendor/model-small"))).toBe(true);
    expect(top.every((i) => i.kind === "step" && i.raw !== null)).toBe(true);
  });
});

describe("titles and outcomes", () => {
  it("titles a strand, a judge, a brief and an unknown agent in plain words", () => {
    expect(groupTitle("contractor-gap", {})).toBe("Looked for the gap that is left");
    expect(groupTitle("judge", {})).toBe("Weighed the evidence and wrote the verdict");
    expect(groupTitle("main.sub-3", {})).toBe("A contractor's piece of the work (3)");
    expect(groupTitle("x", { title: "Checked the pricing" })).toBe("Checked the pricing");
    expect(groupTitle("brand-designer", {})).toBe("Brand designer");
  });

  it("reads an outcome from a JSON report or from prose", () => {
    expect(outcomeOf('{"headline":"Do not build"}')).toBe("Do not build");
    expect(outcomeOf("Done. Then more.")).toBe("Done.");
    expect(outcomeOf("Here it is {not json}")).toBe("Here it is");
  });
});

describe("the security review's agents, by what they did (R6-6)", () => {
  const none = () => null;
  it("names every repair of the findings, the second as the first, and the correction of the app's documents", () => {
    expect(factoryAgentTitle("builder-security-repair", none)).toBe("Fixed what the security review found, at no charge");
    expect(factoryAgentTitle("builder-security-repair-1", none)).toBe("Fixed what the security review found, at no charge");
    expect(factoryAgentTitle("builder-security-docs", none)).toBe("Corrected what the app’s documents say, at no charge");
    expect(factoryAgentTitle("security-reviewer-0", none)).toBe("Reviewed the app for misuse of the platform");
    expect(factoryAgentTitle("security-reviewer-2", none)).toBe("Reviewed the fixes");
  });
});
