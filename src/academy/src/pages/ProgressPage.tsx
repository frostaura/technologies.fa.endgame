import { useId, useState } from "react";
import { CLIENT_LEVELS, type Level } from "../content/types.ts";
import { clientFlows, operatorFlows, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { catalogue, progressStore, streakNow, useProgressSnapshot } from "../lib/progress.ts";
import { encode, toFile } from "../progress/model.ts";
import { milestones, nextUp, overallNext, trackStats } from "../progress/derive.ts";
import { count, shortDate } from "../lib/format.ts";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { Medal, ProgressRing } from "../components/ProgressMarks.tsx";
import { ResumeCard } from "../components/ResumeCard.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { ui } from "../components/ui.ts";

/**
 * "Your progress": the paths, the badges and milestones, what is next, and the controls to move
 * progress to another device or forget it. Everything here is read from, and written to, this
 * device only.
 */
export function ProgressPage() {
  const { progress, persistent } = useProgressSnapshot();
  const done = clientFlows.filter((f) => progress.flows[f.id]?.done).length;
  const started = clientFlows.filter((f) => progress.flows[f.id] && !progress.flows[f.id]?.done).length;
  const days = streakNow(progress.days);
  const next = overallNext(progress, catalogue, CLIENT_LEVELS);
  const marks = milestones(progress, catalogue, CLIENT_LEVELS);
  const opTrack = track("Operator");
  const op = opTrack ? trackStats(progress, opTrack) : undefined;
  const opNext = nextUp(progress, opTrack, catalogue);
  const anything = Object.keys(progress.flows).length > 0;
  const clientTotal = CLIENT_LEVELS.reduce((n, l) => n + (track(l)?.flows.length ?? 0), 0);

  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
        <div className="lg:col-span-3">
          <Eyebrow>Your progress</Eyebrow>
          <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">How far you have come</h1>
          <p className="mt-3 text-sm text-ink-muted" data-testid="privacy">Kept on this device only — there are no accounts, and nothing leaves it.</p>
          {!persistent && (
            <p className="mt-2 rounded-md bg-attention-wash px-4 py-3 text-sm text-ink-body" role="note">
              This browser is not letting the academy keep anything, so your progress lasts only for this visit. Export it below to keep it.
            </p>
          )}
          <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="overall">
            <div className="col-span-2 flex items-center gap-4 rounded-lg border bg-surface p-5 sm:col-span-1 sm:flex-col sm:items-start">
              <ProgressRing done={done} total={clientTotal} size="lg" label={`${done} of ${clientTotal} client flows done`} />
              <div>
                <dt className="text-sm text-ink-muted">Flows done</dt>
                <dd className="font-display text-figure font-bold text-ink">{done}<span className="text-2xl text-ink-muted"> of {clientTotal}</span></dd>
              </div>
            </div>
            <div className="rounded-lg border bg-surface p-5">
              <dt className="text-sm text-ink-muted">Started, not finished</dt>
              <dd className="mt-2 font-display text-figure font-bold text-ink">{started}</dd>
            </div>
            <div className="rounded-lg border bg-surface p-5">
              <dt className="text-sm text-ink-muted">Days in a row</dt>
              <dd className="mt-2 font-display text-figure font-bold text-ink">{days}</dd>
              <dd className="mt-1 text-xs text-ink-muted">{days > 1 ? "Keep it going tomorrow." : progress.days.length ? `Last here ${shortDate(new Date(`${progress.days.at(-1)}T12:00:00`).getTime())}` : "Counted from the days you learn."}</dd>
            </div>
          </dl>
        </div>
        <div className="space-y-4 lg:col-span-2 lg:pt-8">
          <ResumeCard />
          {next && progress.last && progress.flows[progress.last.flow]?.done !== true && (
            <a href={href(`/flow/${next.flow.id}`)} className="flex items-center gap-4 rounded-lg border bg-surface p-5 hover:border-primary-line hover:bg-primary-tint">
              <span className="min-w-0 flex-1">
                <span className={`${ui.eyebrow} block text-ink-muted`}>Next up</span>
                <span className="mt-1 block font-medium text-ink"><span className="font-mono text-xs font-semibold text-primary-link">{next.flow.id}</span> {next.flow.title}</span>
                {next.before && <span className="mt-1 block text-xs text-ink-muted">Learn it first, for {next.before.id}.</span>}
              </span>
              <span aria-hidden="true" className="text-primary-link">→</span>
            </a>
          )}
          {!anything && (
            <div className="rounded-lg border border-dashed p-6">
              <p className="font-medium text-ink">Nothing yet.</p>
              <p className="mt-1 text-sm text-ink-muted">Open any flow; each step you read is counted here.</p>
              <a href={href("/path/Foundation")} className={`${ui.primary} mt-4`}>Begin with Foundation</a>
            </div>
          )}
        </div>
      </div>

      <h2 className="mt-14 font-display text-2xl font-semibold text-ink">Paths and badges</h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CLIENT_LEVELS.map((level, i) => <PathProgress key={level} level={level} index={i} />)}
      </ul>

      <h2 className="mt-14 font-display text-2xl font-semibold text-ink">Milestones</h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="milestones">
        {marks.map((m) => (
          <li key={m.id} className={`flex items-center gap-4 rounded-lg border p-4 ${m.earned ? "bg-surface" : "bg-ground"}`}>
            <Medal earned={m.earned} mark="·" label={m.earned ? `${m.title}: earned` : `${m.title}: not yet`} />
            <span className="min-w-0">
              <span className="block font-semibold text-ink">{m.title}</span>
              <span className="block text-sm text-ink-muted">{m.earned ? (m.at ? `Earned ${shortDate(m.at)}` : "Earned") : m.toGo || m.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {op && operatorFlows.length > 0 && (
        <section aria-labelledby="op-h" className="mt-14 rounded-lg bg-night p-6 text-primary-ink sm:p-8">
          <p className="text-eyebrow font-semibold uppercase text-live">FrostAura only</p>
          <div className="mt-3 flex flex-wrap items-center gap-5">
            <ProgressRing done={op.done} total={op.total} tone="dark" label={`Operator handbook: ${op.done} of ${op.total} flows done`} />
            <div className="min-w-0 flex-1">
              <h2 id="op-h" className="font-display text-2xl font-semibold">The operator handbook</h2>
              <p className="mt-1 text-sm text-primary-ink-soft">{op.done} of {op.total} done · counted apart from the client paths{op.complete ? " · badge earned" : ""}</p>
            </div>
            {opNext && <a href={href(`/flow/${opNext.flow.id}`)} className={ui.light}>{op.done ? "Continue" : "Begin"} with {opNext.flow.id}</a>}
          </div>
        </section>
      )}

      <h2 className="mt-14 font-display text-2xl font-semibold text-ink">Move or reset</h2>
      <p className="mt-2 max-w-read text-sm text-ink-muted">Take your progress to another device as a file or a short code, bring it in there, and the two are merged — the furthest step of each flow wins.</p>
      <MoveControls />
    </Page>
  );
}

function PathProgress({ level, index }: { level: Level; index: number }) {
  const { progress } = useProgressSnapshot();
  const t = track(level);
  if (!t) return null;
  const s = trackStats(progress, t);
  const next = nextUp(progress, t, catalogue);
  return (
    <li className="flex flex-col rounded-lg border bg-surface p-5 shadow-card">
      <div className="flex items-center gap-4">
        <Medal earned={s.complete} mark={`0${index + 1}`} label={s.complete ? `${level} badge: earned` : `${level} badge: not yet`} />
        <div className="min-w-0">
          <a href={href(`/path/${level}`)} className="font-display text-xl font-semibold text-ink hover:text-primary-link">{level}</a>
          <p className="text-sm text-ink-muted">{s.done} of {s.total} done{s.complete && s.completedAt ? ` · badge ${shortDate(s.completedAt)}` : ""}</p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-quiet" aria-hidden="true">
        <div className="h-full rounded-full bg-success" style={{ width: `${s.total ? (100 * s.done) / s.total : 0}%` }} />
      </div>
      <p className="mt-3 flex-1 text-sm text-ink-muted">{LEVEL_BLURB[level]}</p>
      {next ? (
        <a href={href(`/flow/${next.flow.id}`)} className="mt-4 inline-flex min-h-touch items-center text-sm font-semibold text-primary-link">
          Next up: {next.flow.id} <span aria-hidden="true" className="ml-1">→</span>
        </a>
      ) : (
        <p className="mt-4 inline-flex min-h-touch items-center text-sm font-semibold text-success-text">Path complete</p>
      )}
    </li>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MoveControls() {
  const { progress } = useProgressSnapshot();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const pasteId = useId();
  const fileId = useId();
  const flows = Object.keys(progress.flows).length;

  const bringIn = (text: string) => {
    const n = progressStore.importText(text);
    setMessage(n === null ? { ok: false, text: "That is not a progress code or file from this academy." } : { ok: true, text: `Brought in ${count(n, "flow")}, merged with what this device had.` });
    if (n !== null) setPaste("");
  };

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-3">
      <div className="flex flex-col rounded-lg border bg-surface p-5">
        <h3 className="font-semibold text-ink">Export</h3>
        <p className="mt-1 flex-1 text-sm text-ink-muted">A small file, or a code to paste on the other device.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={ui.quiet} disabled={!flows} onClick={() => download("endgame-academy-progress.json", toFile(progress, Date.now()))}>Download a file</button>
          <button
            type="button"
            className={ui.quiet}
            disabled={!flows}
            onClick={() => {
              const c = encode(progress);
              setCode(c);
              setCopied(false);
              void navigator.clipboard?.writeText(c).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            Copy a code
          </button>
        </div>
        {code && (
          <div className="mt-3">
            <label htmlFor={`${pasteId}-code`} className="text-xs text-ink-muted">{copied ? "Copied. The code, in case you need it again:" : "Select and copy this code:"}</label>
            <textarea id={`${pasteId}-code`} readOnly value={code} rows={3} onFocus={(e) => e.currentTarget.select()} className="mt-1 w-full break-all rounded-xs border bg-ground p-2 font-mono text-xs text-ink" />
          </div>
        )}
      </div>
      <div className="flex flex-col rounded-lg border bg-surface p-5">
        <h3 className="font-semibold text-ink">Import</h3>
        <label htmlFor={pasteId} className="mt-1 text-sm text-ink-muted">Paste a progress code, or choose a file.</label>
        <textarea id={pasteId} value={paste} onChange={(e) => setPaste(e.target.value)} rows={2} placeholder="EGA2.…" className="mt-3 w-full rounded-xs border bg-surface p-2 font-mono text-xs text-ink placeholder:text-ink-muted" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={ui.quiet} disabled={!paste.trim()} onClick={() => bringIn(paste)}>Bring it in</button>
          <label htmlFor={fileId} className={`${ui.quiet} cursor-pointer focus-within:ring-2 focus-within:ring-primary`}>
            Choose a file
            <input
              id={fileId}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void file.text().then(bringIn);
              }}
            />
          </label>
        </div>
        <p role="status" className={`mt-3 text-sm ${message?.ok === false ? "text-attention-text" : "text-success-text"}`}>{message?.text ?? ""}</p>
      </div>
      <div className="flex flex-col rounded-lg border bg-surface p-5">
        <h3 className="font-semibold text-ink">Reset</h3>
        <p className="mt-1 flex-1 text-sm text-ink-muted">Forget every flow, badge and where you left off, on this device.</p>
        <div className="mt-4">
          <button type="button" className={ui.quiet} disabled={!flows && !progress.last} onClick={() => setConfirm(true)}>Reset progress…</button>
        </div>
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Reset your progress?">
        <p className="mt-3 text-sm text-ink-body">This forgets {count(flows, "flow")}, your badges and where you left off, on this device. It cannot be undone — export first if you may want it back.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className={ui.quiet} onClick={() => setConfirm(false)} autoFocus>Keep it</button>
          <button
            type="button"
            className={ui.danger}
            onClick={() => {
              progressStore.reset();
              setConfirm(false);
              setMessage({ ok: true, text: "Progress reset." });
            }}
          >
            Reset progress
          </button>
        </div>
      </Sheet>
    </div>
  );
}
