import { useEffect } from "react";
import { CLIENT_LEVELS, type Level } from "../content/types.ts";
import { flow, scripts, shotFor, site, track } from "../lib/data.ts";
import { Blocks } from "../components/Blocks.tsx";
import { Inline } from "../components/Inline.tsx";
import { Mark } from "../components/Mark.tsx";
import { Qr } from "../components/Qr.tsx";
import { stepOf } from "../bridge/player.ts";
import { sentence } from "../content/text.ts";
import type { ScriptStep } from "../content/scripts.ts";

const json = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** A terminal, request, code or e-mail step as it renders on the stage, set for paper. */
function PrintMedia({ step }: { step: ScriptStep }) {
  const box = "mt-2 whitespace-pre-wrap break-words rounded-xs bg-ground p-3 font-mono text-xs";
  if (step.kind === "terminal") return <pre className={box}>$ {step.command}{step.output.length ? `\n${step.output.join("\n")}` : ""}</pre>;
  if (step.kind === "code") return <pre className={box}>{step.code}{step.output?.length ? `\n\n→ ${step.output.join("\n")}` : ""}</pre>;
  if (step.kind === "request")
    return (
      <pre className={box}>
        {step.method} {step.path}
        {step.body !== undefined ? `\n${json(step.body)}` : ""}
        {`\n\n← ${step.response.status}`}
        {step.response.body !== undefined ? `\n${json(step.response.body)}` : ""}
      </pre>
    );
  if (step.kind === "email")
    return (
      <div className="mt-2 rounded-xs border p-3 text-xs">
        <p className="font-semibold text-ink">{step.subject}</p>
        <p className="text-ink-muted">From {step.from} · to {step.to}</p>
        {step.body.map((p, i) => <p key={i} className="mt-1 text-ink-body">{p}</p>)}
      </div>
    );
  return null;
}

/**
 * The print version, which `make academy-pdf` renders to academy.pdf and operator-handbook.pdf: a
 * cover with the QR code, a contents page, then every flow as numbered steps, each with its
 * captured image (`make academy-shots`) beside its text where the site has a live frame; terminal,
 * request, code and e-mail steps print as they render, and each branch of "What else can happen"
 * that plays live prints with the picture of where it ends.
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
              {f.whatYouLearn && <p className="mt-2 text-base text-ink-body"><Inline text={sentence(f.whatYouLearn)} plainIds /></p>}
              {f.who && <p className="mt-2 text-xs text-ink-muted">Who: <Inline text={f.who} plainIds /> · Starts at: <Inline text={f.startsAt} plainIds /></p>}
              <ol className="mt-4 space-y-4">
                {f.steps.map((st) => {
                  const sc = stepOf(scripts[f.id], st.n);
                  const file = sc?.kind === "image" ? sc.file : sc?.kind === "demo" ? (sc.shot?.file ?? shotFor(f.id, st.n)) : undefined;
                  const alt = sc?.kind === "image" ? sc.alt : sc?.kind === "demo" ? (sc.shot?.alt ?? sc.highlight?.note ?? sc.note ?? f.title) : "";
                  const caption = sc && "note" in sc ? (sc.note ?? (sc.kind === "demo" ? sc.highlight?.note : undefined)) : undefined;
                  return (
                    <li key={st.n} className={`break-inside-avoid ${file ? "grid grid-cols-12 gap-4" : "flex gap-3"}`}>
                      <div className={`flex min-w-0 gap-3 ${file ? "col-span-5" : "flex-1"}`}>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-quiet text-xs font-semibold">{st.n}</span>
                        <div className="min-w-0 flex-1 text-sm">
                          <Inline text={st.text} plainIds />
                          {st.children.length > 0 && <Blocks blocks={st.children} />}
                          {caption && file && <p className="mt-2 text-xs text-ink-muted"><Inline text={caption} plainIds /></p>}
                          {sc && !file && <PrintMedia step={sc} />}
                        </div>
                      </div>
                      {file && <img src={`./shots/${file}`} alt={alt} className="col-span-7 w-full rounded-xs border" loading="eager" />}
                    </li>
                  );
                })}
              </ol>
              {(scripts[f.id]?.variations ?? []).length > 0 && (
                <div className="mt-6 break-inside-avoid">
                  <p className="text-eyebrow font-semibold uppercase text-ink-muted">What else can happen, shown live in the academy</p>
                  <ul className="mt-2 space-y-3">
                    {(scripts[f.id]?.variations ?? []).map((v, i) => {
                      const file = shotFor(f.id, `v${i + 1}`);
                      const last = v.steps[v.steps.length - 1];
                      const words = last ? (last.note ?? (last.kind === "demo" ? last.highlight?.note : undefined)) : undefined;
                      return (
                        <li key={v.title} className={`break-inside-avoid ${file ? "grid grid-cols-12 gap-4" : ""}`}>
                          <div className={`text-sm ${file ? "col-span-5" : ""}`}>
                            <p className="font-semibold text-ink">{v.title}</p>
                            {words && <p className="mt-1 text-xs text-ink-muted"><Inline text={words} plainIds /></p>}
                          </div>
                          {file && <img src={`./shots/${file}`} alt={words ?? v.title} className="col-span-7 w-full rounded-xs border" loading="eager" />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
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
