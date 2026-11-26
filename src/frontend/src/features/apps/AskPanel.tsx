import { useId, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatCredits, timeAgo } from "@/lib/format";
import { RISE } from "@/lib/motion";
import { describeError, errorStatus, viewOf } from "@/lib/queryState";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useAskAppMutation, useEstimateAskMutation, useGetDashboardQuery, useRemoveQuestionMutation, useSaveQuestionMutation } from "@/store/api";
import type { AskAnswer, AskEstimate, AskTechnical, SavedQuestion } from "@/store/types";
import { AskChartView } from "./AskChart";

const CANNOT_ANSWER = "That question could not be answered from what the app records. Try asking it another way.";

/** A refused question: plain words for everyone, and what failed underneath for technical mode. */
interface AskFailure {
  words: string;
  technical: AskTechnical | null;
}

function technicalOf(data: unknown): AskTechnical | null {
  const t = (data as { technical?: unknown } | undefined)?.technical;
  if (!t || typeof t !== "object") return null;
  const { sql, error } = t as { sql?: unknown; error?: unknown };
  return typeof error === "string" ? { sql: typeof sql === "string" ? sql : null, error } : null;
}

/**
 * What a refused question means, in words: the control plane's codes for asking. Normal mode never
 * repeats a query or a database message (CLAUDE.md rule 12); those travel apart, as `technical`.
 */
function askProblem(e: unknown): AskFailure {
  const status = errorStatus(e as never);
  const data = (e as { data?: { code?: string; detail?: unknown } } | undefined)?.data;
  const technical = technicalOf(data);
  switch (data?.code) {
    case "ask_unanswerable":
      // Its detail is written for the owner: the plain reason, never the query.
      return { words: typeof data.detail === "string" && data.detail.trim() ? data.detail.trim() : CANNOT_ANSWER, technical };
    case "query_failed":
    case "query_refused":
      return { words: CANNOT_ANSWER, technical: technical ?? (typeof data.detail === "string" ? { sql: null, error: data.detail } : null) };
    case "query_timeout":
      return { words: "That question took too long to answer. Try a narrower one, such as a shorter period.", technical };
    case "ask_unavailable":
      return { words: "Questions about apps cannot be answered on this installation yet.", technical: null };
    default:
      return { words: status === 403 ? `Asking needs the Builder role here. ${describeError(e as never)}` : describeError(e as never), technical: null };
  }
}

/**
 * Ask about this app (UC-117): a plain question about its visits, errors and events, answered from
 * its own telemetry. The most it can cost is shown first; nothing is asked until that is seen.
 */
