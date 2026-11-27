import type { ConversationAttachment, ConversationCapabilities } from "@/store/types";
import { decide } from "./scripts";
import { chain, organisation, type World } from "./world";

/**
 * The conversation's files and "what it can use here" in the demo (ARCH-011), as the control plane
 * does them (`ConversationAttachments.cs`, `ConversationCapabilities.cs`): the same limits, the same
 * checks by a file's bytes, the same refusals in the same words, and capabilities read from the
 * world as it is. A file is kept in the page; a small one (under 512 KB) is kept with the world too,
 * so it still opens after a reload.
 */

export const LIMITS = { maxFiles: 10, maxFileBytes: 10 * 1024 * 1024, maxMessageBytes: 25 * 1024 * 1024, maxPixels: 40_000_000, maxTextCharacters: 200_000, maxUnsentPerPerson: 20 } as const;

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".xml", ".html", ".htm", ".css",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".cs", ".csproj", ".sln", ".py", ".go", ".rs", ".java", ".kt", ".kts",
  ".rb", ".php", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".toml", ".ini", ".cfg", ".conf", ".log",
  ".c", ".h", ".cpp", ".hpp", ".swift", ".scala", ".dart", ".lua", ".r", ".vue", ".svelte", ".graphql", ".proto",
  ".tf", ".dockerfile", ".gitignore", ".editorconfig", ".rst", ".tex", ".srt", ".vtt",
];
export const EXTENSIONS = [...IMAGE_EXTENSIONS, ".pdf", ...TEXT_EXTENSIONS];

/** Model tiers whose every model takes images (`ModelEntry.InputModalities`); the `chat` route reads text only. */
const IMAGE_TIERS = new Set(["research", "build", "build-t1", "build-t3"]);
/** Tiers whose route searches the web (`ModelRoute.WebSearch`). */
const SEARCH_TIERS = new Set(["research"]);

export interface DemoAttachment extends ConversationAttachment {
  scope: string;
  employeeId: string | null;
  uploadedBy: string;
  createdAt: string;
  /** A small file's bytes as a data URL, kept with the world; a larger one is held only in the page. */
  data: string | null;
}

/** Larger files' bytes, for this page only. */
const held = new Map<string, Blob>();

