import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, timeAgo } from "@/lib/format";
import { describeError, viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { useAppSelector } from "@/store";
import { useGetVersionsQuery, useRestoreVersionMutation } from "@/store/api";
import type { AppDetail, AppVersion, RestoreResult } from "@/store/types";
import { versionTitle } from "./appModel";

const PAGE = 10;

function Author({ v }: { v: AppVersion }) {
  if (v.author.kind === "employee" && v.author.id) {
    return (
      <Link href={paths.employee(v.author.id)} className="rounded-xs text-primary-link hover:text-primary-hover">
        {v.author.name}
      </Link>
    );
  }
  return <span>{v.author.kind === "factory" ? "The factory" : v.author.name}</span>;
}

/**
 * History (UC-118): every version with who made it — an employee, a person or the factory — and
 * which one is live. Any earlier one can be brought back; it becomes the newest version.
 */
export function History({ app, canRestore }: { app: AppDetail; canRestore: boolean }) {
  const [limit, setLimit] = useState(PAGE);
  const query = useGetVersionsQuery({ appId: app.id, limit });
  const view = viewOf(query);
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [confirm, setConfirm] = useState<AppVersion | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [restore, restoring] = useRestoreVersionMutation();

  const bringBack = async (v: AppVersion) => {
    setConfirm(null);
    setProblem(null);
    setResult(null);
    try {
      setResult(await restore({ appId: app.id, commit: v.commit }).unwrap());
    } catch (e) {
      setProblem(`That version was not brought back: ${describeError(e as never)} Nothing changed.`);
    }
  };

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="history-title" className="text-lg font-semibold">
          History
        </h2>
        <span className="text-sm text-ink-muted">Any version can be brought back.</span>
      </div>
      {problem && (
        <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
          {problem}
        </p>
      )}
      {result && <Restored result={result} technical={technical} onDone={() => setResult(null)} />}
      {view.kind === "loading" && (
        <Loading label="Loading the history" className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-sm" />
          <Skeleton className="h-14 rounded-sm" />
          <Skeleton className="h-14 rounded-sm" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The history could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          {view.data.versions.length === 0 ? (
            <Empty icon="build" title="No versions yet">
              The first version appears here once it is built.
            </Empty>
          ) : (
            <ol aria-label="Versions" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
              {view.data.versions.map((v) => (
                <li key={v.commit} data-version={v.commit} className="flex flex-col gap-2 border-b px-5 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 flex-1 basis-full break-words font-medium sm:basis-0">{versionTitle(v, technical)}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      <Author v={v} />
                      <span aria-hidden>·</span>
                      <time dateTime={v.at} title={formatDate(v.at)}>
                        {timeAgo(v.at)}
                      </time>
                      {v.live && <Badge tone="success">Live now</Badge>}
                      {technical && <code className="font-mono text-xs">{v.commit.slice(0, 12)}</code>}
                      {canRestore && !v.live && confirm?.commit !== v.commit && (
                        <Button size="sm" variant="ghost" className="min-h-touch px-2 text-primary-link" disabled={restoring.isLoading} onClick={() => setConfirm(v)} aria-label={`Bring back “${versionTitle(v, technical)}” from ${timeAgo(v.at)}`}>
                          Bring back
                        </Button>
                      )}
                    </span>
                  </div>
                  {technical && v.message.includes("\n") && <p className="whitespace-pre-line break-words text-sm text-ink-body">{v.message.split("\n").slice(1).join("\n").trim()}</p>}
                  {confirm?.commit === v.commit && <ConfirmRestore app={app} onConfirm={() => void bringBack(v)} onCancel={() => setConfirm(null)} />}
                </li>
              ))}
            </ol>
          )}
          {view.data.hasMore && (
            <Button variant="ghost" className="self-start" onClick={() => setLimit((n) => n + PAGE)} disabled={query.isFetching}>
              {query.isFetching ? "Loading…" : "Show earlier versions"}
            </Button>
          )}
          {restoring.isLoading && (
            <p role="status" className="text-ink-body">
              Bringing it back: it becomes the newest version, then it is rebuilt and restarted.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ConfirmRestore({ app, onConfirm, onCancel }: { app: AppDetail; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} role="alertdialog" aria-labelledby={titleId} tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && onCancel()} className="flex flex-col gap-2 rounded-sm border border-attention-line bg-attention-tint px-4 py-3 outline-none">
      <p id={titleId} className="font-semibold text-attention-text">
        Bring this version of {app.name} back?
      </p>
      <p className="text-attention-deep">
        It becomes the newest version, made by you; nothing in the history is lost. The app is rebuilt and restarted, so it is briefly unavailable.
        {app.settings.access === "public" ? " It is public now, so it becomes private: look at the restored version before you make it public again." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onConfirm}>
          Bring it back
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Keep the live version
        </Button>
      </div>
    </div>
  );
}

function Restored({ result, technical, onDone }: { result: RestoreResult; technical: boolean; onDone: () => void }) {
  return (
    <div role="status" className={result.published ? "flex flex-col gap-2 rounded-sm border border-success-text bg-success-tint px-4 py-3" : "flex flex-col gap-2 rounded-sm border border-attention-line bg-attention-tint px-4 py-3"}>
      <p className="font-semibold">{result.published ? "The earlier version is back and running." : "The earlier version is back, but it is not running yet."}</p>
      {result.madePrivate && <p>It was public, so it is private now. Make it public again once you have looked at it.</p>}
      {!result.published && result.publishError && <p className="text-attention-deep">{technical ? result.publishError : "It could not be rebuilt. Try publishing it again, or ask the builder to look."}</p>}
      <Button size="sm" variant="ghost" className="self-start" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
