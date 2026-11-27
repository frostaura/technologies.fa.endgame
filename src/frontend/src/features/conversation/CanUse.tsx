import type { ReactNode } from "react";
import { Link } from "@/components/Link";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/iconNames";
import { timeAgo } from "@/lib/format";
import { plainOrNull } from "@/lib/plain";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import type { ConversationCapabilities, MessageNarrowing } from "@/store/types";
import { serviceLabel, tierLabel, toolLabel } from "../workforce/workforceModel";
import { limitsSentence } from "./attachments";

/**
 * "What it can use here" (ARCH-012): who answers at this level and how strongly it thinks, the
 * tools it may use (in the hire page's words), the work it can start, the skills the builders here
 * load, the services the apps here have, web search under the autonomy rules, and the
 * organisation's AI assistants — all read from the control plane. The two narrowings for one
 * message sit at its foot; nothing here can widen what the rules allow.
 */
export function CanUse({ caps, who, narrow, onNarrow, scope }: { caps: ConversationCapabilities; who: string; narrow: MessageNarrowing; onNarrow: (n: MessageNarrowing) => void; scope: string }) {
  const mode = useAppSelector((s) => s.ui.mode);
  // What it uses to answer; the tools that start work are listed with the work, and only where that work applies here.
  const using = caps.tools.filter((t) => !WORK_TOOLS.has(t));
  const search = caps.webSearch;
  return (
    <div data-can-use="" className="flex flex-col gap-4 text-sm">
      <Section title="Who answers">
        <p className="text-ink">
          {caps.answerer.kind === "employee" ? `${caps.answerer.name ?? who}, ${caps.answerer.role?.toLowerCase() ?? "employee"}` : "Endgame’s assistant, for everything here"}
          <span className="text-ink-muted"> · {tierLabel(caps.answerer.tier, mode)}</span>
        </p>
      </Section>

      <Section title="It may">
        <ul className="flex flex-wrap gap-1.5">
          {using.map((t) => (
            <Pill key={t}>{toolLabel(t, mode)}</Pill>
          ))}
          {search.available && <Pill tone={search.rule === "may-not" ? "off" : search.rule === "asks" ? "ask" : "on"}>{`Search the web: ${SEARCH[search.rule]}`}</Pill>}
        </ul>
        {!search.available && <p className="text-xs text-ink-muted">It answers from what Endgame holds here; it does not search the web.</p>}
        {search.available && search.setAtPath && (
          <p className="text-xs text-ink-muted">
            Web search is set by the autonomy rules.{" "}
            <Link href={paths.autonomy(scope)} className="font-semibold text-primary-link hover:text-primary-hover">
              See the rules
            </Link>
          </p>
        )}
      </Section>

      {caps.actions.length > 0 && (
        <Section title="Work it can start, asking you first">
          <ul className="flex flex-wrap gap-1.5">
            {caps.actions.map((t) => (
              <Pill key={t} tone="ask">
                {toolLabel(t, mode)}
              </Pill>
            ))}
          </ul>
        </Section>
      )}

      {caps.skills.length > 0 && (
        <Section title="Skills the builders here use">
          <ul className="flex flex-col gap-1">
            {caps.skills.map((s) => (
              <li key={s.name} className="flex flex-col">
                <span className="text-ink">{skillName(s.name)}</span>
                {(mode === "technical" ? s.trigger : plainOrNull(s.trigger)) && <span className="text-xs text-ink-muted">{mode === "technical" ? `${s.name}: ${s.trigger}` : plainOrNull(s.trigger)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {caps.apps > 0 && caps.services.length > 0 && (
        <Section title={caps.apps === 1 ? "Services the app here has" : `Services the ${caps.apps} apps here have`}>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {caps.services.map((s) => (
              <li key={s.id} className="flex min-w-0 items-start gap-2">
                <Icon name={SERVICE_ICON[s.id]} tinted className="mt-0.5 size-4" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-ink">{serviceLabel(s.id, mode)}</span>
                  {s.detail && <span className="text-xs text-ink-muted">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={mode === "technical" ? "MCP access" : "AI assistants"}>
        {caps.assistants.length === 0 ? (
          <p className="text-ink-muted">
            No AI assistant has a key to this organisation.{" "}
            <Link href={paths.assistants()} className="font-semibold text-primary-link hover:text-primary-hover">
              Give one access
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {caps.assistants.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-ink">{a.name}</span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {ROLE[a.role]} · {a.lastUsedAt ? `used ${timeAgo(a.lastUsedAt)}` : "not used yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Attaching files">
        <p className="text-ink-muted">{limitsSentence(caps.attachments)}</p>
      </Section>

      {(caps.narrowing.noWebSearch || caps.narrowing.answerOnly) && (
        <Section title="For this message only">
          <div className="flex flex-col gap-1">
            {caps.narrowing.noWebSearch && <Toggle label="Don’t search the web" hint="It answers from what Endgame holds." on={!!narrow.noWebSearch} onChange={(v) => onNarrow({ ...narrow, noWebSearch: v })} />}
            {caps.narrowing.answerOnly && <Toggle label="Answer only: start no work" hint="It will not start, change or try anything again." on={!!narrow.answerOnly} onChange={(v) => onNarrow({ ...narrow, answerOnly: v })} />}
          </div>
        </Section>
      )}
    </div>
  );
}

const WORK_TOOLS = new Set(["start_idea", "change_app", "try_again", "adjust_setting", "web_search"]);

const SEARCH: Record<ConversationCapabilities["webSearch"]["rule"], string> = { may: "may", asks: "asks you first", "may-not": "may not" };

const ROLE: Record<ConversationCapabilities["assistants"][number]["role"], string> = { admin: "Admin", builder: "Builder", viewer: "Viewer" };

const SERVICE_ICON: Record<ConversationCapabilities["services"][number]["id"], IconName> = {
  identity: "private",
  models: "assistants",
  secrets: "secrets",
  email: "email",
  schedules: "schedules",
  webhooks: "incoming-data",
  telemetry: "health",
};

function skillName(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-eyebrow font-semibold uppercase text-ink-muted">{title}</h4>
      {children}
    </section>
  );
}

/** One neutral chip for everything listed here; the accent is kept for what acts. What it may not do is struck through. */
function Pill({ children, tone = "on" }: { children: ReactNode; tone?: "on" | "ask" | "off" }) {
  return (
    <li className={cn("rounded-full border border-border px-2.5 py-0.5 text-xs", tone === "off" ? "bg-surface text-ink-muted line-through" : "bg-ground text-ink-body")}>
      {children}
    </li>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-xs px-1 hover:bg-ground">
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary motion-reduce:transition-none", on ? "bg-primary" : "bg-border-strong")}>
        <span className={cn("absolute left-0.5 top-0.5 size-4 rounded-full bg-surface shadow-toggle transition-transform motion-reduce:transition-none", on && "translate-x-4")} />
      </span>
      <span className="flex flex-col">
        <span className="text-ink">{label}</span>
        <span className="text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}