export class FileRefused extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function starts(bytes: Uint8Array, ...sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

/** What a file is, from its bytes, with what its kind needs: the pages of a PDF, the characters of text. */
export async function checkFile(file: File): Promise<{ kind: ConversationAttachment["kind"]; contentType: string; pages: number | null; characters: number | null }> {
  const name = file.name || "file";
  const ext = extensionOf(name);
  if (file.size === 0) throw new FileRefused(400, "attachment_empty", `${name} is empty.`);
  if (file.size > LIMITS.maxFileBytes) throw new FileRefused(413, "attachment_too_large", `${name} is larger than 10 MB, the most a file may be.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512)).toLowerCase();
  if (ext === ".svg" || ext === ".svgz" || /<svg[\s>]/.test(head)) throw new FileRefused(415, "attachment_svg", `${name}: SVG images are not accepted, because they can carry scripts. Send it as PNG instead.`);
  if (starts(bytes, 0x50, 0x4b, 0x03, 0x04) || starts(bytes, 0x1f, 0x8b) || starts(bytes, 0x37, 0x7a, 0xbc, 0xaf)) throw new FileRefused(415, "attachment_archive", `${name} is an archive. Archives are not accepted; attach the files inside it.`);
  const image = starts(bytes, 0x89, 0x50, 0x4e, 0x47) ? "image/png" : starts(bytes, 0xff, 0xd8, 0xff) ? "image/jpeg" : starts(bytes, 0x47, 0x49, 0x46, 0x38) ? "image/gif" : starts(bytes, 0x52, 0x49, 0x46, 0x46) && head.slice(8, 12) === "webp" ? "image/webp" : null;
  if (image) {
    if (!IMAGE_EXTENSIONS.includes(ext)) throw new FileRefused(415, "attachment_mismatch", `${name} is an image, but its name says otherwise. Name it for what it is and attach it again.`);
    if (image === "image/png" && bytes.length >= 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      if (view.getUint32(16) * view.getUint32(20) > LIMITS.maxPixels) throw new FileRefused(413, "attachment_too_many_pixels", `${name} is larger than 40 megapixels, the most an image may be.`);
    }
    return { kind: "image", contentType: image, pages: null, characters: null };
  }
  if (starts(bytes, 0x25, 0x50, 0x44, 0x46, 0x2d)) {
    if (ext !== ".pdf") throw new FileRefused(415, "attachment_mismatch", `${name} is a PDF, but its name says otherwise. Name it for what it is and attach it again.`);
    const pages = Math.max(1, (new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page[^s]/g) ?? []).length);
    return { kind: "pdf", contentType: "application/pdf", pages, characters: null };
  }
  if (IMAGE_EXTENSIONS.includes(ext) || ext === ".pdf") throw new FileRefused(415, "attachment_mismatch", `${name} is not the ${ext === ".pdf" ? "PDF" : "image"} its name says. Attach the file itself.`);
  if (!TEXT_EXTENSIONS.includes(ext)) throw new FileRefused(415, "attachment_kind", `${name}: this kind of file is not accepted. Images (PNG, JPEG, WebP, GIF), PDFs and text files are.`);
  if (bytes.includes(0)) throw new FileRefused(415, "attachment_binary", `${name} is not text, although its name says it is.`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FileRefused(415, "attachment_binary", `${name} is not readable text. Save it as UTF-8 and attach it again.`);
  }
  return { kind: "text", contentType: ext === ".json" ? "application/json" : "text/plain; charset=utf-8", pages: null, characters: Math.min(text.length, LIMITS.maxTextCharacters) };
}

export async function keep(world: World, a: Omit<DemoAttachment, "data">, file: File): Promise<DemoAttachment> {
  const small = file.size <= 512 * 1024;
  const data = small
    ? await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      })
    : null;
  if (!small) held.set(a.id, file);
  const kept: DemoAttachment = { ...a, data };
  (world.attachments ??= []).push(kept);
  return kept;
}

export function content(a: DemoAttachment): Blob | null {
  if (a.data) {
    const [meta, body] = a.data.split(",", 2);
    const binary = atob(body ?? "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: meta?.match(/^data:([^;,]+)/)?.[1] ?? a.contentType });
  }
  return held.get(a.id) ?? null;
}

export function view(a: DemoAttachment): ConversationAttachment {
  return { id: a.id, name: a.name, contentType: a.contentType, kind: a.kind, bytes: a.bytes, pages: a.pages, characters: a.characters, runId: a.runId };
}

/** Whoever answers at a tier can look at images. */
export function takesImages(tier: string): boolean {
  return IMAGE_TIERS.has(tier);
}

const SKILLS: ConversationCapabilities["skills"] = [
  { name: "add-an-endpoint", trigger: "Adding or changing an HTTP endpoint in an app's API.", usedBy: "builders" },
  { name: "add-an-entity", trigger: "Adding a new kind of thing an app stores, end to end: entity, database, API, screen and tests.", usedBy: "builders" },
  { name: "build-on-the-app-kit", trigger: "Before changing any Endgame app: where things go, the five rules, and the commands that prove a change.", usedBy: "builders" },
  { name: "write-a-migration", trigger: "Changing an app's database schema: a new entity, column, index or constraint.", usedBy: "builders" },
  { name: "write-a-screen", trigger: "Writing or changing a front-end page or form in an app, with its four states, its test ids and its tests.", usedBy: "builders" },
  { name: "security-review-checklist", trigger: "Reviewing an app before it is published, for misuse of the platform's services.", usedBy: "security review" },
];

const CONVERSATION_TOOLS = ["read_organisation", "start_idea", "change_app", "try_again", "adjust_setting"];
const CHECKPOINTS = ["start_idea", "change_app", "try_again", "adjust_setting"];

function count(n: number, one: string, many: string): string | null {
  return n > 0 ? `${n} ${n === 1 ? one : many}` : null;
}

function within(scope: string, path: string): boolean {
  return path === scope || path.startsWith(`${scope}/`);
}

/** `ConversationCapabilitiesService.ForAsync`, read from the world. */
export function capabilities(world: World, scope: string, employeeId: string | null): ConversationCapabilities {
  const worker = employeeId ? world.employees.find((e) => e.id === employeeId) : undefined;
  const tier = worker?.jobDescription.modelTier ?? "chat";
  const rule = (tool: string) => {
    const d = decide(world, scope, "conversation", tool, "", true);
    const at = d.rule.match(/^cascade:([^:]+):/)?.[1] ?? null;
    return { verdict: d.verdict === "deny" ? ("may-not" as const) : d.verdict === "ask" ? ("asks" as const) : ("may" as const), at: d.rule.startsWith("cascade:") ? at : null };
  };
  const search = rule("web_search");
  const searchAvailable = SEARCH_TIERS.has(tier);
  const tools = [...CONVERSATION_TOOLS, ...(worker ? ["remember"] : [])].filter((t) => rule(t).verdict !== "may-not");
  if (searchAvailable && search.verdict !== "may-not") tools.push("web_search");
  const asks = tools.filter((t) => CHECKPOINTS.includes(t) || rule(t).verdict === "asks");
  const apps = world.apps.filter((a) => within(scope, a.path));
  const stopped = world.runs.some((r) => within(scope, r.run.scope) && (r.run.status === "failed" || r.run.status === "cancelled") && (r.run.kind === "research" || r.run.kind === "build" || r.run.kind === "task"));
  const actions = CHECKPOINTS.filter((t) => tools.includes(t)).filter((t) => !(t === "change_app" && apps.length === 0) && !(t === "try_again" && !stopped));
  const secrets = world.secrets.filter((s) => chain(scope).includes(s.path)).length;
  const people = apps.reduce((n, a) => n + a.endUsers, 0);
  const org = organisation(world, scope.split("/")[0] ?? scope);
  const now = Date.now();
  return {
    scope,
    answerer: worker ? { kind: "employee", name: worker.name, role: worker.role, employeeId: worker.id, tier } : { kind: "assistant", name: null, role: null, employeeId: null, tier },
    tools,
    asks,
    actions,
    skills: SKILLS,
    services: [
      { id: "identity", detail: count(people, "person has an account", "people have accounts")?.concat(" in the apps here") ?? null },
      { id: "models", detail: null },
      { id: "secrets", detail: count(secrets, "secret", "secrets")?.concat(" set here") ?? null },
      { id: "email", detail: null },
      { id: "schedules", detail: null },
      { id: "webhooks", detail: null },
      { id: "telemetry", detail: null },
    ],
    apps: apps.length,
    webSearch: { available: searchAvailable, rule: search.verdict, setAtPath: search.at },
    assistants: world.tokens
      .filter((t) => t.organisation === org?.slug && t.active && !t.revokedAt && (!t.expiresAt || Date.parse(t.expiresAt) > now))
      .map((t) => ({ id: t.id, name: t.name, role: t.role, prefix: t.prefix, lastUsedAt: t.lastUsedAt })),
    narrowing: { noWebSearch: searchAvailable && search.verdict !== "may-not", answerOnly: actions.length > 0 },
    attachments: { maxFiles: LIMITS.maxFiles, maxFileBytes: LIMITS.maxFileBytes, maxMessageBytes: LIMITS.maxMessageBytes, images: takesImages(tier), extensions: EXTENSIONS },
  };
}
