import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { ArrowDown, ArrowUpRight, Check, ChevronDown, IdCard, Maximize2, MessageCircle, Minimize2, MoveHorizontal, PanelRightClose, Paperclip, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Markdown } from "@/components/Markdown";
import { markdownToPlain } from "@/lib/markdown";
import { Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { describeError, viewOf } from "@/lib/queryState";
import { navigate, paths, useLocation } from "@/lib/router";
import { TAP } from "@/lib/touch";
import { ARRIVAL, useFollowLatest } from "@/lib/useFollowLatest";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useControlRunMutation, useEstimateMessageQuery, useGetConversationCapabilitiesQuery, useGetConversationQuery, useGetMeQuery, useStartConversationMutation } from "@/store/api";
import type { ConversationAttachment, MessageNarrowing, Tree } from "@/store/types";
import { conversationKey, messageQueued, messageSettled, selected, type ChatMessage, type Selection } from "@/store/uiSlice";
import { ApprovalCard } from "../runs/ApprovalCard";
import { isTerminal } from "../runs/runModel";
import { useRunStream } from "../runs/useRunStream";
import { distinctReplies, noticesToShow, withoutClosingRepeats } from "./conversationModel";
import { activeWork, activityLine } from "./treeModel";
import { useInSheet } from "../shell/talkContext";
import { SentAttachments } from "../conversation/AttachmentChips";
import { Composer } from "../conversation/Composer";
import { useDockLayout } from "../conversation/dockLayout";
import { contentsOf, suggestedPrompts, targetsOf, type Target } from "../conversation/scopeModel";
import { answeredAt, interrupted, receiptsOf, segmentsOf, turnsOf, type HistoryTurn, type Receipt, type SaidLine } from "../conversation/turnModel";
import { useDraftFiles } from "../conversation/useDraftFiles";
import { WorkCard } from "../conversation/WorkCard";
import { deriveWork } from "../conversation/workModel";

/** What "@" carried here from another page: the words, so they are not lost on the way (ARCH-012). */
let carriedDraft: string | null = null;

const LEVEL: Record<Selection["kind"], string> = { organisation: "Organisation", division: "Division", project: "Project", app: "App", employee: "Employee" };
const LEVELS: Exclude<Selection["kind"], "employee">[] = ["organisation", "division", "project", "app"];

/** Says, once, what a screen reader should hear: a reply that arrived, work that ended, a question waiting. */
const AnnounceContext = createContext<(text: string) => void>(() => undefined);

/**
 * The conversation at a level (ARCH-012): a pane with its header, the thread, and the composer
 * pinned at its foot. On a desktop it is docked at the window's right edge (narrow, wide, collapsed
 * to a rail, or full width); on a tablet it fills the shell's drawer, on a phone its sheet. What was
 * said before is read from the control plane, so it survives a reload — a turn still being answered
 * picks up its reply where it is; each new message starts a run, whose replies and work stream in.
 */
