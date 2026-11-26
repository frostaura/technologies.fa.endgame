/**
 * The flow documents write what changes from case to case as `{Org}`, `{credits}`, `{reason}`: the
 * console fills them in. A learner reads them as what they stand for — "your organisation's name",
 * "number of credits" — set as a small variable token, in the site and in the PDFs. The flow files
 * keep their braces; only the academy reads them out.
 */

const WORDS: Record<string, string> = {
  organisation: "organisation name",
  division: "division name",
  "division path": "division path",
  project: "project name",
  app: "app name",
  name: "name",
  n: "number",
  "n.n": "number",
  reason: "reason",
  date: "date",
  credits: "number of credits",
  path: "path",
  role: "role",
  slug: "short name",
  part: "part",
  node: "place in the tree",
  level: "level",
  "level name": "level name",
  title: "title",
  label: "label",
  activity: "activity",
  "time ago": "how long ago",
  status: "status",
  spent: "credits spent",
  m: "minutes",
  h: "hours",
  id: "id",
  time: "time",
  outcome: "outcome",
  line: "line",
  host: "host",
  estimate: "estimate",
  email: "e-mail address",
  ceiling: "ceiling",
  total: "total",
  seq: "sequence number",
  run: "run",
  idea: "idea",
  employee: "employee",
  scope: "scope",
  kind: "kind",
  field: "field",
  error: "error",
  p: "percentage",
  appid: "app id",
};

/** `{Org}` → "your organisation's name" (the brace's own word, de-camel-cased, when there is no entry). */
export function placeholderWords(token: string): string {
  const inner = token.replace(/^\{|\}$/g, "").trim();
  if (/^org$/i.test(inner)) return "your organisation’s name";
  const known = WORDS[inner.toLowerCase()];
  if (known) return known;
  return inner
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

/** A placeholder as the flow files write one: a word or a few in braces. */
export const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9 ._-]*\}/;
