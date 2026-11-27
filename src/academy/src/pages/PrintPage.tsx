import { useEffect } from "react";
import { CLIENT_LEVELS, type Level } from "../content/types.ts";
import { flow, printFor, scripts, shotFor, site, track } from "../lib/data.ts";
import { Blocks } from "../components/Blocks.tsx";
import { Inline } from "../components/Inline.tsx";
import { Mark } from "../components/Mark.tsx";
import { Qr } from "../components/Qr.tsx";
import { Breakable } from "../components/Breakable.tsx";
import { stepOf } from "../bridge/player.ts";
import { sentence } from "../content/text.ts";
import type { ScriptStep } from "../content/scripts.ts";
import { PRINT_SHOT, printMmPerPx } from "../theme/tokens.ts";

/** A step's print picture: its file under ./shots/, and (from `make academy-shots`) its size in the console's CSS pixels. */
interface Paper {
  file: string;
  whole: boolean;
  width?: number;
  font?: number;
}

/** The page numbers each flow landed on, set by `tools/render-pdf.ts` on its second pass (`window.__pages`). */
function pagesOf(): Record<string, number> {
  return (window as unknown as { __pages?: Record<string, number> }).__pages ?? {};
}

/** A picture for paper: the print copy `make academy-shots` captured (the whole component the step rings), or a script's own image. */
function paperImage(flowId: string, key: number | string, own?: string): Paper | undefined {
  if (own && !own.includes("/")) return { file: own, whole: true };
  const p = printFor(flowId, key) as Paper | undefined;
  if (p) return p;
  const shot = shotFor(flowId, key);
  return shot ? { file: shot.replace(/\.webp$/, ".jpg"), whole: true } : undefined;
}

/**
 * A captured picture at its print size (`printMmPerPx`): its smallest text at the same size in
 * every picture, beside its words when narrow, under them — set in under the step's number where
 * the column has the room — when wide. A script's own image fills the column.
 */
