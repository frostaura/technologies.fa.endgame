import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, AtSign, LayoutGrid, Paperclip, Slash, Square, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { ViewState } from "@/lib/queryState";
import type { ConversationCapabilities, ConversationEstimate, MessageNarrowing } from "@/store/types";
import { messageCostLine } from "../home/conversationModel";
import { DraftChips } from "./AttachmentChips";
import { CanUse } from "./CanUse";
import type { Target } from "./scopeModel";
import type { DraftFiles } from "./useDraftFiles";


/** The actions "/" offers, each a real thing a conversation does at this level (`capabilities.actions`), or a page that does it. */
interface Action {
  key: string;
  label: string;
  hint: string;
  /** Words put in the box to start the request; the conversation asks before it acts. */
  lead?: string;
  href?: string;
}

function actionsFor(caps: ConversationCapabilities | null, scope: string, appName: string | null): Action[] {
  const out: Action[] = [];
  for (const a of caps?.actions ?? []) {
    if (a === "start_idea") out.push({ key: a, label: "Start an idea", hint: "Research a new idea here. It asks you before it starts.", lead: "Start researching this idea: " });
    if (a === "change_app") out.push({ key: a, label: appName ? `Change ${appName}` : "Change an app", hint: "Describe the change; it is built in a preview and checked. It asks you first.", lead: appName ? `Change ${appName}: ` : "Change the app " });
    if (a === "try_again") out.push({ key: a, label: "Try stopped work again", hint: "Carry on stopped work from where it stopped. It asks you first.", lead: "Try the stopped work again: " });
    if (a === "adjust_setting") out.push({ key: a, label: "Change a setting", hint: "How an app runs, or a setting the workforce may change. It asks you first.", lead: "Change a setting: " });
  }
  out.push({ key: "hire", label: "Propose a hire", hint: "Opens Hiring for this level.", href: paths.hires(scope) });
  return out;
}


type Menu = { kind: "slash"; filter: string } | { kind: "mention"; filter: string; start: number } | null;

function menuAt(text: string, caret: number): Menu {
  if (/^\/[^\s]*$/.test(text)) return { kind: "slash", filter: text.slice(1).toLowerCase() };
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (m) return { kind: "mention", filter: (m[2] ?? "").toLowerCase(), start: before.length - (m[2] ?? "").length - 1 };
  return null;
}

export interface ComposerProps {
  name: string;
  scope: string;
  inputId: string;
  draft: string;
  onDraft: (text: string) => void;
  files: DraftFiles;
  caps: ViewState<ConversationCapabilities>;
  estimate: ViewState<ConversationEstimate>;
  narrow: MessageNarrowing;
  onNarrow: (n: MessageNarrowing) => void;
  targets: Target[];
  onRetarget: ((t: Target) => void) | null;
  appName: string | null;
  /** The reply being written now, which Stop cancels. */
  live: boolean;
  onStop: () => void;
  onSend: () => void;
  inSheet: boolean;
}

