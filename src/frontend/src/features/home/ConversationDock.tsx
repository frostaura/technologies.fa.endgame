import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { Link } from "@/components/Link";
import { Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { formatCredits } from "@/lib/format";
import { describeError, viewOf } from "@/lib/queryState";
import { paths, useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useEstimateMessageQuery, useGetConversationQuery, useGetMeQuery, useGetTreeQuery, useStartConversationMutation } from "@/store/api";
import type { ConversationMessage, Tree } from "@/store/types";
import { conversationKey, messageQueued, messageSettled, type ChatMessage, type Selection } from "@/store/uiSlice";
import { ApprovalCard } from "../runs/ApprovalCard";
import { deriveRun, isTerminal } from "../runs/runModel";
import { useRunStream } from "../runs/useRunStream";
import { activeWork } from "./treeModel";

/**
 * The one conversation, docked beside the org chart and scoped to whatever is selected. What was
 * said before is read from the control plane, so it survives a reload; each new message starts a
 * run, and its replies are that run's `message` events, streamed and appended below.
 */
export function ConversationDock({ tree, selection }: { tree: Tree; selection: Selection }) {
  const dispatch = useAppDispatch();
  const key = conversationKey(selection);
  const messages = useAppSelector((s) => s.ui.conversations[key]) ?? NONE;
  const historyQuery = useGetConversationQuery({ scope: selection.scope, ...(selection.employeeId ? { employeeId: selection.employeeId } : {}) });
  const history = viewOf(historyQuery);
  // A turn sent in this visit is drawn from its live run; the history copy of it is left out.
  const liveRuns = new Set(messages.map((m) => m.runId).filter((id): id is string => id !== null));
  const earlier = history.kind === "loaded" ? groupTurns(history.data.messages.filter((m) => !liveRuns.has(m.runId))) : [];
  const [start] = useStartConversationMutation();
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const name = selection.trail[selection.trail.length - 1] ?? "";
  const narrowable = selection.kind === "organisation";
  const me = useGetMeQuery(undefined);
  const myName = me.data?.user.displayName ?? null;
  // What a message can cost at most, shown before it is sent (CLAUDE.md rule 11).
  const estimateQuery = useEstimateMessageQuery({ scope: selection.scope, ...(selection.employeeId ? { employeeId: selection.employeeId } : {}) });
  const estimate = viewOf(estimateQuery);
  // Who is working: everyone, or only the employee the conversation is with.
  const busy = activeWork(tree).filter((w) => !selection.employeeId || w.id === selection.employeeId);
  const logRef = useRef<HTMLDivElement>(null);
  const onEmployeePage = useLocation().pathname.startsWith("/employees/");

  useEffect(() => {
    const el = logRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [messages.length, earlier.length]);

  const send = async (text: string) => {
    const id = newMessageId();
    dispatch(messageQueued({ key, message: { id, text, state: "sending", runId: null, error: null } }));
    try {
      const run = await start({ scope: selection.scope, message: text, ...(selection.employeeId ? { employeeId: selection.employeeId } : {}) }).unwrap();
      dispatch(messageSettled({ key, id, runId: run.id, error: null }));
    } catch (e) {
      dispatch(messageSettled({ key, id, runId: null, error: describeError(e as never) }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void send(text);
  };

  return (
    <section aria-label="Conversation" className="flex min-h-full flex-col gap-0">
      <div className="flex items-center gap-3.5 border-b pb-5">
        <Avatar name={name} seed={selection.employeeId ?? selection.scope} size="md" shape={selection.kind === "employee" ? "round" : "square"} />
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate font-sans text-base font-semibold tracking-normal">Talking to {name}</h2>
          <span className="text-xs text-ink-muted">
            {narrowable
              ? "Select a division, project or employee to narrow this."
              : onEmployeePage
                ? `Only ${name} hears this, and answers from its job and what it remembers.`
                : selection.kind === "app"
                  ? `About ${name} only: ask about it, or ask for a change to it.`
                  : "Select the organisation band to talk to everything again."}
          </span>
          {selection.kind === "employee" && selection.employeeId && !onEmployeePage && (
            <Link href={paths.employee(selection.employeeId)} className="self-start rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover">
              See {name}’s job, record and memory
            </Link>
          )}
        </div>
      </div>

      <div ref={logRef} role="log" aria-live="polite" aria-label={`Conversation with ${name}`} className="flex flex-1 flex-col gap-3.5 overflow-y-auto py-5 lg:max-h-screen">
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
        {history.kind === "loaded" && earlier.length === 0 && messages.length === 0 && (
          <p data-state="empty" className="text-ink-muted">
            Ask what needs you, or tell it what to change. It answers for {name} and everything beneath it.
          </p>
        )}
        {earlier.map((turn) => (
          <EarlierTurn key={turn.key} turn={turn} myName={myName} answerer={selection.kind === "employee" ? name : null} />
        ))}
        {messages.map((m) => (
          <Exchange key={m.id} message={m} onRetry={() => void send(m.text)} answerer={selection.kind === "employee" ? name : null} />
        ))}
        {busy.slice(0, 2).map((w) => (
          <div key={w.name} className="flex items-center gap-2.5 text-sm text-ink-muted">
            <TypingDots />
            {w.name} is {lowerFirst(w.activity)}
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 border-t pt-4">
        <label htmlFor={inputId} className="text-xs text-ink-muted">
          Message {name}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask, or tell it what to change"
            autoComplete="off"
            className="min-h-12 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface px-4"
          />
          <Button type="submit" className="min-h-12 px-5" disabled={draft.trim().length === 0 || estimate.kind === "loading"}>
            Send
          </Button>
        </div>
        <p data-testid="message-estimate" className="text-xs text-ink-muted" aria-live="polite">
          {estimate.kind === "loading" && "Working out what a message costs…"}
          {estimate.kind === "loaded" &&
            (estimate.data.ceiling !== null
              ? `A message here costs at most ${formatCredits(estimate.data.ceiling)}, usually about ${formatCredits(estimate.data.credits)}; it is charged at what it actually costs.`
              : `A message here is estimated at ${formatCredits(estimate.data.credits)}.`)}
          {estimate.kind === "failed" && `What a message costs could not be worked out: ${estimate.reason} Its cost is still held before each step and shown with the reply.`}
        </p>
      </form>
    </section>
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
}

/** Consecutive messages from the same person on the same run read as one bubble. */
function groupTurns(messages: ConversationMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    const owner = m.from === "owner";
    const last = turns[turns.length - 1];
    if (last && last.runId === m.runId && last.owner === owner && last.from === m.from && last.by === m.by) last.texts.push(m.text);
    else turns.push({ key: `${m.runId}-${m.seq}`, runId: m.runId, from: m.from, owner, by: m.by, code: m.code, texts: [m.text] });
  }
  return turns;
}

/** Who a message is from, by name: the conversation at a level is shared by everyone there (TALK-11). */
function Sender({ name, mine = false }: { name: string; mine?: boolean }) {
  return <span className={cn("text-xs font-semibold text-ink-muted", mine && "self-end")}>{name}</span>;
}

function EarlierTurn({ turn, myName, answerer }: { turn: Turn; myName: string | null; answerer: string | null }) {
  if (turn.owner) {
    const mine = turn.by === null || turn.by === myName;
    return (
      <div className="flex flex-col gap-1 self-end">
        <Sender name={mine ? "You" : (turn.by ?? "Someone")} mine />
        <p className="max-w-bubble whitespace-pre-line rounded-md rounded-br-xs bg-primary px-4 py-2.5 text-primary-ink">{turn.texts.join("\n\n")}</p>
      </div>
    );
  }
  if (turn.from === "runner") return <Notice text={turn.texts.join(" ")} budget={turn.code === "budget_exhausted"} />;
  return (
    <div className="flex flex-col gap-1">
      <Sender name={turn.by ?? answerer ?? "Endgame"} />
      <div className="flex max-w-reply flex-col gap-2 rounded-md rounded-bl-xs bg-ground px-4 py-3.5">
        {turn.texts.map((text, i) => (
          <p key={i} className="whitespace-pre-line">
            {text}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Endgame's own word in the conversation: no reply was written, and why, with the way to more credits when it was the budget. */
function Notice({ text, budget }: { text: string; budget: boolean }) {
  return (
    <div role="status" className="flex max-w-reply flex-col gap-2 rounded-md border border-attention-line bg-attention-tint px-4 py-3 text-sm text-attention-text">
      {text}
      {budget && (
        <Link href={paths.credits()} className="self-start rounded-xs font-semibold underline">
          See credits
        </Link>
      )}
    </div>
  );
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
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

function Exchange({ message, onRetry, answerer }: { message: ChatMessage; onRetry: () => void; answerer: string | null }) {
  return (
    <>
      <div className="flex flex-col gap-1 self-end">
        <Sender name="You" mine />
        <p className={cn("max-w-bubble rounded-md rounded-br-xs bg-primary px-4 py-2.5 text-primary-ink", message.state === "sending" && "opacity-70")}>{message.text}</p>
      </div>
      {message.state === "failed" && (
        <div role="alert" className="flex flex-col gap-2 self-end rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          Not sent: {message.error}
          <button type="button" onClick={onRetry} className="min-h-touch self-start rounded-xs font-semibold underline">
            Send again
          </button>
        </div>
      )}
      {message.runId && <Replies runId={message.runId} answerer={answerer} />}
    </>
  );
}

function Replies({ runId, answerer }: { runId: string; answerer: string | null }) {
  const [retry, setRetry] = useState(0);
  const log = useRunStream(runId, retry);
  const run = deriveRun(log.events);
  const done = isTerminal(run.status);
  // The run's log opens with the owner's own message; it is already drawn as their bubble. Endgame's own notices stand apart.
  const replies = run.messages.filter((m) => m.from !== "owner" && m.from !== "runner");
  const notices = run.messages.filter((m) => m.from === "runner");
  const budget = log.events.some((e) => e.type === "message" && e.payload.code === "budget_exhausted");
  const pending = run.approvals.filter((a) => a.answer === null);
  const by = log.events.map((e) => (e.type === "message" && e.payload.from === "assistant" && typeof e.payload.by === "string" ? e.payload.by : null)).find((n) => n !== null) ?? answerer;
  return (
    <>
      {replies.length > 0 && (
        <div className="flex flex-col gap-1">
          <Sender name={by ?? "Endgame"} />
          <div className="flex max-w-reply flex-col gap-2 rounded-md rounded-bl-xs bg-ground px-4 py-3.5">
            {replies.map((m) => (
              <p key={m.seq} className="whitespace-pre-line">
                {m.text}
              </p>
            ))}
          </div>
        </div>
      )}
      {notices.map((m) => (
        <Notice key={m.seq} text={m.text} budget={budget} />
      ))}
      {/* The conversation's own checkpoints are answered here, in the conversation (TALK-07). */}
      {pending.map((a) => (
        <ApprovalCard key={a.id} runId={runId} approval={a} compact />
      ))}
      {!done && log.stream !== "failed" && (
        <div className="flex items-center gap-2.5 text-sm text-ink-muted">
          <TypingDots />
          {log.stream === "reconnecting" ? "Reconnecting…" : pending.length > 0 ? "Waiting for your answer" : "Working on it"}
        </div>
      )}
      {log.stream === "failed" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {log.streamError} The reply is still being written.
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="min-h-touch rounded-xs font-semibold underline">
            Reconnect
          </button>
        </div>
      )}
      {(run.toolCalls > 0 || run.tasks.length > 0) && (
        <Link href={paths.run(runId)} className="self-start rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover">
          See how it got there
        </Link>
      )}
    </>
  );
}

/**
 * The conversation scoped to one app (TALK-04), for the app's own page: the same dock, about that app only. It may answer, start
 * an idea, ask for a change to the app or try stopped work again — each only once the person approves it here.
 */
export function AppConversation({ scope, trail }: { scope: string; trail: string[] }) {
  const tree = useGetTreeQuery(undefined);
  if (!tree.data) return null;
  return <ConversationDock tree={tree.data} selection={{ scope, kind: "app", trail }} />;
}
