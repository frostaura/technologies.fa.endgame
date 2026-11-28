import { useId, useState, type ReactNode } from "react";
import { CLIENT_LEVELS, type Level } from "../content/types.ts";
import { figures, operatorFlows, pathFlows, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { catalogue, progressStore, streakNow, useProgressSnapshot } from "../lib/progress.ts";
import { encode, toFile } from "../progress/model.ts";
import { milestones, nextOwn, nextUp, overallNext, trackStats } from "../progress/derive.ts";
import { count, shortDate } from "../lib/format.ts";
import { Page } from "../components/Shell.tsx";
import { PageHeader, Tag } from "../components/PageHeader.tsx";
import { Medal, ProgressRing } from "../components/ProgressMarks.tsx";
import { ResumeCard } from "../components/ResumeCard.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { ui } from "../components/ui.ts";

/**
 * "Your progress": the paths, the badges and milestones, what is next, and the controls to move
 * progress to another device or forget it. Everything here is read from, and written to, this
 * device only.
 */
/** One statistic card: its label, its figure, a line under it, and — where it has one — its ring beside the figure. */
function Stat({ label, figure, of, note, ring }: { label: string; figure: number; of?: number; note: string; ring?: ReactNode }) {
  return (
    // On a phone the three sit in one compact row: the figure and its label, nothing else.
    <div className="flex min-w-0 items-center gap-4 rounded-lg border bg-surface p-3 sm:p-5 sm:shadow-card">
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-ink-muted sm:text-sm">{label}</dt>
        <dd className={`mt-1 text-2xl sm:text-figure ${ui.figure}`}>
          {figure}
          {of !== undefined && <span className="font-display text-sm font-semibold text-ink-muted sm:text-2xl"> of {of}</span>}
        </dd>
        <dd className="mt-1 hidden text-xs text-ink-muted sm:block">{note}</dd>
      </div>
      {ring && <span className="hidden sm:inline-flex">{ring}</span>}
    </div>
  );
}

export function ProgressPage() {
  const { progress, persistent } = useProgressSnapshot();
  const done = pathFlows.filter((f) => progress.flows[f.id]?.done).length;
  const started = pathFlows.filter((f) => progress.flows[f.id] && !progress.flows[f.id]?.done).length;
  const days = streakNow(progress.days);
  const next = overallNext(progress, catalogue, CLIENT_LEVELS);
  const marks = milestones(progress, catalogue, CLIENT_LEVELS);
  const opTrack = track("Operator");
  const op = opTrack ? trackStats(progress, opTrack) : undefined;
  const opNext = nextUp(progress, opTrack, catalogue);
  const anything = Object.keys(progress.flows).length > 0;
  const total = figures.flows;

  return (
    <Page>
      <PageHeader eyebrow="Your progress" title="How far you have come">
        <p className="mt-3 text-sm text-ink-muted" data-testid="privacy">Kept on this device only — there are no accounts, and nothing leaves it.</p>
      </PageHeader>
      {!persistent && (
        <p className="mt-3 max-w-read rounded-md bg-attention-wash px-4 py-3 text-sm text-ink-body" role="note">
          This browser is not letting the academy keep anything, so your progress lasts only for this visit. Export it below to keep it.
        </p>
      )}

      {anything ? (
        <div className="mt-8 space-y-3">
          <ResumeCard />
          {next && progress.last && progress.flows[progress.last.flow]?.done !== true && next.flow.id !== progress.last.flow && (
            // What comes after the flow being read: one quiet row that is plainly a link.
            <a href={href(`/flow/${next.flow.id}`)} className="group flex min-h-touch items-center gap-3 rounded-md border bg-surface px-4 py-3 transition-colors hover:border-primary-line hover:bg-ground">
              <span className="shrink-0 text-sm text-ink-muted">Next up</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink group-hover:text-primary-link"><span className="font-mono text-xs font-semibold text-primary-link">{next.flow.id}</span> {next.flow.title}{next.before ? ` — first, for ${next.before.id}` : ""}</span>
              <span aria-hidden="true" className="shrink-0 text-primary-link transition-transform group-hover:translate-x-0.5">→</span>
            </a>
          )}
        </div>
      ) : (
        <div className={`${ui.card} mt-8 flex flex-col gap-4 p-6 sm:flex-row sm:items-center`}>
          <div className="min-w-0 flex-1">
            <p className="font-display text-xl font-semibold text-ink">Nothing yet</p>
            <p className="mt-1 text-sm text-ink-muted">Open any flow; each step you read is counted here.</p>
          </div>
          <a href={href("/path/Foundation")} className={`${ui.primary} self-start sm:self-auto`}>Begin with Foundation</a>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-2 sm:gap-4" data-testid="overall">
        <Stat label="Flows done" figure={done} of={total} note={`On the ${figures.paths} paths`} ring={<ProgressRing done={done} total={total} label={`${done} of ${total} client flows done`} />} />
        <Stat label="Started" figure={started} note={started ? "Each picks up where you left it." : "Flows you open appear here."} />
        <Stat
          label="Days in a row"
          figure={days}
          note={days > 1 ? "Keep it going tomorrow." : progress.days.length ? `Last here ${shortDate(new Date(`${progress.days.at(-1)}T12:00:00`).getTime())}` : "Counted from the days you learn."}
        />
      </dl>

      <h2 className="mt-14 font-display text-2xl font-semibold text-ink">Paths and badges</h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CLIENT_LEVELS.map((level, i) => <PathProgress key={level} level={level} index={i} />)}
      </ul>

      <h2 className="mt-14 font-display text-2xl font-semibold text-ink">Milestones</h2>
      <ul className={`mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 ${marks.length === 7 ? "lg:grid-cols-7" : "lg:grid-cols-4"}`} data-testid="milestones">
        {marks.map((m, i) => (
          // Seven badges: one row on a wide screen; on a tablet, pairs, the last one spanning the row.
          <li key={m.id} className={`${ui.card} ${i === marks.length - 1 && marks.length % 2 ? "sm:col-span-2 lg:col-span-1" : ""} min-w-0 flex items-center gap-4 p-4 lg:flex-col lg:items-start lg:gap-3 ${m.earned ? "" : "shadow-none"}`}>
            <Medal earned={m.earned} label={m.earned ? `${m.title}: earned` : `${m.title}: not yet`} />
            <span className="min-w-0">
              <span className={`block font-semibold ${m.earned ? "text-ink" : "text-ink-body"}`}>{m.title}</span>
              <span className="block text-sm text-ink-muted">{m.earned ? (m.at ? `Earned ${shortDate(m.at)}` : "Earned") : m.toGo || m.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {op && operatorFlows.length > 0 && (
        <section aria-labelledby="op-h" className={`${ui.card} mt-14 flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6`} data-testid="operator-banner">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <ProgressRing done={op.done} total={op.total} label={`Operator handbook: ${op.done} of ${op.total} flows done`} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 id="op-h" className="font-display text-xl font-semibold text-ink">The operator handbook</h2>
                <Tag>FrostAura only</Tag>
              </div>
              <p className="mt-1 text-sm tabular-nums text-ink-muted">{op.done} of {op.total} done · counted apart from the client paths{op.complete ? " · badge earned" : ""}</p>
            </div>
          </div>
          {opNext && <a href={href(`/flow/${opNext.flow.id}`)} className={`${ui.quiet} w-full whitespace-nowrap sm:w-auto`}>{op.done ? "Continue" : "Begin"} with {opNext.flow.id}</a>}
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
  const next = nextOwn(progress, t, catalogue);
  return (
    <li className={`${ui.card} flex flex-col p-5`}>
      <div className="flex items-center gap-4">
        {/* A badge once it is earned; until then the path's own count, so an empty circle never reads as a disabled avatar. */}
        {s.complete ? <Medal earned mark={`0${index + 1}`} label={`${level} badge: earned`} /> : <ProgressRing done={s.done} total={s.total} label={`${level} badge: not yet. ${s.done} of ${s.total} flows done`} />}
        <div className="min-w-0">
          <a href={href(`/path/${level}`)} className="-my-2 inline-flex min-h-touch items-center font-display text-xl font-semibold text-ink hover:text-primary-link">{level}</a>
          <p className="text-sm tabular-nums text-ink-muted">{s.done} of {s.total} done{s.complete && s.completedAt ? ` · badge ${shortDate(s.completedAt)}` : ""}</p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-quiet" aria-hidden="true">
        {/* Any progress is wide enough to read as a bar, never a stray dot. */}
        <div className="h-full rounded-full bg-success" style={{ width: `${s.total && s.done ? Math.max(4, (100 * s.done) / s.total) : 0}%` }} />
      </div>
      <p className="mt-3 flex-1 text-sm text-ink-muted">{LEVEL_BLURB[level]}</p>
      {next ? (
        <a href={href(`/flow/${next.id}`)} className="mt-4 inline-flex min-h-touch items-center text-sm font-semibold text-primary-link">
          Next up: {next.id} <span aria-hidden="true" className="ml-1">→</span>
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

  const card = `${ui.card} flex flex-col p-5`;
  // A control that cannot act yet is still readable, not washed out.
  const quiet = `${ui.quiet} disabled:opacity-60`;
  return (
    // Three cards, each ending with its content: the buttons right under what they do.
    <div className="mt-6 grid items-start gap-4 md:grid-cols-3">
      <div className={card}>
        <h3 className="font-semibold text-ink">Export</h3>
        <p className="mt-1 text-sm text-ink-muted">A small file, or a code to paste on the other device.</p>
        {code && (
          <div className="mt-3">
            <label htmlFor={`${pasteId}-code`} className="text-xs text-ink-muted">{copied ? "Copied. The code, in case you need it again:" : "Select and copy this code:"}</label>
            <input id={`${pasteId}-code`} readOnly value={code} onFocus={(e) => e.currentTarget.select()} className="mt-1 min-h-touch w-full text-ellipsis rounded-xs border bg-ground px-3 font-mono text-xs text-ink" />
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-4">
          <button type="button" className={quiet} disabled={!flows} onClick={() => download("endgame-academy-progress.json", toFile(progress, Date.now()))}>Download a file</button>
          <button
            type="button"
            className={quiet}
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
            {code ? (copied ? "Copied" : "Copy the code") : "Copy a code"}
          </button>
        </div>
      </div>
      <div className={card}>
        <h3 className="font-semibold text-ink">Import</h3>
        <label htmlFor={pasteId} className="mt-1 text-sm text-ink-muted">Paste a progress code, or choose a file.</label>
        <input id={pasteId} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="A code starting EGA2." className="mt-3 min-h-touch w-full rounded-xs border bg-surface px-3 font-mono text-xs text-ink placeholder:text-ink-muted" />
        <p role="status" className={`mt-2 min-h-5 text-sm ${message?.ok === false ? "text-attention-text" : "text-success-text"}`}>{message?.text ?? ""}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" className={quiet} disabled={!paste.trim()} onClick={() => bringIn(paste)}>Bring it in</button>
          <label htmlFor={fileId} className={`${quiet} cursor-pointer focus-within:ring-2 focus-within:ring-primary`}>
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
      </div>
      <div className={card}>
        <h3 className="font-semibold text-ink">Reset</h3>
        <p className="mt-1 text-sm text-ink-muted">Forget every flow, badge and where you left off, on this device.</p>
        <div className="pt-4">
          <button type="button" className={quiet} disabled={!flows && !progress.last} onClick={() => setConfirm(true)}>Reset progress…</button>
        </div>
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Reset your progress?">
        <p className="mt-3 text-sm text-ink-body">This forgets {count(flows, "flow")}, your badges and where you left off, on this device. It cannot be undone — export first if you may want it back.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className={quiet} onClick={() => setConfirm(false)} autoFocus>Keep it</button>
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
