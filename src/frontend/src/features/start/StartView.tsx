import { useEffect, useId, useState, type FormEvent } from "react";
import { TAP } from "@/lib/touch";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { formatCredits, isValidSlug, slugify } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { ROLE_NAME, effectiveRole, roleRank } from "@/lib/roles";
import { navigate, paths, useLocation } from "@/lib/router";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { platformHost, useCreateIdeaMutation, useCreateOrganisationMutation, useEstimateIdeaMutation, useGetAutonomyQuery, useGetCreditsQuery, useGetMeQuery } from "@/store/api";
import type { Autonomy, IdeaEstimate, MemberRole } from "@/store/types";
import { isArchived } from "../tree/treeManage";
import { NEVER_TOPPED_UP, nextSteps, researchPromise, roomFor, shortfall } from "./startModel";
import { AppShell } from "../shell/AppShell";

/** Things an idea commonly has to respect, offered as one-tap constraints. They are the owner's words, sent as text. */
const CONSTRAINT_OPTIONS = ["Members sign in", "Works on a phone", "Sends email", "Uses AI inside the app", "Receives data from a device"] as const;

const MIN_IDEA = 12;

type EstimateState = { kind: "idle" } | { kind: "loading" } | { kind: "loaded"; estimate: IdeaEstimate } | { kind: "failed"; reason: string };

/** An estimate answer, remembered against the exact idea and constraints it was for. */
type EstimateResult = { key: string } & ({ ok: true; estimate: IdeaEstimate } | { ok: false; reason: string });

