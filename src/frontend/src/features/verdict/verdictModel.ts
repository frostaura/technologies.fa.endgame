import { ShapeError, type Guard } from "@/lib/guards";
import { NO_VALUE } from "@/components/ui/stat";
import { formatNumber, plural } from "@/lib/format";
import type { DecisionChoice, ExistingProduct, Signal, Strand, Verdict, VerdictOutcome } from "@/store/types";

/**
 * The verdict document, read. Research writes it as JSON (ARCH-004, the verdict schema); older
 * runs wrote some sections as plain text or as `{ evidence }` objects, newer ones as structured
 * lists. Whatever arrived, the page gets one shape: lists are lists and texts are texts. Only a
 * document that cannot be a verdict at all — not an object, or no outcome — is refused, and the
 * page then shows a failed read instead of crashing.
 */

const OUTCOMES: readonly VerdictOutcome[] = ["build", "change", "do-not-build"];

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function texts(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => text(x) ?? (isObj(x) ? (text(x.text) ?? text(x.evidence) ?? text(x.summary)) : null)).filter((x): x is string => !!x);
  const t = text(v);
  return t ? [t] : [];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Long research prose split into readable paragraphs: on blank lines, or on numbered points "1) … 2) …". */
export function paragraphs(v: unknown): string[] {
  return texts(v).flatMap((t) => {
    const byBlank = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    if (byBlank.length > 1) return byBlank;
    const numbered = t.split(/\s(?=\d{1,2}\)\s)/).map((x) => x.trim()).filter(Boolean);
    return numbered.length > 1 ? numbered : [t];
  });
}

