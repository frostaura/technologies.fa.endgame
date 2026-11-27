import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { formatTime } from "@/lib/format";
import { viewOf } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useViewport } from "@/lib/useViewport";
import { Disclosure } from "@/components/Fold";
import { useAppSelector } from "@/store";
import { useGetOntologyQuery } from "@/store/api";
import type { Ontology, OntologyNode } from "@/store/types";
import { NODE, edgeLabel, edgeWords, layoutGraph, nodeName, nodeType, recordId } from "./ontologyModel";

/**
 * How each kind of line is drawn: ink and the one accent, told apart by weight and dash rather than by
 * hue (ARCH-011). "Works on" and "Sends data to" — what is happening — take the accent.
 */
const EDGE_STYLE: Record<string, { stroke: string; marker: string; dashed?: boolean; label: string }> = {
  owns: { stroke: "stroke-border-strong", marker: "fill-border-strong", label: "Holds" },
  "works-on": { stroke: "stroke-primary", marker: "fill-primary", label: "Works on" },
  "reports-to": { stroke: "stroke-ink-muted", marker: "fill-ink-muted", dashed: true, label: "Reports to" },
  "depends-on": { stroke: "stroke-ink-muted", marker: "fill-ink-muted", dashed: true, label: "Relies on" },
  "data-flows-to": { stroke: "stroke-primary", marker: "fill-primary", label: "Sends data to" },
};

/** A node's kind, as the bar at its left edge: the organisation's own levels in ink, what is built in the accent, people grey. */
const NODE_TONE: Record<string, string> = {
  organisation: "fill-ink",
  division: "fill-ink",
  project: "fill-primary-soft",
  app: "fill-primary",
  employee: "fill-ink-muted",
  contractor: "fill-border-strong",
  person: "fill-ink-muted",
  secret: "fill-quiet-text",
  service: "fill-border-strong",
  webhook: "fill-primary-soft",
  schedule: "fill-primary-soft",
};

/** A short sample of a kind of line: the legend's key, and the mark before each line of the list that reads the graph. */
function Swatch({ type }: { type: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 8" className="h-2 w-6 shrink-0">
      <line x1="0" y1="4" x2="24" y2="4" strokeWidth="2" strokeDasharray={EDGE_STYLE[type]?.dashed ? "4 3" : undefined} className={EDGE_STYLE[type]?.stroke ?? "stroke-ink-muted"} />
    </svg>
  );
}

/** The drawing's narrowest scale: below it, it scrolls inside its frame rather than shrinking its words further. */
const MIN_SCALE = 0.75;

/** The organisation as a graph: who works on what (org-chart view) or how data flows (data-flow view). */
export function OntologyView({ scope, view }: { scope: string; view: "org-chart" | "data-flow" }) {
  const query = useGetOntologyQuery({ scope, view });
  const state = viewOf(query);
  if (state.kind === "loading")
    return (
      <Loading label="Drawing the organisation" className="flex flex-col gap-3">
        <Skeleton className="h-96 rounded-md" />
      </Loading>
    );
  if (state.kind === "failed") return <Failed title="The organisation graph could not be loaded" reason={state.reason} status={state.status} onRetry={() => void query.refetch()} />;
  const graph = state.data;
  const shown = view === "org-chart" ? graph.edges.filter((e) => e.type !== "depends-on" && e.type !== "data-flows-to") : graph.edges.filter((e) => e.type === "depends-on" || e.type === "data-flows-to");
  const linked = new Set(shown.flatMap((e) => [e.from, e.to]));
  // Each view draws only what its edges touch: no services on the org chart, no secrets in the flow.
  const nodes = graph.nodes.filter((n) => linked.has(n.id));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {state.stale && <Stale reason={state.stale.reason} />}
      {shown.length === 0 ? (
        <Empty icon={view === "data-flow" ? "incoming-data" : "employee"} title={view === "data-flow" ? "No data flows yet" : "Nobody works on anything yet"}>
          {view === "data-flow"
            ? "Once an app signs people in, sends mail, calls a model or receives data, the flow appears here."
            : "Once employees are hired and given work, who works on what, and who reports to whom, appears here."}
        </Empty>
      ) : (
        <Graph graph={{ ...graph, nodes, edges: shown }} view={view} />
      )}
    </div>
  );
}

