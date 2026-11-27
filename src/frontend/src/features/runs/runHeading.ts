import type { RunEvent } from "@/store/types";
import { str } from "./runModel";

/**
 * What a run page is called. The control plane names a run after the whole request, cut at about 120 characters
 * ("Build: A reading list for the supper club: members sign in, add books with a title, … mark a book as rea..."), which
 * makes a three-line heading that stops mid-word. The heading is a short name instead — what kind of work it is and the
 * first clause of what it is for — and the whole request is said under it.
 */

/** The longest short name, in characters, before it is cut back to a whole word. */
const LONGEST = 72;

/** The cut the control plane makes: three full stops (or an ellipsis) at the very end. */
const CUT = /(\.\.\.|…)\s*$/;

/** "Build: A reading list for the supper club" from the run's title; a short title is kept as it is. */
export function shortRunName(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const prefix = clean.match(/^(Build|Research|Change|Conversation|Task): /)?.[0] ?? "";
  const body = clean.slice(prefix.length).replace(CUT, "").trim();
  const wasCut = CUT.test(clean);
  if (!wasCut && clean.length <= LONGEST) return clean;
  // The first clause: up to a colon, a dash, a semicolon or the end of the first sentence.
  const clause = body.split(/: | — | – |; |\. (?=[A-Z])/)[0]?.replace(/[.,:;]+$/, "").trim() ?? body;
  const room = LONGEST - prefix.length;
  if (clause.length <= room) return `${prefix}${clause}`;
  // Still long: back to the last comma that leaves enough, else the last whole word, and say it goes on.
  const comma = clause.lastIndexOf(", ", room);
  if (comma > room / 2) return `${prefix}${clause.slice(0, comma)}`;
  const space = clause.lastIndexOf(" ", room - 1);
  return `${prefix}${clause.slice(0, space > 0 ? space : room).replace(/[.,:;]+$/, "")}…`;
}

/**
 * The whole request behind the work, in the owner's words: the change they asked for, or what they first wrote (the log's
 * first message from the owner); failing those, the run's own title without its kind, when that says more than the name.
 */
export function fullRequest(title: string, events: readonly RunEvent[]): string | null {
  const asked = events.find((e) => e.type === "message" && str(e.payload ?? {}, "from") === "owner");
  const words = asked ? (str(asked.payload, "change") ?? str(asked.payload, "text")) : null;
  const request = words ?? title.replace(/^(Build|Research|Change|Conversation|Task): /, "");
  const name = shortRunName(title).replace(/^(Build|Research|Change|Conversation|Task): /, "").replace(/…$/, "");
  const same = (a: string) => a.replace(/[\s.…]+$/g, "").toLowerCase();
  return same(request) === same(name) ? null : request;
}

/** A quoted phrase in straight single quotes ('like this') set in typographic quotes (“like this”). */
export function curlyQuotes(text: string): string {
  return text.replace(/(^|[\s(])'([^'\n]+)'(?=$|[\s.,:;!?)])/g, "$1“$2”");
}
