import { plainOrNull } from "@/lib/plain";
import type { AppVersion } from "@/store/types";

/**
 * A version's first line as the owner reads it: a plan item's id prefix ("frontend-books: …") is
 * dropped, the factory's own bookkeeping is named as such, and a line that still names files or
 * commands falls back to who made it. Technical mode shows the line as written.
 */
export function versionTitle(v: AppVersion, technical: boolean): string {
  const first = v.message.split("\n")[0]?.trim() ?? "";
  if (technical) return first || "A change";
  if (v.author.kind === "factory") return "The factory recorded its progress";
  const stripped = first.replace(/^[a-z0-9]+(?:-[a-z0-9]+)*:\s+/, "");
  const sentence = stripped ? `${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}` : "";
  return plainOrNull(sentence) ?? `A change by ${v.author.name}`;
}
