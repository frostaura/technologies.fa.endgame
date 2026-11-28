import { useEffect, useRef, useState, type ReactNode } from "react";
import { REACHES, ROLES, type Reach, type Role } from "../content/types.ts";
import { area, clientFlows, content, flow, flowsForReach, flowsForRole, isOperator, operatorFlows } from "../lib/data.ts";
import { REACH_BLURB, REACH_LABEL, ROLE_BLURB, ROLE_LABEL } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { Blocks } from "../components/Blocks.tsx";
import { ReachIcon } from "../components/Chips.tsx";
import { FlowList } from "../components/FlowList.tsx";
import { ListLayout } from "../components/ListLayout.tsx";
import { PageHeader, Tag, type Crumb } from "../components/PageHeader.tsx";
import { Page } from "../components/Shell.tsx";
import { NotFound } from "./NotFound.tsx";
import { ui } from "../components/ui.ts";

const CLIENT_ROLES = ROLES.filter((r) => r !== "operator");

/**
 * One card for every "browse by" choice: how many flows as a figure, the name, what it covers, and —
 * for a route — its sign. Cards end with their content; the grid keeps every column one width.
 */
function ChoiceCard({ to, count, title, blurb, tag, icon }: { to: string; count: number; title: string; blurb: string; tag?: string; icon?: ReactNode }) {
  return (
    <a href={href(to)} className="group flex flex-col rounded-lg border bg-surface p-5 shadow-card transition-shadow hover:border-primary-line hover:shadow-raised sm:p-6">
      <span className="flex items-start justify-between gap-3">
        <span className="flex items-baseline gap-1.5">
          <span className={`${ui.figure} text-3xl`}>{count}</span>
          <span className="text-sm text-ink-muted">flows</span>
        </span>
        {icon && <span className="text-ink-muted">{icon}</span>}
      </span>
      <span className="mt-3 font-display text-xl font-semibold text-ink group-hover:text-primary-link">{title}</span>
      <span className="mt-1.5 text-sm text-ink-muted">{blurb}</span>
      {tag && <span className="mt-3"><Tag>{tag}</Tag></span>}
    </a>
  );
}

const grid = "mt-5 grid grid-cols-1 items-start gap-4 sm:grid-cols-cards-sm";

export function Browse({ operator = false }: { operator?: boolean }) {
  const pool = operator ? operatorFlows : clientFlows;
  const roles = (operator ? ROLES : CLIENT_ROLES).filter((r) => flowsForRole(r, operator).length);
  const reaches = REACHES.filter((r) => flowsForReach(r, operator).length);
  const prefix = operator ? "/operator" : "";
  const areas = content.areas.filter((a) => pool.some((f) => f.area === a.id));
  const frostaura = operatorFlows.length;
  return (
    <Page>
      <PageHeader
        crumbs={operator ? [{ label: "Operator handbook", to: "/operator" }, { label: "Browse" }] : undefined}
        eyebrow="Browse"
        title={operator ? "The handbook, three ways" : "Every flow, three ways"}
        lede="By the part of the product it lives in, by who you are, or by how you reach it."
      />

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">By area</h2>
      <ul className={grid}>
        {areas.map((a) => (
          <li key={a.id} className="min-w-0">
            <ChoiceCard to={`${prefix}/area/${a.id}`} count={pool.filter((f) => f.area === a.id).length} title={a.title} blurb={a.summary} />
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">By who you are</h2>
      <ul className={grid}>
        {roles.map((r) => (
          <li key={r} className="min-w-0">
            <ChoiceCard to={`${prefix}/who/${r}`} count={flowsForRole(r, operator).length} title={ROLE_LABEL[r]} blurb={ROLE_BLURB[r]} />
          </li>
        ))}
        {!operator && (
          // Operators and host administrators are FrostAura's own: one card, to the separate handbook.
          <li className="min-w-0">
            <ChoiceCard to="/operator" count={frostaura} title={`${ROLE_LABEL.operator} and ${ROLE_LABEL["host-admin"].toLowerCase()}`} blurb="FrostAura's own: God mode and running the platform, taught in the separate operator handbook." tag="FrostAura only" />
          </li>
        )}
      </ul>

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">By how it is reached</h2>
      <ul className={grid}>
        {reaches.map((r) => (
          <li key={r} className="min-w-0">
            <ChoiceCard to={`${prefix}/reach/${r}`} count={flowsForReach(r, operator).length} title={REACH_LABEL[r]} blurb={REACH_BLURB[r]} icon={<ReachIcon reach={r} />} />
          </li>
        ))}
      </ul>
    </Page>
  );
}

/** The trail of a "browse by" page: Browse (or the handbook's Browse), then which way it is browsed. */
function trail(operator: boolean, by: string): Crumb[] {
  return operator ? [{ label: "Operator handbook", to: "/operator" }, { label: "Browse", to: "/operator/browse" }, { label: by }] : [{ label: "Browse", to: "/browse" }, { label: by }];
}

/** Which section is in view as the page scrolls: the index marks it. */
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
      { rootMargin: "-130px 0px -55% 0px" },
    );
    for (const id of key.split(",")) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);
  return current;
}