const printedMm = (pic: Paper) => (pic.width ? pic.width * printMmPerPx(pic.width, pic.font ?? 0) : undefined);
function Shot({ pic, alt }: { pic: Paper; alt: string }) {
  const mm = printedMm(pic);
  return <img src={`./shots/${pic.file}`} alt={alt} className={`${mm ? "max-w-full" : "w-full"} rounded-xs border`} style={mm ? { width: `${mm.toFixed(1)}mm` } : undefined} loading="eager" />;
}
const beside = (pic: Paper) => (printedMm(pic) ?? Infinity) <= PRINT_SHOT.besideMm;
/** The step's number column (2.25 rem, about 9.5 mm): a picture under the words sits in from it when it still fits the column. */
const indented = (pic: Paper) => (printedMm(pic) ?? 0) <= PRINT_SHOT.columnMm - 9.5;

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
  const pages = pagesOf();
  useEffect(() => {
    document.title = operator ? "Endgame operator handbook" : "The Endgame Academy";
    document.documentElement.dataset.print = "ready";
  }, [operator]);
  return (
    <div className="print-doc bg-surface text-ink">
      {/* The cover, on a grid: the title block, then the QR card under the subtitle with the address beside it. */}
      <section className="print-page grid min-h-screen grid-rows-cover gap-10 p-12">
        <Mark className="h-14 w-14" />
        <div className="self-center">
          <p className="text-eyebrow font-semibold uppercase text-primary">{operator ? "FrostAura only" : "Endgame"}</p>
          <h1 className="mt-3 font-display text-cover font-bold">{operator ? "The operator handbook" : "The Endgame Academy"}</h1>
          <p className="mt-6 max-w-read text-lead text-ink-body">
            {operator ? "God mode and running the platform, every flow step by step." : "Every flow in Endgame, step by step."}
          </p>
          <div className="mt-12 flex items-center gap-6 rounded-lg border p-5">
            <a href={site.siteUrl} aria-label={`Open ${site.siteUrl}`}>
              <Qr size="sm" />
            </a>
            <p className="max-w-read text-sm text-ink-body">
              The live version, with an interactive console beside every step, is at{" "}
              <a href={site.siteUrl} className="font-mono text-xs text-ink"><Breakable text={site.siteUrl.replace(/^https?:\/\//, "")} /></a>. Scan the code, or follow the address, to open it.
            </p>
          </div>
        </div>
        <p className="text-sm text-ink-muted">Built from docs/flows, read from the product's code.</p>
      </section>
      <section className="print-break px-12 pt-4" aria-labelledby="contents">
        <h2 id="contents" className="font-display text-title-sm font-bold keep-next">Contents</h2>
        {sections.map((s) => (
          <div key={s.level} className="mt-6">
            {/* Not a heading: the PDF's bookmarks are the paths and flows themselves, not the contents' copy of them. */}
            <p className="font-display text-xl font-semibold keep-next">{s.title}</p>
            <ol className="mt-2 text-xs">
              {s.flows.map((f) => (
                <li key={f.id} className="break-inside-avoid border-b border-border/60 py-1">
                  <a href={`#flow-${f.id}`} className="grid grid-cols-contents items-baseline gap-x-3 text-ink no-underline">
                    <span className="font-mono font-semibold text-primary-link">{f.id}</span>
                    {/* A title that wraps hangs under its own first word, clear of the id. */}
                    <span className="min-w-0">{f.title}</span>
                    <span className="tabular-nums text-ink-muted" data-page={f.id}>{pages[f.id] ?? ""}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>
      {sections.map((s) => (
        <section key={s.level} className="px-12">
          <h2 className="print-break pt-4 font-display text-title font-bold keep-next">{s.title}</h2>
          {s.flows.map((f, n) => (
            <article key={f.id} id={`flow-${f.id}`} className={`${n ? "mt-10 border-t pt-6" : "mt-6"}`}>
              <div className="break-inside-avoid keep-next">
                <p className="font-mono text-xs font-semibold text-primary-link">{f.id}</p>
                <h3 className="mt-1 font-display text-2xl font-semibold">{f.title}</h3>
                {f.whatYouLearn && <p className="mt-2 text-base text-ink-body"><Inline text={sentence(f.whatYouLearn)} plainIds /></p>}
                {f.who && <p className="mt-2 text-xs text-ink-muted">Who: <Inline text={f.who} plainIds /> · Starts at: <Inline text={f.startsAt} plainIds /></p>}
              </div>
              <ol className="mt-4 space-y-4">
                {f.steps.map((st, i) => {
                  const sc = stepOf(scripts[f.id], st.n);
                  const found = sc?.kind === "image" ? paperImage(f.id, st.n, sc.file) : sc?.kind === "demo" ? paperImage(f.id, st.n, sc.shot?.file) : undefined;
                  // A step that leaves the screen as the step before it did prints no second copy of the picture.
                  const prev = i > 0 ? f.steps[i - 1] : undefined;
                  const prevSc = prev ? stepOf(scripts[f.id], prev.n) : undefined;
                  const prevPic = prev && prevSc?.kind === "demo" ? paperImage(f.id, prev.n, prevSc.shot?.file) : undefined;
                  const pic = found && prevPic?.file === found.file ? undefined : found;
                  const alt = sc?.kind === "image" ? sc.alt : sc?.kind === "demo" ? (sc.shot?.alt ?? sc.highlight?.note ?? sc.note ?? f.title) : "";
                  const caption = sc && "note" in sc ? (sc.note ?? (sc.kind === "demo" ? sc.highlight?.note : undefined)) : undefined;
                  const words = (
                    <div className="flex min-w-0 gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-quiet text-xs font-semibold">{st.n}</span>
                      <div className="min-w-0 flex-1 text-sm">
                        <Inline text={st.text} plainIds />
                        {st.children.length > 0 && <Blocks blocks={st.children} />}
                        {caption && found && <p className="mt-2 text-xs text-ink-muted"><Inline text={caption} plainIds /></p>}
                        {sc && !found && <PrintMedia step={sc} />}
                      </div>
                    </div>
                  );
                  if (!pic) return <li key={st.n} className="break-inside-avoid">{words}</li>;
                  // A narrow picture sits beside its step; a wide one goes under it.
                  return beside(pic) ? (
                    <li key={st.n} className="grid break-inside-avoid grid-cols-print-step items-start gap-5">
                      {words}
                      <Shot pic={pic} alt={alt} />
                    </li>
                  ) : (
                    <li key={st.n} className="break-inside-avoid space-y-2">
                      {words}
                      <div className={indented(pic) ? "pl-9" : ""}><Shot pic={pic} alt={alt} /></div>
                    </li>
                  );
                })}
              </ol>
              {(scripts[f.id]?.variations ?? []).length > 0 && (
                <div className="mt-6">
                  <p className="text-eyebrow font-semibold uppercase text-ink-muted keep-next">What else can happen, shown live in the academy</p>
                  <ul className="mt-2 space-y-3">
                    {(scripts[f.id]?.variations ?? []).map((v, i) => {
                      const pic = paperImage(f.id, `v${i + 1}`);
                      const last = v.steps[v.steps.length - 1];
                      const words = last ? (last.note ?? (last.kind === "demo" ? last.highlight?.note : undefined)) : undefined;
                      return (
                        <li key={v.title} className={`break-inside-avoid ${pic && beside(pic) ? "grid grid-cols-print-step items-start gap-5" : "space-y-2"}`}>
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold text-ink">{v.title}</p>
                            {words && <p className="mt-1 text-xs text-ink-muted"><Inline text={words} plainIds /></p>}
                          </div>
                          {pic && <Shot pic={pic} alt={words ?? v.title} />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {/* As on the site: a light card, a hairline, the one accent for its eyebrow; never alone at the top of a page. */}
              {f.workedWhen && (
                <div className="mt-5 break-before-avoid break-inside-avoid rounded-md border bg-surface p-4">
                  <p className="text-eyebrow font-semibold uppercase text-primary">You know it worked when</p>
                  <p className="mt-1 text-sm text-ink-body"><Inline text={f.workedWhen} plainIds /></p>
                </div>
              )}
            </article>
          ))}
        </section>
      ))}
      <section className="print-page print-break flex min-h-screen flex-col items-center justify-center gap-8 p-12 text-center">
        <h2 className="font-display text-title font-bold">Keep learning, live</h2>
        <p className="max-w-read text-lead text-ink-body">Open the academy for the interactive console beside every step.</p>
        <a href={site.siteUrl} aria-label={`Open ${site.siteUrl}`}>
          <Qr caption />
        </a>
      </section>
    </div>
  );
}