function urls(v: unknown): string[] {
  return texts(v).filter((u) => /^https?:\/\//i.test(u));
}

/** "Name (owner/repo) — what it does" → name and description; the dash forms research uses. */
function splitProduct(line: string): { name: string; does: string | null } {
  const m = line.match(/^(.+?)\s+[—–]\s+(.+)$/) ?? line.match(/^(.+?)\s+-\s+(.+)$/) ?? line.match(/^([^:]{2,80}):\s+(.+)$/);
  if (!m) return { name: line, does: null };
  return { name: (m[1] ?? line).trim(), does: (m[2] ?? "").trim() || null };
}

function product(v: unknown, allSources: string[]): ExistingProduct | null {
  if (isObj(v)) {
    const name = text(v.name) ?? text(v.product) ?? text(v.title);
    if (!name) return null;
    const own = [...urls(v.sources), ...urls(v.source), ...urls(v.url), ...urls(v.urls)];
    return { name, does: text(v.what) ?? text(v.does) ?? text(v.description) ?? text(v.summary), sources: own.length > 0 ? [...new Set(own)] : matching(name, allSources) };
  }
  const line = text(v);
  if (!line) return null;
  const { name, does } = splitProduct(line);
  return { name, does, sources: matching(name, allSources) };
}

/** A product with no address of its own: the research sources that mention it by name. */
function matching(name: string, allSources: string[]): string[] {
  const key = name.toLowerCase().replace(/\(.*?\)/g, "").trim().split(/[\s,:]+/)[0] ?? "";
  return key.length >= 4 ? allSources.filter((s) => s.toLowerCase().includes(key)).slice(0, 3) : [];
}

function strand(v: unknown): Strand | null {
  if (isObj(v)) {
    const id = text(v.id) ?? text(v.title);
    if (!id) return null;
    return { id, title: text(v.title) ?? id, searches: num(v.searches), sources: num(v.sources), confidence: text(v.confidence) };
  }
  const id = text(v);
  return id ? { id, title: id, searches: null, sources: null, confidence: null } : null;
}

const RED_LINES: Record<string, string> = {
  "tobacco-gambling-finance": "tobacco, exploitative gambling or predatory finance",
  weapons: "weapons against civilians",
  "animal-harm": "animal harm and industrial cruelty",
  surveillance: "surveillance and authoritarian tooling",
};

/** A red line by its code, in the words FrostAura's red lines use. */
export function redLineWords(line: string): string {
  return RED_LINES[line] ?? line;
}

function signal(v: unknown): Signal | null {
  if (isObj(v)) {
    const t = text(v.text) ?? text(v.signal) ?? text(v.evidence) ?? text(v.summary);
    return t ? { text: t, source: urls(v.source)[0] ?? urls(v.url)[0] ?? urls(v.sources)[0] ?? null } : null;
  }
  const t = text(v);
  return t ? { text: t, source: null } : null;
}

/** The demand section's first words say whether any was found ("No evidence of demand was found."). */
function demandFound(evidence: string[], signals: Signal[], explicit: unknown): boolean {
  if (typeof explicit === "boolean") return explicit;
  if (signals.length > 0) return true;
  const first = (evidence[0] ?? "").toLowerCase();
  return evidence.length > 0 && !/^no (evidence|demand|sign)/.test(first);
}

export const normaliseVerdict: Guard<Verdict> = (value, path) => {
  if (!isObj(value)) throw new ShapeError(path, "a verdict document", value);
  const v = value;
  const outcome = (text(v.outcome) ?? "").replace(/_/g, "-").toLowerCase() as VerdictOutcome;
  if (!OUTCOMES.includes(outcome)) throw new ShapeError(`${path}.outcome`, `one of ${OUTCOMES.join(", ")}`, v.outcome);

  const method = isObj(v.method) ? v.method : {};
  const existingSources = isObj(v.existing) ? urls(v.existing.sources) : [];
  const sources = [...new Set([...existingSources, ...urls(method.sources), ...urls(v.sources)])];

  // Existing products: a list of products, or { evidence, products }.
  const existingRaw = v.existing;
  const productList = Array.isArray(existingRaw) ? existingRaw : isObj(existingRaw) ? (existingRaw.products ?? existingRaw.items ?? []) : [];
  const products = (Array.isArray(productList) ? productList : [productList]).map((p) => product(p, sources)).filter((p): p is ExistingProduct => !!p);
  const existingEvidence = isObj(existingRaw) ? paragraphs(existingRaw.evidence ?? existingRaw.summary) : [];

  // The gap: text, a list, or { evidence }.
  const gapRaw = v.gap;
  const gap = isObj(gapRaw) ? paragraphs(gapRaw.evidence ?? gapRaw.summary ?? gapRaw.text) : paragraphs(gapRaw);

  // Demand: { evidence, signals }, or the older { paragraphs, evidenceFound }.
  const demandRaw = v.demand;
  const demandText = isObj(demandRaw) ? paragraphs(demandRaw.evidence ?? demandRaw.paragraphs ?? demandRaw.summary) : paragraphs(demandRaw);
  const signals = isObj(demandRaw) && Array.isArray(demandRaw.signals) ? demandRaw.signals.map(signal).filter((s): s is Signal => !!s) : [];

  // What would change it: text, or { text, changeLabel, estimateCredits }.
  const wc = v.wouldChange;
  const wouldChange = isObj(wc)
    ? (text(wc.text) ?? text(wc.evidence))
      ? { text: (text(wc.text) ?? text(wc.evidence)) as string, changeLabel: text(wc.changeLabel) ?? text(wc.label), estimateCredits: num(wc.estimateCredits) }
      : null
    : text(wc)
      ? { text: text(wc) as string, changeLabel: null, estimateCredits: null }
      : null;

  const rl = isObj(v.redLines) ? v.redLines : isObj(v.redLine) ? v.redLine : null;
  const redLines = rl ? { breached: rl.breached === true, line: text(rl.line), reasoning: text(rl.reasoning) ?? text(rl.why) } : null;

  const searches = texts(method.searches).filter((q) => !/^\d+$/.test(q));
  const pl = isObj(v.placement) ? v.placement : null;
  const placement = pl && (text(pl.name) ?? text(pl.division)) ? { division: text(pl.division), project: text(pl.project), app: text(pl.app), name: text(pl.name) } : null;
  return {
    outcome,
    headline: text(v.headline) ?? (outcome === "build" ? "Build it." : outcome === "change" ? "Build it, changed." : "Do not build it."),
    summary: text(v.summary) ?? text(v.against) ?? "",
    against: paragraphs(v.against ?? v.caseAgainst),
    existing: { evidence: existingEvidence, products },
    gap: { paragraphs: gap },
    demand: { paragraphs: demandText, signals, evidenceFound: demandFound(demandText, signals, isObj(demandRaw) ? demandRaw.evidenceFound : undefined) },
    suggestedChange: text(v.suggestedChange),
    wouldChange,
    placement,
    redLines,
    method: {
      summary: typeof v.method === "string" ? v.method : text(method.summary),
      argued: text(method.argued),
      strands: (Array.isArray(method.strands) ? method.strands : []).map(strand).filter((x): x is Strand => !!x),
      sources,
      searches,
      searchCount: num(method.searchCount) ?? num(method.searches) ?? (searches.length > 0 ? searches.length : null),
      confidence: text(method.confidence) ?? text(v.confidence),
      contractors: num(method.contractors),
    },
    rulesApplied: texts(v.rulesApplied),
  };
};

/** True when the idea may not be built at all: the verdict's red-line screen found one breached. */
export function redLineBreached(verdict: Verdict, ideaRedLine: string | null): string | null {
  if (ideaRedLine) return redLineWords(ideaRedLine);
  if (verdict.redLines?.breached) return verdict.redLines.line ? redLineWords(verdict.redLines.line) : "a red line";
  return null;
}

export interface Option {
  choice: DecisionChoice;
  label: string;
  variant: "primary" | "secondary" | "danger-outline";
}

/**
 * The decisions a verdict allows, as the control plane enforces them (`IdeaDecisions.IsAllowed`):
 * build after build or change; overrule only over a "do not build", recorded as one; change (a new
 * round of research with your note) and drop always. Over a breached red line nothing may be built,
 * so neither build nor overrule is offered.
 */
export function decisionOptions(verdict: Verdict, redLine: string | null = null): Option[] {
  const change = verdict.wouldChange?.changeLabel ? `Change it: ${verdict.wouldChange.changeLabel}` : "Change the idea";
  if (redLine) {
    return [
      { choice: "change", label: change, variant: "primary" },
      { choice: "drop", label: "Drop the idea", variant: "danger-outline" },
    ];
  }
  if (verdict.outcome === "build") {
    return [
      { choice: "build", label: "Build it", variant: "primary" },
      { choice: "change", label: change, variant: "secondary" },
      { choice: "drop", label: "Drop the idea", variant: "danger-outline" },
    ];
  }
  if (verdict.outcome === "change") {
    return [
      { choice: "change", label: change, variant: "primary" },
      { choice: "build", label: "Build it as described", variant: "secondary" },
      { choice: "drop", label: "Drop the idea", variant: "danger-outline" },
    ];
  }
  return [
    ...(verdict.wouldChange ? [{ choice: "change" as const, label: change, variant: "primary" as const }] : []),
    { choice: "overrule", label: "Overrule and build anyway", variant: verdict.wouldChange ? "secondary" : "primary" },
    { choice: "drop", label: "Drop the idea", variant: "danger-outline" },
  ];
}

/** A source shown by its site, never as a raw address. */
export function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Normal mode never names repositories: "Nightscout (nightscout/cgm-remote-monitor)" reads "Nightscout". */
export function plainProductName(name: string): string {
  return name.replace(/\s*\([^()]*\/[^()]*\)/g, "").trim() || name;
}

/** The same words, whatever the spacing, case or closing punctuation: so a page says a thing once. */
export function sameText(a: string, b: string): boolean {
  const flat = (s: string) => s.replace(/\s+/g, " ").replace(/[\s.!?…]+$/, "").trim().toLowerCase();
  const x = flat(a);
  const y = flat(b);
  return x.length > 0 && (x === y || (x.length > 60 && y.includes(x)));
}

/**
 * True when research looked at no market at all — what happens over a red line: no product found, no
 * signal, and every market section is research saying it did not look ("Not researched…", "Not looked
 * into…", "No evidence was gathered…"). The page then says so once, not three times.
 */
export function notResearched(verdict: Verdict): boolean {
  if (verdict.existing.products.length > 0 || verdict.demand.signals.length > 0) return false;
  const said = [...verdict.existing.evidence, ...verdict.gap.paragraphs, ...verdict.demand.paragraphs];
  return said.length > 0 && said.every((t) => /^(not (researched|looked)|no (evidence|market research) was (gathered|done))/i.test(t.trim()));
}

/** The sentences of a text, kept whole. */
function sentences(text: string): string[] {
  return (text.replace(/\s+/g, " ").trim().match(/[^.!?]+(?:[.!?]+["”’)]?|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * The verdict in a few lines, for the top of the page: research's own conclusion ("Verdict: do not
 * build. …") when it wrote one, otherwise its opening sentences — never the whole argument, which
 * sits behind "read the full reasoning". `full` is false when the short form already says it all.
 */
export function shortSummary(summary: string, max = 320): { text: string; full: boolean } {
  const all = sentences(summary).filter((s) => !/^the case against(,)? (argued )?first\.?$/i.test(s));
  if (all.length === 0) return { text: summary.trim(), full: true };
  const verdictAt = all.findIndex((s) => /^verdict\b/i.test(s));
  const from = verdictAt >= 0 ? all.slice(verdictAt + 1) : all;
  const picked: string[] = [];
  for (const s of from.length > 0 ? from : all) {
    if (picked.length >= 2 || (picked.length > 0 && [...picked, s].join(" ").length > max)) break;
    picked.push(s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  }
  const text = picked.join(" ");
  return { text, full: text.length >= summary.replace(/\s+/g, " ").trim().length - 30 };
}

/**
 * True when research ran no web search and read no source: the verdict is what the researcher already knew.
 * The page then says so once, and never counts what it knew as evidence it read.
 */
export function nothingSearched(verdict: Verdict): boolean {
  const m = verdict.method;
  if (!m || sourceCount(verdict) > 0) return false;
  const strandSearches = m.strands.reduce((n, x) => n + (x.searches ?? 0), 0);
  return (m.searchCount ?? 0) === 0 && strandSearches === 0 && (m.searchCount === 0 || m.strands.some((x) => x.searches === 0));
}

/** How many sources research read: its list, or what its strands counted when it kept no list. */
export function sourceCount(verdict: Verdict): number {
  const listed = new Set(verdict.method.sources).size;
  return listed > 0 ? listed : verdict.method.strands.reduce((n, x) => n + (x.sources ?? 0), 0);
}

/** Three short figures for the hero: what is already sold, how many signs of demand, and how sure research is. */
export function heroFacts(verdict: Verdict): { label: string; value: string; caption: string }[] {
  if (notResearched(verdict) || nothingSearched(verdict)) return [];
  const products = verdict.existing.products.length;
  const signals = verdict.demand.signals.length;
  const sources = sourceCount(verdict);
  const confidence = verdict.method?.confidence;
  return [
    { label: "Already sold", value: formatNumber(products), caption: products === 1 ? "product like it" : "products like it" },
    {
      label: "Demand",
      value: !verdict.demand.evidenceFound ? "None" : signals > 0 ? formatNumber(signals) : "Some",
      caption: !verdict.demand.evidenceFound ? "none found" : signals > 0 ? (signals === 1 ? "signal found" : "signals found") : "no signals listed",
    },
    { label: "Confidence", value: confidence ? `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)}` : NO_VALUE, caption: sources > 0 ? `from ${plural(sources, "source")}` : "no sources recorded" },
  ];
}


/** A title as a person would write it: older records kept the idea's first words in lower case. */
export function titleCase(text: string): string {
  const t = text.trim();
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : t;
}

/** Words cut to at most `max` characters at a word's end, with "…" — never part of a word ("the ho…"). */
export function wordClamp(text: string, max = 110): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const end = cut.lastIndexOf(" ");
  return `${(end > max / 2 ? cut.slice(0, end) : cut).replace(/[\s,;:.—–-]+$/, "")}…`;
}

/** Every source read, once per site: the site, the first address read there and how many were. */
export function sourceSites(urls: readonly string[]): { site: string; url: string; pages: number }[] {
  const bySite = new Map<string, { site: string; url: string; pages: number }>();
  for (const url of new Set(urls)) {
    const site = sourceLabel(url);
    const seen = bySite.get(site);
    if (seen) seen.pages += 1;
    else bySite.set(site, { site, url, pages: 1 });
  }
  return [...bySite.values()];
}
