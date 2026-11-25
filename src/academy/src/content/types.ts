/**
 * The academy's content model: what the build step reads out of `docs/flows/0*.md` and the step
 * scripts beside it. The markdown is the single source of truth; this is its typed shape.
 *
 * Inline text stays as the markdown it was written in (`**bold**`, `` `code` ``, `*em*`, links),
 * and `src/components/Inline.tsx` renders it. Nothing here is hand-copied from the docs.
 */

/** The academy paths, in learning order. `Operator` is the separate handbook. */
export const LEVELS = ["Foundation", "Core", "Advanced", "Developer", "Operator"] as const;
export type Level = (typeof LEVELS)[number];
export const CLIENT_LEVELS: readonly Level[] = ["Foundation", "Core", "Advanced", "Developer"];

/** How a flow is reached, normalised from its "Reachable from" field. */
export const REACHES = ["screen", "api", "cli", "automatic", "none"] as const;
export type Reach = (typeof REACHES)[number];

/** Who a flow is for, normalised from its "Who" field. */
export const ROLES = ["owner", "admin", "builder", "viewer", "operator", "end-user", "assistant", "developer", "host-admin"] as const;
export type Role = (typeof ROLES)[number];

export type Block =
  | { kind: "para"; text: string }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "table"; header: string[]; rows: string[][] };

export interface ListItem {
  text: string;
  children: Block[];
}

export interface Step {
  /** 1-based, continuous across the whole flow (a flow with two step sections numbers on). */
  n: number;
  text: string;
  children: Block[];
  /** The step section this step sits in, when a flow has more than one ("Steps in the console"). */
  section?: string;
}

export interface Field {
  label: string;
  text: string;
  blocks: Block[];
}

export interface Area {
  /** "01" … "05", from the file name. */
  id: string;
  file: string;
  title: string;
  summary: string;
  sections: { id: string; title: string; intro: Block[]; flows: string[] }[];
}

export interface Flow {
  id: string;
  /** Other ids this entry answers to (a grouped entry such as "AST-07 to AST-16"). */
  aliases: string[];
  title: string;
  area: string;
  section: string;
  /** Position across all five files, for stable ordering. */
  order: number;
  who: string;
  roles: Role[];
  startsAt: string;
  /** A console address named in "Starts at", if there is one (e.g. `/start`). */
  startRoute: string | null;
  needs: string;
  /** The path the flow sits on, or null when it is not placed in any. */
  level: Level | null;
  levelText: string;
  learnFirst: string[];
  learnFirstText: string;
  whatYouLearn: string;
  intro: Block[];
  steps: Step[];
  /** When the steps field is prose rather than a numbered list ("**Not supported by any route.**"). */
  stepsNote: string;
  workedWhen: string;
  variations: Block[];
  variationsText: string;
  where: string;
  reach: Reach;
  reachText: string;
  tests: Block[];
  testsText: string;
  /** Any other labelled field (Finding, Note, Oddity, What it changes …). */
  extras: Field[];
  /** True for the documented "not supported" entries, which have no steps on purpose. */
  unsupported: boolean;
  /** On-screen words quoted in the flow, for search. */
  labels: string[];
}

export interface ParseProblem {
  flow: string;
  file: string;
  line: number;
  message: string;
  /** A problem that fails the build, rather than one that is printed and carried. */
  fatal: boolean;
}

export interface Track {
  level: Level;
  title: string;
  summary: string;
  /** Flow ids in learning order: the README's order, with every "learn first" moved ahead of what needs it. */
  flows: string[];
}

export interface Content {
  generatedFrom: string[];
  flows: Flow[];
  areas: Area[];
  tracks: Track[];
  unplaced: string[];
  problems: ParseProblem[];
}
