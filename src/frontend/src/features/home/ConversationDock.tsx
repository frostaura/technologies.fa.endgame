import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { Link } from "@/components/Link";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useStartConversationMutation } from "@/store/api";
import type { Tree } from "@/store/types";
import { conversationKey, messageQueued, messageSettled, type ChatMessage, type Selection } from "@/store/uiSlice";
import { deriveRun, isTerminal } from "../runs/runModel";
import { useRunStream } from "../runs/useRunStream";
import { activeWork } from "./treeModel";

/**
 * The one conversation, docked beside the org chart and scoped to whatever is selected. The
 * owner's messages are kept per scope; each starts a run, and the replies are that run's
 * `message` events, streamed.
 */
export function ConversationDock({ tree, selection }: { tree: Tree; selection: Selection }) {
  const dispatch = useAppDispatch();
  const key = conversationKey(selection);
  const messages = useAppSelector((s) => s.ui.conversations[key]) ?? NONE;
  const [start] = useStartConversationMutation();
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const name = selection.trail[selection.trail.length - 1] ?? "";
  const narrowable = selection.kind === "organisation";
  const busy = activeWork(tree);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [messages.length]);

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
            {narrowable ? "Select a division, project or employee to narrow this." : "Select the organisation band to talk to everything again."}
          </span>
        </div>
      </div>

      <div ref={logRef} role="log" aria-live="polite" aria-label={`Conversation with ${name}`} className="flex flex-1 flex-col gap-3.5 overflow-y-auto py-5 lg:max-h-screen">
        {messages.length === 0 && <p className="text-ink-muted">Ask what needs you, or tell it what to change. It answers for {name} and everything beneath it.</p>}
        {messages.map((m) => (
          <Exchange key={m.id} message={m} onRetry={() => void send(m.text)} />
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
          <Button type="submit" className="min-h-12 px-5" disabled={draft.trim().length === 0}>
            Send
          </Button>
        </div>
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

function Exchange({ message, onRetry }: { message: ChatMessage; onRetry: () => void }) {
  return (
    <>
      <p className={cn("max-w-bubble self-end rounded-md rounded-br-xs bg-primary px-4 py-2.5 text-primary-ink", message.state === "sending" && "opacity-70")}>{message.text}</p>
      {message.state === "failed" && (
        <div role="alert" className="flex flex-col gap-2 self-end rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          Not sent: {message.error}
          <button type="button" onClick={onRetry} className="min-h-touch self-start rounded-xs font-semibold underline">
            Send again
          </button>
        </div>
      )}
      {message.runId && <Replies runId={message.runId} />}
    </>
  );
}

function Replies({ runId }: { runId: string }) {
  const [retry, setRetry] = useState(0);
  const log = useRunStream(runId, retry);
  const run = deriveRun(log.events);
  const done = isTerminal(run.status);
  return (
    <>
      {run.messages.length > 0 && (
        <div className="flex max-w-reply flex-col gap-2 rounded-md rounded-bl-xs bg-ground px-4 py-3.5">
          {run.messages.map((m) => (
            <p key={m.seq} className="whitespace-pre-line">
              {m.text}
            </p>
          ))}
        </div>
      )}
      {!done && log.stream !== "failed" && (
        <div className="flex items-center gap-2.5 text-sm text-ink-muted">
          <TypingDots />
          {log.stream === "reconnecting" ? "Reconnecting…" : "Working on it"}
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
