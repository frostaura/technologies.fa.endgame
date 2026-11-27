import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, AtSign, LayoutGrid, Lightbulb, Paperclip, RotateCcw, SearchX, SlidersHorizontal, Slash, Square, TriangleAlert, UserPlus, Wrench, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { ViewState } from "@/lib/queryState";
import type { ConversationCapabilities, ConversationEstimate, MessageNarrowing } from "@/store/types";
import { messageCostLine, messageCostShort } from "../home/conversationModel";
import { DraftChips } from "./AttachmentChips";
import { CanUse } from "./CanUse";
import type { Target } from "./scopeModel";
import type { DraftFiles } from "./useDraftFiles";

/** The actions "/" offers, each a real thing a conversation does at this level (`capabilities.actions`), or a page that does it. */
interface Action {
  key: string;
  label: string;
  hint: string;
  icon: ReactNode;
  /** Words put in the box to start the request; the conversation asks before it acts. */
  lead?: string;
  href?: string;
}

const ACTION_ICON = "size-4 text-primary";

function actionsFor(caps: ConversationCapabilities | null, scope: string, appName: string | null): Action[] {
  const out: Action[] = [];
  for (const a of caps?.actions ?? []) {
    if (a === "start_idea")
      out.push({ key: a, label: "Start an idea", icon: <Lightbulb aria-hidden className={ACTION_ICON} />, hint: "Research a new idea here: who already does it, what they leave undone, whether people would pay. It asks you before it starts.", lead: "Start researching this idea: " });
    if (a === "change_app")
      out.push({ key: a, label: appName ? `Change ${appName}` : "Change an app", icon: <Wrench aria-hidden className={ACTION_ICON} />, hint: "Describe the change: it is planned, built in a preview and checked, then published. It asks you first.", lead: appName ? `Change ${appName}: ` : "Change the app " });
    if (a === "try_again")
      out.push({ key: a, label: "Try stopped work again", icon: <RotateCcw aria-hidden className={ACTION_ICON} />, hint: "Carry on work that stopped, from where it stopped, keeping what was built. It asks you first.", lead: "Try the stopped work again: " });
    if (a === "adjust_setting")
      out.push({ key: a, label: "Change a setting", icon: <SlidersHorizontal aria-hidden className={ACTION_ICON} />, hint: "How an app sleeps, or what the workforce may do without asking. It asks you first.", lead: "Change a setting: " });
  }
  out.push({ key: "hire", label: "Propose a hire", icon: <UserPlus aria-hidden className={ACTION_ICON} />, hint: "Opens Hiring for this level, to propose someone for work that keeps coming back.", href: paths.hires(scope) });
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
  /** Where the dimmed layer behind an open menu is drawn: over the thread, never over the composer itself. */
  scrimTarget?: HTMLElement | null;
}

/** The width from which the composer's tools are named under their icons; narrower, icons with their names in a tooltip. */
const LABELLED_FROM = 400;
/** The window height below which the tools are never named under their icons (`short:`). */
const SHORT_FROM = 500;

/**
 * The composer (ARCH-012): the box, the files going with it, and one toolbar that never changes form while someone
 * types or a reply is written — named tools wherever the pane is wide enough, icons with tooltips where it is not.
 * Send turns into Stop in the same place while a reply is being written and the box is empty. "/" and "@" open
 * menus anchored above it with the thread dimmed behind; on a phone or a tablet they and "What it can use here"
 * are sheets the full width of the conversation. Escape closes only the topmost of them. The cost of a message is
 * one short line, the full sentence in its tooltip.
 */
