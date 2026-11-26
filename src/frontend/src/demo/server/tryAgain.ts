import type { Idea, RetryEstimate, Run, TryAgainOffer } from "@/store/types";
import { append } from "./engine";
import { conflict, invalid, problem, Refusal } from "./http";
import { startRun } from "./mutations";
import { appAt, newId, orgOf, runRecord, uuidFor, type DemoApp, type DemoRun, type World } from "./world";

/**
 * Trying stopped work again and changing a built app, as `RetryService.cs`, `ChangeService.cs` and
 * `FactoryEstimates.cs` do them: which runs can be tried again (only the latest attempt, once), what
 * a try or a change is expected to cost (the median of this organisation's own finished runs of the
 * kind once there are three, otherwise the measured starting figure, priced for what is left), and
 * the refusals with the control plane's own words.
 */

export const RESEARCH_BASIS =
  "The measured starting figure for research runs, used until 3 have finished here to learn from. It can never cost more than 111.09 credits, the most its steps could cost; it is charged at what it actually costs.";

const STARTING = { build: 20, change: 10, conversation: 0.5 };
const MAX_REQUEST = 20000;

/** The first message of a run: the owner's words, and what kind of work they asked for. */
export function ownerMessage(r: DemoRun): Record<string, unknown> {
  return r.events.find((e) => e.type === "message" && e.payload.from === "owner")?.payload ?? {};
}

export function isChange(r: DemoRun): boolean {
  return r.run.kind === "task" && ownerMessage(r).kind === "change";
}

const stopped = (r: DemoRun) => r.run.status === "failed" || r.run.status === "cancelled";

/** `ReadModels.CanTryAgainAsync`: the latest attempt at research, a build or a change, stopped without finishing. */
export function canTryAgain(world: World, r: DemoRun): boolean {
  if (!stopped(r)) return false;
  const idea = r.run.ideaId ? world.ideas.find((i) => i.id === r.run.ideaId) : undefined;
  if (r.run.kind === "research") return !!idea && idea.status === "researching" && idea.runId === r.run.id;
  if (r.run.kind === "build") return !!idea && idea.status === "decided" && idea.decision?.runId === r.run.id;
  return isChange(r) && !world.runs.some((x) => ownerMessage(x).retryOf === r.run.id);
}

function why(r: DemoRun): TryAgainOffer["why"] {
  if (r.run.status === "cancelled") return "cancelled";
  if (r.run.budgetExhausted) return "budget";
  if (r.run.summary?.startsWith("The owner declined to start")) return "start-declined";
  return r.run.summary?.startsWith("The owner rejected the plan") ? "plan-declined" : "failed";
}

/** The run as the control plane answers it, with whether it can be tried again. */
export function runView(world: World, r: DemoRun): Run {
  return { ...r.run, canTryAgain: canTryAgain(world, r) };
}

/** The idea as `ReadModels.IdeaAsync` reads it: research that stopped reads "failed", with the offer to try again. */
export function ideaState(world: World, idea: Idea): Pick<Idea, "status" | "tryAgain"> {
  const research = runRecord(world, idea.runId);
  if (idea.status === "researching" && research && stopped(research)) return { status: "failed", tryAgain: { runId: research.run.id, what: "research", why: why(research) } };
  const build = idea.status === "decided" && idea.decision?.runId ? runRecord(world, idea.decision.runId) : undefined;
  if (build && build.run.kind === "build" && stopped(build)) return { status: idea.status, tryAgain: { runId: build.run.id, what: "build", why: why(build) } };
  return { status: idea.status, tryAgain: null };
}

/** The agreed plan's parts and how many passed their check, from the run's own journal (`RetryService.ProgressAsync`). */
export function progress(r: DemoRun): { done: number | null; parts: number | null; passed: string[] } {
  let items: string[] | null = null;
  const passed = new Set<string>();
  for (const e of r.events) {
    if (e.type !== "message" || e.payload.kind !== "workflow.step") continue;
    const step = String(e.payload.step ?? "");
    const data = (e.payload.data ?? {}) as Record<string, unknown>;
    if (step === "plan" && Array.isArray(data.items)) items = (data.items as { id?: unknown }[]).map((i) => String(i.id ?? ""));
    else if (/^item:[^:]+$/.test(step) && data.passed === true) passed.add(step.slice(5));
  }
  if (!items) return { done: null, parts: null, passed: [] };
  const kept = items.filter((i) => passed.has(i));
  return { done: kept.length, parts: items.length, passed: kept };
}

/** `FactoryEstimates.ExpectedAsync`: this organisation's own finished runs of the kind, or the starting figure. */
function expected(world: World, org: string, kind: "build" | "change", label: string): { credits: number; basis: string } {
  const actuals = world.runs
    .filter((x) => orgOf(x.run.scope) === org && x.run.status === "finished" && x.run.spentCredits > 0 && (kind === "build" ? x.run.kind === "build" : isChange(x)))
    .map((x) => x.run.spentCredits)
    .sort((a, b) => a - b);
  if (actuals.length >= 3) {
    const mid = Math.floor(actuals.length / 2);
    const median = actuals.length % 2 === 1 ? (actuals[mid] ?? 0) : ((actuals[mid - 1] ?? 0) + (actuals[mid] ?? 0)) / 2;
    return { credits: Math.ceil(median * 100) / 100, basis: `About the median of the last ${actuals.length} ${label} runs here, which is what they actually cost.` };
  }
  return { credits: STARTING[kind], basis: `The measured starting figure for ${label} runs, used until 3 have finished here to learn from.` };
}