function Graph({ graph, view }: { graph: Ontology; view: "org-chart" | "data-flow" }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const scroller = useRef<HTMLDivElement>(null);
  const room = useWidth(scroller);
  const layout = layoutGraph(graph.nodes, graph.edges, room > 0 ? room : undefined);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const types = [...new Set(graph.edges.map((e) => e.type))];
  const names = new Map(graph.nodes.map((n) => [n.id, nodeName(n, mode)]));
  // The line the pointer rests on, or the keyboard has reached, named on the drawing ("Kasper works on Court booking").
  const [hovered, setHovered] = useState<number | null>(null);
  // The node the pointer rests on: its own lines stand out, the rest step back.
  const [lit, setLit] = useState<string | null>(null);
  const plain = new Map(graph.nodes.map((n) => [n.id, n.type === "service" ? nodeName(n, mode) : n.name]));
  const title = (e: (typeof layout.edges)[number]) => {
    const label = edgeLabel(e.edge);
    return `${names.get(e.edge.from) ?? ""} ${edgeWords(e.edge.type)} ${names.get(e.edge.to) ?? ""}${label ? ` (${label})` : ""}`;
  };
  /** Said as a person would say it: who, what, to whom — and what is under way, when something is. */
  const sentence = (e: (typeof layout.edges)[number]) => {
    const label = edgeLabel(e.edge);
    const tell = label && (view === "data-flow" || label.startsWith("now on "));
    return `${plain.get(e.edge.from) ?? ""} ${edgeWords(e.edge.type)} ${plain.get(e.edge.to) ?? ""}${tell ? ` (${label})` : ""}`;
  };
  const named = hovered === null ? undefined : layout.edges[hovered];
  const phone = useViewport() === "phone";
  // The nodes a line starts from, in the drawing's order; a phone groups them by kind, the kinds in the order they first appear.
  const sources = layout.nodes.filter((p) => graph.edges.some((e) => e.from === p.node.id));
  const groups: { type: string; label: string; items: typeof sources }[] = [];
  for (const p of sources) {
    const g = groups.find((x) => x.type === p.node.type);
    if (g) g.items.push(p);
    else groups.push({ type: p.node.type, label: plurals(nodeType(p.node)), items: [p] });
  }
  // Scaled to its frame: whole at any width it can be read at, scrolled (and dragged) only beyond that.
  const scale = room > 0 ? Math.max(MIN_SCALE, Math.min(1, room / layout.width)) : 1;
  const scrolls = room > 0 && layout.width * scale > room + 1;
  const chars = Math.floor((layout.nodeWidth - 30) / 7.6);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el || !scrolls || e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    const d = drag.current;
    if (!el || !d) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const up = () => {
    drag.current = null;
  };
  // The keyboard walks the lines one by one, each named as it is reached.
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = layout.edges.length;
    if (n === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") setHovered((h) => (h === null ? 0 : (h + 1) % n));
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setHovered((h) => (h === null ? n - 1 : (h - 1 + n) % n));
    else if (e.key === "Escape") setHovered(null);
    else return;
    e.preventDefault();
  };

  const open = (node: OntologyNode) => {
    const href = hrefFor(node);
    if (href) navigate(href);
  };
  const touches = (e: (typeof layout.edges)[number]) => lit === null || e.edge.from === lit || e.edge.to === lit;

  return (
    <>
      <ul aria-label="Key" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-body">
        {types.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <Swatch type={t} />
            {EDGE_STYLE[t]?.label ?? edgeWords(t)}
          </li>
        ))}
        <li className="text-ink-muted">
          <span className="hidden md:inline">{scrolls ? "Drag to move around. " : "Point at a line, or use the arrow keys, to name it. "}</span>Generated {formatTime(graph.generatedAt)}.
        </li>
      </ul>

      {/* The drawing: wide screens. It fills its frame; past the narrowest it can be read at, it scrolls inside the frame and the page never scrolls sideways. */}
      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={view === "data-flow" ? "How data flows, drawn" : "Who works on what, drawn"}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        onKeyDown={key}
        onBlur={() => setHovered(null)}
        className={cn("hidden max-h-graph min-w-0 overflow-auto rounded-md border bg-surface shadow-card md:block", scrolls && "cursor-grab active:cursor-grabbing")}
      >
        <svg aria-hidden width={Math.round(layout.width * scale)} height={Math.round(layout.height * scale)} viewBox={`0 0 ${layout.width} ${layout.height}`} className="block select-none">
          <defs>
            {Object.entries(EDGE_STYLE).map(([type, style]) => (
              <marker key={type} id={`arrow-${type}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={style.marker} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((e, i) => {
            const style = EDGE_STYLE[e.edge.type];
            const live = e.edge.type === "data-flows-to" || (e.edge.label?.startsWith("now:") ?? false);
            const on = hovered === i;
            return (
              <g
                key={`${e.edge.from}-${e.edge.to}-${e.edge.type}-${i}`}
                data-edge={sentence(e)}
                className={cn("transition-opacity motion-reduce:transition-none", !touches(e) && "opacity-20")}
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered((h) => (h === i ? null : h))}
              >
                <title>{title(e)}</title>
                {/* A wider, unseen line, so the pointer need not find the two-pixel one exactly. */}
                <path d={e.d} fill="none" strokeWidth="14" className="stroke-transparent" style={{ pointerEvents: "stroke" }} />
                <path d={e.d} fill="none" strokeWidth={on ? 3 : 2} className={cn(style?.stroke ?? "stroke-ink-muted", on ? "opacity-100" : "opacity-70")} strokeDasharray={style?.dashed ? "6 4" : undefined} markerEnd={`url(#arrow-${e.edge.type})`} />
                {live && <path d={e.d} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 22" className={cn(style?.stroke ?? "stroke-primary", "animate-flow")} />}
              </g>
            );
          })}
          {layout.nodes.map((p) => {
            const href = hrefFor(p.node);
            const name = nodeName(p.node, mode);
            return (
              <g
                key={p.node.id}
                transform={`translate(${p.x} ${p.y})`}
                onClick={() => open(p.node)}
                onPointerEnter={() => setLit(p.node.id)}
                onPointerLeave={() => setLit((x) => (x === p.node.id ? null : x))}
                className={href ? "cursor-pointer" : undefined}
              >
                <title>{name}</title>
                <rect width={layout.nodeWidth} height={NODE.height} rx="14" className={cn("fill-surface stroke-border", (href || lit === p.node.id) && "hover:stroke-primary")} strokeWidth="1.5" />
                <rect x="0" y="0" width="6" height={NODE.height} rx="3" className={NODE_TONE[p.node.type] ?? "fill-ink-muted"} />
                <text x="18" y="24" className="fill-ink-muted text-xs">
                  {nodeType(p.node)}
                  {p.node.status === "working" ? " · working" : ""}
                </text>
                <text x="18" y="44" className="fill-ink text-sm font-semibold">
                  {clip(name, chars)}
                </text>
              </g>
            );
          })}
          {named && <EdgeName x={named.mid.x} y={named.mid.y} width={layout.width} text={sentence(named)} />}
        </svg>
      </div>

      {/* The same graph as a list: phones read it here, grouped by kind and folded, each line marked as the key marks it; screen readers everywhere. */}
      {phone ? (
        <div aria-label={view === "data-flow" ? "How data flows" : "Who works on what"} role="group" className="flex flex-col gap-2.5">
          {groups.map((g, i) => (
            <Disclosure key={g.type} title={`${g.label} · ${g.items.length}`} summary={g.items.slice(0, 3).map((p) => nodeName(p.node, mode)).join(", ") + (g.items.length > 3 ? "…" : "")} defaultOpen={i === 0}>
              <ul className="flex flex-col divide-y rounded-md border bg-surface">
                {g.items.map((p) => (
                  <NodeEdges key={p.node.id} node={p.node} graph={graph} showType={false} />
                ))}
              </ul>
            </Disclosure>
          ))}
        </div>
      ) : (
        <ul aria-label={view === "data-flow" ? "How data flows" : "Who works on what"} className="flex flex-col gap-2.5 md:sr-only">
          {sources.map((p) => (
            <NodeEdges key={p.node.id} node={p.node} graph={graph} showType card />
          ))}
        </ul>
      )}
    </>
  );
}

