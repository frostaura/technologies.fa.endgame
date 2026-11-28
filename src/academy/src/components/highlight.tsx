import { Fragment, type ReactNode } from "react";

/** Marks every occurrence of the search's terms in a run of plain text. */
export function highlight(text: string, terms: string[] | undefined, key = "h"): ReactNode {
  const words = (terms ?? []).map((t) => t.trim()).filter((t) => t.length >= 3);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(re);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2 ? <mark key={`${key}-${i}`} className="rounded-xxs bg-primary-tint text-ink">{part}</mark> : <Fragment key={`${key}-${i}`}>{part}</Fragment>));
}
