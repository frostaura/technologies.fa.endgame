import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Avatar } from "@/components/Avatar";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { formatTime } from "@/lib/format";
import { viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useGetOntologyQuery } from "@/store/api";
import type { OntologyNode } from "@/store/types";
import { cellSentence, flowOf, nodeName, nodeType, plainName, recordId, teamsOf, type Flow, type FlowCell, type Team, type Worker } from "./ontologyModel";

/**
 * The organisation read two ways (ONT-02, ONT-03). Neither is a node-and-line drawing: at real sizes
 * that was a tangle three reviews could not read. "Who works on what" is the people, team by team,
 * each a reporting tree with what each person works on; "How data flows" is a matrix of apps by the
 * services they use, each cell saying which way data travels and what it is. Both are plain HTML —
 * every word is real text at a readable size, wraps rather than being cut, and is read by a screen
 * reader as it is seen.
 */
export function OntologyView({ scope, view }: { scope: string; view: "org-chart" | "data-flow" }) {
  const query = useGetOntologyQuery({ scope, view });
  const state = viewOf(query);
  if (state.kind === "loading")
    return (
      <Loading label="Drawing the organisation" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-80 max-w-full rounded-xs" />
        <Skeleton className="h-72 rounded-md" />
      </Loading>
    );
  if (state.kind === "failed") return <Failed title="The organisation graph could not be loaded" reason={state.reason} status={state.status} onRetry={() => void query.refetch()} />;
  const graph = state.data;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {state.stale && <Stale reason={state.stale.reason} />}
      {view === "org-chart" ? <WhoWorksOnWhat nodes={graph.nodes} edges={graph.edges} generatedAt={graph.generatedAt} /> : <DataFlow nodes={graph.nodes} edges={graph.edges} generatedAt={graph.generatedAt} />}
    </div>
  );
}

type Props = { nodes: OntologyNode[]; edges: { from: string; to: string; type: string; label: string | null }[]; generatedAt: string };

// ---------------------------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------------------------

/** The key: one line per mark drawn below, each with the mark exactly as it is drawn there. */
function Key({ items, generatedAt }: { items: { mark: ReactNode; label: string }[]; generatedAt: string }) {
  return (
    <ul aria-label="Key" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-body">
      {items.map((i) => (
        <li key={i.label} data-key-item={i.label} className="flex items-center gap-2">
          {i.mark}
          {i.label}
        </li>
      ))}
      <li className="text-ink-muted">Generated {formatTime(generatedAt)}.</li>
    </ul>
  );
}

/** Data the app sends to the service: an arrow out, in the accent. */
function SendsMark() {
  return (
    <svg aria-hidden data-mark="sends" viewBox="0 0 16 16" className="size-4 shrink-0">
      <circle cx="8" cy="8" r="7.25" className="fill-primary" />
      <path d="M4.5 8h6M8 5l3 3-3 3" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-ink" />
    </svg>
  );
}

/** Data the service sends the app: an arrow in, in ink, outlined. */
function ReceivesMark() {
  return (
    <svg aria-hidden data-mark="receives" viewBox="0 0 16 16" className="size-4 shrink-0">
      <circle cx="8" cy="8" r="7" strokeWidth="1.5" className="fill-surface stroke-ink" />
      <path d="M11.5 8h-6M8 5L5 8l3 3" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink" />
    </svg>
  );
}

/** Relied on, with nothing said to travel: a hollow ring. */
function ReliesMark() {
  return (
    <svg aria-hidden data-mark="relies" viewBox="0 0 16 16" className="size-4 shrink-0">
      <circle cx="8" cy="8" r="5" strokeWidth="1.5" className="fill-surface stroke-ink-muted" />
    </svg>
  );
}

/** What a person works on: a short arrow from them to it. */
function WorksOnMark() {
  return (
    <svg aria-hidden data-mark="works-on" viewBox="0 0 16 16" className="size-4 shrink-0">
      <path d="M2 8h10M9 5l3 3-3 3" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink-muted" />
    </svg>
  );
}

/** Reporting to the person above: the rule a report is indented on, as drawn beside every team's reports. */
function ReportsMark() {
  return (
    <svg aria-hidden data-mark="reports-to" viewBox="0 0 16 16" className="size-4 shrink-0">
      <path d="M3 1v14" fill="none" strokeWidth="2" className="stroke-border" />
      <circle cx="10.5" cy="8" r="3.5" className="fill-border-strong" />
    </svg>
  );
}

/** At work right now: the accent dot, still when motion is reduced. */
function NowMark() {
  return <span aria-hidden data-mark="now" className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />;
}

