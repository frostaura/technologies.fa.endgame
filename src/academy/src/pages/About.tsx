import { content, figures, site } from "../lib/data.ts";
import { href } from "../lib/router.ts";
import { Page } from "../components/Shell.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { Figures } from "./Cover.tsx";
import { ui } from "../components/ui.ts";

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "0%");

/** An id as a chip that never breaks across a line; in a grid, every chip one width so the ids form columns. */
const IdChip = ({ id }: { id: string }) => (
  <a className="inline-flex w-full justify-center whitespace-nowrap rounded-full border bg-surface px-2.5 py-0.5 font-mono text-xs font-semibold text-primary-link hover:border-primary-line hover:bg-primary-tint" href={href(`/flow/${id}`)}>{id}</a>
);

/** How the academy is made, and how much of it plays live: the coverage report, on the page. */
export function About() {
  const c = site.coverage;
  const problems = content.problems;
  return (
    <Page>
      <PageHeader eyebrow="About this academy" title="Built from the product's own flows" />
      {/* A reading column and, beside it, a column that takes the rest of the width: no gap between them grows with the screen. */}
      <div className="mt-8 grid gap-10 lg:grid-cols-about lg:gap-16">
        <div className="min-w-0">
          <p className="max-w-read text-lead-sm text-ink-body sm:text-lead">
            Every page here is generated from <span className="font-mono text-base">docs/flows</span>, read from Endgame's code: one flow per thing a person, an operator, an app's end user or an AI assistant can do. Nothing is copied by hand, so when a screen changes, its flow changes, and so does this academy.
          </p>
          <Figures className="mt-8 max-w-read" />
          <p className="mt-4 max-w-read text-sm text-ink-muted" data-testid="figures-note">
            The {figures.flows} flows and {figures.steps} steps are the ones the {figures.paths} paths teach. {figures.reference > 0 && `${figures.reference} reference entries sit outside every path and are found by browsing. `}
            The operator handbook, for FrostAura alone, adds {figures.operatorFlows} flows and {figures.operatorSteps} steps of its own.
          </p>

          <h2 className="mt-12 font-display text-2xl font-semibold text-ink">{problems.length ? "What the reading could not settle" : "How completely the flows were read"}</h2>
          {problems.length ? (
            <ul className="mt-4 max-w-read space-y-2 text-sm text-ink-body">
              {problems.map((p, i) => <li key={i} className="flex gap-3"><IdChip id={p.flow} /> <span className="min-w-0">{p.message}</span></li>)}
            </ul>
          ) : (
            <p className="mt-4 max-w-read text-sm text-ink-body">Every flow was read in its full shape: the build reported nothing about any of them that it could not settle.</p>
          )}

          <h2 className="mt-12 font-display text-2xl font-semibold text-ink">Your progress</h2>
          <p className="mt-2 max-w-read text-sm text-ink-muted">Progress is kept on this device only; nothing leaves it. See it, move it to another device, or reset it on <a className={ui.textLink} href={href("/progress")}>your progress</a>.</p>

          <h2 className="mt-12 font-display text-2xl font-semibold text-ink">Sources</h2>
          <ul className="mt-3 space-y-1 font-mono text-xs text-ink-muted">{site.builtFrom.map((f) => <li key={f}>{f}</li>)}</ul>
          <p className="mt-6 text-sm text-ink-muted">Step scripts follow <a className={ui.textLink} href="./schema/step-script.schema.json">the step-script schema</a>.</p>
        </div>

        <aside className="min-w-0 max-w-site space-y-4" aria-labelledby="coverage-h">
          <h2 id="coverage-h" className="font-display text-2xl font-semibold text-ink">Coverage</h2>
          <p className="text-sm text-ink-muted">Across all {c.flows} flows, the operator handbook's included: a step script tells the live console, a terminal, a request panel or an e-mail what to show beside each step.</p>
          <dl className="grid gap-4 sm:grid-cols-2" data-testid="coverage">
            <div className={`${ui.card} p-5`}>
              <dt className="text-sm text-ink-muted">Flows with a step script</dt>
              <dd className={`mt-1 text-figure ${ui.figure}`}>{c.flowsWithScript}<span className="text-2xl font-semibold text-ink-muted"> of {c.flows}</span></dd>
              <dd className="mt-1 text-xs tabular-nums text-ink-muted">{pct(c.flowsWithScript, c.flows)}</dd>
            </div>
            <div className={`${ui.card} p-5`}>
              <dt className="text-sm text-ink-muted">Steps with media</dt>
              <dd className={`mt-1 text-figure ${ui.figure}`}>{c.stepsWithMedia}<span className="text-2xl font-semibold text-ink-muted"> of {c.steps}</span></dd>
              <dd className="mt-1 text-xs tabular-nums text-ink-muted">{pct(c.stepsWithMedia, c.steps)}</dd>
            </div>
          </dl>
          <p className="text-sm text-ink-muted">By kind: {Object.entries(c.byKind).map(([k, n]) => `${k} ${n}`).join(" · ")}. Branches that play under “What else can happen”: {c.variations}.</p>
          <details className={`${ui.card} group p-5`}>
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 font-medium text-ink">
              The {c.scripted.length} scripted flows
              <span className="text-sm font-normal text-ink-muted group-open:hidden">Show all</span>
            </summary>
            <ul className="mt-3 grid grid-cols-ids gap-1.5">{c.scripted.map((id) => <li key={id}><IdChip id={id} /></li>)}</ul>
          </details>
          <p className="text-sm text-ink-muted">Flows without a script still show every step, and a screen flow opens the live console on the screen it starts at.</p>
        </aside>
      </div>
    </Page>
  );
}