export function Composer(p: ComposerProps) {
  const box = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [active, setActive] = useState(0);
  const [panel, setPanel] = useState(false);
  const [triedEarly, setTriedEarly] = useState(false);
  const [labelled, setLabelled] = useState(true);
  const listId = useId();
  const caps = p.caps.kind === "loaded" ? p.caps.data : null;
  const limits = caps?.attachments ?? null;

  // The box grows with what is typed, up to about eight lines (less in a phone's sheet), then scrolls.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [p.draft]);

  // One toolbar form for the pane's width, decided by the width alone — never by what is typed.
  useLayoutEffect(() => {
    const el = form.current;
    if (!el) return;
    // A phone on its side has no height for names under the icons: there the tools are icons, as on a narrow pane.
    const measure = (w: number) => setLabelled(w >= LABELLED_FROM && (typeof window === "undefined" || window.innerHeight >= SHORT_FROM));
    measure(el.getBoundingClientRect().width || LABELLED_FROM);
    if (typeof ResizeObserver === "undefined") return;
    // The pane's width, edge to edge (its border box), not what is left inside the form's padding.
    const watch = new ResizeObserver(() => measure(el.getBoundingClientRect().width));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

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
          icon: a.icon,
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
        // A role that only repeats the name says nothing: the kind of thing it is says more.
        detail: t.detail.toLowerCase() === t.label.toLowerCase() ? (t.kind === "employee" ? "Employee" : "App") : t.detail,
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

  // A menu stays open with "nothing matches" rather than vanishing under the person's typing.
  const open = menu !== null && (menu.kind === "slash" || !!p.onRetarget);
  const highlighted = open && items.length > 0 ? Math.min(active, items.length - 1) : 0;

  const onChange = (text: string, caret: number) => {
    p.onDraft(text);
    setMenu(menuAt(text, caret));
    setActive(0);
    if (!p.files.uploading) setTriedEarly(false);
  };

  const imagesRefused = !!(p.files.images && caps && !caps.attachments.images);
  const blocked = p.files.uploading ? "Wait for the files to be added." : imagesRefused ? imageRefusal(caps, p.name) : null;
  const empty = p.draft.trim().length === 0 && p.files.ready.length === 0;
  const canSend = !empty && !blocked && p.estimate.kind !== "loading";
  // While a reply is being written and nothing new is typed, the send button is the stop button, in the same place.
  const stopping = p.live && empty;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (p.files.uploading && !empty) setTriedEarly(true);
    if (!canSend) return;
    setMenu(null);
    setPanel(false);
    p.onSend();
  };

  /** Escape closes the topmost layer only: a menu, else the panel; never the sheet the conversation is in. */
  const onFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Escape") return;
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
      box.current?.focus();
    } else if (panel) {
      e.preventDefault();
      e.stopPropagation();
      setPanel(false);
      box.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && items.length > 0) {
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

  // The panel closes when focus and pointer leave the composer entirely (a press on the thread behind it).
  useEffect(() => {
    if (!open && !panel) return;
    const away = (e: PointerEvent) => {
      if (form.current && e.target instanceof Node && !form.current.contains(e.target)) {
        setMenu(null);
        setPanel(false);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, panel]);

  const layer = open || (panel && !!caps);
  const sheetLike = p.inSheet;
  const costShort = p.estimate.kind === "loaded" ? messageCostShort(p.estimate.data.credits, p.estimate.data.ceiling) : null;
  const costFull = p.estimate.kind === "loaded" ? messageCostLine(p.estimate.data.credits, p.estimate.data.ceiling) : null;
  const filesCounted = p.estimate.kind === "loaded" && p.files.ready.length > 0;

  return (
    <form ref={form} onSubmit={submit} onKeyDown={onFormKeyDown} className="relative flex shrink-0 flex-col gap-1.5 px-4 pb-3 pt-2" data-composer="">
      {layer && p.scrimTarget && createPortal(<div aria-hidden data-scrim="" className="absolute inset-0 z-20 bg-ink/10 motion-safe:animate-fade" />, p.scrimTarget)}
      {layer && (
        <div
          className={cn(
            "absolute bottom-full z-30 mb-2 flex flex-col overflow-y-auto border bg-surface shadow-raised",
            // On a phone or a tablet: a sheet the conversation's width, rising from the composer.
            sheetLike ? "inset-x-0 max-h-sheet-menu rounded-t-lg p-2 pb-3" : "inset-x-4 max-h-popover rounded-md p-1.5",
          )}
          data-composer-popover={panel && !open ? "can-use" : menu?.kind}
        >
          {panel && !open && caps ? (
            <div className="flex min-h-0 flex-col">
              <div className="sticky top-0 z-10 flex items-center justify-between bg-surface px-2.5 pt-1">
                <h3 className="font-sans text-sm font-semibold text-ink">What {p.name} can use here</h3>
                <button type="button" onClick={() => setPanel(false)} aria-label="Close" className="flex min-h-touch min-w-touch items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink">
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              <div className="px-2.5 pb-2.5">
                <CanUse caps={caps} who={p.name} narrow={p.narrow} onNarrow={p.onNarrow} scope={p.scope} />
              </div>
            </div>
          ) : (
            <ul role="listbox" id={listId} aria-label={menu?.kind === "slash" ? "Actions" : "Send it to"} className="flex flex-col">
              <li role="presentation" className="px-2.5 pb-1 pt-1.5 text-eyebrow font-semibold uppercase text-ink-muted">
                {menu?.kind === "slash" ? "Actions here" : "Send it to"}
              </li>
              {items.length === 0 && (
                <li role="presentation" data-nothing-matches="" className="flex items-center gap-2.5 px-2.5 py-2.5 text-sm text-ink-muted">
                  <SearchX aria-hidden className="size-4 shrink-0" />
                  {menu?.kind === "slash" ? "No action here matches that." : "Nobody and no app here matches that."}
                </li>
              )}
              {items.map((item, i) => (
                <li
                  key={item.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === highlighted}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={item.choose}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex min-h-touch cursor-pointer items-start gap-3 rounded-xs px-2.5 py-2", i === highlighted && "bg-primary-tint")}
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-xs bg-ground">{item.icon}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-ink">{item.label}</span>
                    <span className="line-clamp-2 text-xs text-ink-muted">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={cn("flex flex-col rounded-md border border-border-strong bg-surface shadow-card transition-colors focus-within:border-primary motion-reduce:transition-none", imagesRefused && "border-attention-line")}>
        <DraftChips files={p.files.files} onRemove={p.files.remove} imagesRefused={imagesRefused} />
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
          aria-activedescendant={open && items.length > 0 ? `${listId}-${highlighted}` : undefined}
          aria-describedby={`${p.inputId}-cost`}
          className={cn("min-h-12 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-ink outline-none placeholder:text-ink-muted focus-visible:ring-0 focus-visible:ring-offset-0", p.inSheet ? "max-h-composer-sheet" : "max-h-composer")}
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
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
          <ToolButton label="Attach files" text="Attach" showText={labelled} onClick={() => fileInput.current?.click()} disabled={!limits}>
            <Paperclip aria-hidden className="size-5 shrink-0" />
          </ToolButton>
          <ToolButton
            label="What it can use here"
            text="Can use"
            showText={labelled}
            onClick={() => {
              setMenu(null);
              setPanel((v) => !v);
            }}
            pressed={panel}
            disabled={!caps}
          >
            <LayoutGrid aria-hidden className="size-5 shrink-0" />
          </ToolButton>
          <ToolButton label="Actions" text="Actions" showText={labelled} onClick={() => onChange("/", 1)} disabled={actions.length === 0}>
            <Slash aria-hidden className="size-5 shrink-0" />
          </ToolButton>
          {p.onRetarget && p.targets.length > 0 && (
            <ToolButton
              label="Mention someone"
              text="Mention"
              showText={labelled}
              onClick={() => {
                const text = p.draft && !/\s$/.test(p.draft) ? `${p.draft} @` : `${p.draft}@`;
                onChange(text, text.length);
                box.current?.focus();
              }}
            >
              <AtSign aria-hidden className="size-5 shrink-0" />
            </ToolButton>
          )}
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {narrowed.map((n) => (
              <button
                key={n.key}
                type="button"
                aria-label={`Turn off ${n.label.toLowerCase()}`}
                title={`Turn off ${n.label.toLowerCase()}`}
                onClick={() => p.onNarrow({ ...p.narrow, [n.key]: false })}
                className="inline-flex min-h-touch shrink-0 items-center rounded-full px-0.5 text-xs font-semibold text-primary-hover"
              >
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-primary-tint py-1 pl-2.5 pr-1.5">
                  {n.label}
                  <X aria-hidden className="size-3.5" />
                </span>
              </button>
            ))}
          </span>
          {stopping ? (
            <button type="button" onClick={p.onStop} aria-label="Stop the reply" title="Stop the reply" className="ml-1 flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-full bg-ink text-primary-ink transition hover:bg-ink-body motion-reduce:transition-none">
              <Square aria-hidden className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              data-ready={canSend || undefined}
              className="ml-1 flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-full bg-primary text-primary-ink shadow-press transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-quiet disabled:text-ink-muted/50 disabled:shadow-none motion-reduce:transition-none"
            >
              <ArrowUp aria-hidden className="size-5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      {(imagesRefused || (triedEarly && p.files.uploading)) && (
        <p role="alert" className={cn("flex items-start gap-1.5 px-1 text-xs", imagesRefused ? "text-attention-text" : "text-ink-muted")}>
          {imagesRefused && <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />}
          {blocked}
        </p>
      )}
      <p id={`${p.inputId}-cost`} data-testid="message-estimate" title={costFull ? `${costFull}${filesCounted ? " The files are counted in it." : ""}` : undefined} className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-ink-muted" aria-live="polite">
        {p.estimate.kind === "failed" && <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-attention-text" />}
        <span className="min-w-0 truncate">
          {p.estimate.kind === "loading" && "Working out what a message costs…"}
          {costShort}
          {filesCounted && " Files counted."}
          {p.estimate.kind === "failed" && `What a message costs could not be worked out: ${p.estimate.reason} Its cost is still held before each step and shown with the reply.`}
        </span>
      </p>
    </form>
  );
}

function imageRefusal(caps: ConversationCapabilities | null, name: string): string {
  return `${caps?.answerer.kind === "employee" ? (caps.answerer.name ?? name) : "Endgame’s assistant"} reads text only, so an image cannot be sent here. Take the image off, or put it in a PDF${caps?.answerer.kind === "assistant" ? ", or ask an employee who can look at pictures" : ""}.`;
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
        "flex min-h-touch min-w-touch shrink-0 flex-col items-center justify-center rounded-sm text-ink-muted hover:bg-ground hover:text-ink focus-visible:ring-inset disabled:opacity-40",
        showText && "px-1.5 py-0.5",
        pressed && "bg-primary-tint text-primary-hover",
      )}
    >
      {children}
      {/* Named under its icon wherever the pane has room, always the same while typing; its name kept in the tooltip and for screen readers. */}
      {showText && (
        <span aria-hidden className="whitespace-nowrap text-xs font-medium leading-tight">
          {text}
        </span>
      )}
    </button>
  );
}
