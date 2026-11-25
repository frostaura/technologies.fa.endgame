import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Area, Block, Content, Field, Flow, Level, ParseProblem, Reach, Role, Step, Track } from "../src/content/types.ts";
import { LEVELS } from "../src/content/types.ts";
import { blockText, parseBlocks, plain } from "./markdown.ts";

/**
 * Reads `docs/flows/0*.md` (and the README's academy path) into typed content. Strict and loud:
 * every flow whose shape cannot be read is reported with its file and line, and a flow with no
 * steps is fatal unless the README lists it as "not placed in a track" (the documented entries
 * that do not exist yet, or are purely automatic).
 */

const FLOW_ID = /[A-Z]{2,5}-\d{2}/g;
const HEADING = /^([A-Z]{2,5}-\d{2})(?:\s+to\s+([A-Z]{2,5}-\d{2}))?\s+(.+)$/;

/** The fields every flow carries, in the README's words. */
const KNOWN = [
  "Who",
  "Starts at",
  "Needs",
  "Level",
  "Learn first",
  "What you learn",
  "Steps",
  "You know it worked when",
  "Variations and refusals",
  "Where",
  "Reachable from",
  "Covered by tests",
] as const;
type Known = (typeof KNOWN)[number];

/** Labels that are a flow's steps under another name. */
function stepsLabel(label: string): boolean {
  return /^Steps\b/.test(label) || label === "The rules, from the code";
}

function canonical(label: string): Known | null {
  if (stepsLabel(label)) return "Steps";
  return (KNOWN as readonly string[]).includes(label) ? (label as Known) : null;
}

/** A top-level bullet may carry several fields: `**Level:** Core · **Learn first:** ORG-02 · …`. */
const INLINE_FIELD = new RegExp(`\\*\\*(${KNOWN.join("|")}|Steps[^*:]*|The rules, from the code):\\*\\*`, "g");

function splitInlineFields(text: string): { label: string; value: string }[] {
  const matches = [...text.matchAll(INLINE_FIELD)];
  if (!matches.length || matches[0]?.index !== 0) return [];
  return matches.map((m, k) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = matches[k + 1]?.index ?? text.length;
    const value = text
      .slice(start, end)
      .trim()
      .replace(/\s*[·]\s*$/, "")
      .trim();
    return { label: m[1] ?? "", value };
  });
}

function emptyValue(v: string): boolean {
  return /^(—|-|none\.?|not applicable\.?)$/i.test(plain(v));
}

export function normaliseLevel(text: string): Level | null {
  const t = plain(text);
  if (emptyValue(t)) return null;
  for (const level of LEVELS) if (new RegExp(`^${level}\\b`, "i").test(t)) return level;
  return null;
}

export function normaliseReach(text: string): Reach {
  const t = plain(text).toLowerCase();
  if (/^ui\b|^screen|^ui;|^\(?ui/.test(t)) return "screen";
  if (/^(nowhere|—|none\b(?! \(automatic\)))/.test(t)) return "none";
  if (/command line|^ci\b|portainer|outside endgame/.test(t)) return "cli";
  if (/^(system|internal|none \(automatic\))/.test(t)) return "automatic";
  if (/^(api|mcp|inside the app)/.test(t)) return "api";
  return "screen";
}

const README_REACH: Record<string, Reach> = {
  Screen: "screen",
  "API or assistant only": "api",
  "Command line": "cli",
  Automatic: "automatic",
  "No route": "none",
};

export function rolesOf(who: string): Role[] {
  const t = plain(who).toLowerCase();
  const out = new Set<Role>();
  const members: Role[] = ["owner", "admin", "builder", "viewer"];
  if (/\bviewer (or|and) above|any member|anyone signed in|any signed-in|signed-in person|depends on the link|\bmembers?\b|^anyone\b|anyone who can/.test(t)) members.forEach((r) => out.add(r));
  if (/builder (or|and) above|\bbuilder\b|the approver/.test(t)) ["builder", "admin", "owner"].forEach((r) => out.add(r as Role));
  if (/admin (or|and) above|admin or owner|\badmins?\b/.test(t)) ["admin", "owner"].forEach((r) => out.add(r as Role));
  if (/\bowners?\b|first person|owner-to-be/.test(t)) out.add("owner");
  if (/\bviewer\b/.test(t)) out.add("viewer");
  if (/operator/.test(t) && !/not .*operator/.test(t)) out.add("operator");
  if (/end user|visitor|anonymous|stranger|invited person|keyboard and screen-reader/.test(t)) out.add("end-user");
  if (/assistant|\bkey's maker|\bmcp\b/.test(t)) out.add("assistant");
  if (/developer|tester|\bthe app\b/.test(t)) out.add("developer");
  if (/host administrator/.test(t)) out.add("host-admin");
  return [...out];
}

/** Quoted on-screen words: "…", “…” and **"…"**. */
export function harvestLabels(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/"([^"]{2,240})"|“([^”]{2,240})”/g)) {
      const v = plain(m[1] ?? m[2] ?? "");
      if (v.length >= 2) out.add(v);
    }
  }
  return [...out];
}

