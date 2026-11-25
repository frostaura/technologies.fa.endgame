import { useRef, type PointerEvent } from "react";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { formatTime } from "@/lib/format";
import { viewOf } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useGetOntologyQuery } from "@/store/api";
import type { Ontology, OntologyNode } from "@/store/types";
import { NODE, edgeLabel, edgeWords, layoutGraph, nodeName, nodeType, recordId } from "./ontologyModel";

const EDGE_STYLE: Record<string, { stroke: string; marker: string; dashed?: boolean; label: string }> = {
  owns: { stroke: "stroke-border-strong", marker: "fill-border-strong", label: "Holds" },
  "works-on": { stroke: "stroke-violet", marker: "fill-violet", label: "Works on" },
  "reports-to": { stroke: "stroke-violet-dash", marker: "fill-violet-dash", dashed: true, label: "Reports to" },
  "depends-on": { stroke: "stroke-primary", marker: "fill-primary", label: "Relies on" },
  "data-flows-to": { stroke: "stroke-teal", marker: "fill-teal", label: "Sends data to" },
};

const NODE_TONE: Record<string, string> = {
  organisation: "fill-primary",
  division: "fill-primary",
  project: "fill-primary-soft",
  app: "fill-teal",
  employee: "fill-violet",
  contractor: "fill-violet-dash",
  person: "fill-ink-muted",
  secret: "fill-quiet-text",
  service: "fill-success",
  webhook: "fill-teal",
  schedule: "fill-teal",
};

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
  if (state.kind === "failed") return <Failed title="The organisation graph could not be loaded" reason={state.reason} onRetry={() => void query.refetch()} />;
  const graph = state.data;
  const shown = view === "org-chart" ? graph.edges.filter((e) => e.type !== "depends-on" && e.type !== "data-flows-to") : graph.edges.filter((e) => e.type === "depends-on" || e.type === "data-flows-to");
  const linked = new Set(shown.flatMap((e) => [e.from, e.to]));
  // The data-flow view draws only what takes part in a flow; the org chart draws every node.
  const nodes = view === "data-flow" ? graph.nodes.filter((n) => linked.has(n.id)) : graph.nodes;
  return (
    <div className="flex flex-col gap-3">
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
  const layout = layoutGraph(graph.nodes, graph.edges);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const types = [...new Set(graph.edges.map((e) => e.type))];
  const names = new Map(graph.nodes.map((n) => [n.id, nodeName(n, mode)]));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el || e.pointerType !== "mouse" || e.button !== 0) return;
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

  const open = (node: OntologyNode) => {
    const href = hrefFor(node);
    if (href) navigate(href);
  };

  return (
    <>
      <ul aria-label="Key" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-body">
        {types.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <svg aria-hidden viewBox="0 0 24 8" className="h-2 w-6">
              <line x1="0" y1="4" x2="24" y2="4" strokeWidth="2" strokeDasharray={EDGE_STYLE[t]?.dashed ? "4 3" : undefined} className={EDGE_STYLE[t]?.stroke ?? "stroke-ink-muted"} />
            </svg>
            {EDGE_STYLE[t]?.label ?? edgeWords(t)}
          </li>
        ))}
        <li className="text-ink-muted">Drag to move around. Generated {formatTime(graph.generatedAt)}.</li>
      </ul>

      {/* The drawing: wide screens. It scrolls inside its own frame; the page never scrolls sideways. */}
      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={view === "data-flow" ? "How data flows, drawn" : "Who works on what, drawn"}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="hidden max-h-graph cursor-grab overflow-auto rounded-md border bg-surface shadow-card active:cursor-grabbing md:block"
      >
        <svg aria-hidden width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} className="block select-none">
          <defs>
            {Object.entries(EDGE_STYLE).map(([type, style]) => (
              <marker key={type} id={`arrow-${type}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={style.marker} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((e, i) => {
            const style = EDGE_STYLE[e.edge.type];
            const label = edgeLabel(e.edge);
            const live = e.edge.type === "data-flows-to" || (e.edge.label?.startsWith("now:") ?? false);
            return (
              <g key={`${e.edge.from}-${e.edge.to}-${e.edge.type}-${i}`}>
                <title>{`${names.get(e.edge.from) ?? ""} ${edgeWords(e.edge.type)} ${names.get(e.edge.to) ?? ""}${label ? ` (${label})` : ""}`}</title>
                <path d={e.d} fill="none" strokeWidth="2" className={cn(style?.stroke ?? "stroke-ink-muted", "opacity-70")} strokeDasharray={style?.dashed ? "6 4" : undefined} markerEnd={`url(#arrow-${e.edge.type})`} />
                {live && <path d={e.d} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 22" className={cn(style?.stroke ?? "stroke-primary", "animate-flow")} />}
                {label && view === "data-flow" && (
                  <text x={e.mid.x} y={e.mid.y - 6} textAnchor="middle" className="fill-ink-muted text-xs">
                    {label}
                  </text>
                )}
              </g>
            );
          })}
          {layout.nodes.map((p) => {
            const href = hrefFor(p.node);
            return (
              <g key={p.node.id} transform={`translate(${p.x} ${p.y})`} onClick={() => open(p.node)} className={href ? "cursor-pointer" : undefined}>
                <rect width={NODE.width} height={NODE.height} rx="14" className={cn("fill-surface stroke-border", href && "hover:stroke-primary")} strokeWidth="1.5" />
                <rect x="0" y="0" width="6" height={NODE.height} rx="3" className={NODE_TONE[p.node.type] ?? "fill-ink-muted"} />
                <text x="18" y="24" className="fill-ink-muted text-xs">
                  {nodeType(p.node)}
                  {p.node.status === "working" ? " · working" : ""}
                </text>
                <text x="18" y="44" className="fill-ink text-sm font-semibold">
                  {clip(nodeName(p.node, mode), 26)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* The same graph as a list: phones read it here, and screen readers everywhere. */}
      <ul aria-label={view === "data-flow" ? "How data flows" : "Who works on what"} className="flex flex-col gap-2.5 md:sr-only">
        {layout.nodes
          .filter((p) => graph.edges.some((e) => e.from === p.node.id))
          .map((p) => (
            <li key={p.node.id} className="flex flex-col gap-1 rounded-sm border bg-surface px-4 py-3">
              <span className="text-xs text-ink-muted">{nodeType(p.node)}</span>
              <NodeName node={p.node} />
              <ul className="flex flex-col gap-0.5 text-ink-body">
                {graph.edges
                  .filter((e) => e.from === p.node.id)
                  .map((e, i) => {
                    const to = graph.nodes.find((n) => n.id === e.to);
                    const label = edgeLabel(e);
                    return (
                      <li key={`${e.to}-${e.type}-${i}`}>
                        {edgeWords(e.type)} {to ? <NodeName node={to} inline /> : e.to}
                        {label && <span className="text-ink-muted"> ({label})</span>}
                      </li>
                    );
                  })}
              </ul>
            </li>
          ))}
      </ul>
    </>
  );
}

function NodeName({ node, inline = false }: { node: OntologyNode; inline?: boolean }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const href = hrefFor(node);
  const name = nodeName(node, mode);
  if (href)
    return (
      <Link href={href} className={cn("rounded-xs text-primary-link hover:text-primary-hover", !inline && "font-semibold")}>
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