/** An element's inner width, kept current. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** One node and the lines that leave it, said as sentences. */
function NodeEdges({ node, graph, showType, card = false }: { node: OntologyNode; graph: Ontology; showType: boolean; card?: boolean }) {
  return (
    <li className={cn("flex flex-col gap-1 px-4 py-3", card && "rounded-sm border bg-surface")}>
      {showType && <span className="text-xs text-ink-muted">{nodeType(node)}</span>}
      <NodeName node={node} />
      <ul className="flex flex-col text-ink-body">
        {graph.edges
          .filter((e) => e.from === node.id)
          .map((e, i) => {
            const to = graph.nodes.find((n) => n.id === e.to);
            const label = edgeLabel(e);
            return (
              <li key={`${e.to}-${e.type}-${i}`} className="flex min-h-touch items-center gap-2.5 touch:py-1 md:min-h-0">
                <Swatch type={e.type} />
                <span className="min-w-0 break-words">
                  {edgeWords(e.type)} {to ? <NodeName node={to} inline /> : e.to}
                  {label && <span className="text-ink-muted"> ({label})</span>}
                </span>
              </li>
            );
          })}
      </ul>
    </li>
  );
}

/** "Employee" → "Employees", for a group's title. */
function plurals(word: string): string {
  return /y$/.test(word) && !/[aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : word.endsWith("s") ? word : `${word}s`;
}

function NodeName({ node, inline = false }: { node: OntologyNode; inline?: boolean }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const href = hrefFor(node);
  const name = nodeName(node, mode);
  if (href)
    return (
      <Link href={href} className={cn("rounded-xs text-primary-link hover:text-primary-hover", inline ? "touch:py-3" : "flex min-h-touch items-center self-start font-semibold md:min-h-0")}>
        {name}
      </Link>
    );
  return <span className={inline ? "font-medium" : "font-semibold"}>{name}</span>;
}

function hrefFor(node: OntologyNode): string | null {
  if (node.type === "employee" || node.type === "contractor") return paths.employee(recordId(node));
  if (node.type === "app") return paths.app(recordId(node));
  return null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A line's name, drawn on the line while the pointer rests on it; kept inside the drawing. */
function EdgeName({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const w = Math.round(text.length * 6.8 + 20);
  const cx = Math.min(Math.max(x, w / 2 + 4), width - w / 2 - 4);
  return (
    <g data-edge-name="" transform={`translate(${cx} ${Math.max(y - 18, 16)})`} style={{ pointerEvents: "none" }}>
      <rect x={-w / 2} y={-13} width={w} height={26} rx="8" className="fill-ink" />
      <text y="4" textAnchor="middle" className="fill-surface text-xs font-semibold">
        {text}
      </text>
    </g>
  );
}
