import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { ArrowDown, ChevronDown, Maximize2, MessageCircle, Minimize2, MoveHorizontal, PanelRightClose, PanelRightOpen, Paperclip } from "lucide-react";
import { useActiveTree } from "@/lib/useActiveOrganisation";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Markdown } from "@/components/Markdown";
import { Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { describeError, viewOf } from "@/lib/queryState";
import { navigate, paths, useLocation } from "@/lib/router";
import { TAP } from "@/lib/touch";
import { useFollowLatest } from "@/lib/useFollowLatest";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useControlRunMutation, useEstimateMessageQuery, useGetConversationCapabilitiesQuery, useGetConversationQuery, useGetMeQuery, useStartConversationMutation } from "@/store/api";
import type { ConversationAttachment, ConversationMessage, ConversationTurn, MessageNarrowing, Tree } from "@/store/types";
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
import { useDraftFiles } from "../conversation/useDraftFiles";
import { WorkCard } from "../conversation/WorkCard";
import { deriveWork } from "../conversation/workModel";

/** What "@" carried here from another page: the words, so they are not lost on the way (ARCH-011). */
let carriedDraft: string | null = null;

const LEVEL: Record<Selection["kind"], string> = { organisation: "Organisation", division: "Division", project: "Project", app: "App", employee: "Employee" };

/** Says, once, what a screen reader should hear: a reply that arrived, work that ended, a question waiting. */
const AnnounceContext = createContext<(text: string) => void>(() => undefined);

/**
 * The conversation at a level (ARCH-011): a pane with its header, the thread, and the composer
 * pinned at its foot. On a desktop it is docked at the right edge (narrow, wide, collapsed or full
 * width); in a page (a tablet, an app's or an employee's page) it is a framed panel of its own
 * height; on a phone it fills the shell's sheet. What was said before is read from the control
 * plane, so it survives a reload; each new message starts a run, whose replies and work stream in.
 */