export function StartView() {
  const me = useGetMeQuery(undefined);
  const active = useActiveOrganisation();
  const org = active.organisation;
  const { search } = useLocation();
  const tree = useActiveTree();
  // The organisation field is for the very first one only: once one exists, organisations are provisioned by FrostAura.
  const firstRun = me.data ? me.data.organisation === null && !active.entered && tree.data?.firstRun !== false : false;
  const roleOf = (scope: string): MemberRole | null => effectiveRole(tree.data, me.data, scope);
  // Where it may go: the whole organisation and each active division, wherever the person may start work.
  const places = org
    ? [
        { scope: org.slug, label: `The whole of ${org.name}` },
        ...(tree.data?.divisions ?? []).filter((d) => !isArchived(d)).map((d) => ({ scope: `${org.slug}/${d.slug}`, label: d.name })),
      ].filter((p) => roleRank(roleOf(p.scope)) >= roleRank("builder"))
    : [];
  const [picked, setPicked] = useState<string | null>(search.get("scope"));
  const place = places.find((p) => p.scope === picked) ?? places[0] ?? null;
  const scope = firstRun ? undefined : place?.scope;
  const blocked = !firstRun && !!me.data && !!org && places.length === 0 && (tree.isSuccess || tree.isError || roleRank(roleOf(org.slug)) < roleRank("builder"));
  // No organisation, and none may be named here: an idea has nowhere to live (ORG-03).
  const unplaced = !firstRun && !!me.data && !org && !active.isLoading && tree.data?.firstRun === false;
  const [orgName, setOrgName] = useState("");
  const [idea, setIdea] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [estimateIdea] = useEstimateIdeaMutation();
  const [createOrganisation, orgState] = useCreateOrganisationMutation();
  const [createIdea, ideaState] = useCreateIdeaMutation();
  const ids = { org: useId(), idea: useId(), other: useId(), orgHint: useId(), place: useId(), placeHint: useId() };

  const constraints = [...chosen, ...(other.trim() ? [other.trim()] : [])];
  const text = idea.trim();
  const key = JSON.stringify([text, constraints, scope ?? null]);
  const slug = slugify(orgName);
  const host = platformHost();

  // Ask for the research estimate once the idea has settled; nothing is charged for asking.
  // The state is derived: an answer only counts for the exact text it was given.
  useEffect(() => {
    if (text.length < MIN_IDEA) return;
    let current = true;
    const timer = setTimeout(() => {
      const [, asked, where] = JSON.parse(key) as [string, string[], string | null];
      // The estimate names the same place the idea will, so the figure shown is the figure recorded.
      estimateIdea({ text, constraints: asked, ...(where ? { scope: where } : {}) })
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
  const ready = estimate.kind === "loaded" && (firstRun ? isValidSlug(slug) : !!scope);
  const submitting = orgState.isLoading || ideaState.isLoading;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || submitting) return;
    setSubmitError(null);
    try {
      if (firstRun) await createOrganisation({ name: orgName.trim(), slug }).unwrap();
      const created = await createIdea({ text, constraints, ...(scope ? { scope } : {}) }).unwrap();
      navigate(paths.run(created.runId));
    } catch (err) {
      setSubmitError(describeError(err as never));
    }
  };

  const toggle = (c: string) => setChosen((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  return (
    <AppShell
      crumbs={org ? [{ label: org.name, href: active.entered ? paths.homeOf(org.slug) : paths.home() }, { label: "New idea" }] : [{ label: "Start" }]}
      aside={<NextSteps scope={firstRun ? null : (scope ?? null)} division={place && place.scope !== org?.slug ? place.label : null} />}
    >
      {unplaced ? (
        <section data-state="refused" className="mx-auto flex w-full max-w-form flex-col items-start gap-3 py-4 lg:py-8">
          <h1 className="text-3xl font-semibold max-sm:text-2xl leading-tight max-sm:text-2xl">Organisations are set up by FrostAura</h1>
          <p className="text-base text-ink-body">
            An idea lives in an organisation, and you hold no role in one yet. FrostAura sets one up for each person it invites; if someone already works here, ask them to give you a role.
          </p>
          <Link href={paths.home()} className={cn("rounded-xs text-primary-link hover:text-primary-hover", TAP)}>
            Back to the org chart
          </Link>
        </section>
      ) : blocked && org ? (
        <section data-state="refused" className="mx-auto flex w-full max-w-form flex-col items-start gap-3 py-4 lg:py-8">
          <h1 className="text-3xl font-semibold max-sm:text-2xl leading-tight max-sm:text-2xl">Only a Builder or above starts an idea</h1>
          <p className="text-base text-ink-body">
            {active.role ? `You are ${article(active.role)} ${ROLE_NAME[active.role]} in ${org.name}` : `You hold no role over the whole of ${org.name}`}, and no division gives you more. An Admin or the Owner can make you a Builder; until then, you can follow everything that is being built.
          </p>
          <Link href={active.entered ? paths.homeOf(org.slug) : paths.home()} className={cn("rounded-xs text-primary-link hover:text-primary-hover", TAP)}>
            Back to the org chart
          </Link>
        </section>
      ) : (
      <form onSubmit={(e) => void submit(e)} className="mx-auto flex w-full max-w-form flex-col gap-9 py-4 lg:py-8" aria-describedby={submitError ? "start-error" : undefined}>
        <div className={cn("flex flex-col gap-2.5", RISE)}>
          <h1 className="text-3xl font-semibold max-sm:text-2xl leading-tight max-sm:text-2xl">What do you want to build?</h1>
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
              className="min-h-12 rounded-xs border border-border-field bg-surface px-3.5 text-base"
            />
            <span id={ids.orgHint} className={cn("text-xs", orgName.length > 0 && !isValidSlug(slug) ? "text-attention-text" : "text-ink-muted")}>
              {orgName.length > 0 && !isValidSlug(slug)
                ? "Use at least two letters or digits."
                : `Everything you make lives under this name. Its apps appear at ${host}/${slug || "your-name"}.`}
            </span>
          </div>
        )}

        {!firstRun && org && (
          <div className={cn("flex flex-col gap-2", RISE, stagger(1))}>
            <label htmlFor={ids.place} className="font-medium">
              Where it goes
            </label>
            {tree.isLoading ? (
              <Skeleton className="h-11" />
            ) : (
              <Select id={ids.place} value={place?.scope ?? ""} onChange={(e) => setPicked(e.target.value)} aria-describedby={ids.placeHint}>
                {places.map((p) => (
                  <option key={p.scope} value={p.scope}>
                    {p.label}
                  </option>
                ))}
              </Select>
            )}
            <span id={ids.placeHint} className="text-xs text-ink-muted">
              {tree.isError
                ? "The divisions could not be loaded, so for now it can only go to the whole organisation."
                : place && place.scope !== org.slug
                  ? `It is researched for ${place.label}, and built there if it is built.`
                  : "Endgame suggests a division for it once it is researched."}
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
            className="resize-y rounded-xs border border-border-field bg-surface px-3.5 py-3 text-base leading-relaxed"
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
          <input id={ids.other} value={other} onChange={(e) => setOther(e.target.value)} className="min-h-touch rounded-xs border border-border-field bg-surface px-3.5" />
        </fieldset>

        <EstimatePanel state={estimate} scope={scope ?? null} firstRun={firstRun} />

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
        {org && (
          <Link href={active.entered ? paths.homeOf(org.slug) : paths.home()} className={cn("self-start rounded-xs text-primary-link hover:text-primary-hover", TAP)}>
            Back to the org chart
          </Link>
        )}
      </form>
      )}
    </AppShell>
  );
}

const article = (role: MemberRole) => (role === "admin" || role === "owner" ? "an" : "a");

function EstimatePanel({ state, scope, firstRun }: { state: EstimateState; scope: string | null; firstRun: boolean }) {
  const autonomy = useGetAutonomyQuery(scope ?? "", { skip: !scope });
  // What there is to spend, read at the organisation so every cap on the way down is seen. A read that fails says
  // nothing here: the run itself still waits, and says why, if there is not enough (IDEA-04).
  const credits = useGetCreditsQuery(scope?.split("/")[0] ?? "", { skip: !scope || state.kind !== "loaded" });
  const short =
    state.kind !== "loaded"
      ? null
      : firstRun
        ? `A new organisation starts with no credits, and this needs about ${formatCredits(state.estimate.credits)}. Research starts, then waits for a top-up before it spends anything.`
        : scope && credits.data?.neverToppedUp
          ? NEVER_TOPPED_UP
          : scope && credits.data
            ? shortfall(roomFor(credits.data, scope), state.estimate.credits)
            : null;
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
            : `${researchPromise(scope ? (autonomy.data ?? null) : null)} If the estimate turns out wrong, you see by how much.${state.kind === "loaded" && state.estimate.basis ? ` ${state.estimate.basis}` : ""}`}
        </span>
      )}
      {short && (
        <p data-testid="estimate-shortfall" className="flex flex-col gap-1 rounded-xs border border-attention-line bg-surface px-3 py-2 text-ink">
          {short}
          {!firstRun &&
            (credits.data?.neverToppedUp ? (
              <Link href={paths.credits()} className="self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover">
                Ask for a top-up
              </Link>
            ) : (
              <Link href={paths.credits()} className="self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover">
                See credits
              </Link>
            ))}
        </p>
      )}
    </section>
  );
}

/** What happens next, as the autonomy at the chosen place will actually do it. */
function NextSteps({ scope, division }: { scope: string | null; division: string | null }) {
  const query = useGetAutonomyQuery(scope ?? "", { skip: !scope });
  const view = viewOf(query);
  const autonomy: Autonomy | null = scope ? (view.kind === "loaded" ? view.data : null) : null;
  return (
    <>
      <h2 className="text-lg font-semibold">What happens next</h2>
      {scope && view.kind === "loading" && (
        <Loading label="Loading how much happens on its own here" className="flex flex-col gap-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </Loading>
      )}
      {scope && view.kind === "failed" && <Failed title="What happens next could not be worked out" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {(!scope || view.kind === "loaded") && (
        <ol className="flex flex-col gap-5">
          {nextSteps(autonomy, division).map(([title, text], i) => (
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
      )}
    </>
  );
}
