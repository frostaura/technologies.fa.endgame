import { REACHES, ROLES, type Reach, type Role } from "../content/types.ts";
import { area, clientFlows, content, flow, flowsForReach, flowsForRole, isOperator, operatorFlows } from "../lib/data.ts";
import { REACH_BLURB, REACH_LABEL, ROLE_BLURB, ROLE_LABEL } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { Blocks } from "../components/Blocks.tsx";
import { FlowList } from "../components/FlowList.tsx";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { NotFound } from "./NotFound.tsx";
import { ui } from "../components/ui.ts";
import { useEffect, useState, type ReactNode } from "react";

const CLIENT_ROLES = ROLES.filter((r) => r !== "operator");

/**
 * Grids that fill their rows: five across on a wide screen; on a tablet, three then two, each row
 * spanning the full width; four or fewer, as many columns as there are cards.
 */
const fiveUp = (n: number) => (n === 5 ? "sm:grid-cols-6 lg:grid-cols-5" : n === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : n === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2");
const fiveSpan = (n: number, i: number) => (n === 5 ? (i < 3 ? "sm:col-span-2 lg:col-span-1" : "sm:col-span-3 lg:col-span-1") : "");

/** One card for every "browse by" choice: the count in the same corner, the name, what it covers. */
function ChoiceCard({ to, count, title, blurb, tag }: { to: string; count: number; title: string; blurb: string; tag?: string }) {
  return (
    <a href={href(to)} className={ui.cardLink}>
      <span className="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="font-medium tabular-nums">{count} flows</span>
        {tag && <span className="shrink-0 rounded-full bg-night px-2 py-0.5 font-medium text-primary-ink">{tag}</span>}
      </span>
      <span className="mt-2 font-display text-xl font-semibold text-ink group-hover:text-primary-link">{title}</span>
      <span className="mt-1.5 text-sm text-ink-muted">{blurb}</span>
    </a>
  );
}

export function Browse({ operator = false }: { operator?: boolean }) {
  const pool = operator ? operatorFlows : clientFlows;
  const roles = (operator ? ROLES : CLIENT_ROLES).filter((r) => flowsForRole(r, operator).length);
  const reaches = REACHES.filter((r) => flowsForReach(r, operator).length);
  const prefix = operator ? "/operator" : "";
  const areas = content.areas.filter((a) => pool.some((f) => f.area === a.id));
  const frostaura = operatorFlows.length;
  return (
    <Page>
      <Eyebrow>Browse</Eyebrow>
      <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">Every flow, three ways</h1>
      <p className="mt-4 max-w-read text-lead-sm text-ink-body sm:text-lead">By the part of the product it lives in, by who you are, or by how you reach it.</p>

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">By area</h2>
      <ul className={`mt-5 grid grid-cols-1 gap-4 ${fiveUp(areas.length)}`}>
        {areas.map((a, i) => (
          <li key={a.id} className={`min-w-0 ${fiveSpan(areas.length, i)}`}>
            <ChoiceCard to={`${prefix}/area/${a.id}`} count={pool.filter((f) => f.area === a.id).length} title={a.title} blurb={a.summary} tag={undefined} />
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">By who you are</h2>
      <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {roles.map((r) => (
          <li key={r} className="min-w-0">
            <ChoiceCard to={`${prefix}/who/${r}`} count={flowsForRole(r, operator).length} title={ROLE_LABEL[r]} blurb={ROLE_BLURB[r]} />
          </li>
        ))}
        {!operator && (
          // Operators and host administrators are FrostAura's own: one card, to the separate handbook.
          <li>
            <ChoiceCard to="/operator" count={frostaura} title={`${ROLE_LABEL.operator} and ${ROLE_LABEL["host-admin"].toLowerCase()}`} blurb="FrostAura's own: God mode and running the platform, taught in the separate operator handbook." tag="FrostAura only" />
          </li>
        )}
      </ul>

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">By how it is reached</h2>
      <ul className={`mt-5 grid grid-cols-1 gap-4 ${fiveUp(reaches.length)}`}>
        {reaches.map((r, i) => (
          <li key={r} className={`min-w-0 ${fiveSpan(reaches.length, i)}`}>
            <ChoiceCard to={`${prefix}/reach/${r}`} count={flowsForReach(r, operator).length} title={REACH_LABEL[r]} blurb={REACH_BLURB[r]} />
          </li>
        ))}
      </ul>
    </Page>
  );
}

/**
 * The one layout of every "browse by" page: a rail with where you are — its name, what it covers, how
 * many flows, and on an area its sections with the one in view marked — beside the list.
 */
function ListLayout({ eyebrow, title, blurb, count, rail, children }: { eyebrow: string; title: string; blurb: string; count: number; rail?: ReactNode; children: ReactNode }) {
  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-4 lg:gap-12">
        <div className="lg:sticky lg:top-header lg:self-start lg:pt-2">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-3 font-display text-title-sm font-bold text-ink">{title}</h1>
          <p className="mt-3 text-sm text-ink-body">{blurb}</p>
          <p className="mt-3 text-sm font-medium tabular-nums text-ink-muted">{count} flows</p>
          {rail}
        </div>
        <div className="min-w-0 lg:col-span-3 lg:pt-9">{children}</div>
      </div>
    </Page>
  );
}

/** Which section is in view as the page scrolls: the rail marks it. */
function useInView(ids: string[]): string | undefined {
  const [current, setCurrent] = useState<string | undefined>(ids[0]);
  const key = ids.join(",");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = key.split(",").find((id) => seen.get(id));
        if (first) setCurrent(first);
      },
      { rootMargin: "-90px 0px -55% 0px" },
    );
    for (const id of key.split(",")) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);
  return current;
}

