import { content, site } from "../lib/data.ts";
import { resetProgress } from "../lib/progress.ts";
import { href } from "../lib/router.ts";
import { Eyebrow, Page } from "../components/Shell.tsx";

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "0%");

/** How the academy is made, and how much of it plays live: the coverage report, on the page. */
export function About() {
  const c = site.coverage;
  const problems = content.problems;
  return (
    <Page className="max-w-prose">
      <Eyebrow>About this academy</Eyebrow>
      <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">Built from the product's own flows</h1>
      <p className="mt-5 text-lead text-ink-body">
        Every page here is generated from <span className="font-mono text-base">docs/flows</span>: {content.flows.length} flows read from Endgame's code, one per thing a person, an operator, an app's end user or an AI assistant can do. Nothing is copied by hand, so when a screen changes, its flow changes, and so does this academy.
      </p>
      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">Coverage</h2>
      <p className="mt-2 text-ink-muted">Each flow can carry a step script that tells the live console, a terminal, a request panel or an e-mail what to show beside each step.</p>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2" data-testid="coverage">
        <div className="rounded-lg border bg-surface p-6">
          <dt className="text-sm text-ink-muted">Flows with a step script</dt>
          <dd className="mt-2 font-display text-balance font-bold text-ink">{c.flowsWithScript}<span className="text-2xl text-ink-muted">/{c.flows}</span></dd>
          <dd className="mt-1 font-mono text-xs text-ink-muted">{pct(c.flowsWithScript, c.flows)}</dd>
        </div>
        <div className="rounded-lg border bg-surface p-6">
          <dt className="text-sm text-ink-muted">Steps with media</dt>
          <dd className="mt-2 font-display text-balance font-bold text-ink">{c.stepsWithMedia}<span className="text-2xl text-ink-muted">/{c.steps}</span></dd>
          <dd className="mt-1 font-mono text-xs text-ink-muted">{pct(c.stepsWithMedia, c.steps)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-ink-muted">By kind: {Object.entries(c.byKind).map(([k, n]) => `${k} ${n}`).join(" · ")}. {c.variations} {c.variations === 1 ? "branch" : "branches"} of “What else can happen” play in a console of their own. Scripted: {c.scripted.map((id, i) => <span key={id}>{i ? ", " : ""}<a className="font-mono text-xs text-primary-link underline" href={href(`/flow/${id}`)}>{id}</a></span>)}.</p>
      <p className="mt-2 text-sm text-ink-muted">Flows without a script still show every step, and a screen flow opens the live console on the screen it starts at.</p>

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">What the reading could not settle</h2>
      {problems.length ? (
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-ink-body">
          {problems.map((p, i) => <li key={i}><a className="font-mono text-xs text-primary-link underline" href={href(`/flow/${p.flow}`)}>{p.flow}</a> {p.message}</li>)}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-body">Every flow was read in its full shape.</p>
      )}

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">Your progress</h2>
      <p className="mt-2 text-sm text-ink-muted">Progress is kept in this browser only. Nothing leaves it.</p>
      <button type="button" onClick={() => resetProgress()} className="mt-4 min-h-touch rounded-full border px-5 text-sm font-semibold text-ink hover:bg-ground">Forget my progress</button>

      <h2 className="mt-12 font-display text-2xl font-semibold text-ink">Sources</h2>
      <ul className="mt-3 space-y-1 font-mono text-xs text-ink-muted">{site.builtFrom.map((f) => <li key={f}>{f}</li>)}</ul>
      <p className="mt-6 text-sm text-ink-muted">Step scripts follow <a className="text-primary-link underline" href="./schema/step-script.schema.json">the step-script schema</a>.</p>
    </Page>
  );
}
