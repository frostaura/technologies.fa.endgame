import { plain } from "../content/text.ts";

/** The on-screen label or refusal the query matched, if it matched one; otherwise what the flow teaches. */
export function snippet(f: { labels: string[]; whatYouLearn: string; variationsText: string; title: string }, terms: string[]): string {
  const hit = (s: string) => terms.some((t) => s.toLowerCase().includes(t.toLowerCase()));
  const label = f.labels.find(hit);
  if (label) return `“${label}”`;
  return plain(f.whatYouLearn) || f.title;
}