export function AskPanel({ appId, canAsk }: { appId: string; canAsk: boolean }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [estimate, setEstimate] = useState<{ for: string; value: AskEstimate } | null>(null);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [problem, setProblem] = useState<AskFailure | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [estimateAsk, estimating] = useEstimateAskMutation();
  const [askApp, asking] = useAskAppMutation();
  const [save, saving] = useSaveQuestionMutation();
  const typed = question.trim();
  const estimated = estimate && estimate.for === typed ? estimate.value : null;

  const getEstimate = async (event: FormEvent) => {
    event.preventDefault();
    if (!typed) return;
    setProblem(null);
    try {
      const value = await estimateAsk({ appId, question: typed }).unwrap();
      setEstimate({ for: typed, value });
    } catch (e) {
      const failure = askProblem(e);
      setProblem({ ...failure, words: `No estimate could be made: ${failure.words}` });
    }
  };

  const ask = async () => {
    if (!estimated) return;
    setProblem(null);
    setSaved(null);
    try {
      setAnswer(await askApp({ appId, question: typed }).unwrap());
    } catch (e) {
      setProblem(askProblem(e));
    }
  };

  const keep = async () => {
    if (!answer) return;
    setSaved(null);
    try {
      await save({ appId, question: answer.question, sql: answer.sql, chart: answer.chart, answer: answer.answer, columns: answer.columns, rows: answer.rows, truncated: answer.truncated }).unwrap();
      setSaved("It is on the dashboard, and is worked out afresh each time you open this page.");
    } catch (e) {
      setSaved(`It was not kept: ${describeError(e as never)}`);
    }
  };

  return (
    <section aria-label="Asking about this app" className={cn("flex flex-col gap-4 rounded-md border bg-surface p-5 shadow-card sm:p-6", RISE)}>
      <form onSubmit={(e) => void getEstimate(e)} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="flex items-center gap-2 font-display text-lg font-semibold">
          <Icon name="research" tinted />
          Ask about this app
        </label>
        <span className="text-ink-body">Ask in plain words about its visits, errors and what its people do in it. It answers from this app&rsquo;s own records only.</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={inputId} value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="Which days are busiest?" className="min-h-12 flex-1 px-4" />
          <Button type="submit" variant="outline" className="min-h-12" disabled={!typed || estimating.isLoading}>
            {estimating.isLoading ? "Working it out…" : "See what it costs"}
          </Button>
        </div>
      </form>

      {estimated && !answer && (
        <div role="status" className="flex flex-col gap-3 rounded-sm bg-primary-tint px-4 py-3">
          <p>
            <span className="font-semibold">At most {formatCredits(estimated.credits)}.</span> <span className="text-ink-body">{estimated.basis}</span>
          </p>
          {canAsk ? (
            <>
              <Button className="self-start" onClick={() => void ask()} disabled={asking.isLoading}>
                {asking.isLoading ? "Asking…" : "Ask it"}
              </Button>
              {/* One call does both, so neither is claimed as under way on its own (D39). */}
              {asking.isLoading && (
                <p role="status" data-testid="ask-progress" className="text-sm text-ink-body">
                  Writing the query, then reading the records. It usually takes up to half a minute.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-muted">Asking spends credits, so it needs the Builder role here. You can read the dashboard below.</p>
          )}
        </div>
      )}

      {problem && (
        <div className="flex flex-col gap-2">
          <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
            {problem.words}
          </p>
          {technical && problem.technical && <Underneath technical={problem.technical} />}
        </div>
      )}

      {answer && (
        <div className="flex flex-col gap-4 border-t pt-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-base font-semibold">{answer.question}</h3>
            <span className="text-sm text-ink-muted">
              Cost {formatCredits(answer.credits.charged)} of at most {formatCredits(answer.credits.estimate)}
            </span>
          </div>
          <p className="text-ink-body">{answer.answer}</p>
          <AskChartView chart={answer.chart} columns={answer.columns} rows={answer.rows} />
          {answer.truncated && <p className="text-sm text-ink-muted">Only the first rows are shown; there were more.</p>}
          {technical && answer.sql && <Query sql={answer.sql} />}
          <div className="flex flex-wrap items-center gap-2">
            {canAsk && (
              <Button variant="outline" onClick={() => void keep()} disabled={saving.isLoading || saved?.startsWith("It is on") === true}>
                {saving.isLoading ? "Keeping it…" : "Keep this on the dashboard"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setAnswer(null);
                setEstimate(null);
                setQuestion("");
                setSaved(null);
              }}
            >
              Ask something else
            </Button>
          </div>
          {saved && (
            <p role={saved.startsWith("It is on") ? "status" : "alert"} className={saved.startsWith("It is on") ? "text-success-text" : "text-attention-text"}>
              {saved}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Query({ sql }: { sql: string }) {
  return (
    <details>
      <summary className="min-h-touch cursor-pointer py-2 text-sm text-ink-muted">The query</summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xs bg-ground p-3 font-mono text-xs">{sql}</pre>
    </details>
  );
}

/** Technical mode only: the last query tried and the guard's or the database's message about it. */
function Underneath({ technical }: { technical: AskTechnical }) {
  return (
    <details open className="text-sm">
      <summary className="min-h-touch cursor-pointer py-2 text-ink-muted">What failed underneath</summary>
      <div className="flex flex-col gap-2">
        {technical.sql && (
          <>
            <span className="text-ink-muted">The last query tried</span>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xs bg-ground p-3 font-mono text-xs">{technical.sql}</pre>
          </>
        )}
        <span className="text-ink-muted">What refused it</span>
        <pre className="whitespace-pre-wrap break-words rounded-xs bg-ground p-3 font-mono text-xs">{technical.error}</pre>
      </div>
    </details>
  );
}

/** The questions kept on the dashboard, each worked out again from the app's records when it is read. */
export function Dashboard({ appId, canChange }: { appId: string; canChange: boolean }) {
  const query = useGetDashboardQuery(appId);
  const view = viewOf(query);
  // Said here, not on the card: a question taken off is gone from the list until a refusal brings it back.
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <section aria-labelledby="dashboard-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-title" className="text-lg font-semibold">
          Dashboard
        </h2>
        {view.kind === "loaded" && view.data.length > 0 && <span className="text-sm text-ink-muted">Worked out afresh each time you open it, at no cost.</span>}
      </div>
      {view.kind === "loading" && (
        <Loading label="Loading the dashboard" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Skeleton className="h-48 rounded-md" />
          <Skeleton className="h-48 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The dashboard could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {problem && (
        <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
          {problem}
        </p>
      )}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          {view.data.length === 0 ? (
            <Empty icon="research" title="Nothing is kept on the dashboard yet">
              Ask a question above, then keep the answer here. It is worked out again from the latest records whenever this page opens.
            </Empty>
          ) : (
            <ul aria-label="Kept questions" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {view.data.map((q) => (
                <SavedCard key={q.id} appId={appId} question={q} canChange={canChange} onRefused={setProblem} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function SavedCard({ appId, question, canChange, onRefused }: { appId: string; question: SavedQuestion; canChange: boolean; onRefused: (text: string | null) => void }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [remove] = useRemoveQuestionMutation();
  const pending = question.id.startsWith("pending-");
  const drop = async () => {
    onRefused(null);
    try {
      await remove({ appId, questionId: question.id }).unwrap();
    } catch (e) {
      onRefused(`“${question.question}” was not taken off the dashboard: ${describeError(e as never)} It is back.`);
    }
  };
  return (
    <li data-question={question.id} className="flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 break-words font-display text-base font-semibold">{question.question}</h3>
        {canChange && !pending && (
          <Button size="sm" variant="ghost" onClick={() => void drop()} aria-label={`Take “${question.question}” off the dashboard`}>
            Take off
          </Button>
        )}
      </div>
      {question.error ? (
        <p role="alert" data-state="failed" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          This question no longer runs: {question.error}
        </p>
      ) : (
        <>
          {question.answer && <p className="text-ink-body">{question.answer}</p>}
          <AskChartView chart={question.chart} columns={question.columns} rows={question.rows} />
          {question.truncated && <p className="text-sm text-ink-muted">Only the first rows are shown.</p>}
        </>
      )}
      <span className="text-sm text-ink-muted">{pending ? "Keeping it…" : `Worked out ${timeAgo(question.ranAt)}`}</span>
      {technical && question.error && question.technical ? <Underneath technical={question.technical} /> : technical && question.sql && <Query sql={question.sql} />}
    </li>
  );
}
