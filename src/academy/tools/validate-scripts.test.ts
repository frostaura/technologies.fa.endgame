// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlows } from "./parse-flows.ts";
import { schemaPath, validateScripts } from "./validate-scripts.ts";
import { PERSONAS, SCENARIOS } from "../src/content/scripts.ts";

const content = parseFlows(path.resolve(import.meta.dirname, "../../../docs/flows"));

function sandbox(files: Record<string, unknown>, shots: string[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "academy-scripts-"));
  const scripts = path.join(dir, "scripts");
  const shotsDir = path.join(dir, "shots");
  mkdirSync(scripts);
  mkdirSync(shotsDir);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(scripts, name), typeof body === "string" ? body : JSON.stringify(body));
  for (const s of shots) writeFileSync(path.join(shotsDir, s), "");
  return validateScripts(content.flows, scripts, shotsDir);
}

const ok = { flow: "ID-02", persona: "signed-out", scenario: "established", start: "/sign-in", steps: [{ step: 1, kind: "demo", highlight: { text: "Sign in" } }] };

describe("the step-script validator", () => {
  it("accepts every script in the repository, and proves each kind", () => {
    const report = validateScripts(content.flows);
    expect(report.problems).toEqual([]);
    expect(report.coverage.flowsWithScript).toBeGreaterThanOrEqual(14);
    for (const kind of ["demo", "terminal", "request", "email"]) expect(report.coverage.byKind[kind]).toBeGreaterThan(0);
    for (const id of ["ID-01", "ID-02", "ORG-04", "ORG-07", "IDEA-02", "VERD-03", "RUN-01", "BLD-03", "APP-04", "CRED-01", "OP-02", "OPS-01", "OPS-12", "AST-05"]) expect(report.scripts[id]).toBeDefined();
  });

  it("accepts a well-formed script", () => {
    expect(sandbox({ "ID-02.json": ok }).problems).toEqual([]);
  });

  it("refuses a script for a flow that does not exist, or under the wrong name", () => {
    expect(sandbox({ "ZZ-99.json": { ...ok, flow: "ZZ-99" } }).problems[0]).toMatch(/no flow ZZ-99/);
    expect(sandbox({ "ID-01.json": ok }).problems[0]).toMatch(/"flow" says ID-02/);
  });

  it("refuses a step the flow does not have, a step scripted twice, and an empty demo step", () => {
    const p = sandbox({ "ID-02.json": { ...ok, steps: [{ step: 9, kind: "demo", note: "x", highlight: { text: "a" } }, { step: 1, kind: "demo", note: "x" }, { step: 1, kind: "demo", goto: "/" }] } }).problems.join("\n");
    expect(p).toMatch(/step 9 does not exist/);
    expect(p).toMatch(/sends the console nothing/);
    expect(p).toMatch(/scripted twice/);
  });

  it("refuses schema violations: an unknown kind, a bad route, a terminal step with no output", () => {
    expect(sandbox({ "ID-02.json": { ...ok, steps: [{ step: 1, kind: "video" }] } }).problems.length).toBeGreaterThan(0);
    expect(sandbox({ "ID-02.json": { ...ok, start: "sign-in" } }).problems.join()).toMatch(/start/);
    expect(sandbox({ "ID-02.json": { ...ok, steps: [{ step: 1, kind: "terminal", command: "make up" }] } }).problems.length).toBeGreaterThan(0);
    expect(sandbox({ "ID-02.json": "{ not json" }).problems[0]).toMatch(/not valid JSON/);
  });

  it("requires a named image to be on disk", () => {
    const image = { ...ok, steps: [{ step: 1, kind: "image", file: "id-02-1.png", alt: "The sign-in screen" }] };
    expect(sandbox({ "ID-02.json": image }).problems[0]).toMatch(/does not exist/);
    expect(sandbox({ "ID-02.json": image }, ["id-02-1.png"]).problems).toEqual([]);
  });

  it("keeps the TypeScript types and the JSON Schema in step", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { properties: { persona: { enum: string[] }; scenario: { enum: string[] } } };
    expect(schema.properties.persona.enum).toEqual([...PERSONAS]);
    expect(schema.properties.scenario.enum).toEqual([...SCENARIOS]);
  });

  it("checks a script's variations: numbered from 1, each step saying what it shows", () => {
    const branch = { title: "A stranger is refused", persona: "signed-out", scenario: "established", start: "/sign-in", steps: [{ step: 1, kind: "demo", highlight: { text: "invite-only", note: "Refused." } }] };
    expect(sandbox({ "ID-02.json": { ...ok, variations: [branch] } }).problems).toEqual([]);
    expect(sandbox({ "ID-02.json": { ...ok, variations: [{ ...branch, steps: [{ step: 2, kind: "demo", highlight: { text: "a", note: "b" } }] }] } }).problems.join()).toMatch(/number them 1 to 1/);
    expect(sandbox({ "ID-02.json": { ...ok, variations: [{ ...branch, steps: [{ step: 1, kind: "demo", highlight: { text: "a" } }] }] } }).problems.join()).toMatch(/has no note/);
    expect(sandbox({ "ID-02.json": { ...ok, variations: [{ ...branch, persona: "nobody" }] } }).problems.length).toBeGreaterThan(0);
  });
});
