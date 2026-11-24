import { useEffect, useId, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { formatCredits, isValidSlug, slugify } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useCreateIdeaMutation, useCreateOrganisationMutation, useEstimateIdeaMutation, useGetMeQuery } from "@/store/api";
import type { IdeaEstimate } from "@/store/types";
import { AppShell } from "../shell/AppShell";

/** Things an idea commonly has to respect, offered as one-tap constraints. They are the owner's words, sent as text. */
const CONSTRAINT_OPTIONS = ["Members sign in", "Works on a phone", "Sends email", "Uses AI inside the app", "Receives data from a device"] as const;

const NEXT_STEPS: [string, string][] = [
  ["Research", "Who already does this, what gap is left, who would want it."],
  ["Verdict", "Build, change, or do not build. You can overrule it."],
  ["A home for it", "Endgame suggests a division and a name."],
  ["Hiring", "The people this needs are proposed, each with a cost."],
  ["Design, build, test, review", "On its own, inside your budget. Step in whenever you like."],
  ["Running, privately", "Live at its own address, visible only to you until you share it."],
];

const MIN_IDEA = 12;

type EstimateState = { kind: "idle" } | { kind: "loading" } | { kind: "loaded"; estimate: IdeaEstimate } | { kind: "failed"; reason: string };

/** An estimate answer, remembered against the exact idea and constraints it was for. */
type EstimateResult = { key: string } & ({ ok: true; estimate: IdeaEstimate } | { ok: false; reason: string });

