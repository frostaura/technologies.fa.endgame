import MiniSearch, { type AsPlainObject, type Options, type SearchResult } from "minisearch";
import type { Flow } from "./types.ts";
import { plain } from "./text.ts";

/**
 * The academy's search: one MiniSearch index over every flow, built at build time
 * (`tools/build-content.ts`) and loaded as JSON in the browser. Both sides use these options;
 * MiniSearch refuses a serialised index read with different ones.
 *
 * Flow ids and hyphenated words ("invite-only") are kept whole as well as split, so typing an id
 * or a message seen on screen finds the flow that explains it.
 */

export interface SearchDoc {
  id: string;
  code: string;
  title: string;
  labels: string;
  steps: string;
  refusals: string;
  about: string;
}

const SPLIT = /[\s,.;:!?()[\]{}"“”'‘’`*|/\\<>=+…·—–]+/u;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(SPLIT)) {
    const word = raw.replace(/^-+|-+$/g, "");
    if (!word) continue;
    out.push(word);
    if (word.includes("-")) out.push(...word.split("-").filter(Boolean));
  }
  return out;
}

export const searchOptions: Options<SearchDoc> = {
  idField: "id",
  fields: ["code", "title", "labels", "steps", "refusals", "about"],
  storeFields: [],
  tokenize,
  processTerm: (term) => term.toLowerCase(),
  searchOptions: {
    boost: { code: 8, title: 4, labels: 2, refusals: 1.5, steps: 1, about: 1 },
    prefix: (term) => term.length > 2,
    fuzzy: (term) => (term.length > 5 ? 0.15 : false),
    combineWith: "AND",
  },
};

export function documentOf(flow: Flow): SearchDoc {
  const steps = flow.steps.map((s) => s.text).join(" ");
  return {
    id: flow.id,
    code: [flow.id, ...flow.aliases].join(" "),
    title: flow.title,
    labels: flow.labels.join(" · "),
    steps: plain(steps + " " + flow.workedWhen),
    refusals: flow.variationsText,
    about: plain([flow.whatYouLearn, flow.who, flow.startsAt, flow.needs].join(" ")),
  };
}

export function buildIndex(flows: Flow[]): MiniSearch<SearchDoc> {
  const index = new MiniSearch<SearchDoc>(searchOptions);
  index.addAll(flows.map(documentOf));
  return index;
}

export function loadIndex(index: AsPlainObject): MiniSearch<SearchDoc> {
  return MiniSearch.loadJS<SearchDoc>(index, searchOptions);
}

export interface Hit {
  id: string;
  score: number;
  terms: string[];
}

/** Searches, falling back to "any word" when every word together finds nothing. */
export function search(index: MiniSearch<SearchDoc>, query: string, allow: (id: string) => boolean, limit = 12): Hit[] {
  const q = query.trim();
  if (!q) return [];
  let results: SearchResult[] = index.search(q, { filter: (r) => allow(String(r.id)) });
  if (!results.length) results = index.search(q, { combineWith: "OR", filter: (r) => allow(String(r.id)) });
  const exact = q.toUpperCase();
  results.sort((a, b) => Number(String(b.id) === exact) - Number(String(a.id) === exact) || b.score - a.score);
  return results.slice(0, limit).map((r) => ({ id: String(r.id), score: r.score, terms: r.terms }));
}
