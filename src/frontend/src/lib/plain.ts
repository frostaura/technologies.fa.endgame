/**
 * Normal mode speaks to the owner, never to a developer (CLAUDE.md rule 12). These checks find the
 * marks of machinery in a line of text — a raw key, an id, a model, a file, a command — so a screen
 * can leave that line to technical mode instead of printing it.
 */

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
/** A long hex run: a commit, a hash, a compact id. */
const HEX_ID = /\b[0-9a-f]{12,}\b/i;
/** `hire:stage:research:frostaura`, `item:backend-books` — a key, not a sentence. Not `https:` and not a time. */
const COLON_KEY = /(?<![\w/])(?!https?:)[a-z][\w.-]*:[a-z0-9][\w./-]*/i;
/** `anthropic/claude-sonnet-4`, `openai/gpt-5-mini`. */
const MODEL_ID = /\b[a-z0-9][\w-]*\/[\w.-]*(claude|gpt|gemini|llama|mistral|qwen|deepseek|grok|sonnet|haiku|opus|o\d)[\w.-]*/i;
/** A file: `api/Books/Book.cs`, `BooksEndpoints.cs`, `web/src/notes/`. An app's address is not one. */
const FILE = /(\b[\w-]+\.(cs|csproj|slnx?|tsx?|jsx?|mjs|json|md|sql|ya?ml|py|toml|lock|css|html|sh|env)\b)|((?<![\w/])(src|web|api|lib|tests?|docs|scripts|migrations)\/[\w./-]+)/i;
/** Commands and infrastructure words normal mode never uses; "JSON" is a prompt's word, never the owner's (D64). */
const MACHINERY = /(`[^`]+`)|\b(make (test|lint|build|up)|npm |dotnet|docker|git |pg_dump|container|repository|repo\b|commit\b|migration|endpoint|frontend|backend|openapi|mcp\b|json\b|http (get|post|put|patch|delete))/i;

export type TechnicalMark = "key" | "id" | "model" | "file" | "machinery";

/** What makes a line technical, or null when it reads as plain language. */
export function technicalMark(text: string): TechnicalMark | null {
  if (GUID.test(text) || HEX_ID.test(text)) return "id";
  if (MODEL_ID.test(text)) return "model";
  if (FILE.test(text.replace(/https?:\/\/\S+/g, ""))) return "file";
  if (COLON_KEY.test(text)) return "key";
  if (MACHINERY.test(text)) return "machinery";
  return null;
}

export function isPlain(text: string | null | undefined): boolean {
  return !text || technicalMark(text) === null;
}

/** The line when it is plain, otherwise null — for normal mode to drop rather than print. */
export function plainOrNull(text: string | null | undefined): string | null {
  return text && isPlain(text) ? text : null;
}

/** A quoted slug path (`'acme/tools'`), which plain words never carry. */
const QUOTED_PATH = /'[a-z0-9][\w.-]*(\/[\w.-]+)+'/gi;

/**
 * A sentence's scope paths retold as words: "at 'acme/tools'" and "at acme/tools" are "here", a leading quoted path is
 * "This", any other quoted path "this part". Normal mode never prints a scope path in a sentence.
 */
export function withoutPaths(text: string): string {
  return text
    .replace(/ at '[a-z0-9][\w./-]*'/gi, " here")
    .replace(/ at [a-z0-9][\w.-]*(\/[a-z0-9][\w.-]*)+(?=[\s,.;:!?)]|$)/gi, " here")
    .replace(/^'[a-z0-9][\w.-]*(\/[\w.-]+)+'/i, "This")
    .replace(QUOTED_PATH, "this part");
}

/** A raw tool line an older notice kept as its detail: "adjust_setting: hire_checkpoint=false.", "try_again: 075ba848-…". */
const RAW_TOOL_LINE = /^[a-z_]+: /;

/**
 * A notice's or approval's detail and its technical line (R2-5). One raised before the plain-detail fix kept the raw
 * tool line as its detail and has no `technical` field: that line is technical, shown in technical mode only.
 */
export function plainDetail(detail: string | null, technical: string | null | undefined): { detail: string | null; technical: string | null } {
  if ((technical === null || technical === undefined) && detail && RAW_TOOL_LINE.test(detail.trim())) return { detail: null, technical: detail };
  return { detail, technical: technical ?? null };
}

/** The first sentence of a text, at most `max` characters, ending in an ellipsis when cut. */
export function firstSentence(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentence = clean.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** A title cut to a readable length at a word boundary; a trailing "..." from the server is tidied. */
export function shortTitle(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, " ").replace(/\.{3,}$|…$/, "").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:]+$/, "")}…`;
}