type Section = { id: string; title: string };

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

/** The sections as a column beside the list, on a wide screen. */
function SectionRail({ sections, current }: { sections: Section[]; current?: string }) {
  return (
    <nav aria-label="Sections" className="mt-8 hidden border-l lg:block">
      <ul className="space-y-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              aria-current={current === s.id ? "location" : undefined}
              onClick={() => jump(s.id)}
              className={`-ml-px block w-full border-l-2 py-1.5 pl-4 pr-2 text-left text-sm transition-colors ${current === s.id ? "border-primary font-medium text-primary-link" : "border-transparent text-ink-body hover:border-border-strong hover:text-ink"}`}
            >
              {s.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The sections as a row of chips that sticks under the site header and scrolls sideways, below a wide
 * screen: a long list keeps a way to jump, and the chip of the section in view is marked and kept in view.
 */
function SectionChips({ sections, current }: { sections: Section[]; current?: string }) {
  const row = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = row.current;
    const chip = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !chip) return;
    const left = chip.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + chip.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
  }, [current]);
  return (
    <nav aria-label="Sections, small screens" className="sticky top-header-sm z-20 -mx-4 mb-6 border-b bg-surface/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:top-header short:top-header-short lg:hidden">
      <ul ref={row} className="flex gap-2 overflow-x-auto">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <button
              type="button"
              aria-current={current === s.id ? "location" : undefined}
              onClick={() => jump(s.id)}
              className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors touch:min-h-touch ${current === s.id ? "border-primary bg-primary-tint text-primary-link" : "bg-surface text-ink-body hover:bg-ground"}`}
            >
              {s.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
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
      crumbs={trail(operator, "By area")}
      title={a.title}
      lede={a.summary}
      meta={`${count} flows in ${sections.length} sections`}
      aside={<SectionRail sections={sections} current={current} />}
      bar={sections.length > 1 ? <SectionChips sections={sections} current={current} /> : undefined}
    >
      <div className="space-y-12">
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-32 lg:scroll-mt-24">
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
    <ListLayout crumbs={trail(operator, "By who you are")} title={ROLE_LABEL[r]} lede={ROLE_BLURB[r]} meta={`${flows.length} flows`}>
      <FlowList flows={flows} />
    </ListLayout>
  );
}

export function ReachPage({ reach, operator = false }: { reach: string; operator?: boolean }) {
  if (!(REACHES as readonly string[]).includes(reach)) return <NotFound />;
  const r = reach as Reach;
  const flows = flowsForReach(r, operator);
  return (
    <ListLayout crumbs={trail(operator, "By how it is reached")} title={REACH_LABEL[r]} lede={REACH_BLURB[r]} meta={`${flows.length} flows`}>
      <FlowList flows={flows} hideReach />
    </ListLayout>
  );
}