export function Composer(p: ComposerProps) {
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [active, setActive] = useState(0);
  const [panel, setPanel] = useState(false);
  const listId = useId();
  const caps = p.caps.kind === "loaded" ? p.caps.data : null;
  const limits = caps?.attachments ?? null;

  // The box grows with what is typed, up to about eight lines, then scrolls.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [p.draft]);

  const actions = useMemo(() => actionsFor(caps, p.scope, p.appName), [caps, p.scope, p.appName]);
  const items: { key: string; label: string; detail: string; icon: ReactNode; choose: () => void }[] = useMemo(() => {
    if (!menu) return [];
    if (menu.kind === "slash")
      return actions
        .filter((a) => a.label.toLowerCase().includes(menu.filter))
        .map((a) => ({
          key: a.key,
          label: a.label,
          detail: a.hint,
          icon: <Slash aria-hidden className="size-4 text-primary" />,
          choose: () => {
            setMenu(null);
            if (a.href) {
              p.onDraft("");
              navigate(a.href);
              return;
            }
            p.onDraft(a.lead ?? "");
            requestAnimationFrame(() => box.current?.focus());
          },
        }));
    if (!p.onRetarget) return [];
    return p.targets
      .filter((t) => t.label.toLowerCase().includes(menu.filter))
      .slice(0, 8)
      .map((t) => ({
        key: t.key,
        label: t.label,
        detail: t.detail,
        icon: t.kind === "employee" ? <Avatar name={t.label} seed={t.employeeId} size="xs" /> : <Icon name="app" tinted className="size-4" />,
        choose: () => {
          setMenu(null);
          // The mention is the address, not part of the message: it leaves the box, and the message goes there.
          const rest = `${p.draft.slice(0, menu.start)}${p.draft.slice(menu.start + 1 + menu.filter.length)}`.replace(/\s{2,}/g, " ").trimStart();
          p.onDraft(rest);
          p.onRetarget?.(t);
          requestAnimationFrame(() => box.current?.focus());
        },
      }));
  }, [menu, actions, p]);

  const open = menu !== null && items.length > 0;
  const highlighted = open ? Math.min(active, items.length - 1) : 0;

  const onChange = (text: string, caret: number) => {
    p.onDraft(text);
    setMenu(menuAt(text, caret));
    setActive(0);
  };

  const blocked = p.files.uploading
    ? "Wait for the files to be added."
    : p.files.images && caps && !caps.attachments.images
      ? `${caps.answerer.kind === "employee" ? (caps.answerer.name ?? p.name) : "Endgame’s assistant"} reads text only, so an image cannot be sent here. Take the image off, or put it in a PDF${caps.answerer.kind === "assistant" ? ", or ask an employee who can look at pictures" : ""}.`
      : null;
  const empty = p.draft.trim().length === 0 && p.files.ready.length === 0;
  // A box with nothing in it yet names its tools; once the person types they fold to icons.
  const fresh = p.draft.length === 0 && p.files.files.length === 0 && !p.live;
  const canSend = !empty && !blocked && p.estimate.kind !== "loading";

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    setMenu(null);
    setPanel(false);
    p.onSend();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        items[highlighted]?.choose();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }
    if (e.key === "Escape" && panel) {
      setPanel(false);
      return;
    }
    // Enter sends; Shift+Enter is a new line; a word still being composed (an input method) is never sent.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...e.clipboardData.files];
    if (pasted.length === 0) return;
    e.preventDefault();
    p.files.add(pasted);
  };

  // A narrowing is for one message: said beside the box while it is on.
  const narrowed = [p.narrow.noWebSearch && { key: "noWebSearch" as const, label: "No web search" }, p.narrow.answerOnly && { key: "answerOnly" as const, label: "Answer only" }].filter(Boolean) as { key: keyof MessageNarrowing; label: string }[];

  useEffect(() => {
    if (!panel) return;
    const close = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setPanel(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [panel]);

  return (
    <form onSubmit={submit} className={cn("relative flex shrink-0 flex-col gap-1.5 px-4 pb-3 pt-2", p.inSheet && "px-0")} data-composer="">
      {(open || panel) && (
        <div
          className="absolute inset-x-4 bottom-full z-20 mb-1 flex max-h-popover flex-col overflow-y-auto rounded-md border bg-surface p-1.5 shadow-raised"
          data-composer-popover={panel ? "can-use" : menu?.kind}
        >
          {panel && caps ? (
            <div className="flex flex-col gap-2 p-2.5">
              <div className="flex items-center justify-between">
                <h3 className="font-sans text-sm font-semibold text-ink">What {p.name} can use here</h3>
                <button type="button" onClick={() => setPanel(false)} aria-label="Close" className="flex min-h-touch min-w-touch items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink">
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              <CanUse caps={caps} who={p.name} narrow={p.narrow} onNarrow={p.onNarrow} scope={p.scope} />
            </div>
          ) : (
            <ul role="listbox" id={listId} aria-label={menu?.kind === "slash" ? "Actions" : "Send it to"} className="flex flex-col">
              <li role="presentation" className="px-2.5 pb-1 pt-1.5 text-eyebrow font-semibold uppercase text-ink-muted">
                {menu?.kind === "slash" ? "Actions here" : "Send it to"}
              </li>
              {items.map((item, i) => (
                <li
                  key={item.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === highlighted}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={item.choose}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex min-h-touch cursor-pointer items-center gap-3 rounded-xs px-2.5 py-1.5", i === highlighted && "bg-primary-tint")}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center">{item.icon}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-ink">{item.label}</span>
                    <span className="truncate text-xs text-ink-muted">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        className={cn(
          "flex flex-col rounded-md border border-border-strong bg-surface shadow-card transition-colors focus-within:border-primary motion-reduce:transition-none",
          blocked && p.files.images && "border-attention-line",
        )}
      >
        <DraftChips files={p.files.files} onRemove={p.files.remove} />
        <label htmlFor={p.inputId} className="sr-only">
          Message {p.name}
        </label>
        <textarea
          ref={box}
          id={p.inputId}
          rows={1}
          value={p.draft}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setMenu(null)}
          placeholder="Ask, or tell it what to change"
          autoComplete="off"
          enterKeyHint="send"
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
          aria-describedby={`${p.inputId}-cost`}
          className="max-h-composer min-h-12 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-ink outline-none placeholder:text-ink-muted focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={limits?.extensions.join(",")}
            onChange={(e) => {
              p.files.add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <ToolButton label="Attach files" text="Attach" showText={fresh} onClick={() => fileInput.current?.click()} disabled={!limits}>
            <Paperclip aria-hidden className="size-5 shrink-0" />
          </ToolButton>
          <ToolButton label="What it can use here" text="Can use" showText={fresh} onClick={() => setPanel((v) => !v)} pressed={panel} disabled={!caps}>
            <LayoutGrid aria-hidden className="size-5 shrink-0" />
          </ToolButton>
          <ToolButton label="Actions" text="Actions" showText={fresh} onClick={() => onChange("/", 1)} disabled={actions.length === 0}>
            <Slash aria-hidden className="size-5 shrink-0" />
          </ToolButton>
          {p.onRetarget && p.targets.length > 0 && (
            <ToolButton
              label="Mention someone"
              text="Mention"
              showText={fresh}
              onClick={() => {
                const text = p.draft && !/\s$/.test(p.draft) ? `${p.draft} @` : `${p.draft}@`;
                onChange(text, text.length);
                box.current?.focus();
              }}
            >
              <AtSign aria-hidden className="size-5 shrink-0" />
            </ToolButton>
          )}
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {narrowed.map((n) => (
              <button
                key={n.key}
                type="button"
                aria-label={`Turn off ${n.label.toLowerCase()}`}
                title={`Turn off ${n.label.toLowerCase()}`}
                onClick={() => p.onNarrow({ ...p.narrow, [n.key]: false })}
                className="inline-flex min-h-touch items-center gap-1 rounded-full px-1 text-xs font-semibold text-primary-hover"
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-tint py-1 pl-2.5 pr-1.5">
                  {n.label}
                  <X aria-hidden className="size-3.5" />
                </span>
              </button>
            ))}
          </span>
          {p.live && (
            <button type="button" onClick={p.onStop} aria-label="Stop the reply" title="Stop the reply" className="flex min-h-touch min-w-touch items-center justify-center rounded-full border border-border-strong text-ink hover:bg-ground">
              <Square aria-hidden className="size-3.5 fill-current" />
            </button>
          )}
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            data-ready={canSend || undefined}
            className="ml-1 flex min-h-touch min-w-touch items-center justify-center rounded-full bg-primary text-primary-ink shadow-press transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-border-strong disabled:bg-surface disabled:text-ink-muted disabled:shadow-none motion-reduce:transition-none"
          >
            <ArrowUp aria-hidden className="size-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {(blocked || p.files.problem) && (
        <p role="alert" className="text-xs text-attention-text">
          {p.files.problem ?? blocked}
        </p>
      )}
      <p id={`${p.inputId}-cost`} data-testid="message-estimate" className="px-1 text-xs text-ink-muted" aria-live="polite">
        {p.estimate.kind === "loading" && "Working out what a message costs…"}
        {p.estimate.kind === "loaded" && messageCostLine(p.estimate.data.credits, p.estimate.data.ceiling)}
        {p.estimate.kind === "failed" && `What a message costs could not be worked out: ${p.estimate.reason} Its cost is still held before each step and shown with the reply.`}
        {p.estimate.kind === "loaded" && p.files.ready.length > 0 && ` ${p.files.ready.length === 1 ? "The file is" : "The files are"} counted in it.`}
      </p>
    </form>
  );
}

function ToolButton({ label, text, showText, onClick, children, pressed, disabled }: { label: string; text: string; showText: boolean; onClick: () => void; children: ReactNode; pressed?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-tool={text}
      className={cn(
        "flex min-h-touch min-w-touch shrink-0 flex-col items-center justify-center rounded-full text-ink-muted hover:bg-ground hover:text-ink disabled:opacity-40",
        showText && "rounded-sm px-1.5 py-0.5",
        pressed && "bg-primary-tint text-primary-hover",
      )}
    >
      {children}
      {/* Named on screen under its icon until the person starts typing; the icon alone after, its name kept in the tooltip and for screen readers. */}
      {showText && (
        <span aria-hidden className="whitespace-nowrap text-xs font-medium leading-tight">
          {text}
        </span>
      )}
    </button>
  );
}