export function ConversationDock({ tree, selection, onRetarget }: { tree: Tree; selection: Selection; onRetarget?: (selection: Selection) => void }) {
  const dispatch = useAppDispatch();
  const key = conversationKey(selection);
  const messages = useAppSelector((s) => s.ui.conversations[key]) ?? NONE;
  const scopeArgs = { scope: selection.scope, ...(selection.employeeId ? { employeeId: selection.employeeId } : {}) };
  const historyQuery = useGetConversationQuery(scopeArgs);
  const history = viewOf(historyQuery);
  const capsQuery = useGetConversationCapabilitiesQuery(scopeArgs);
  const caps = viewOf(capsQuery);
  const [start] = useStartConversationMutation();
  const [control] = useControlRunMutation();
  const [draft, setDraft] = useState(() => {
    const carried = carriedDraft ?? "";
    carriedDraft = null;
    return carried;
  });
  const [narrow, setNarrow] = useState<MessageNarrowing>({});
  const inputId = useId();
  const name = selection.trail[selection.trail.length - 1] ?? "";
  const me = useGetMeQuery(undefined);
  const myName = me.data?.user.displayName ?? null;
  const files = useDraftFiles(selection.scope, selection.employeeId, caps.kind === "loaded" ? caps.data.attachments : null);
  const attachmentIds = files.ready.map((f) => f.id);
  // What a message can cost at most, shown before it is sent (CLAUDE.md rule 11), the files in it counted.
  const estimateQuery = useEstimateMessageQuery(attachmentIds.length > 0 ? { ...scopeArgs, attachmentIds } : scopeArgs);
  const estimate = viewOf(estimateQuery);
  const busy = useMemo(() => busyHere(tree, selection), [tree, selection]);
  const logRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const onEmployeePage = location.pathname.startsWith("/employees/");
  const onHome = location.pathname === "/";
  const inSheet = useInSheet();
  const dock = useDockLayout();
  const variant = inSheet ? "sheet" : dock?.full ? "full" : "docked";
  const { behind, toLatest } = useFollowLatest(logRef);
  const [dragging, setDragging] = useState(false);
  const [threadBox, setThreadBox] = useState<HTMLDivElement | null>(null);
  const [said, setSaid] = useState("");
  const announce = useCallback((text: string) => setSaid(text), []);

  const contents = useMemo(() => contentsOf(tree, selection.scope), [tree, selection.scope]);
  const targets = useMemo(() => targetsOf(contents, selection), [contents, selection]);
  const suggestions = useMemo(() => suggestedPrompts(tree, selection), [tree, selection]);

  // The reply being written now: the latest message sent here whose work has not ended. Stop cancels it.
  const turns = history.kind === "loaded" ? history.data.turns : null;
  const lastRun = [...messages].reverse().find((m) => m.runId)?.runId ?? (turns && turns.length > 0 && !isTerminal(turns[turns.length - 1]?.status ?? null) ? (turns[turns.length - 1]?.runId ?? null) : null);
  const live = useAppSelector((s) => {
    if (!lastRun) return false;
    const events = s.runs[lastRun]?.events;
    if (!events) return messages.some((m) => m.runId === lastRun) || (turns?.find((t) => t.runId === lastRun)?.status ?? "finished") !== "finished";
    return events[events.length - 1]?.type !== "run.finished";
  });

  const go = (next: Selection) => {
    if (onRetarget) {
      onRetarget(next);
      return;
    }
    dispatch(selected(next));
    if (!onHome) navigate(paths.home());
  };
  const retarget = (t: Target) => {
    // Off the org chart (an app's or an employee's page), the conversation there moves to the org chart, words and all.
    if (!onRetarget && !onHome) carriedDraft = draft;
    go(t.kind === "employee" ? { scope: t.scope, kind: "employee", trail: t.trail, employeeId: t.employeeId } : { scope: t.scope, kind: "app", trail: t.trail });
  };

  const send = async (text: string, attachments: ConversationAttachment[], narrowing: MessageNarrowing) => {
    const id = newMessageId();
    toLatest();
    dispatch(messageQueued({ key, message: { id, text, state: "sending", runId: null, error: null, attachments } }));
    try {
      const run = await start({
        ...scopeArgs,
        message: text,
        ...(attachments.length > 0 ? { attachmentIds: attachments.map((a) => a.id) } : {}),
        ...(narrowing.noWebSearch || narrowing.answerOnly ? { narrow: { ...(narrowing.noWebSearch ? { noWebSearch: true } : {}), ...(narrowing.answerOnly ? { answerOnly: true } : {}) } } : {}),
      }).unwrap();
      dispatch(messageSettled({ key, id, runId: run.id, error: null }));
    } catch (e) {
      dispatch(messageSettled({ key, id, runId: null, error: describeError(e as never) }));
    }
  };

  const submit = () => {
    const text = draft.trim();
    const attachments = files.ready;
    if (!text && attachments.length === 0) return;
    setDraft("");
    files.sent();
    const narrowing = narrow;
    setNarrow({});
    void send(text, attachments, narrowing);
  };

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(false);
    files.add([...e.dataTransfer.files]);
  };

  const liveRuns = new Set(messages.map((m) => m.runId).filter((id): id is string => id !== null));
  const earlier = history.kind === "loaded" ? turnsOf(withoutClosingRepeats(history.data.messages.filter((m) => !liveRuns.has(m.runId))), history.data.turns) : [];
  const empty = history.kind === "loaded" && earlier.length === 0 && messages.length === 0;
  const answerer = selection.kind === "employee" ? name : null;

  if (variant === "docked" && dock?.collapsed) return <CollapsedRail selection={selection} name={name} live={live} busy={busy.length} onOpen={() => dock.setCollapsed(false)} />;

  const full = variant === "full";
  return (
    <AnnounceContext.Provider value={announce}>
      <section
        aria-label="Conversation"
        data-variant={variant}
        data-in-sheet={inSheet || undefined}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className="relative flex h-full min-h-0 flex-col"
      >
        <PaneHeader selection={selection} name={name} inSheet={inSheet} onEmployeePage={onEmployeePage} busy={busy} onGo={go} full={full} />
        <AlsoHappening busy={busy} full={full} />

        <div ref={setThreadBox} className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={logRef}
            role="log"
            aria-live="off"
            aria-label={`Conversation with ${name}`}
            data-thread=""
            className={cn("fade-y flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-5", inSheet && "pr-3", full && "items-center")}
          >
            <div className={cn("flex w-full flex-col gap-5", full && "max-w-prose")}>
              {history.kind === "loading" && (
                <div role="status" aria-busy="true" data-state="loading" className="flex flex-col gap-3.5">
                  <span className="sr-only">Loading what was said before</span>
                  <Skeleton className="h-10 w-2/3 self-end rounded-md" />
                  <Skeleton className="h-16 w-5/6 rounded-md" />
                </div>
              )}
              {history.kind === "failed" && (
                <div role="alert" data-state="failed" className="flex flex-col gap-2 rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
                  What was said before could not be loaded: {history.reason} New messages still send.
                  <button type="button" onClick={() => void historyQuery.refetch()} className="min-h-touch self-start rounded-xs font-semibold underline">
                    Try again
                  </button>
                </div>
              )}
              {history.kind === "loaded" && history.stale && (
                <p role="alert" data-state="stale" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
                  The latest refresh failed: {history.stale.reason}
                </p>
              )}
              {empty && (
                <EmptyThread
                  selection={selection}
                  name={name}
                  suggestions={suggestions}
                  canStart={caps.kind === "loaded" && caps.data.actions.length > 0}
                  canAddress={targets.length > 0}
                  onPick={(text) => {
                    setDraft(text);
                    requestAnimationFrame(() => document.getElementById(inputId)?.focus());
                  }}
                />
              )}
              {earlier.map((turn) => (
                <EarlierTurn key={turn.key} turn={turn} myName={myName} answerer={answerer} root={logRef} onAskAgain={(text) => void send(text, [], {})} />
              ))}
              {messages.map((m) => (
                <Exchange key={m.id} message={m} onRetry={() => void send(m.text, m.attachments ?? [], {})} answerer={answerer} />
              ))}
            </div>
          </div>
        </div>
        {behind && (
          // Docked just above the composer, outside the log so it is never over what was said, and not read out as part of it.
          <div className={cn("flex shrink-0 justify-center bg-surface pb-1 pt-1.5", full && "px-4")}>
            <Button size="sm" variant="soft" onClick={toLatest} className="rounded-full font-semibold text-ink shadow-raised">
              <ArrowDown aria-hidden className="size-4" />
              New reply
            </Button>
          </div>
        )}

        <div className={cn("shrink-0", full && "flex justify-center")}>
          <div className={cn("w-full", full && "max-w-prose")}>
            <Composer
              name={name}
              scope={selection.scope}
              inputId={inputId}
              draft={draft}
              onDraft={setDraft}
              files={files}
              caps={caps}
              estimate={estimate}
              narrow={narrow}
              onNarrow={setNarrow}
              targets={targets}
              onRetarget={targets.length > 0 ? retarget : null}
              appName={selection.kind === "app" ? name : null}
              live={live && !!lastRun}
              onStop={() => lastRun && void control({ id: lastRun, action: "cancel" })}
              onSend={submit}
              inSheet={inSheet}
              scrimTarget={threadBox}
            />
          </div>
        </div>

        {dragging && (
          <div aria-hidden className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary bg-primary-tint/90 text-primary-hover">
            <Paperclip className="size-6" />
            <span className="font-semibold">Drop files to attach them</span>
          </div>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {said}
        </p>
      </section>
    </AnnounceContext.Provider>
  );
}

interface Busy {
  id: string;
  name: string;
  line: string;
}

/** Who is at work at this level, each in a sentence that says what they are doing in the right verb. */
function busyHere(tree: Tree, selection: Selection): Busy[] {
  const roles = new Map<string, string | null>();
  const visit = (workers: { id: string; standing: string | null }[]) => workers.forEach((w) => roles.set(w.id, w.standing));
  visit(tree.organisation?.workers ?? []);
  for (const d of tree.divisions) {
    visit(d.workers);
    for (const p of d.projects) {
      visit(p.workers);
      for (const a of p.apps) visit(a.workers);
    }
  }
  return activeWork(tree)
    .filter((w) => !selection.employeeId || w.id === selection.employeeId)
    .map((w) => {
      // The security reviewer reviews whatever the work is: never "is building" (finding 13).
      const reviewing = roles.get(w.id) === "security-reviewer";
      const subject = w.activity.replace(/^[A-Za-z ]+:\s+/, "");
      return { id: w.id, name: w.name, line: reviewing ? `${w.name} is reviewing: ${subject}` : activityLine(w.name, w.activity) };
    });
}

/** The levels above the one being talked to, each a way back up, and the level itself. */
function scopeCrumbs(selection: Selection): { label: string; selection: Selection }[] {
  const parts = selection.scope.split("/").filter(Boolean);
  const out: { label: string; selection: Selection }[] = [];
  parts.forEach((_, i) => {
    const kind = LEVELS[Math.min(i, LEVELS.length - 1)] ?? "app";
    out.push({ label: selection.trail[i] ?? parts[i] ?? "", selection: { scope: parts.slice(0, i + 1).join("/"), kind, trail: selection.trail.slice(0, i + 1) } });
  });
  return out;
}

/**
 * Who you are talking to, at which level — the levels above as a way back up, an × to talk to the whole organisation
 * again — and, docked on a desktop, narrow or wide, full width, or collapsed. A window with little height (`low:`)
 * draws it as one line, with the work under way as a count beside it.
 */
function PaneHeader({ selection, name, inSheet, onEmployeePage, busy, onGo, full }: { selection: Selection; name: string; inSheet: boolean; onEmployeePage: boolean; busy: Busy[]; onGo: (s: Selection) => void; full: boolean }) {
  const dock = useDockLayout();
  const crumbs = scopeCrumbs(selection);
  // The level just above this one (for an employee, their own place): one line, the full way up in its tooltip.
  const above = (selection.kind === "employee" ? crumbs : crumbs.slice(0, -1)).slice(1).slice(-1);
  const narrowed = selection.kind !== "organisation";
  const home = crumbs[0];
  const hint =
    selection.kind === "organisation"
      ? "Select a division, project or employee to narrow this."
      : selection.kind === "app"
        ? `About ${name} only: ask about it, or ask for a change to it.`
        : onEmployeePage
          ? `Only ${name} hears this, and answers from its job and what it remembers.`
          : null;
  return (
    <header className={cn("flex shrink-0 border-b px-4 py-3 low:py-1.5", inSheet && "pr-14")}>
      {/* Full width: the header keeps to the conversation's own column, as the thread and the composer do. */}
      <div className={cn("flex w-full min-w-0 items-center gap-3", full && "mx-auto max-w-prose")}>
      <Avatar name={name} seed={selection.employeeId ?? selection.scope} size="md" shape={selection.kind === "employee" ? "round" : "square"} className="low:hidden" />
      <div className="flex min-w-0 flex-1 flex-col low:flex-row low:items-center low:gap-2">
        <nav aria-label="What this conversation is about" className="flex min-w-0 items-center gap-1 text-xs text-ink-muted low:hidden" data-level="">
          <span className="shrink-0 text-eyebrow font-semibold uppercase low:hidden">{LEVEL[selection.kind]}</span>
          {above.length > 0 && (
            <ol className="flex min-w-0 items-center gap-1 truncate low:hidden">
              {above.map((c) => (
                <li key={c.selection.scope} className="flex min-w-0 items-center gap-1">
                  <span aria-hidden>· in</span>
                  <button type="button" onClick={() => onGo(c.selection)} aria-label={`Back up to ${c.label}`} title={`Talk to ${c.label}`} className="min-w-0 truncate rounded-xs hover:text-ink hover:underline">
                    {c.label}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {narrowed && home && (
            <button type="button" onClick={() => onGo(home.selection)} aria-label={`Talk to all of ${home.label} again`} title={`Talk to all of ${home.label} again`} className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-ground hover:text-ink">
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </nav>
        <h2 className="truncate font-sans text-base font-semibold tracking-normal low:min-w-0 low:flex-1 low:text-sm">Talking to {name}</h2>
        {hint && <span className="truncate text-xs text-ink-muted low:hidden" title={hint}>{hint}</span>}
      </div>
      {busy.length > 0 && <BusyCount busy={busy} />}
      <div className="-mr-2 flex shrink-0 items-center" role="group" aria-label="The pane">
        {selection.kind === "employee" && selection.employeeId && !onEmployeePage && (
          <Link href={paths.employee(selection.employeeId)} aria-label={`See ${name}’s job, record and memory`} title={`See ${name}’s job, record and memory`} className="flex min-h-touch min-w-touch items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink">
            <IdCard aria-hidden className="size-4" />
          </Link>
        )}
        {dock && !dock.full && (
          <HeaderButton label={dock.wide || dock.overlay ? "Make the pane narrower" : "Make the pane wider"} onClick={() => dock.setWide(!(dock.wide || dock.overlay))} pressed={dock.wide || dock.overlay}>
            <MoveHorizontal aria-hidden className="size-4" />
          </HeaderButton>
        )}
        {dock && (
          <HeaderButton label={dock.full ? "Back to the page" : "Open full width"} onClick={() => dock.setFull(!dock.full)} pressed={dock.full}>
            {dock.full ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
          </HeaderButton>
        )}
        {dock && (
          <HeaderButton label="Collapse the pane" onClick={() => dock.setCollapsed(true)}>
            <PanelRightClose aria-hidden className="size-4" />
          </HeaderButton>
        )}
      </div>
      </div>
    </header>
  );
}

function HeaderButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed} className="flex min-h-touch min-w-touch items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink">
      {children}
    </button>
  );
}

/** On a low window, the work under way here as a count in the header; opened, who is doing what. */
function BusyCount({ busy }: { busy: Busy[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative hidden shrink-0 low:block">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${busy.length} at work here`} title={`${busy.length} at work here`} className="flex min-h-touch items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-ink-muted hover:bg-ground hover:text-ink">
        <TypingDots />
        {busy.length}
      </button>
      {open && (
        <ul className="absolute right-0 top-full z-30 mt-1 flex w-popover max-w-popover flex-col gap-1.5 rounded-md border bg-surface p-3 text-sm text-ink-body shadow-raised">
          {busy.map((w) => (
            <li key={w.id} className="flex items-start gap-2">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
              {w.line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Other work under way at this level, anchored under the header on a solid band with a divider, rather than floating
 * in the thread: the first line shown, the rest one tap away, every row with the same dot. Folded into the header's
 * count on a low window.
 */
function AlsoHappening({ busy, full }: { busy: Busy[]; full: boolean }) {
  const [open, setOpen] = useState(false);
  const first = busy[0];
  if (!first) return null;
  return (
    <div data-also-happening="" className="relative z-10 shrink-0 border-b bg-ground px-4 text-sm text-ink-muted shadow-card low:hidden">
      <ul className={cn("flex flex-col pb-0.5", full && "mx-auto max-w-prose")}>
        {(open ? busy : [first]).map((w, i) => (
          <li key={w.id} className="flex min-h-touch items-center gap-2.5">
            <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
            <span className="min-w-0 flex-1 truncate" title={w.line}>
              {i === 0 && <span className="sr-only">Also happening here: </span>}
              {w.line}
            </span>
            {i === 0 && busy.length > 1 && (
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-touch shrink-0 items-center gap-1 rounded-xs text-xs font-semibold text-primary-link hover:text-primary-hover">
                {open ? "Less" : `${busy.length - 1} more`}
                <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The pane collapsed to its rail: who it is, what to press to open it, its name read up the rail, a dot for each piece
 * of work under way here, and a marker when a reply arrived while it was closed.
 */
function CollapsedRail({ selection, name, live, busy, onOpen }: { selection: Selection; name: string; live: boolean; busy: number; onOpen: () => void }) {
  const [unread, setUnread] = useState(false);
  const was = useRef(live);
  useEffect(() => {
    // A reply that finished while the pane was closed is news.
    if (was.current && !live) setUnread(true);
    was.current = live;
  }, [live]);
  return (
    <section aria-label="Conversation" data-variant="collapsed" className="flex h-full flex-col items-center py-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open the conversation with ${name}${unread ? ": a new reply" : ""}`}
        title={`Talk to ${name}`}
        className="flex flex-1 flex-col items-center gap-3 rounded-md px-1.5 py-2 text-ink-muted hover:bg-ground hover:text-ink"
      >
        <span className="relative">
          <Avatar name={name} seed={selection.employeeId ?? selection.scope} size="sm" shape={selection.kind === "employee" ? "round" : "square"} />
          {unread && <span data-unread="" className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-surface bg-primary" />}
        </span>
        <MessageCircle aria-hidden className="size-5 text-primary" />
        <span className="text-vertical max-h-64 truncate text-sm font-semibold text-ink">Talk to {name}</span>
        {live && (
          <span className="flex flex-col items-center gap-1 text-xs" role="img" aria-label="A reply is being written">
            <TypingDots />
          </span>
        )}
        {busy > 0 && (
          <span className="mt-auto flex flex-col items-center gap-1" role="img" aria-label={`${busy} at work here`}>
            {Array.from({ length: Math.min(busy, 4) }, (_, i) => (
              <span key={i} className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
            ))}
          </span>
        )}
      </button>
    </section>
  );
}

/** Nothing said here yet: who answers, what it can do at this level, and three things worth asking, from what is really here. */
function EmptyThread({ selection, name, suggestions, canStart, canAddress, onPick }: { selection: Selection; name: string; suggestions: string[]; canStart: boolean; canAddress: boolean; onPick: (text: string) => void }) {
  const employee = selection.kind === "employee";
  const covers =
    selection.kind === "app" ? `It answers about ${name}: how it is running, what it costs, who works on it and what changed.` : `It answers for ${name} and everything beneath it: what is running, what it costs, who is working on what.`;
  return (
    <div data-state="empty" className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-1.5">
        <p className="wrap-balance font-display text-lg font-semibold text-ink">{employee ? `Ask ${name} anything about its work` : `Ask about ${name}, or tell it what to change`}</p>
        <p className="text-sm text-ink-muted">
          {employee ? `${name} answers from its job and what it remembers, and can take on work you give it.` : `${covers}${canStart ? " It can also start work here, asking you first." : ""}`}
        </p>
      </div>
      <p className="text-xs text-ink-muted">{canAddress ? "Type / for the actions here, or @ to send it to someone or an app beneath this level." : "Type / for the actions here."} Files can be attached or dropped in.</p>
      {suggestions.length > 0 && (
        <ul aria-label="Things to ask" className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <li key={s} className="max-w-full">
              <button type="button" onClick={() => onPick(s)} className="flex min-h-touch max-w-full items-center gap-2 rounded-full border bg-surface px-3.5 py-2 text-left text-sm text-ink-body shadow-card transition hover:border-primary-line hover:bg-primary-tint hover:text-ink motion-reduce:transition-none">
                <MessageCircle aria-hidden className="size-4 shrink-0 text-primary" />
                <span className="min-w-0">{s}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const NONE: ChatMessage[] = [];

let sequence = 0;
function newMessageId(): string {
  sequence += 1;
  return `m-${sequence}`;
}

/** Who a message is from, by name: the conversation at a level is shared by everyone there (TALK-11). */
function Sender({ name, mine = false }: { name: string; mine?: boolean }) {
  return <span className={cn("text-xs font-semibold text-ink-muted", mine && "self-end")}>{name}</span>;
}

function OwnBubble({ who, text, attachments, sending = false, children }: { who: string; text: string; attachments: ConversationAttachment[]; sending?: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 self-end" data-own-message="">
      <Sender name={who} mine />
      <SentAttachments files={attachments} />
      {text && <p className={cn("max-w-bubble self-end whitespace-pre-line break-words rounded-md rounded-br-xs bg-primary px-4 py-2.5 text-primary-ink", sending && "opacity-70")}>{text}</p>}
      {children}
    </div>
  );
}

function Bubble({ lines, live }: { lines: SaidLine[]; live: boolean }) {
  return (
    <div data-reply={live ? "live" : "earlier"} {...(live ? { [ARRIVAL]: "" } : {})} className="flex max-w-reply flex-col gap-2 rounded-md rounded-bl-xs bg-ground px-4 py-3.5">
      {lines.map((m) => (
        <Markdown key={m.seq} text={m.text} />
      ))}
    </div>
  );
}

/** An approval the turn asked for, once answered: what was proposed, the answer, by whom and when, and the note. */
function ReceiptRow({ receipt }: { receipt: Receipt }) {
  const when = answeredAt(receipt.at);
  const word = receipt.answer === "approved" ? "Approved" : receipt.answer === "rejected" ? "Declined" : "No longer waiting";
  return (
    <div data-receipt={receipt.answer} className="flex max-w-reply items-start gap-2.5 rounded-md border bg-surface px-3 py-2.5 text-sm">
      <span aria-hidden className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", receipt.answer === "approved" ? "bg-success-tint text-success-text" : "bg-quiet text-ink-muted")}>
        {receipt.answer === "approved" ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="line-clamp-2 text-ink-body">{receipt.question}</p>
        <p className="text-xs text-ink-muted">
          <span className="font-semibold text-ink">{word}</span>
          {receipt.by && ` by ${receipt.by}`}
          {when && ` · ${when}`}
        </p>
        {receipt.note && <p className="text-xs italic text-ink-muted">“{receipt.note}”</p>}
      </div>
    </div>
  );
}

/** A turn said before this visit. Its run is read again only when it did work, once it is in view; one still under way is followed at once. */
function EarlierTurn({ turn, myName, answerer, root, onAskAgain }: { turn: HistoryTurn; myName: string | null; answerer: string | null; root: RefObject<HTMLDivElement | null>; onAskAgain: (text: string) => void }) {
  const info = turn.info;
  const mine = turn.owner?.by === null || turn.owner?.by === myName;
  const running = info !== null && !isTerminal(info.status);
  const worked = info !== null && (info.toolCalls > 0 || info.started.length > 0);
  const owner = turn.owner && <OwnBubble who={mine ? "You" : (turn.owner.by ?? "Someone")} text={turn.owner.text} attachments={turn.owner.attachments} />;
  const replyBy = turn.replies.find((r) => r.by)?.by ?? answerer ?? "Endgame";
  return (
    <>
      {owner}
      {running ? (
        // Still being answered (a reload mid-reply): its reply is picked up where it is.
        <Answer runId={turn.runId} answerer={answerer} live onRetry={turn.owner ? () => onAskAgain(turn.owner?.text ?? "") : undefined} />
      ) : worked ? (
        <LazyAnswer turn={turn} by={replyBy} root={root} onAskAgain={onAskAgain} />
      ) : (
        <StaticAnswer turn={turn} by={replyBy} onAskAgain={onAskAgain} />
      )}
    </>
  );
}

/** A turn that did no work: its reply and notices, from the history alone. */
function StaticAnswer({ turn, by, onAskAgain }: { turn: HistoryTurn; by: string; onAskAgain: (text: string) => void }) {
  const ended = turn.info?.endedWithoutReply ?? interrupted(turn.info?.status ?? null, turn.replies.length, turn.notices.length);
  return (
    <div className="flex flex-col gap-1.5" data-turn="">
      {turn.replies.length > 0 && (
        <>
          <Sender name={by} />
          <Bubble lines={turn.replies} live={false} />
        </>
      )}
      {turn.notices.map((n) => (
        <Notice key={n.seq} text={n.text} budget={n.code === "budget_exhausted"} finished={!n.code} />
      ))}
      {ended && <Interrupted why={turn.info?.interruption ?? null} onRetry={turn.owner?.text ? () => onAskAgain(turn.owner?.text ?? "") : undefined} />}
    </div>
  );
}

/** An earlier turn that did work: drawn from the history at once, then read from its log once it scrolls into view. */
function LazyAnswer({ turn, by, root, onAskAgain }: { turn: HistoryTurn; by: string; root: RefObject<HTMLDivElement | null>; onAskAgain: (text: string) => void }) {
  // Where nothing can say what is in view (a test's document), it is read at once.
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined");
  const spot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = spot.current;
    if (shown || !el) return;
    const watch = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown(true), { root: root.current, rootMargin: "400px 0px" });
    watch.observe(el);
    return () => watch.disconnect();
  }, [shown, root]);
  return <div ref={spot}>{shown ? <Answer runId={turn.runId} answerer={by} live={false} said={turn.replies} /> : <StaticAnswer turn={turn} by={by} onAskAgain={onAskAgain} />}</div>;
}

/**
 * What one turn said and did, in its fixed order: who answers, the steps it took (one row), its reply — split at each
 * approval, answered ones kept as a receipt — Endgame's own notices, then the work it started, each a card.
 */
function Answer({ runId, answerer, live, said, onRetry }: { runId: string; answerer: string | null; live: boolean; said?: SaidLine[]; onRetry?: () => void }) {
  const [retry, setRetry] = useState(0);
  const log = useRunStream(runId, retry);
  const mode = useAppSelector((s) => s.ui.mode);
  const work = useMemo(() => deriveWork(log.events, mode), [log.events, mode]);
  const run = work.run;
  const done = isTerminal(run.status);
  const announce = useContext(AnnounceContext);
  // The run's log opens with the owner's own message; it is already drawn as their bubble. Endgame's own notices stand apart.
  // Each thing said once: the closing word never repeats, or stands in for, the reply (D10, D49).
  const fromLog = distinctReplies(run.messages).map((m) => ({ seq: m.seq, text: m.text, by: null }));
  const replies = fromLog.length > 0 || log.events.length > 0 ? fromLog : (said ?? []);
  const notices = noticesToShow(run.messages);
  const receipts = useMemo(() => receiptsOf(log.events), [log.events]);
  const segments = segmentsOf(replies, receipts);
  const budget = log.events.some((e) => e.type === "message" && e.payload.code === "budget_exhausted");
  const pending = work.pending;
  const by = log.events.map((e) => (e.type === "message" && e.payload.from === "assistant" && typeof e.payload.by === "string" ? e.payload.by : null)).find((n) => n !== null) ?? answerer ?? "Endgame";
  const lastReply = replies[replies.length - 1]?.text ?? null;
  useEffect(() => {
    if (live && lastReply) announce(`${by} replied: ${markdownToPlain(lastReply).slice(0, 200)}`);
  }, [live, lastReply, by, announce]);
  useEffect(() => {
    if (pending.length > 0) announce(`Your answer is needed: ${pending[0]?.question ?? ""}`);
  }, [pending.length, pending, announce]);
  const hasWords = segments.length > 0;
  const stopped = done && interrupted(run.status, replies.length, notices.length) && !budget;
  return (
    <div className="flex flex-col gap-2" data-turn="">
      {(hasWords || work.steps.length > 0) && <Sender name={by} />}
      {work.steps.length > 0 && <Steps steps={work.steps} runId={runId} toolCalls={work.tools.total} />}
      {segments.map((s) =>
        s.kind === "bubble" ? (
          <Bubble key={`b-${s.lines[0]?.seq ?? 0}`} lines={s.lines} live={live} />
        ) : s.receipt.answer === "pending" ? (
          // The conversation's own checkpoints are answered here, in the conversation (TALK-07).
          <div key={s.receipt.id} className="max-w-reply" {...(live ? { [ARRIVAL]: "" } : {})}>
            {pending.filter((a) => a.id === s.receipt.id).map((a) => (
              <ApprovalCard key={a.id} runId={runId} approval={a} compact />
            ))}
          </div>
        ) : (
          <ReceiptRow key={s.receipt.id} receipt={s.receipt} />
        ),
      )}
      {notices.map((m) => (
        <Notice key={m.seq} text={m.text} budget={budget} finished={run.status === "finished" && !m.code} />
      ))}
      {/* Stopped with nothing said (no AI model could be reached, its worker lost, a fault): it can be asked again as it was. */}
      {stopped && <Interrupted why={run.finishedSummary} onRetry={onRetry} />}
      {/* Stopped with only Endgame's own word for why (not the budget, which has its own way on): the same, asked again. */}
      {done && run.status === "failed" && !budget && replies.length === 0 && notices.length > 0 && onRetry && (
        <Button size="sm" variant="outline" className="self-start" onClick={onRetry}>
          <RotateCcw aria-hidden className="size-4" />
          Try again
        </Button>
      )}
      {work.started.map((s) => (
        <div key={s.runId} className="max-w-prose" {...(live ? { [ARRIVAL]: "" } : {})}>
          <WorkCard runId={s.runId} kind={s.kind} />
        </div>
      ))}
      {live && !done && log.stream !== "failed" && <Working text={log.stream === "reconnecting" ? "Reconnecting…" : pending.length > 0 ? "Waiting for your answer" : "Working on it"} />}
      {log.stream === "failed" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {log.streamError} The reply is still being written.
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="min-h-touch rounded-xs font-semibold underline">
            Reconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** A simple answer's steps, as one row — how many, what they were, open them, or see the whole run; opened, each one. */
function Steps({ steps, runId, toolCalls }: { steps: string[]; runId: string; toolCalls: number }) {
  const [open, setOpen] = useState(false);
  const count = Math.max(toolCalls, steps.length);
  return (
    <div data-steps="" className="flex max-w-reply flex-col gap-1 text-sm">
      <div className="flex min-w-0 items-center gap-2 text-ink-muted">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-touch min-w-0 flex-1 items-center gap-2 rounded-xs text-left hover:text-ink">
          <Icon name="plan" className="size-4 shrink-0" />
          <span className="shrink-0 font-semibold text-ink-body">{count === 1 ? "1 step" : `${count} steps`}</span>
          <span aria-hidden className="shrink-0">·</span>
          <span className="min-w-0 truncate">{steps.join(" · ")}</span>
          <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        <Link href={paths.run(runId)} className={cn("flex shrink-0 items-center gap-0.5 rounded-xs text-xs font-semibold text-primary-link hover:text-primary-hover", TAP)}>
          See how it got there
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      {open && (
        <ol className="flex list-decimal flex-col gap-0.5 border-l-2 border-border pb-1 pl-8 text-ink-body">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Endgame's own word in the conversation: no reply was written, and why, with the way to more credits when it was the budget.
 * Only a stop reads as one; work that finished is said in the ordinary voice.
 */
function Notice({ text, budget, finished = false }: { text: string; budget: boolean; finished?: boolean }) {
  return (
    <div
      role="status"
      data-tone={finished ? "neutral" : "attention"}
      className={cn("flex max-w-reply gap-2.5 rounded-md border px-3.5 py-3 text-sm", finished ? "border-border bg-surface text-ink-body" : "border-attention-line bg-attention-tint text-attention-text")}
    >
      {!finished && <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <div className="flex flex-col gap-2">
        {text}
        {budget && (
          <Link href={paths.credits()} className="self-start rounded-xs font-semibold underline">
            See credits
          </Link>
        )}
      </div>
    </div>
  );
}

/** A turn that ended with nothing said for it: said plainly, and asked again in one press. */
function Interrupted({ why, onRetry }: { why: string | null; onRetry?: () => void }) {
  return (
    <div role="status" data-interrupted="" className="flex max-w-reply flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-attention-line bg-attention-tint px-3.5 py-2.5 text-sm text-attention-text">
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        The reply was interrupted.
        {why && <span className="text-ink-muted"> {why}</span>}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="flex min-h-touch items-center gap-1 rounded-xs font-semibold underline">
          <RotateCcw aria-hidden className="size-3.5" />
          Try again
        </button>
      )}
    </div>
  );
}

export function TypingDots({ label }: { label?: string }) {
  return (
    <span aria-hidden={label ? undefined : true} role={label ? "status" : undefined} aria-label={label} className="flex gap-1">
      <span className="size-1.5 animate-bob rounded-full bg-primary motion-reduce:animate-none" />
      <span className="size-1.5 animate-bob rounded-full bg-primary animate-delay-1 motion-reduce:animate-none" />
      <span className="size-1.5 animate-bob rounded-full bg-primary animate-delay-2 motion-reduce:animate-none" />
    </span>
  );
}

/** The answer is on its way: shown from the moment a message is sent until the work that answers it ends. */
function Working({ text }: { text: string }) {
  return (
    <div data-working="" className="flex items-center gap-2.5 text-sm text-ink-muted">
      <TypingDots />
      {text}
    </div>
  );
}

function Exchange({ message, onRetry, answerer }: { message: ChatMessage; onRetry: () => void; answerer: string | null }) {
  return (
    <>
      <OwnBubble who="You" text={message.text} attachments={message.attachments ?? []} sending={message.state === "sending"}>
        {message.state === "failed" && (
          <div role="alert" className="max-w-bubble self-end text-right text-xs text-attention-text">
            <TriangleAlert aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />
            Not sent: {message.error}{" "}
            <button type="button" onClick={onRetry} className="inline-flex min-h-touch items-center rounded-xs font-semibold underline">
              Send again
            </button>
          </div>
        )}
      </OwnBubble>
      {/* From the moment it is sent, before the work that answers it has started ("Working on it" then takes over). */}
      {message.state === "sending" && <Working text="Sending…" />}
      {message.runId && <Answer runId={message.runId} answerer={answerer} live onRetry={onRetry} />}
    </>
  );
}
