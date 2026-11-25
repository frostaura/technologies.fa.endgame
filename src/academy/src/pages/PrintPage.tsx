import { useEffect } from "react";
import { CLIENT_LEVELS, type Level } from "../content/types.ts";
import { flow, scripts, site, track } from "../lib/data.ts";
import { Blocks } from "../components/Blocks.tsx";
import { Inline } from "../components/Inline.tsx";
import { Mark } from "../components/Mark.tsx";
import { Qr } from "../components/Qr.tsx";
import { stepOf } from "../bridge/player.ts";

/**
 * The print version, which `make academy-pdf` renders to academy.pdf and operator-handbook.pdf: a
 * cover with the QR code, a contents page, then every flow as numbered steps, each with its
 * captured image where one exists in place of the live frame.
 */
export function PrintPage({ operator }: { operator: boolean }) {
  const levels: readonly Level[] = operator ? ["Operator"] : CLIENT_LEVELS;
  const sections = levels.map((l) => ({ level: l, title: track(l)?.title ?? l, flows: (track(l)?.flows ?? []).flatMap((id) => flow(id) ?? []) }));
  useEffect(() => {
    document.title = operator ? "Endgame operator handbook" : "The Endgame Academy";
    document.documentElement.dataset.print = "ready";
  }, [operator]);
  return (
    <div className="print-doc bg-surface text-ink">
      <section className="print-page flex min-h-screen flex-col justify-between p-12">
        <div>
          <Mark className="h-14 w-14" />
          <p className="mt-10 text-eyebrow font-semibold uppercase text-primary">{operator ? "FrostAura only" : "Endgame"}</p>
          <h1 className="mt-3 font-display text-cover font-bold">{operator ? "The operator handbook" : "The Endgame Academy"}</h1>
          <p className="mt-6 max-w-read text-lead text-ink-body">
            {operator ? "God mode and running the platform, every flow step by step." : "Every flow in Endgame, step by step."}
          </p>
        </div>
        <div className="flex items-end justify-between gap-8">
          <p className="max-w-read text-sm text-ink-muted">Built from docs/flows, read from the product's code. The live version, with an interactive console beside every step, is at {site.siteUrl}</p>
          <Qr size="sm" />
        </div>
      </section>
      <section className="print-page p-12">
        <h2 className="font-display text-title-sm font-bold">Contents</h2>
        {sections.map((s) => (
          <div key={s.level} className="mt-8 break-inside-avoid-page">
            <h3 className="font-display text-xl font-semibold">{s.title}</h3>
            <ol className="mt-2 columns-2 gap-8 text-xs">
              {s.flows.map((f) => (
                <li key={f.id} className="break-inside-avoid py-0.5"><span className="font-mono font-semibold text-primary-link">{f.id}</span> {f.title}</li>
              ))}
            </ol>
          </div>
        ))}
      </section>
      {sections.map((s) => (
        <section key={s.level} className="px-12">
          <h2 className="print-break pt-12 font-display text-title font-bold">{s.title}</h2>
          {s.flows.map((f) => (
            <article key={f.id} className="mt-10 break-inside-avoid-page border-t pt-6">
              <p className="font-mono text-xs font-semibold text-primary-link">{f.id}</p>
              <h3 className="mt-1 font-display text-2xl font-semibold">{f.title}</h3>
              {f.whatYouLearn && <p className="mt-2 text-base text-ink-body"><Inline text={f.whatYouLearn} plainIds /></p>}
              {f.who && <p className="mt-2 text-xs text-ink-muted">Who: <Inline text={f.who} plainIds /> · Starts at: <Inline text={f.startsAt} plainIds /></p>}
              <ol className="mt-4 space-y-3">
                {f.steps.map((st) => {
                  const sc = stepOf(scripts[f.id], st.n);
                  const shot = sc?.kind === "image" ? { file: sc.file, alt: sc.alt } : sc?.kind === "demo" ? sc.shot : undefined;
                  return (
                    <li key={st.n} className="flex gap-3 break-inside-avoid">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-quiet text-xs font-semibold">{st.n}</span>
                      <div className="min-w-0 flex-1 text-sm">
                        <Inline text={st.text} plainIds />
                        {st.children.length > 0 && <Blocks blocks={st.children} />}
                        {sc?.kind === "terminal" && <pre className="mt-2 whitespace-pre-wrap rounded-xs bg-ground p-3 font-mono text-xs">$ {sc.command}{"\n"}{sc.output.join("\n")}</pre>}
                        {sc?.kind === "request" && <pre className="mt-2 whitespace-pre-wrap rounded-xs bg-ground p-3 font-mono text-xs">{sc.method} {sc.path} → {sc.response.status}</pre>}
                        {shot && <img src={`./shots/${shot.file}`} alt={shot.alt} className="mt-2 max-h-shot rounded-xs border" />}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {f.workedWhen && <p className="mt-4 rounded-xs bg-success-tint p-3 text-sm text-success-text"><strong>You know it worked when</strong> <Inline text={f.workedWhen} plainIds /></p>}
            </article>
          ))}
        </section>
      ))}
      <section className="print-page print-break flex min-h-screen flex-col items-center justify-center gap-8 p-12 text-center">
        <h2 className="font-display text-title font-bold">Keep learning, live</h2>
        <p className="max-w-read text-lead text-ink-body">Open the academy for the interactive console beside every step.</p>
        <Qr />
      </section>
    </div>
  );
}