/** `FactoryEstimates.LearnedAsync`: a whole build or change, or the part of one still to do. */
export function learned(world: World, org: string, kind: "build" | "change", remaining: number, items: number) {
  const whole = expected(world, org, kind, kind);
  if (items <= 0 || remaining >= items) return whole;
  const left = Math.ceil(whole.credits * (Math.max(1, remaining) / items) * 100) / 100;
  return { credits: left, basis: `${whole.basis} Only ${remaining} of its ${items} parts are left to build, so it is priced for those; the parts already built and checked are not built or charged again.` };
}

/** `FactoryEstimates.ConversationAsync`: what one message costs at most, priced on the thinking power that answers it. */
export function conversationEstimate(world: World, scope: string, tier: string | null) {
  const perCall: Record<string, number> = { research: 0.62, build: 0.41, strong: 0.88 };
  const most = Math.ceil((perCall[tier ?? ""] ?? 0.115) * 12 * 100) / 100;
  const org = orgOf(scope);
  const turns = world.runs.filter((x) => x.run.kind === "conversation" && orgOf(x.run.scope) === org && x.run.status === "finished" && x.run.spentCredits > 0).map((x) => x.run.spentCredits).sort((a, b) => a - b);
  const learnedHere = turns.length >= 3;
  const credits = learnedHere ? Math.ceil((turns[Math.floor(turns.length / 2)] ?? 0) * 100) / 100 : STARTING.conversation;
  const basis = learnedHere
    ? `About the median of the last ${turns.length} conversation runs here, which is what they actually cost.`
    : "The measured starting figure for conversation runs, used until 3 have finished here to learn from.";
  return { credits: Math.min(most, credits), ceiling: most, basis: `${basis} It can never cost more than ${most} credits: up to 12 steps, each priced at the most it could cost, and it is charged at what it actually costs.` };
}

/** `RetryService.RequireAsync`: a run that can be tried again, and what it is. */
function retryable(r: DemoRun): "research" | "build" | "change" {
  const terminal = r.run.status === "finished" || stopped(r);
  if (!stopped(r) || !(r.run.kind === "research" || r.run.kind === "build" || isChange(r)) || ((r.run.kind === "research" || r.run.kind === "build") && !r.run.ideaId))
    throw new Refusal(
      problem(409, "not_retryable", "This work cannot be tried again", terminal ? "Only research, a build or a change of an app that stopped without finishing can be tried again." : "It has not stopped: pause, resume or cancel it instead."),
    );
  return r.run.kind === "research" ? "research" : r.run.kind === "build" ? "build" : "change";
}

export function retryEstimate(world: World, r: DemoRun): RetryEstimate {
  const what = retryable(r);
  if (what === "research") return { runId: r.run.id, what, credits: 12, basis: RESEARCH_BASIS, partsDone: null, parts: null };
  const { done, parts } = progress(r);
  const left = parts !== null ? parts - (done ?? 0) : 1;
  const priced = learned(world, orgOf(r.run.scope), what, left, parts ?? 1);
  return { runId: r.run.id, what, credits: priced.credits, basis: priced.basis, partsDone: done, parts };
}

/** The project a run's app lives in, once placed. */
function projectOf(r: DemoRun): string | null {
  const parts = r.run.scope.split("/");
  return parts.length >= 3 ? parts.slice(0, 3).join("/") : null;
}

/** `ChangeService.RefusePausedAsync`: no new work is started for a paused employee on the project. */
export function refusePaused(world: World, project: string | null) {
  if (!project) return;
  const paused = world.employees.filter((e) => e.scope === project && e.kind === "employee" && e.status === "paused").map((e) => e.name).sort();
  if (paused.length === 0) return;
  const who = paused.join(" and ");
  const one = paused.length === 1;
  throw new Refusal(problem(409, "employee_paused", `${who} ${one ? "is" : "are"} paused`, `${who}, who ${one ? "works" : "work"} on this app, ${one ? "is" : "are"} paused, so no new work is started for them. Resume them first.`));
}

/** `ChangeService`: another build or change of the app is under way. */
function busy(world: World, appPath: string, except?: string) {
  const project = appPath.split("/").slice(0, 3).join("/");
  return world.runs.some((x) => x.run.id !== except && !["finished", "failed", "cancelled"].includes(x.run.status) && ((x.run.kind === "build" && x.run.scope === project) || (x.run.kind === "task" && x.run.scope === appPath)));
}

/**
 * Starts stopped work again as a new run (`RetryService.RetryAsync`) that carries on from what the
 * earlier one placed, agreed and finished. `by` is the person, or null when the conversation asked.
 */
