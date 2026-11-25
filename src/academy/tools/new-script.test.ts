// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlows } from "./parse-flows.ts";
import { scaffold } from "./new-script.ts";
import { compileSchema } from "./validate-scripts.ts";

const content = parseFlows(path.resolve(import.meta.dirname, "../../../docs/flows"));
const flow = (id: string) => {
  const f = content.flows.find((x) => x.id === id);
  if (!f) throw new Error(`no flow ${id}`);
  return f;
};
const valid = compileSchema();

describe("script:new", () => {
  it("pre-fills one entry per step that the schema accepts, from the parsed flow", () => {
    const s = scaffold(flow("VERD-02"));
    expect(s.steps).toHaveLength(flow("VERD-02").steps.length);
    expect(valid(s)).toBe(true);
    expect(s.start).toBe("/ideas/{idea}");
  });

  it("suggests the kind from how the flow is reached", () => {
    expect(scaffold(flow("OPS-12")).steps[0]?.kind).toBe("terminal");
    expect(scaffold(flow("OPS-12")).persona).toBe("host-admin");
    expect(scaffold(flow("AST-06")).steps[0]?.kind).toBe("request");
    expect(scaffold(flow("ID-02")).steps[0]).toMatchObject({ kind: "demo", highlight: { text: "Sign in with a passkey" } });
  });
});