export function AreaPage({ id, operator = false }: { id: string; operator?: boolean }) {
  const a = area(id);
  const keep = (fid: string) => {
    const f = flow(fid);
    return !!f && f.id === fid && isOperator(f) === operator;
  };
  const sections = a ? a.sections.filter((s) => s.flows.some(keep)) : [];
  const current = useInView(sections.map((s) => s.id));
  if (!a) return <NotFound />;
  const count = sections.reduce((n, s) => n + s.flows.filter(keep).length, 0);
  return (
    <ListLayout
      eyebrow={`Area ${a.id}`}
      title={a.title}
      blurb={a.summary}
      count={count}
      rail={
        <nav aria-label="Sections" className="mt-6 hidden border-l lg:block">
          <ul className="space-y-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={current === s.id ? "location" : undefined}
                  onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" })}
                  className={`-ml-px block w-full border-l-2 py-1.5 pl-4 pr-2 text-left text-sm transition-colors ${current === s.id ? "border-primary font-medium text-primary-link" : "border-transparent text-ink-body hover:border-border-strong hover:text-ink"}`}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      }
    >
      <div className="space-y-12">
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
            <h2 id={`${s.id}-h`} className="font-display text-2xl font-semibold text-ink">{s.title}</h2>
            {s.intro.length > 0 && <div className="mt-2 max-w-read text-sm"><Blocks blocks={s.intro} tone="muted" /></div>}
            <div className="mt-5"><FlowList flows={s.flows.filter(keep).flatMap((fid) => flow(fid) ?? [])} /></div>
          </section>
        ))}
      </div>
    </ListLayout>
  );
}

export function RolePage({ role, operator = false }: { role: string; operator?: boolean }) {
  if (!(ROLES as readonly string[]).includes(role) || (!operator && role === "operator")) return <NotFound />;
  const r = role as Role;
  const flows = flowsForRole(r, operator);
  return (
    <ListLayout eyebrow="Who you are" title={ROLE_LABEL[r]} blurb={ROLE_BLURB[r]} count={flows.length}>
      <FlowList flows={flows} />
    </ListLayout>
  );
}

export function ReachPage({ reach, operator = false }: { reach: string; operator?: boolean }) {
  if (!(REACHES as readonly string[]).includes(reach)) return <NotFound />;
  const r = reach as Reach;
  const flows = flowsForReach(r, operator);
  return (
    <ListLayout eyebrow="Reached by" title={REACH_LABEL[r]} blurb={REACH_BLURB[r]} count={flows.length}>
      <FlowList flows={flows} hideReach />
    </ListLayout>
  );
}