export function retryRun(world: World, r: DemoRun, by: { id: string; name: string } | null, startResearch: (world: World, ideaId: string, scope: string, text: string, constraints: string[], via: "console" | "conversation" | "suggestion", story: string | null, change: string | null) => DemoRun): DemoRun {
  const what = retryable(r);
  if (what !== "research") refusePaused(world, projectOf(r));
  const estimate = retryEstimate(world, r);
  const owner = ownerMessage(r);
  const at = new Date().toISOString();
  if (what === "research") {
    const idea = world.ideas.find((i) => i.id === r.run.ideaId);
    if (!idea || idea.status !== "researching" || idea.runId !== r.run.id) throw conflict("Only the idea's latest research can be tried again, while no verdict has been reached.");
    const story = typeof r.ended?.params.story === "string" ? r.ended.params.story : null;
    const again = startResearch(world, idea.id, r.run.scope, idea.text, idea.constraints, "console", story, typeof owner.change === "string" ? owner.change : null);
    idea.runId = again.run.id;
    idea.history = [...idea.history, { verdict: null, headline: null, choice: "retry", note: null, by: by?.name ?? "", at, runId: again.run.id }];
    world.changed.push("Idea", "Tree", "Run");
    return again;
  }
  if (what === "build") {
    const idea = world.ideas.find((i) => i.id === r.run.ideaId);
    if (!idea || idea.status !== "decided" || idea.decision?.runId !== r.run.id) throw conflict("Only the idea's latest build can be built again.");
    if (world.runs.some((x) => ownerMessage(x).retryOf === r.run.id)) throw conflict("This build was already started again.");
    const again = startRun(world, { id: newId(world, "run"), kind: "build", title: r.run.title, scope: r.run.scope, ideaId: idea.id, estimateCredits: estimate.credits, employeeId: null, conversationId: null }, "build", { ...(r.ended?.params ?? { ideaId: idea.id }), fail: false, retryOf: r.run.id, answer: null });
    append(world, again, "message", { ...owner, retryOf: r.run.id, userId: by?.id ?? null, decidedBy: by ? "person" : "conversation" });
    append(world, again, "estimate.made", { credits: estimate.credits, basis: "retry", reason: estimate.basis });
    idea.decision = { ...idea.decision, runId: again.run.id };
    world.changed.push("Idea", "Tree", "Run");
    return again;
  }
  if (world.runs.some((x) => ownerMessage(x).retryOf === r.run.id)) throw conflict("This change was already started again.");
  const app = appAt(world, r.run.scope);
  if (app && busy(world, app.path, r.run.id)) throw conflict("Another build or change of this app is under way; wait for it, or cancel it, first.");
  const again = startRun(world, { id: newId(world, "run"), kind: "task", title: r.run.title, scope: r.run.scope, ideaId: null, estimateCredits: estimate.credits, employeeId: null, conversationId: null }, "change", { ...(r.ended?.params ?? {}), fail: false, retryOf: r.run.id, answer: null });
  append(world, again, "message", { ...owner, retryOf: r.run.id, userId: by?.id ?? null });
  append(world, again, "estimate.made", { credits: estimate.credits, basis: "retry", reason: estimate.basis });
  world.changed.push("App", "Tree", "Run");
  return again;
}

/** `ChangeService.Validate`: one app, and the change in 1 to 20000 characters. */
export function changeText(request: string | undefined): string {
  const text = (request ?? "").trim();
  if (text.length === 0 || text.length > MAX_REQUEST) throw invalid(`Describe the change in 1 to ${MAX_REQUEST} characters.`);
  return text;
}

export function changeEstimate(world: World, app: DemoApp) {
  return learned(world, orgOf(app.path), "change", 1, 1);
}

/** `ChangeService.CreateAsync`: a change run at the app, its owner message the request, its estimate first. */
export function startChange(world: World, app: DemoApp, request: string, by: { id: string } | null, via: "console" | "conversation" | "api", params: Record<string, string | number | boolean | null> = {}): DemoRun {
  const text = changeText(request);
  if (!app.publishedAt) throw new Refusal(problem(409, "app_not_built", "This app has not been built yet", "An app is changed once it has been built and published. Finish or try again its build first."));
  if (busy(world, app.path))
    throw new Refusal(problem(409, "app_busy", "This app is already being worked on", "Another build or change of this app is under way. Wait for it to finish, or cancel it, then ask for this change."));
  refusePaused(world, app.path.split("/").slice(0, 3).join("/"));
  const estimate = changeEstimate(world, app);
  const line = (text.split("\n")[0] ?? "").trim();
  const title = `Change: ${line.length <= 110 ? line : `${line.slice(0, 107)}...`}`;
  const r = startRun(world, { id: uuidFor(`run:change:${app.id}:${world.counter++}`), kind: "task", title, scope: app.path, ideaId: null, estimateCredits: estimate.credits, employeeId: null, conversationId: null }, "change", { appId: app.id, ...params });
  append(world, r, "message", { from: "owner", kind: "change", text, userId: by?.id ?? null, via });
  append(world, r, "estimate.made", { credits: estimate.credits, basis: "change", reason: estimate.basis });
  world.changed.push("App", "Tree", "Run", "Credits");
  return r;
}
