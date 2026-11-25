import { REACHES, ROLES, type Reach, type Role } from "../content/types.ts";
import { area, clientFlows, content, flow, flowsForReach, flowsForRole, isOperator, operatorFlows } from "../lib/data.ts";
import { REACH_BLURB, REACH_LABEL, ROLE_BLURB, ROLE_LABEL } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { Blocks } from "../components/Blocks.tsx";
import { FlowList } from "../components/FlowList.tsx";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { NotFound } from "./NotFound.tsx";

const CLIENT_ROLES = ROLES.filter((r) => r !== "operator");

export function Browse({ operator = false }: { operator?: boolean }) {
  const pool = operator ? operatorFlows : clientFlows;
  const roles = (operator ? ROLES : CLIENT_ROLES).filter((r) => flowsForRole(r, operator).length);
  const reaches = REACHES.filter((r) => flowsForReach(r, operator).length);
  const prefix = operator ? "/operator" : "";
  return (
    <Page>
      <Eyebrow>Browse</Eyebrow>
      <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">Every flow, three ways</h1>
      <p className="mt-4 max-w-read text-lead text-ink-body">By the part of the product it lives in, by who you are, or by how you reach it.</p>

      <h2 className="mt-14 font-display text-2xl font-semibold text-ink">By area</h2>
      <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {content.areas.map((a) => {
          const n = pool.filter((f) => f.area === a.id).length;
          if (!n) return null;
          return (
            <li key={a.id}>
              <a href={href(`${prefix}/area/${a.id}`)} className="group flex h-full flex-col rounded-lg border bg-surface p-6 shadow-card hover:shadow-raised">
                <span className="font-mono text-xs text-ink-muted">{a.id} · {n} flows</span>
                <span className="mt-2 font-display text-xl font-semibold text-ink group-hover:text-primary-link">{a.title}</span>
                <span className="mt-2 text-sm text-ink-muted">{a.summary}</span>
              </a>
            </li>
          );
        })}
      </ul>

      <h2 className="mt-14 font-display text-2xl font-semibold text-ink">By who you are</h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {roles.map((r) => (
          <li key={r}>
            <a href={href(`${prefix}/who/${r}`)} className="group flex h-full flex-col rounded-md border bg-surface p-5 hover:border-primary-line hover:bg-primary-tint">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink group-hover:text-primary-link">{ROLE_LABEL[r]}</span>
                <span className="font-mono text-xs text-ink-muted">{flowsForRole(r, operator).length}</span>
              </span>
              <span className="mt-1 text-sm text-ink-muted">{ROLE_BLURB[r]}</span>
            </a>
          </li>
        ))}
        {!operator &&
          (["operator", "host-admin"] as const).map((r) => (
            <li key={r}>
              <a href={href("/operator")} className="group flex h-full flex-col rounded-md border border-dashed bg-ground p-5 hover:border-border-strong">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">{ROLE_LABEL[r]}</span>
                  <span className="shrink-0 rounded-full bg-night px-2 py-0.5 text-xs font-medium text-primary-ink">FrostAura only</span>
                </span>
                <span className="mt-1 text-sm text-ink-muted">{ROLE_BLURB[r]} Taught in the separate operator handbook.</span>
              </a>
            </li>
          ))}
      </ul>

      <h2 className="mt-14 font-display text-2xl font-semibold text-ink">By what it is reached by</h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {reaches.map((r) => (
          <li key={r}>
            <a href={href(`${prefix}/reach/${r}`)} className="group flex h-full flex-col rounded-md border bg-surface p-5 hover:border-primary-line hover:bg-primary-tint">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink group-hover:text-primary-link">{REACH_LABEL[r]}</span>
                <span className="font-mono text-xs text-ink-muted">{flowsForReach(r, operator).length}</span>
              </span>
              <span className="mt-1 text-sm text-ink-muted">{REACH_BLURB[r]}</span>
            </a>
          </li>
        ))}
      </ul>
    </Page>
  );
}

export function AreaPage({ id, operator = false }: { id: string; operator?: boolean }) {
  const a = area(id);
  if (!a) return <NotFound />;
  const keep = (fid: string) => {
    const f = flow(fid);
    return !!f && f.id === fid && isOperator(f) === operator;
  };
  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-4">
        <nav aria-label="Sections" className="lg:sticky lg:top-header lg:self-start">
          <Eyebrow>Area {a.id}</Eyebrow>
          <h1 className="mt-3 font-display text-title-sm font-bold text-ink">{a.title}</h1>
          <p className="mt-3 text-sm text-ink-muted">{a.summary}</p>
          <ul className="mt-6 hidden space-y-1 lg:block">
            {a.sections.filter((s) => s.flows.some(keep)).map((s) => (
              <li key={s.id}><button type="button" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" })} className="block w-full rounded-xs px-2 py-1.5 text-left text-sm text-ink-body hover:bg-ground">{s.title}</button></li>
            ))}
          </ul>
        </nav>
        <div className="space-y-12 lg:col-span-3">
          {a.sections.filter((s) => s.flows.some(keep)).map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
              <h2 id={`${s.id}-h`} className="font-display text-2xl font-semibold text-ink">{s.title}</h2>
              {s.intro.length > 0 && <div className="mt-2 max-w-read text-sm"><Blocks blocks={s.intro} tone="muted" /></div>}
              <div className="mt-5"><FlowList flows={s.flows.filter(keep).flatMap((fid) => flow(fid) ?? [])} /></div>
            </section>
          ))}
        </div>
      </div>
    </Page>
  );
}

export function RolePage({ role, operator = false }: { role: string; operator?: boolean }) {
  if (!(ROLES as readonly string[]).includes(role) || (!operator && role === "operator")) return <NotFound />;
  const r = role as Role;
  return (
    <Page>
      <Eyebrow>Who you are</Eyebrow>
      <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">{ROLE_LABEL[r]}</h1>
      <p className="mt-4 max-w-read text-lead text-ink-body">{ROLE_BLURB[r]}</p>
      <div className="mt-10"><FlowList flows={flowsForRole(r, operator)} /></div>
    </Page>
  );
}

export function ReachPage({ reach, operator = false }: { reach: string; operator?: boolean }) {
  if (!(REACHES as readonly string[]).includes(reach)) return <NotFound />;
  const r = reach as Reach;
  return (
    <Page>
      <Eyebrow>Reached by</Eyebrow>
      <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">{REACH_LABEL[r]}</h1>
      <p className="mt-4 max-w-read text-lead text-ink-body">{REACH_BLURB[r]}</p>
      <div className="mt-10"><FlowList flows={flowsForReach(r, operator)} /></div>
    </Page>
  );
}