export function StartView() {
  const me = useGetMeQuery(undefined);
  const firstRun = me.data ? me.data.organisation === null : false;
  const [orgName, setOrgName] = useState("");
  const [idea, setIdea] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [estimateIdea] = useEstimateIdeaMutation();
  const [createOrganisation, orgState] = useCreateOrganisationMutation();
  const [createIdea, ideaState] = useCreateIdeaMutation();
  const ids = { org: useId(), idea: useId(), other: useId(), orgHint: useId() };

  const constraints = [...chosen, ...(other.trim() ? [other.trim()] : [])];
  const text = idea.trim();
  const key = JSON.stringify([text, constraints]);
  const slug = slugify(orgName);
  const host = typeof window === "undefined" ? "" : window.location.host;

  // Ask for the research estimate once the idea has settled; nothing is charged for asking.
  // The state is derived: an answer only counts for the exact text it was given.
  useEffect(() => {
    if (text.length < MIN_IDEA) return;
    let current = true;
    const timer = setTimeout(() => {
      estimateIdea({ text, constraints: JSON.parse(key)[1] as string[] })
        .unwrap()
        .then((e) => current && setResult({ key, ok: true, estimate: e }))
        .catch((err: unknown) => current && setResult({ key, ok: false, reason: describeError(err as never) }));
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, text, estimateIdea]);

  const estimate: EstimateState =
    text.length < MIN_IDEA
      ? { kind: "idle" }
      : result?.key !== key
        ? { kind: "loading" }
        : result.ok
          ? { kind: "loaded", estimate: result.estimate }
          : { kind: "failed", reason: result.reason };
  const ready = estimate.kind === "loaded" && (!firstRun || isValidSlug(slug));
  const submitting = orgState.isLoading || ideaState.isLoading;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || submitting) return;
    setSubmitError(null);
    try {
      if (firstRun) await createOrganisation({ name: orgName.trim(), slug }).unwrap();
      const created = await createIdea({ text, constraints }).unwrap();
      navigate(paths.run(created.runId));
    } catch (err) {
      setSubmitError(describeError(err as never));
    }
  };

  const toggle = (c: string) => setChosen((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  return (
    <AppShell
      crumbs={me.data?.organisation ? [{ label: me.data.organisation.name, href: paths.home() }, { label: "New idea" }] : [{ label: "Start" }]}
      aside={<NextSteps />}
    >
      <form onSubmit={(e) => void submit(e)} className="mx-auto flex w-full max-w-form flex-col gap-9 py-4 lg:py-8" aria-describedby={submitError ? "start-error" : undefined}>
        <div className={cn("flex flex-col gap-2.5", RISE)}>
          <h1 className="text-4xl font-semibold leading-tight">What do you want to build?</h1>
          <p className="text-base text-ink-body">Describe it the way you would to a friend. Endgame researches it first, tells you plainly whether it is worth building, then builds and runs it.</p>
        </div>

        {me.isLoading && <Skeleton className="h-20" />}
        {firstRun && (
          <div className={cn("flex flex-col gap-2", RISE, stagger(1))}>
            <label htmlFor={ids.org} className="font-medium">
              Your organisation
            </label>
            <input
              id={ids.org}
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              aria-describedby={ids.orgHint}
              aria-invalid={orgName.length > 0 && !isValidSlug(slug)}
              className="min-h-12 rounded-xs border border-border-strong bg-surface px-3.5 text-base"
            />
            <span id={ids.orgHint} className={cn("text-xs", orgName.length > 0 && !isValidSlug(slug) ? "text-attention-text" : "text-ink-muted")}>
              {orgName.length > 0 && !isValidSlug(slug)
                ? "Use at least two letters or digits."
                : `Everything you make lives under this name. Its apps appear at ${host}/${slug || "your-name"}.`}
            </span>
          </div>
        )}

        <div className={cn("flex flex-col gap-2", RISE, stagger(2))}>
          <label htmlFor={ids.idea} className="font-medium">
            The idea
          </label>
          <textarea
            id={ids.idea}
            required
            rows={5}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            className="resize-y rounded-xs border border-border-strong bg-surface px-3.5 py-3 text-base leading-relaxed"
          />
        </div>

        <fieldset className={cn("flex flex-col gap-2.5", RISE, stagger(3))}>
          <legend className="mb-2.5 font-medium">
            Anything it must respect? <span className="font-normal text-ink-muted">Optional</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {CONSTRAINT_OPTIONS.map((c) => {
              const on = chosen.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(c)}
                  className={cn("min-h-touch rounded-full px-4 transition-colors", on ? "bg-primary text-primary-ink" : "border border-border-strong bg-surface hover:bg-ground")}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <label htmlFor={ids.other} className="mt-2 text-sm text-ink-muted">
            Anything else, in your own words
          </label>
          <input id={ids.other} value={other} onChange={(e) => setOther(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3.5" />
        </fieldset>

        <EstimatePanel state={estimate} />

        {submitError && (
          <p id="start-error" role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
            Research did not start: {submitError} Nothing was charged.
          </p>
        )}

        <div className={cn("flex flex-wrap items-center gap-4", RISE, stagger(5))}>
          <Button type="submit" size="lg" disabled={!ready || submitting}>
            {submitting ? "Starting research…" : "Research this idea"}
          </Button>
          <span className="text-ink-muted">Takes a few minutes. You can leave and come back.</span>
        </div>
        {me.data?.organisation && (
          <Link href={paths.home()} className="self-start rounded-xs text-primary-link hover:text-primary-hover">
            Back to the org chart
          </Link>
        )}
      </form>
    </AppShell>
  );
}

function EstimatePanel({ state }: { state: EstimateState }) {
  return (
    <section aria-label="Research estimate" aria-live="polite" className={cn("flex flex-col gap-2.5 rounded-md border border-primary-line bg-primary-tint px-5 py-4", RISE, stagger(4))}>
      <div className="flex flex-wrap justify-between gap-2">
        <span className="font-semibold">Research comes first</span>
        {state.kind === "loaded" && <span data-state="loaded">Estimated {formatCredits(state.estimate.credits)}</span>}
        {state.kind === "loading" && (
          <span role="status" data-state="loading" className="flex items-center gap-2 text-ink-muted">
            <Skeleton className="h-4 w-28" />
            <span className="sr-only">Estimating</span>
          </span>
        )}
      </div>
      {state.kind === "failed" ? (
        <p role="alert" data-state="failed" className="text-attention-text">
          The estimate could not be worked out: {state.reason} Research cannot start until it is shown.
        </p>
      ) : (
        <span className="text-ink-body">
          {state.kind === "idle"
            ? "Describe the idea and the research estimate appears here before anything is charged."
            : `You are charged for research only. Nothing is built until you have seen the verdict. If the estimate turns out wrong, you see by how much.${state.kind === "loaded" && state.estimate.basis ? ` ${state.estimate.basis}` : ""}`}
        </span>
      )}
    </section>
  );
}

function NextSteps() {
  return (
    <>
      <h2 className="text-lg font-semibold">What happens next</h2>
      <ol className="flex flex-col gap-5">
        {NEXT_STEPS.map(([title, text], i) => (
          <li key={title} className={cn("flex gap-3.5", RISE, stagger(i))}>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                i === 0 ? "animate-ring bg-primary text-primary-ink motion-reduce:animate-none" : "border border-ink-muted",
              )}
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">{title}</span>
              <span className="text-ink-body">{text}</span>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