export function ConversationDock({ tree, selection, fill = true, onRetarget }: { tree: Tree; selection: Selection; fill?: boolean; onRetarget?: (selection: Selection) => void }) {
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
  const busy = activeWork(tree).filter((w) => !selection.employeeId || w.id === selection.employeeId);
  const logRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const onEmployeePage = location.pathname.startsWith("/employees/");
  const inSheet = useInSheet();
  const dock = useDockLayout();
  const variant = inSheet ? "sheet" : dock ? "docked" : "framed";
  const { behind, toLatest } = useFollowLatest(logRef);
  const [dragging, setDragging] = useState(false);
  const [said, setSaid] = useState("");
  const announce = useCallback((text: string) => setSaid(text), []);

  const contents = useMemo(() => contentsOf(tree, selection.kind === "employee" ? selection.scope : selection.scope), [tree, selection.scope, selection.kind]);
  const targets = useMemo(() => targetsOf(contents, selection), [contents, selection]);
  const suggestions = useMemo(() => suggestedPrompts(tree, selection), [tree, selection]);

  // The reply being written now: the latest message sent here whose work has not ended. Stop cancels it.
  const lastRun = [...messages].reverse().find((m) => m.runId)?.runId ?? null;
  const live = useAppSelector((s) => {
    if (!lastRun) return false;
    const events = s.runs[lastRun]?.events;
    return !events || events[events.length - 1]?.type !== "run.finished";
  });

  const retarget = (t: Target) => {
    const next: Selection = t.kind === "employee" ? { scope: t.scope, kind: "employee", trail: t.trail, employeeId: t.employeeId } : { scope: t.scope, kind: "app", trail: t.trail };
    if (onRetarget) {
      onRetarget(next);
      return;
    }
    // Off the org chart (an app's or an employee's page), the conversation there moves to the org chart, words and all.
    carriedDraft = draft;
    dispatch(selected(next));
    navigate(paths.home());
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
  const turns = history.kind === "loaded" ? new Map(history.data.turns.map((t) => [t.runId, t])) : new Map<string, ConversationTurn>();
  const earlier = history.kind === "loaded" ? groupTurns(withoutClosingRepeats(history.data.messages.filter((m) => !liveRuns.has(m.runId)))) : [];
  const empty = history.kind === "loaded" && earlier.length === 0 && messages.length === 0;
  const answerer = selection.kind === "employee" ? name : null;

  if (variant === "docked" && dock?.collapsed) {
    return (
      <section aria-label="Conversation" data-variant="collapsed" className="flex h-full flex-col items-center gap-3 py-4">
        <button type="button" onClick={() => dock.setCollapsed(false)} aria-label={`Open the conversation with ${name}`} title={`Talk to ${name}`} className="flex flex-col items-center gap-2 rounded-xs p-1 text-ink-muted hover:text-ink">
          <Avatar name={name} seed={selection.employeeId ?? selection.scope} size="sm" shape={selection.kind === "employee" ? "round" : "square"} />
          <PanelRightOpen aria-hidden className="size-5" />
        </button>
        {live && <span className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-label="A reply is being written" role="img" />}
      </section>
    );
  }

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
        className={cn(
          "relative flex min-h-0 flex-col",
          variant === "sheet" && "h-full px-4 pt-3",
          variant === "docked" && "h-full",
          variant === "framed" && "h-pane overflow-hidden rounded-md border bg-surface shadow-card",
          variant === "framed" && !fill && "w-full",
        )}
      >
        <PaneHeader selection={selection} name={name} inSheet={inSheet} onEmployeePage={onEmployeePage} />

        <div
          ref={logRef}
          role="log"
          aria-live="off"
          aria-label={`Conversation with ${name}`}
          className={cn("flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain py-5", variant === "sheet" ? "py-4" : "px-4", dock?.full && "items-center")}
        >
          <div className={cn("flex w-full flex-col gap-5", dock?.full && "max-w-prose")}>
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
            {empty && <EmptyThread selection={selection} name={name} suggestions={suggestions} canStart={caps.kind === "loaded" && caps.data.actions.length > 0} onPick={(text) => {
              setDraft(text);
              requestAnimationFrame(() => document.getElementById(inputId)?.focus());
            }} />}
            {earlier.map((turn) => (
              <EarlierTurn key={turn.key} turn={turn} info={turns.get(turn.runId) ?? null} myName={myName} answerer={answerer} root={logRef} />
            ))}
            {messages.map((m) => (
              <Exchange key={m.id} message={m} onRetry={() => void send(m.text, m.attachments ?? [], {})} answerer={answerer} />
            ))}
            {busy.slice(0, 2).map((w) => (
              <div key={w.name} className="flex items-center gap-2.5 text-sm text-ink-muted">
                <TypingDots />
                {activityLine(w.name, w.activity)}
              </div>
            ))}
          </div>
        </div>
        {behind && (
          // Over the foot of the log, outside it, so it is not read out as part of the conversation.
          <div className="relative h-0">
            <Button size="sm" variant="soft" onClick={toLatest} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full font-semibold text-ink shadow-raised">
              <ArrowDown aria-hidden className="size-4" />
              New reply
            </Button>
          </div>
        )}

        <div className={cn("shrink-0", dock?.full && "flex justify-center")}>
          <div className={cn("w-full", dock?.full && "max-w-prose")}>
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

/** Who you are talking to, at which level, and — docked on a desktop — narrow or wide, full width, or collapsed. */
function PaneHeader({ selection, name, inSheet, onEmployeePage }: { selection: Selection; name: string; inSheet: boolean; onEmployeePage: boolean }) {
  const dock = useDockLayout();
  const narrowable = selection.kind === "organisation";
  const hint = narrowable
    ? "Select a division, project or employee to narrow this."
    : onEmployeePage
      ? `Only ${name} hears this, and answers from its job and what it remembers.`
      : selection.kind === "app"
        ? `About ${name} only: ask about it, or ask for a change to it.`
        : "Select the organisation band to talk to everything again.";
  return (
    <header className={cn("flex shrink-0 items-start gap-3 border-b", inSheet ? "pb-3 pr-12" : "px-4 py-3.5")}>
      <Avatar name={name} seed={selection.employeeId ?? selection.scope} size="md" shape={selection.kind === "employee" ? "round" : "square"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-eyebrow font-semibold uppercase text-ink-muted" data-level="">
          {LEVEL[selection.kind]}
          {selection.trail.length > 1 && <span className="font-normal normal-case tracking-normal"> · in {selection.trail[selection.trail.length - 2]}</span>}
        </span>
        <h2 className="truncate font-sans text-base font-semibold tracking-normal">Talking to {name}</h2>
        <span className="text-xs text-ink-muted">{hint}</span>
        {selection.kind === "employee" && selection.employeeId && !onEmployeePage && (
          <Link href={paths.employee(selection.employeeId)} className={cn("self-start rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover", TAP)}>
            See {name}’s job, record and memory
          </Link>
        )}
      </div>
      {dock && (
        <div className="-mr-2 -mt-1 flex shrink-0 items-center" role="group" aria-label="The pane">
          {!dock.full && (
            <HeaderButton label={dock.wide ? "Make the pane narrower" : "Make the pane wider"} onClick={() => dock.setWide(!dock.wide)} pressed={dock.wide}>
              <MoveHorizontal aria-hidden className="size-4" />
            </HeaderButton>
          )}
          <HeaderButton label={dock.full ? "Back to the page" : "Open full width"} onClick={() => dock.setFull(!dock.full)} pressed={dock.full}>
            {dock.full ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
          </HeaderButton>
          <HeaderButton label="Collapse the pane" onClick={() => dock.setCollapsed(true)}>
            <PanelRightClose aria-hidden className="size-4" />
          </HeaderButton>
        </div>
      )}
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

/** Nothing said here yet: who answers, what it can do at this level, and three things worth asking, from what is really here. */
function EmptyThread({ selection, name, suggestions, canStart, onPick }: { selection: Selection; name: string; suggestions: string[]; canStart: boolean; onPick: (text: string) => void }) {
  const employee = selection.kind === "employee";
  return (
    <div data-state="empty" className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-1.5">
        <p className="font-display text-lg font-semibold text-ink">{employee ? `Ask ${name} anything about its work` : `Ask about ${name}, or tell it what to change`}</p>
        <p className="text-sm text-ink-muted">
          {employee
            ? `${name} answers from its job and what it remembers, and can take on work you give it.`
            : `It answers for ${name} and everything beneath it: what is running, what it costs, who is working on what.${canStart ? " It can also start an idea, change an app or try stopped work again, asking you first." : ""}`}
        </p>
      </div>
      <p className="text-xs text-ink-muted">Type / for the actions here, or @ to send it to someone or an app beneath this level. Files can be attached or dropped in.</p>
      {suggestions.length > 0 && (
        <ul aria-label="Things to ask" className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => onPick(s)} className="flex min-h-touch w-full items-center gap-2.5 rounded-sm border bg-surface px-3.5 py-2.5 text-left text-sm text-ink-body transition hover:border-primary-line hover:bg-primary-tint motion-reduce:transition-none">
                <MessageCircle aria-hidden className="size-4 shrink-0 text-primary" />
                {s}
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

interface Turn {
  key: string;
  runId: string;
  from: string;
  owner: boolean;
  by: string | null;
  code: string | null;
  texts: string[];
  attachments: ConversationAttachment[];
}

/** Consecutive messages from the same person on the same run read as one bubble. */
function groupTurns(messages: ConversationMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    const owner = m.from === "owner";
    const last = turns[turns.length - 1];
    if (last && last.runId === m.runId && last.owner === owner && last.from === m.from && last.by === m.by) {
      last.texts.push(m.text);
      last.attachments.push(...(m.attachments ?? []));
    } else turns.push({ key: `${m.runId}-${m.seq}`, runId: m.runId, from: m.from, owner, by: m.by, code: m.code, texts: [m.text], attachments: [...(m.attachments ?? [])] });
  }
  return turns;
}

/** Who a message is from, by name: the conversation at a level is shared by everyone there (TALK-11). */
function Sender({ name, mine = false }: { name: string; mine?: boolean }) {
  return <span className={cn("text-xs font-semibold text-ink-muted", mine && "self-end")}>{name}</span>;
}

function OwnBubble({ who, text, attachments, sending = false }: { who: string; text: string; attachments: ConversationAttachment[]; sending?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 self-end" data-own-message="">
      <Sender name={who} mine />
      <SentAttachments files={attachments} />
      {text && <p className={cn("max-w-bubble self-end whitespace-pre-line break-words rounded-md rounded-br-xs bg-primary px-4 py-2.5 text-primary-ink", sending && "opacity-70")}>{text}</p>}
    </div>
  );
}

function ReplyBubble({ by, children }: { by: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Sender name={by} />
      <div className="flex max-w-reply flex-col gap-2 rounded-md rounded-bl-xs bg-ground px-4 py-3.5">{children}</div>
    </div>
  );
}

/** A turn said before this visit. Work it did is streamed again only once it is in view, so a long history opens fast. */
function EarlierTurn({ turn, info, myName, answerer, root }: { turn: Turn; info: ConversationTurn | null; myName: string | null; answerer: string | null; root: RefObject<HTMLDivElement | null> }) {
  if (turn.owner) {
    const mine = turn.by === null || turn.by === myName;
    return <OwnBubble who={mine ? "You" : (turn.by ?? "Someone")} text={turn.texts.join("\n\n")} attachments={turn.attachments} />;
  }
  if (turn.from === "runner") return <Notice text={turn.texts.join(" ")} budget={turn.code === "budget_exhausted"} />;
  const worked = info !== null && (info.toolCalls > 0 || info.started.length > 0 || !isTerminal(info.status));
  return (
    <>
      {worked && <LazyWork runId={turn.runId} root={root} />}
      <ReplyBubble by={turn.by ?? answerer ?? "Endgame"}>
        {turn.texts.map((text, i) => (
          <Markdown key={i} text={text} />
        ))}
      </ReplyBubble>
    </>
  );
}

/** The steps and work of an earlier turn, read from its log once the turn scrolls into view. */
function LazyWork({ runId, root }: { runId: string; root: RefObject<HTMLDivElement | null> }) {
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
  return <div ref={spot}>{shown ? <TurnWork runId={runId} /> : <div className="h-6" />}</div>;
}

/** What one turn did besides replying: the steps it took, approvals it waits on, and the work it started, each live. */
function TurnWork({ runId }: { runId: string }) {
  const log = useRunStream(runId);
  const mode = useAppSelector((s) => s.ui.mode);
  const work = useMemo(() => deriveWork(log.events, mode), [log.events, mode]);
  return (
    <div className="flex flex-col gap-3">
      {work.steps.length > 0 && <Steps steps={work.steps} runId={runId} toolCalls={work.tools.total} />}
      {work.pending.map((a) => (
        <ApprovalCard key={a.id} runId={runId} approval={a} compact />
      ))}
      {work.started.map((s) => (
        <WorkCard key={s.runId} runId={s.runId} kind={s.kind} />
      ))}
    </div>
  );
}

/** A simple answer's steps, collapsed to one line ("Read the org chart · Read the recent work"); opened, each one. */
function Steps({ steps, runId, toolCalls }: { steps: string[]; runId: string; toolCalls: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-steps="" className="flex flex-col gap-1.5 text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-touch items-center gap-2 self-start rounded-xs text-left text-ink-muted hover:text-ink">
        <Icon name="plan" className="size-4 shrink-0 text-teal" />
        <span className="line-clamp-1">{steps.join(" · ")}</span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-l-2 border-teal-tint pl-4">
          <ol className="flex flex-col gap-0.5 text-ink-body">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <span className="text-xs text-ink-muted">{toolCalls === 1 ? "1 step in all." : `${toolCalls} steps in all.`}</span>
          <Link href={paths.run(runId)} className={cn("self-start rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover", TAP)}>
            See how it got there
          </Link>
        </div>
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
      className={cn(
        "flex max-w-reply flex-col gap-2 rounded-md border px-4 py-3 text-sm",
        finished ? "border-border bg-surface text-ink-body" : "border-attention-line bg-attention-tint text-attention-text",
      )}
    >
      {text}
      {budget && (
        <Link href={paths.credits()} className="self-start rounded-xs font-semibold underline">
          See credits
        </Link>
      )}
    </div>
  );
}

export function TypingDots({ label }: { label?: string }) {
  return (
    <span aria-hidden={label ? undefined : true} role={label ? "status" : undefined} aria-label={label} className="flex gap-1">
      <span className="size-1.5 animate-bob rounded-full bg-violet motion-reduce:animate-none" />
      <span className="size-1.5 animate-bob rounded-full bg-violet animate-delay-1 motion-reduce:animate-none" />
      <span className="size-1.5 animate-bob rounded-full bg-violet animate-delay-2 motion-reduce:animate-none" />
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
      <OwnBubble who="You" text={message.text} attachments={message.attachments ?? []} sending={message.state === "sending"} />
      {/* From the moment it is sent, before the work that answers it has started ("Working on it" then takes over). */}
      {message.state === "sending" && <Working text="Sending…" />}
      {message.state === "failed" && (
        <div role="alert" className="flex flex-col gap-2 self-end rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          Not sent: {message.error}
          <button type="button" onClick={onRetry} className="min-h-touch self-start rounded-xs font-semibold underline">
            Send again
          </button>
        </div>
      )}
      {message.runId && <Replies runId={message.runId} answerer={answerer} onRetry={onRetry} />}
    </>
  );
}

function Replies({ runId, answerer, onRetry }: { runId: string; answerer: string | null; onRetry?: () => void }) {
  const [retry, setRetry] = useState(0);
  const log = useRunStream(runId, retry);
  const mode = useAppSelector((s) => s.ui.mode);
  const work = useMemo(() => deriveWork(log.events, mode), [log.events, mode]);
  const run = work.run;
  const done = isTerminal(run.status);
  const announce = useContext(AnnounceContext);
  // The run's log opens with the owner's own message; it is already drawn as their bubble. Endgame's own notices stand apart.
  // Each thing said once: the closing word never repeats, or stands in for, the reply (D10, D49).
  const replies = distinctReplies(run.messages);
  const notices = noticesToShow(run.messages);
  const budget = log.events.some((e) => e.type === "message" && e.payload.code === "budget_exhausted");
  const pending = work.pending;
  const by = log.events.map((e) => (e.type === "message" && e.payload.from === "assistant" && typeof e.payload.by === "string" ? e.payload.by : null)).find((n) => n !== null) ?? answerer;
  const lastReply = replies[replies.length - 1]?.text ?? null;
  useEffect(() => {
    if (lastReply) announce(`${by ?? "Endgame"} replied: ${lastReply.slice(0, 200)}`);
  }, [lastReply, by, announce]);
  useEffect(() => {
    if (pending.length > 0) announce(`Your answer is needed: ${pending[0]?.question ?? ""}`);
  }, [pending.length, pending, announce]);
  return (
    <>
      {work.steps.length > 0 && <Steps steps={work.steps} runId={runId} toolCalls={work.tools.total} />}
      {replies.length > 0 && (
        <ReplyBubble by={by ?? "Endgame"}>
          {replies.map((m) => (
            <Markdown key={m.seq} text={m.text} />
          ))}
        </ReplyBubble>
      )}
      {notices.map((m) => (
        <Notice key={m.seq} text={m.text} budget={budget} finished={run.status === "finished" && !m.code} />
      ))}
      {/* Stopped with no reply (no AI model could be reached, a fault): the message can be sent again as it was. */}
      {onRetry && run.status === "failed" && !budget && replies.length === 0 && (
        <Button size="sm" variant="outline" className="self-start" onClick={onRetry}>
          Try again
        </Button>
      )}
      {/* The conversation's own checkpoints are answered here, in the conversation (TALK-07). */}
      {pending.map((a) => (
        <ApprovalCard key={a.id} runId={runId} approval={a} compact />
      ))}
      {work.started.map((s) => (
        <WorkCard key={s.runId} runId={s.runId} kind={s.kind} />
      ))}
      {!done && log.stream !== "failed" && <Working text={log.stream === "reconnecting" ? "Reconnecting…" : pending.length > 0 ? "Waiting for your answer" : "Working on it"} />}
      {log.stream === "failed" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {log.streamError} The reply is still being written.
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="min-h-touch rounded-xs font-semibold underline">
            Reconnect
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The conversation scoped to one app (TALK-04), for the app's own page: the same pane, about that app only. It may answer, start
 * an idea, ask for a change to the app or try stopped work again — each only once the person approves it here.
 */
export function AppConversation({ scope, trail }: { scope: string; trail: string[] }) {
  const tree = useActiveTree();
  if (!tree.data) return null;
  // In the app's page, among its sections: a framed pane of its own height, never the page's.
  return <ConversationDock tree={tree.data} selection={{ scope, kind: "app", trail }} fill={false} />;
}