// ---------------------------------------------------------------------------------------------
// Who works on what
// ---------------------------------------------------------------------------------------------

function WhoWorksOnWhat({ nodes, edges, generatedAt }: Props) {
  const teams = teamsOf(nodes, edges);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  if (teams.length === 0)
    return (
      <Empty icon="employee" title="Nobody works on anything yet">
        Once employees are hired and given work, who works on what, and who reports to whom, appears here.
      </Empty>
    );
  const anyReports = teams.some((t) => t.heads.some((h) => h.reports.length > 0));
  const anyNow = teams.some((t) => t.heads.some(function busy(w: Worker): boolean {
    return w.working || w.reports.some(busy);
  }));
  return (
    <>
      <Key
        generatedAt={generatedAt}
        items={[
          { mark: <WorksOnMark />, label: "Works on" },
          ...(anyReports ? [{ mark: <ReportsMark />, label: "Reports to the person above" }] : []),
          ...(anyNow ? [{ mark: <NowMark />, label: "Working now" }] : []),
        ]}
      />
      <div ref={box} className="min-w-0">
        {/* Columns of 20rem or more, no more than there are teams; each team stays whole, and the columns balance so none ends in a hole. */}
        <ul aria-label="Who works on what" className="gap-4" style={{ columnCount: Math.max(1, Math.min(teams.length, Math.floor((width + GAP) / (CARD + GAP)))) }}>
          {teams.map((t) => (
            <TeamCard key={t.place?.id ?? t.kind} team={t} />
          ))}
        </ul>
      </div>
    </>
  );
}

/** A team card's narrowest, and the space between cards (20rem and 1rem). */
const CARD = 320;
const GAP = 16;

function TeamCard({ team }: { team: Team }) {
  return (
    <li data-team={team.title} className="mb-4 flex min-w-0 break-inside-avoid flex-col rounded-md border bg-surface shadow-card">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-muted">{team.kind}</p>
          <h3 className="break-words font-semibold text-ink">{team.title}</h3>
        </div>
        <p className="shrink-0 pt-0.5 text-sm text-ink-muted">{team.size === 1 ? "1 person" : `${team.size} people`}</p>
      </div>
      <ul aria-label={`In ${team.title}`} className="flex flex-col px-4 py-2">
        {team.heads.map((w) => (
          <PersonRow key={w.node.id} worker={w} />
        ))}
      </ul>
    </li>
  );
}

