import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Content, Flow, Level, Reach } from "../src/content/types.ts";
import { LEVELS } from "../src/content/types.ts";
import { normaliseLevel, normaliseReach, parseFlows, readTracks } from "./parse-flows.ts";

/**
 * Rewrites the parts of `docs/flows/README.md` that are counted from the five flow files: the
 * total, each file's count, the academy path's track tables and the "What has no screen" table.
 * Every flow is placed by its own **Level** and **Reachable from** fields, in the order the files
 * give them, so a flow added to a file reaches its track without a second edit.
 *
 *   node tools/readme-tracks.ts          rewrite the README
 *   node tools/readme-tracks.ts --check  fail if the README is not what the files say
 */

const REACH_WORDS: Record<Reach, string> = {
  screen: "Screen",
  api: "API or assistant only",
  cli: "Command line",
  automatic: "Automatic",
  none: "No route",
};
const REACH_ORDER: Reach[] = ["screen", "api", "cli", "automatic", "none"];

const label = (f: Flow) => (f.aliases.length ? `${f.id} to ${f.aliases[f.aliases.length - 1]}` : f.id);
const reachOf = (f: Flow): Reach => (f.unsupported ? "none" : normaliseReach(f.reachText));

/** A flow with no level of its own, or no steps, is listed under "Not placed in a track". */
export function placement(content: Content): { tracks: Map<Level, Flow[]>; unplaced: Flow[] } {
  const tracks = new Map<Level, Flow[]>(LEVELS.map((l) => [l, []]));
  const unplaced: Flow[] = [];
  for (const f of content.flows) {
    const level = normaliseLevel(f.levelText);
    if (!level || !f.steps.length || (content.unplaced.includes(f.id) && f.aliases.length > 0)) unplaced.push(f);
    else tracks.get(level)?.push(f);
  }
  return { tracks, unplaced };
}

function table(flows: Flow[], content: Content, reach: (f: Flow) => Reach): string[] {
  const area = new Map(content.areas.map((a) => [a.id, a]));
  return [
    "| Flow | What | Reached by | Area |",
    "| --- | --- | --- | --- |",
    ...flows.map((f) => {
      const a = area.get(f.area);
      return `| ${label(f)} | ${f.title.replace(/\|/g, "\\|")} | ${REACH_WORDS[reach(f)]} | [${a?.title ?? f.area}](${a?.file ?? ""}) |`;
    }),
  ];
}

/** The README with every counted part rewritten; everything else is kept as written. */
export function regenerate(readme: string, content: Content): string {
  const old = readTracks(readme);
  // The README's own word for how an unplaced entry is reached is kept: those are hand-written.
  const unplacedReach = (f: Flow): Reach => old.reach.get(f.id) ?? reachOf(f);
  const { tracks, unplaced } = placement(content);
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## The academy path"));
  const end = lines.findIndex((l) => l.startsWith("## What the reading found"));
  if (start < 0 || end < 0 || end < start) throw new Error('README.md: "## The academy path" or "## What the reading found" is missing.');

  const body = lines.slice(start, end);
  const intro: string[] = [];
  for (const l of body.slice(1)) {
    if (l.startsWith("### ")) break;
    intro.push(l);
  }
  /** The line or two of prose under a heading, kept exactly. */
  const prose = (heading: RegExp): string[] => {
    const at = body.findIndex((l) => heading.test(l));
    if (at < 0) return [];
    const out: string[] = [];
    for (const l of body.slice(at + 1)) {
      if (l.startsWith("|") || l.startsWith("#")) break;
      out.push(l);
    }
    return out.join("\n").trim() ? [out.join("\n").trim(), ""] : [];
  };

  const out: string[] = ["## The academy path", ...intro];
  if (out[out.length - 1]?.trim()) out.push("");
  for (const level of LEVELS) {
    const flows = tracks.get(level) ?? [];
    const screens = flows.filter((f) => reachOf(f) === "screen").length;
    out.push(`### ${level} — ${flows.length} flows, ${screens} with a screen`, "", ...prose(new RegExp(`^### ${level} —`)), ...table(flows, content, reachOf), "");
  }
  out.push(`### Not placed in a track — ${unplaced.length}`, "", ...prose(/^### Not placed in a track/), ...table(unplaced, content, unplacedReach), "");

  const counts = new Map<Reach, number>(REACH_ORDER.map((r) => [r, 0]));
  for (const f of content.flows) {
    const r = unplaced.includes(f) ? unplacedReach(f) : reachOf(f);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  out.push("## What has no screen", "", "| Reached by | Flows |", "| --- | --- |", ...REACH_ORDER.map((r) => `| ${REACH_WORDS[r]} | ${counts.get(r) ?? 0} |`), "");

  const head = lines.slice(0, start).map((l) => {
    if (/^\*\*\d+ flows\*\* in /.test(l)) return l.replace(/^\*\*\d+ flows\*\*/, `**${content.flows.length} flows**`);
    const row = /^\|\s*\[[^\]]+\]\((0\d-[^)]+\.md)\)\s*\|(.*)\|\s*\d+\s*\|\s*$/.exec(l);
    if (!row) return l;
    const a = content.areas.find((x) => x.file === row[1]);
    const n = content.flows.filter((f) => f.area === a?.id).length;
    return l.replace(/\|\s*\d+\s*\|\s*$/, `| ${n} |`);
  });
  return [...head, ...out, ...lines.slice(end)].join("\n");
}

function main() {
  const docs = path.resolve(import.meta.dirname, "../../../docs/flows");
  const file = path.join(docs, "README.md");
  const readme = readFileSync(file, "utf8");
  const next = regenerate(readme, parseFlows(docs));
  if (process.argv.includes("--check")) {
    if (next !== readme) {
      process.stderr.write("docs/flows/README.md is not what the flow files say. Run `npm run readme` in src/academy (make academy-readme) and commit it.\n");
      process.exit(1);
    }
    process.stdout.write("docs/flows/README.md matches the flow files.\n");
    return;
  }
  if (next === readme) process.stdout.write("docs/flows/README.md already matches the flow files.\n");
  else {
    writeFileSync(file, next);
    process.stdout.write("docs/flows/README.md rewritten from the flow files.\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}
