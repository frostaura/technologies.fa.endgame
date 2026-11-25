import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Flow } from "../src/content/types.ts";
import type { Persona, ScriptStep, StepScript } from "../src/content/scripts.ts";
import { parseFlows } from "./parse-flows.ts";
import { plain } from "./markdown.ts";

/**
 * `npm run script:new <FLOW-ID>` — scaffolds `scripts/<FLOW-ID>.json` from the parsed flow: one
 * entry per step, of the kind its "Reachable from" suggests, each spotlighting the first on-screen
 * label the step quotes. Edit it, then `npm run content` validates it.
 */

const root = path.resolve(import.meta.dirname, "..");

/** The least-privileged person who can do the flow: what a learner most needs to see. */
function persona(f: Flow): Persona {
  if (f.level === "Operator") return f.reach === "cli" ? "host-admin" : "operator";
  const order: Persona[] = ["viewer", "builder", "admin", "owner", "end-user", "assistant", "host-admin", "operator"];
  return order.find((p) => (f.roles as string[]).includes(p)) ?? "owner";
}

const RECORD: Record<string, string> = { ideas: "{idea}", runs: "{run}", apps: "{app}", employees: "{employee}", hires: "{hire}" };

function startRoute(route: string | null): string {
  if (!route) return "/";
  return route.replace(/^\/(\w+)\/\{id\}/, (m, kind: string) => (RECORD[kind] ? `/${kind}/${RECORD[kind]}` : m)).replace(/\{[^}]*\}/g, (m) => (Object.values(RECORD).includes(m) ? m : "x"));
}

function quoted(text: string): string | undefined {
  return /\*\*"([^"]+)"\*\*|"([^"]+)"/.exec(text)?.slice(1).find(Boolean);
}

function code(text: string): string | undefined {
  return /`([^`]+)`/.exec(text)?.[1];
}

export function scaffold(f: Flow): StepScript {
  const steps: ScriptStep[] = f.steps.map((s): ScriptStep => {
    const note = plain(s.text).slice(0, 200);
    if (f.reach === "cli") return { step: s.n, kind: "terminal", command: code(s.text) ?? code(f.startsAt) ?? "make", output: [], note };
    if (f.reach === "api") {
      const m = /`(GET|POST|PUT|PATCH|DELETE) (\/[^`]*)`/.exec(`${s.text} ${f.where}`);
      return { step: s.n, kind: "request", method: (m?.[1] as "GET") ?? "GET", path: m?.[2] ?? "/api/", response: { status: 200 }, note };
    }
    const label = quoted(s.text);
    return { step: s.n, kind: "demo", ...(label ? { highlight: { text: label } } : {}), note };
  });
  return {
    $schema: "../schema/step-script.schema.json",
    flow: f.id,
    persona: persona(f),
    scenario: f.level === "Operator" ? "god-mode" : "established",
    start: startRoute(f.startRoute),
    steps,
  };
}

if (import.meta.main) {
  const id = (process.argv[2] ?? "").toUpperCase();
  const content = parseFlows(path.resolve(root, "../../docs/flows"));
  const f = content.flows.find((x) => x.id === id);
  if (!f) {
    process.stderr.write(`script:new: no flow ${id || "(none given)"}. Usage: npm run script:new -- ID-01\n`);
    process.exit(2);
  }
  const file = path.join(root, "scripts", `${f.id}.json`);
  if (existsSync(file)) {
    process.stderr.write(`script:new: ${path.relative(root, file)} already exists; edit it instead.\n`);
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify(scaffold(f), null, 2) + "\n");
  process.stdout.write(`Wrote ${path.relative(root, file)} with ${f.steps.length} steps. Fill in what each step shows, then run \`npm run content\`.\n`);
}