function PersonRow({ worker }: { worker: Worker }) {
  const many = worker.count > 1;
  // Several alike contractors are one row: no one record to open.
  const href = many ? null : hrefFor(worker.node);
  const name = plainName(worker.node);
  const contractor = worker.node.type === "contractor";
  const role = contractor || worker.role === name ? null : worker.role;
  // "Research contractor" already says what it is; a member says so ("Person").
  const kind = worker.node.type === "employee" || name.toLowerCase().includes(nodeType(worker.node).toLowerCase()) ? null : nodeType(worker.node);
  return (
    <li data-person={name} className="flex min-w-0 flex-col">
      <div className="flex min-w-0 gap-3 py-2">
        <Avatar name={name} seed={contractor ? name : worker.node.id} size="sm" className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2">
            {href ? (
              <Link href={href} className="break-words rounded-xs font-semibold text-primary-link hover:text-primary-hover touch:inline-flex touch:min-h-touch touch:items-center">
                {name}
              </Link>
            ) : (
              <span className="break-words font-semibold text-ink">{name}</span>
            )}
            {role && <span className="break-words text-sm text-ink-body">{role}</span>}
            {kind && <span className="text-sm text-ink-muted">{kind}</span>}
            {many && <span className="text-sm text-ink-muted">× {worker.count}</span>}
            {worker.working && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-primary-link">
                <NowMark />
                Working
              </span>
            )}
          </p>
          {worker.under && (
            <p className={cn("text-sm text-ink-muted", worker.under.how === "reports to" && "sr-only")}>
              {capitalFirst(worker.under.how)} {worker.under.name}
            </p>
          )}
          <ul aria-label={`What ${name} works on`} className="flex flex-col gap-1 text-sm text-ink-body">
            {worker.places.map((p) => (
              <li key={p.id} className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5">
                  <WorksOnMark />
                </span>
                <span className="min-w-0 break-words">
                  <span className="sr-only">Works on </span>
                  <PlaceName node={p} />
                  <span className="text-ink-muted"> · {placeKind(p)}</span>
                </span>
              </li>
            ))}
            {worker.now.map((n) => (
              <li key={`${n.node.id}-${n.title}`} className="flex min-w-0 items-start gap-2 text-primary-link">
                <span className="flex size-4 shrink-0 items-center justify-center pt-1">
                  <NowMark />
                </span>
                <span className="min-w-0 break-words">
                  Now on {n.title}
                  <span className="text-ink-muted"> · <PlaceName node={n.node} /></span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {worker.reports.length > 0 && (
        <ul aria-label={`Reporting to ${name}`} data-mark="reports-to" className="ml-4 flex flex-col border-l-2 border-border pl-4">
          {worker.reports.map((r) => (
            <PersonRow key={r.node.id} worker={r} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** "Division", "Project", "App"; the organisation as "Whole organisation". */
function placeKind(node: OntologyNode): string {
  return node.type === "organisation" ? "Whole organisation" : nodeType(node);
}

function PlaceName({ node }: { node: OntologyNode }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const href = hrefFor(node);
  const name = nodeName(node, mode);
  if (!href) return <span className="font-medium text-ink">{name}</span>;
  return (
    <Link href={href} className="rounded-xs font-medium text-primary-link hover:text-primary-hover touch:inline-flex touch:min-h-touch touch:items-center">
      {name}
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------
// How data flows
// ---------------------------------------------------------------------------------------------

/** The narrowest the matrix is drawn at: the app column, and each service's. Narrower, each app is a card. */
const MATRIX = { app: 176, column: 120 } as const;

function DataFlow({ nodes, edges, generatedAt }: Props) {
  const mode = useAppSelector((s) => s.ui.mode);
  const flow = flowOf(nodes, edges, mode);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  if (flow.rows.length === 0)
    return (
      <Empty icon="incoming-data" title="No data flows yet">
        Once an app signs people in, sends mail, calls a model or receives data, the flow appears here.
      </Empty>
    );
  const all = flow.rows.flatMap((r) => Object.values(r.cells));
  const kinds: { mark: ReactNode; label: string }[] = [];
  if (all.some((c) => c.sends.length)) kinds.push({ mark: <SendsMark />, label: "The app sends it" });
  if (all.some((c) => c.receives.length)) kinds.push({ mark: <ReceivesMark />, label: "The app receives it" });
  if (all.some((c) => c.relies && !c.sends.length && !c.receives.length)) kinds.push({ mark: <ReliesMark />, label: "Relies on it; nothing travels" });
  const matrix = width >= MATRIX.app + flow.columns.length * MATRIX.column;
  return (
    <>
      <Key generatedAt={generatedAt} items={kinds} />
      <div ref={box} className="min-w-0">
        {matrix ? <FlowMatrix flow={flow} /> : <FlowCards flow={flow} />}
      </div>
    </>
  );
}

/** A cell's contents: each thing that travels on its own line, its mark before it. */
function CellLines({ cell }: { cell: FlowCell }) {
  if (!cell.sends.length && !cell.receives.length)
    return cell.relies ? (
      <span className="flex items-center gap-2 text-ink-muted">
        <ReliesMark />
        Relies on it
      </span>
    ) : null;
  return (
    <span className="flex flex-col gap-1">
      {cell.sends.map((s) => (
        <span key={`s-${s}`} className="flex items-start gap-2">
          <span className="pt-0.5">
            <SendsMark />
          </span>
          <span className="min-w-0 break-words">
            <span className="sr-only">Sends </span>
            {capitalFirst(s)}
          </span>
        </span>
      ))}
      {cell.receives.map((s) => (
        <span key={`r-${s}`} className="flex items-start gap-2">
          <span className="pt-0.5">
            <ReceivesMark />
          </span>
          <span className="min-w-0 break-words">
            <span className="sr-only">Receives </span>
            {capitalFirst(s)}
          </span>
        </span>
      ))}
    </span>
  );
}

function FlowMatrix({ flow }: { flow: Flow }) {
  const mode = useAppSelector((s) => s.ui.mode);
  // The cell the pointer rests on, or the keyboard has reached: its row and column are lit.
  const [at, setAt] = useState<{ r: number; c: number } | null>(null);
  const [focus, setFocus] = useState({ r: 0, c: 0 });
  const table = useRef<HTMLTableElement>(null);
  const move = (e: KeyboardEvent<HTMLTableElement>) => {
    const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = { r: Math.min(flow.rows.length - 1, Math.max(0, focus.r + (d[0] ?? 0))), c: Math.min(flow.columns.length - 1, Math.max(0, focus.c + (d[1] ?? 0))) };
    setFocus(next);
    setAt(next);
    table.current?.querySelector<HTMLElement>(`[data-cell="${next.r}-${next.c}"]`)?.focus();
  };
  const total = flow.rows.length;
  return (
    <div role="region" aria-label="How data flows, app by service" className="min-w-0 rounded-md border bg-surface shadow-card">
      <table ref={table} aria-label="How data flows" onKeyDown={move} onPointerLeave={() => setAt(null)} className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Each app, the platform services it relies on, and what travels between them. Use the arrow keys to move between cells.</caption>
        <colgroup>
          <col className="w-44 lg:w-56" />
          {flow.columns.map((c) => (
            <col key={c.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="border-b px-4 py-3 text-left align-bottom font-medium text-ink-muted">
              App
            </th>
            {flow.columns.map((c, ci) => (
              <th key={c.id} scope="col" data-column={c.name} className={cn("border-b border-l px-4 py-3 text-left align-bottom transition-colors motion-reduce:transition-none", at?.c === ci && "bg-ground")}>
                <span className="block break-words font-semibold text-ink">{c.name}</span>
                <span className="block font-normal text-ink-muted">
                  {c.uses} of {total} {total === 1 ? "app" : "apps"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flow.rows.map((row, ri) => {
            const name = nodeName(row.app, mode);
            return (
              <tr key={row.app.id} data-row={name}>
                <th scope="row" className={cn("px-4 py-3 text-left align-top font-semibold transition-colors motion-reduce:transition-none", ri > 0 && "border-t", at?.r === ri && "bg-ground")}>
                  <AppName node={row.app} />
                </th>
                {flow.columns.map((c, ci) => {
                  const cell = row.cells[c.id];
                  const lit = at?.r === ri || at?.c === ci;
                  return (
                    <td
                      key={c.id}
                      data-cell={`${ri}-${ci}`}
                      tabIndex={focus.r === ri && focus.c === ci ? 0 : -1}
                      title={cell ? cellSentence(name, c.name, cell) : `${name} does not use ${c.name}.`}
                      onPointerEnter={() => setAt({ r: ri, c: ci })}
                      onFocus={() => {
                        setFocus({ r: ri, c: ci });
                        setAt({ r: ri, c: ci });
                      }}
                      onBlur={() => setAt(null)}
                      className={cn(
                        "border-l px-4 py-3 align-top text-ink-body outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary motion-reduce:transition-none",
                        ri > 0 && "border-t",
                        lit && "bg-ground",
                        at?.r === ri && at.c === ci && "bg-primary-tint",
                      )}
                    >
                      {cell ? (
                        <>
                          <span className="sr-only">{cellSentence(name, c.name, cell)}</span>
                          <span aria-hidden>
                            <CellLines cell={cell} />
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-muted">
                          <span aria-hidden>–</span>
                          <span className="sr-only">Not used</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The phone's form, and any frame too narrow for the matrix: each app a card listing what it uses. */
function FlowCards({ flow }: { flow: Flow }) {
  const mode = useAppSelector((s) => s.ui.mode);
  return (
    <ul aria-label="How data flows" className="grid grid-cols-card-fill items-start gap-4">
      {flow.rows.map((row) => {
        const name = nodeName(row.app, mode);
        const used = flow.columns.filter((c) => row.cells[c.id]);
        return (
          <li key={row.app.id} data-row={name} className="flex min-w-0 flex-col rounded-md border bg-surface shadow-card">
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-ink-muted">App</p>
                <h3 className="break-words font-semibold">
                  <AppName node={row.app} />
                </h3>
              </div>
              <p className="shrink-0 pt-0.5 text-sm text-ink-muted">{used.length === 1 ? "1 service" : `${used.length} services`}</p>
            </div>
            <ul aria-label={`What ${name} uses`} className="flex flex-col divide-y px-4">
              {used.map((c) => {
                const cell = row.cells[c.id] as FlowCell;
                return (
                  <li key={c.id} className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1.5 py-3 text-sm" title={cellSentence(name, c.name, cell)}>
                    <span className="sr-only">{cellSentence(name, c.name, cell)}</span>
                    <span aria-hidden className="break-words font-semibold text-ink">
                      {c.name}
                    </span>
                    <span aria-hidden className="text-ink-body">
                      <CellLines cell={cell} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function AppName({ node }: { node: OntologyNode }) {
  const mode = useAppSelector((s) => s.ui.mode);
  return (
    <Link href={paths.app(recordId(node))} className="break-words rounded-xs text-primary-link hover:text-primary-hover touch:inline-flex touch:min-h-touch touch:items-center">
      {nodeName(node, mode)}
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------

function hrefFor(node: OntologyNode): string | null {
  if (node.type === "employee" || node.type === "contractor") return paths.employee(recordId(node));
  if (node.type === "app") return paths.app(recordId(node));
  return null;
}

function capitalFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
