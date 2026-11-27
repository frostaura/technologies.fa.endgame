import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MemoryChange } from "@/store/types";
import { expectedMonthly, groupedTools, memoryChangeTitle, memoryChangeWhy, nameWithRole, personLabels, plainTool, toolLabel, workStatus } from "./workforceModel";

const SRC = path.join(import.meta.dirname, "../../../..");

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (["bin", "obj", "node_modules", "Fixtures"].includes(name)) return [];
    return statSync(full).isDirectory() ? files(full, ext) : full.endsWith(ext) ? [full] : [];
  });
}

/** Every tool the harness defines: the `Name` of each class that implements `ITool`. */
function harnessTools(): string[] {
  const names = new Set<string>();
  for (const file of files(path.join(SRC, "backend"), ".cs")) {
    const text = readFileSync(file, "utf8");
    if (!/[:,]\s*ITool\b/.test(text)) continue;
    for (const m of text.matchAll(/Name => "([a-z_]+)"/g)) if (m[1]) names.add(m[1]);
  }
  return [...names];
}

/** Every tool an employee holds in the demo's worlds. */
function demoTools(): string[] {
  const names = new Set<string>();
  for (const file of files(path.join(SRC, "frontend/src/demo/world"), ".ts")) {
    for (const list of readFileSync(file, "utf8").matchAll(/tools: \[([^\]]*)\]/g)) for (const m of (list[1] ?? "").matchAll(/"([a-z_]+)"/g)) if (m[1]) names.add(m[1]);
  }
  return [...names];
}

const change = (c: Partial<MemoryChange>): MemoryChange => ({ id: "c1", memoryId: "m1", action: "removed", by: "person", userId: "u1", runId: null, detail: null, at: "2026-11-26T10:00:00Z", ...c });

describe("what an employee may use, in plain words (D23)", () => {
  it("has a plain name for every tool the harness can send, and every tool the demo gives", () => {
    const tools = [...harnessTools(), ...demoTools()];
    expect(tools.length).toBeGreaterThan(15);
    expect(tools.filter((t) => plainTool(t) === null)).toEqual([]);
  });

  it("never prints a raw name in normal mode", () => {
    expect(["commit", "load_skill", "remember"].map((t) => toolLabel(t, "normal"))).toEqual(["Save its work", "Use a skill", "Remember things"]);
    expect(toolLabel("commit", "technical")).toBe("Save its work (commit)");
  });
});

describe("a hire's name and role (D21)", () => {
  it("keeps the role as written, and says a name that is the role once", () => {
    expect(nameWithRole("Nadia", "QA engineer")).toBe("Nadia, QA engineer");
    expect(nameWithRole("Product researcher", "product researcher")).toBe("Product researcher");
  });
});

describe("what a hire is expected to cost (D24)", () => {
  it("never more than its own budget", () => {
    expect(expectedMonthly({ expectedMonthlyCredits: 1500, jobDescription: { monthlyCreditLimit: 800 } })).toBe(800);
    expect(expectedMonthly({ expectedMonthlyCredits: 300, jobDescription: { monthlyCreditLimit: 800 } })).toBe(300);
    expect(expectedMonthly({ expectedMonthlyCredits: 300, jobDescription: { monthlyCreditLimit: null } })).toBe(300);
  });
});

describe("the memory's change log (D28)", () => {
  it("quotes a reason only when one was given", () => {
    expect(memoryChangeWhy(change({ detail: { title: "Old desk", why: "Removed by a person" } }))).toBeNull();
    expect(memoryChangeWhy(change({ detail: { title: "Old desk", why: null } }))).toBeNull();
    expect(memoryChangeWhy(change({ by: "review", detail: { why: "No reason given." } }))).toBeNull();
    expect(memoryChangeWhy(change({ detail: { why: "The desk is retired" } }))).toBe("The desk is retired");
  });

  it("titles a correction from what it became", () => {
    const corrected = change({ action: "corrected", memoryId: "gone", detail: { before: { title: "Desk opens at 8" }, after: { title: "Desk opens at 9" } } });
    expect(memoryChangeTitle(corrected, [])).toBe("Desk opens at 9");
  });
});

describe("telling people and work apart", () => {
  const tree = { organisation: { id: "o", slug: "acme", name: "Acme" }, divisions: [{ slug: "c", name: "Community", projects: [{ slug: "reading", name: "Club Reading List", apps: [] }, { slug: "dive", name: "Dive Trip Ready", apps: [] }] }] } as never;

  it("names where each works when two people share a name and a role (real-stack 5), and only then", () => {
    const labels = personLabels(
      [
        { id: "n1", name: "Nadia", role: "QA engineer", scope: "acme/c/reading" },
        { id: "n2", name: "Nadia", role: "QA engineer", scope: "acme/c/dive" },
        { id: "k", name: "Kasper", role: "Software engineer", scope: "acme/c/dive" },
      ],
      tree,
    );
    expect(labels.get("n1")).toBe("Nadia · QA engineer, Club Reading List");
    expect(labels.get("n2")).toBe("Nadia · QA engineer, Dive Trip Ready");
    expect(labels.get("k")).toBe("Kasper · Software engineer");
  });

  it("says every state of a piece of work in one vocabulary, a cancelled or failed one never Finished", () => {
    expect(workStatus("cancelled")).toMatchObject({ label: "Cancelled", tone: "neutral", ended: true });
    expect(workStatus("failed")).toMatchObject({ label: "Did not succeed", tone: "bad" });
    expect(workStatus("succeeded").label).toBe(workStatus("done").label);
    expect(workStatus("waiting_approval")).toMatchObject({ label: "Waiting for you", tone: "warn" });
    expect(workStatus("blocked").label).toBe("Waiting to start");
  });

  it("groups a job's tools under headings, keeping one the console does not name under Other", () => {
    const groups = groupedTools(["read_file", "edit_file", "notes", "mystery_tool", "run(npm test)"]);
    expect(groups.map((g) => g.title)).toEqual(["Reading", "Changing the work", "Keeping track and others", "Other"]);
    expect(groups.find((g) => g.title === "Changing the work")?.tools).toEqual(["edit_file", "run(npm test)"]);
    expect(groups.find((g) => g.title === "Other")?.tools).toEqual(["mystery_tool"]);
  });
});