function routeOf(startsAt: string): string | null {
  for (const m of startsAt.matchAll(/`([^`]+)`/g)) {
    const v = (m[1] ?? "").trim();
    if (/^\/[A-Za-z0-9/{}_?=&.-]*$/.test(v) && !v.startsWith("/api") && !v.startsWith("/internal") && !v.startsWith("/mcp")) return v;
  }
  return null;
}

interface RawFlow {
  id: string;
  last: string | null;
  title: string;
  line: number;
  body: string[];
}

interface FileParse {
  area: Area;
  raw: { flow: RawFlow; section: string }[];
}

function readArea(file: string, text: string): FileParse {
  const lines = text.split("\n");
  const id = path.basename(file).slice(0, 2);
  const title = (lines.find((l) => l.startsWith("# ")) ?? "").replace(/^# /, "").replace(/\s+—\s+every flow$/i, "").trim();
  const firstSection = lines.findIndex((l) => l.startsWith("## ") || l.startsWith("### "));
  const summary = plain(lines.slice(1, firstSection).find((l) => l.trim() && !l.startsWith("#")) ?? "");
  const area: Area = { id, file: path.basename(file), title, summary, sections: [] };
  const raw: FileParse["raw"] = [];
  let section: Area["sections"][number] | null = null;
  let flow: RawFlow | null = null;
  let intro: string[] = [];
  const closeFlow = () => {
    if (flow && section) {
      raw.push({ flow, section: section.id });
      section.flows.push(flow.id);
    }
    flow = null;
  };
  lines.forEach((line, index) => {
    if (line.startsWith("## ")) {
      closeFlow();
      if (section) section.intro = parseBlocks(intro);
      intro = [];
      const heading = line.slice(3).trim();
      section = { id: `${id}-${area.sections.length + 1}`, title: heading, intro: [], flows: [] };
      area.sections.push(section);
      return;
    }
    if (line.startsWith("### ")) {
      closeFlow();
      if (section && !section.intro.length) section.intro = parseBlocks(intro);
      intro = [];
      const m = HEADING.exec(line.slice(4).trim());
      if (m) flow = { id: m[1] ?? "", last: m[2] ?? null, title: m[3] ?? "", line: index + 1, body: [] };
      return;
    }
    if (line.trim() === "---") {
      closeFlow();
      return;
    }
    if (flow) (flow as RawFlow).body.push(line);
    else intro.push(line);
  });
  closeFlow();
  const lastSection = area.sections[area.sections.length - 1];
  if (lastSection && !lastSection.intro.length) lastSection.intro = parseBlocks(intro);
  return { area, raw };
}

interface Fields {
  values: Map<Known, { text: string; blocks: Block[]; lines: string[]; label: string }[]>;
  extras: Field[];
  intro: Block[];
  loose: Block[];
}

function readFields(body: string[]): Fields {
  const values: Fields["values"] = new Map();
  const extras: Field[] = [];
  const introLines: string[] = [];
  const looseLines: string[] = [];
  let i = 0;
  let seenField = false;
  while (i < body.length) {
    const line = body[i] ?? "";
    const top = /^-\s+(.*)$/.exec(line);
    if (!top) {
      if (!seenField) introLines.push(line);
      else if (line.trim()) looseLines.push(line);
      i++;
      continue;
    }
    const nested: string[] = [];
    i++;
    while (i < body.length) {
      const next = body[i] ?? "";
      if (next.trim() !== "" && !/^\s/.test(next)) break;
      nested.push(next);
      i++;
    }
    const content = top[1] ?? "";
    const parts = splitInlineFields(content);
    if (parts.length) {
      seenField = true;
      parts.forEach((part, k) => {
        const key = canonical(part.label);
        if (!key) return;
        const isLast = k === parts.length - 1;
        const blocks = isLast ? parseBlocks(nested) : [];
        const list = values.get(key) ?? [];
        list.push({ text: part.value, blocks, lines: isLast ? nested : [], label: part.label });
        values.set(key, list);
      });
      continue;
    }
    const other = /^\*\*([^*]+?):\*\*\s*(.*)$/.exec(content);
    if (other && seenField) {
      extras.push({ label: other[1] ?? "", text: other[2] ?? "", blocks: parseBlocks(nested) });
      continue;
    }
    looseLines.push(line, ...nested);
  }
  return { values, extras, intro: parseBlocks(introLines), loose: parseBlocks(looseLines) };
}

function first(fields: Fields, key: Known): string {
  return fields.values.get(key)?.[0]?.text ?? "";
}

function blocksOf(fields: Fields, key: Known): Block[] {
  const entry = fields.values.get(key)?.[0];
  if (!entry) return [];
  return entry.text && !emptyValue(entry.text) ? [{ kind: "para", text: entry.text }, ...entry.blocks] : entry.blocks;
}

function stepsFrom(fields: Fields): { steps: Step[]; note: string } {
  const entries = fields.values.get("Steps") ?? [];
  const steps: Step[] = [];
  const notes: string[] = [];
  const many = entries.length > 1;
  for (const entry of entries) {
    const section = many ? entry.label : undefined;
    const list = entry.blocks.find((b): b is Extract<Block, { kind: "list" }> => b.kind === "list");
    if (list) {
      if (entry.text) notes.push(entry.text);
      for (const item of list.items) steps.push({ n: steps.length + 1, text: item.text, children: item.children, ...(section ? { section } : {}) });
      const after = entry.blocks.filter((b) => b !== list);
      if (after.length && steps.length) {
        const lastStep = steps[steps.length - 1];
        if (lastStep) lastStep.children = [...lastStep.children, ...after];
      }
    } else if (entry.text && !/^(none\b|\*\*not supported)/i.test(plain(entry.text)) && !/^not supported/i.test(plain(entry.text))) {
      steps.push({ n: steps.length + 1, text: entry.text, children: entry.blocks, ...(section ? { section } : {}) });
    } else if (entry.text) notes.push(entry.text);
  }
  return { steps, note: notes.join(" ") };
}

/** The README's track tables: id → level in README order, plus the "not placed" ids. */
export function readTracks(readme: string): { order: Map<Level, string[]>; reach: Map<string, Reach>; unplaced: string[]; summaries: Map<Level, string> } {
  const order = new Map<Level, string[]>();
  const summaries = new Map<Level, string>();
  const reach = new Map<string, Reach>();
  const unplaced: string[] = [];
  let current: Level | "unplaced" | null = null;
  let summaryPending = false;
  for (const line of readme.split("\n")) {
    const h = /^###\s+(.+?)\s+—/.exec(line) ?? /^###\s+(Not placed in a track)/.exec(line);
    if (line.startsWith("## ") || line.startsWith("### ")) {
      current = null;
      if (h) {
        const name = h[1] ?? "";
        const level = LEVELS.find((l) => l === name);
        current = level ?? (/not placed/i.test(name) ? "unplaced" : null);
        if (level) {
          order.set(level, []);
          summaryPending = true;
        }
      }
      continue;
    }
    if (summaryPending && current && current !== "unplaced" && line.trim() && !line.startsWith("|")) {
      summaries.set(current, plain(line));
      summaryPending = false;
      continue;
    }
    const row = /^\|\s*([A-Z]{2,5}-\d{2})(?:\s+to\s+([A-Z]{2,5}-\d{2}))?\s*\|[^|]*\|\s*([^|]+?)\s*\|/.exec(line);
    if (!row || !current) continue;
    const id = row[1] ?? "";
    const r = README_REACH[row[3] ?? ""];
    if (r) reach.set(id, r);
    if (current === "unplaced") unplaced.push(id);
    else order.get(current)?.push(id);
  }
  return { order, reach, unplaced, summaries };
}

/**
 * Moves every "learn first" ahead of the flow that needs it, otherwise keeping the given order.
 * A cycle cannot be honoured; each one found is passed to `onCycle` and broken where it closes.
 */
export function orderByPrerequisites(ids: string[], prereqs: (id: string) => string[], onCycle: (path: string[]) => void = () => {}): string[] {
  const inTrack = new Set(ids);
  const placed = new Set<string>();
  const out: string[] = [];
  const visiting = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) onCycle([...stack.slice(stack.indexOf(id)), id]);
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const p of prereqs(id)) if (inTrack.has(p)) visit(p);
    visiting.delete(id);
    stack.pop();
    placed.add(id);
    out.push(id);
  };
  ids.forEach(visit);
  return out;
}

export function parseFlows(docsDir: string): Content {
  const files = readdirSync(docsDir)
    .filter((f) => /^0\d-.*\.md$/.test(f))
    .sort();
  const readme = readFileSync(path.join(docsDir, "README.md"), "utf8");
  const tracks = readTracks(readme);
  const unplacedIds = new Set<string>();
  const problems: ParseProblem[] = [];
  const areas: Area[] = [];
  const flows: Flow[] = [];
  const trackOf = new Map<string, Level>();
  for (const [level, ids] of tracks.order) for (const id of ids) trackOf.set(id, level);

  for (const file of files) {
    const { area, raw } = readArea(file, readFileSync(path.join(docsDir, file), "utf8"));
    areas.push(area);
    for (const { flow: r, section } of raw) {
      const fields = readFields(r.body);
      const aliases: string[] = [];
      if (r.last) {
        const [prefix, from] = r.id.split("-");
        const to = Number(r.last.split("-")[1]);
        for (let n = Number(from) + 1; n <= to; n++) aliases.push(`${prefix}-${String(n).padStart(2, "0")}`);
      }
      const report = (message: string, fatal = false) => problems.push({ flow: r.id, file, line: r.line, message, fatal });
      const parsed = stepsFrom(fields);
      const note = parsed.note;
      let steps = parsed.steps;
      let intro = fields.intro;
      // A grouped entry (AST-07 to AST-16) is a paragraph then one bullet per capability.
      if (!fields.values.size && fields.loose.length) {
        const list = fields.loose.find((b): b is Extract<Block, { kind: "list" }> => b.kind === "list");
        if (list) steps = list.items.map((item, k) => ({ n: k + 1, text: item.text, children: item.children }));
      }
      if (!fields.values.size && !steps.length) intro = [...fields.intro, ...fields.loose];
      const levelText = first(fields, "Level");
      const readmeLevel = trackOf.get(r.id) ?? null;
      const fieldLevel = normaliseLevel(levelText);
      if (readmeLevel && fieldLevel && readmeLevel !== fieldLevel) report(`Level says ${fieldLevel} but the README's academy path places it in ${readmeLevel}; the README's track is used.`);
      const level = readmeLevel ?? (tracks.unplaced.includes(r.id) ? null : fieldLevel);
      const learnFirstText = first(fields, "Learn first");
      const learnFirst = emptyValue(learnFirstText) ? [] : [...new Set(learnFirstText.match(FLOW_ID) ?? [])].filter((id) => id !== r.id);
      const reachText = first(fields, "Reachable from");
      const readmeReach = tracks.reach.get(r.id);
      const reach = readmeReach ?? normaliseReach(reachText);
      const unsupported = tracks.unplaced.includes(r.id) && !steps.length;
      if (unsupported) unplacedIds.add(r.id);

      for (const key of ["Who", "Level", "You know it worked when", "Where", "Reachable from"] as const) {
        if (!fields.values.has(key) && !unsupported && !r.last) report(`no "${key}" field`);
      }
      if (!steps.length && !unsupported) report(`no steps could be read${note ? ` (the steps field says: ${plain(note).slice(0, 80)})` : ""}`, true);
      const variations = blocksOf(fields, "Variations and refusals");
      const who = first(fields, "Who");
      const startsAt = first(fields, "Starts at");
      const allText = [
        ...steps.flatMap((s) => [s.text, ...blockText(s.children)]),
        ...blockText(variations),
        first(fields, "You know it worked when"),
        startsAt,
      ];
      flows.push({
        id: r.id,
        aliases,
        title: r.title.trim(),
        area: area.id,
        section,
        order: flows.length,
        who: emptyValue(who) ? "" : who,
        roles: rolesOf(who),
        startsAt: emptyValue(startsAt) ? "" : startsAt,
        startRoute: routeOf(startsAt),
        needs: emptyValue(first(fields, "Needs")) ? "" : first(fields, "Needs"),
        level,
        levelText: plain(levelText),
        learnFirst,
        learnFirstText: emptyValue(learnFirstText) ? "" : learnFirstText,
        whatYouLearn: emptyValue(first(fields, "What you learn")) ? "" : first(fields, "What you learn"),
        intro,
        steps,
        stepsNote: note,
        workedWhen: emptyValue(first(fields, "You know it worked when")) ? "" : first(fields, "You know it worked when"),
        variations,
        variationsText: blockText(variations).map(plain).join(" "),
        where: emptyValue(first(fields, "Where")) ? "" : first(fields, "Where"),
        reach,
        reachText: plain(reachText),
        tests: blocksOf(fields, "Covered by tests"),
        testsText: plain(first(fields, "Covered by tests")),
        extras: fields.extras,
        unsupported,
        labels: harvestLabels(allText),
      });
    }
  }

  // Cross-checks against the README's academy path.
  const byId = new Map<string, Flow>();
  for (const f of flows) {
    if (byId.has(f.id)) problems.push({ flow: f.id, file: areas.find((a) => a.id === f.area)?.file ?? "", line: 0, message: "duplicate flow id", fatal: true });
    byId.set(f.id, f);
    for (const a of f.aliases) byId.set(a, f);
  }
  for (const [level, ids] of tracks.order) for (const id of ids) if (!byId.has(id)) problems.push({ flow: id, file: "README.md", line: 0, message: `listed in the ${level} track but no such flow exists`, fatal: true });
  for (const f of flows) {
    // "Who: as ONT-02." — the same people as the flow it names.
    const same = /^as\s+([A-Z]{2,5}-\d{2})/i.exec(plain(f.who));
    if (!f.roles.length && same) f.roles = [...(byId.get(same[1] ?? "")?.roles ?? [])];
    for (const p of f.learnFirst) if (!byId.has(p)) problems.push({ flow: f.id, file: areas.find((a) => a.id === f.area)?.file ?? "", line: 0, message: `learn first names ${p}, which is not a flow`, fatal: false });
    f.learnFirst = f.learnFirst.map((p) => byId.get(p)?.id ?? p).filter((p, k, all) => byId.has(p) && all.indexOf(p) === k);
  }

  const builtTracks: Track[] = LEVELS.map((level) => {
    const ids = (tracks.order.get(level) ?? flows.filter((f) => f.level === level).map((f) => f.id)).map((id) => byId.get(id)?.id ?? id);
    return {
      level,
      title: level === "Operator" ? "Operator handbook" : level,
      summary: tracks.summaries.get(level) ?? "",
      flows: orderByPrerequisites(
        [...new Set(ids)],
        (id) => byId.get(id)?.learnFirst ?? [],
        (cycle) => {
          const f = byId.get(cycle[0] ?? "");
          problems.push({ flow: cycle[0] ?? "", file: areas.find((a) => a.id === f?.area)?.file ?? "", line: 0, message: `learn-first goes round in a circle (${cycle.join(" → ")}); the ${level} path breaks it where it closes`, fatal: false });
        },
      ),
    };
  });

  return {
    generatedFrom: ["docs/flows/README.md", ...files.map((f) => `docs/flows/${f}`)],
    flows,
    areas,
    tracks: builtTracks,
    unplaced: [...new Set(tracks.unplaced.map((id) => byId.get(id)?.id ?? id))],
    problems,
  };
}
