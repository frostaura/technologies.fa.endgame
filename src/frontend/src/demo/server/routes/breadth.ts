import type { AskAnswer, AskChart, MemberRole, TokenRole } from "@/store/types";
import { append } from "../engine";
import { atLeast, highestIn, homeOrganisation, me, requireRole, scopeOf } from "../access";
import { area, conflict, created, forbidden, invalid, noContent, notFound, num, ok, omit, problem, Refusal, str, strings } from "../http";
import { startRun } from "../mutations";
import { createIdea } from "./work";
import { memberView, parseRole } from "./tree";
import { creditsView } from "../views";
import { charge, newId, node, organisation, orgOf, uuidFor, within, type DemoApp, type World } from "../world";

/** `BreadthEndpoints.cs`: tokens, asking about an app, the dashboard, versions and export, roles, top-up requests, the overdraft, notifications, suggestions. */

function app(world: World, id: string): DemoApp {
  const a = world.apps.find((x) => x.id === id);
  if (!a) throw notFound("The app");
  return a;
}

const ASK_BASIS = "Up to 3 model calls (writing the query, one repair that is never charged, and the answer), each priced at the most it could cost. It is charged at what it actually costs.";

function question(body: Record<string, unknown>): string {
  const q = (str(body, "question") ?? "").trim();
  if (q.length < 3 || q.length > 500) throw invalid("Ask a question of 3 to 500 characters.");
  return q;
}

/** An answer worked out from the app's telemetry, in the shape the real ask returns. */
function answerFor(a: DemoApp, q: string): Omit<AskAnswer, "credits"> {
  const t = a.telemetry;
  const lower = q.toLowerCase();
  if (!t) throw new Refusal(problem(422, "ask_unanswerable", "That question cannot be answered from what this app records", "The app does not record what this question needs."));
  if (/error|fail|broken/.test(lower)) {
    return { question: q, answer: t.errorsToday === 0 ? "No requests failed today." : `${t.errorsToday} of ${t.requestsToday} requests failed today.`, chart: { kind: "number", x: null, y: ["errors"], series: [{ name: "errors", points: [{ x: null, y: t.errorsToday }] }] }, sql: "select count(*) as errors from requests where status >= 500 and at::date = current_date", columns: ["errors"], rows: [{ errors: t.errorsToday }], truncated: false };
  }
  if (/hour|busiest|when/.test(lower)) {
    const hours = [9, 10, 11, 12, 13, 14, 17, 18, 19, 20];
    const counts = hours.map((h, i) => Math.round(t.visitsToday * ([0.03, 0.05, 0.08, 0.16, 0.14, 0.06, 0.07, 0.13, 0.17, 0.11][i] ?? 0)) || h % 3);
    const chart: AskChart = { kind: "bar", x: "hour", y: ["visits"], series: [{ name: "visits", points: hours.map((h, i) => ({ x: `${h}:00`, y: counts[i] ?? 0 })) }] };
    return { question: q, answer: "The busiest hour today was 19:00, just ahead of lunchtime at 12:00.", chart, sql: "select extract(hour from at) as hour, count(*) as visits from visits where at::date = current_date group by 1 order by 1", columns: ["hour", "visits"], rows: hours.map((h, i) => ({ hour: `${h}:00`, visits: counts[i] })), truncated: false };
  }
  if (/week|day|trend|visit/.test(lower)) {
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86_400_000).toISOString().slice(0, 10));
    const v = days.map((_, i) => Math.round(t.visitsToday * (0.7 + i * 0.05)));
    return { question: q, answer: `${t.visitsToday} visits today; the week has been rising steadily.`, chart: { kind: "line", x: "day", y: ["visits"], series: [{ name: "visits", points: days.map((d, i) => ({ x: d, y: v[i] ?? 0 })) }] }, sql: "select at::date as day, count(*) as visits from visits where at > now() - interval '7 days' group by 1 order by 1", columns: ["day", "visits"], rows: days.map((d, i) => ({ day: d, visits: v[i] })), truncated: false };
  }
  return {
    question: q,
    answer: `Today: ${t.visitsToday} visits and ${t.requestsToday} requests, answered in ${t.latencyP50Ms ?? 0} ms typically.`,
    chart: { kind: "table", x: null, y: ["measure", "today"], series: [] },
    sql: "select 'visits' as measure, count(*) as today from visits where at::date = current_date union all select 'requests', count(*) from requests where at::date = current_date",
    columns: ["measure", "today"],
    rows: [
      { measure: "visits", today: t.visitsToday },
      { measure: "requests", today: t.requestsToday },
      { measure: "errors", today: t.errorsToday },
    ],
    truncated: false,
  };
}

function overdraftReason(world: World, scope: string, needed: number): string | null {
  const o = organisation(world, orgOf(scope));
  if (!o) return null;
  const limit = o.ownLimit !== null ? Math.min(o.ownLimit, o.frostauraLimit) : o.frostauraLimit;
  const available = o.balance + limit;
  if (available >= needed) return null;
  return `The organisation has ${round(available)} credits available including its overdraft of ${limit}; this call needs up to ${needed}.`;
}

function budgetReason(world: World, scope: string, needed: number): string | null {
  for (const b of world.budgets) {
    if (!within(scope, b.path)) continue;
    const spent = world.spend.filter((s) => within(s.path, b.path)).reduce((n, s) => n + s.ai + s.hosting, 0);
    if (b.cap - spent < needed) return `The monthly budget at ${b.path} has ${round(Math.max(0, b.cap - spent))} credits left; this call needs up to ${needed}.`;
  }
  return null;
}

function round(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

/** `NotificationService.RaiseTopUpRequestedAsync`: a notice in each operator's own organisation feed. */
export function raiseTopUpRequested(world: World, requestId: string, organisationName: string, credits: number, note: string) {
  const operators = world.users.filter((u) => u.isOperator).map((u) => u.id);
  const homes = [...new Set(world.memberships.filter((m) => operators.includes(m.userId) && !m.path.includes("/")).map((m) => m.path))];
  const amount = (Math.round(credits * 100) / 100).toLocaleString("en-GB");
  for (const home of homes) {
    world.notifications.unshift({ id: uuidFor(`notification:topup.requested:${requestId}:${home}`), kind: "topup.requested", severity: "info", title: `${organisationName} asks for ${amount} credits`, detail: note.length > 0 ? note : "No note was given. Answer it under Every organisation.", scope: home, subject: { kind: "topup_request", id: requestId }, createdAt: new Date().toISOString(), read: false, emailedAt: null, organisation: home });
  }
}

area("BreadthEndpoints", {
  // Tokens ------------------------------------------------------------------------------------
  "GET tokens": (_req, { world }) => {
    const u = me(world);
    return ok(world.tokens.filter((t) => world.memberships.some((m) => m.userId === u.id && orgOf(m.path) === t.organisation)));
  },

  "POST tokens": (req, { world }) => {
    const u = me(world);
    const name = (str(req.body, "name") ?? "").trim();
    if (!name || name.length > 100) throw invalid("Give the token a name of 1 to 100 characters, so you know which client holds it.");
    const days = num(req.body, "expiresInDays");
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 366)) throw invalid("expiresInDays is 1 to 366, or left out for a token that lasts until it is revoked.");
    const org = scopeOf(world, str(req.body, "organisation"));
    if (org.includes("/")) throw invalid("A token is for one organisation: pass its slug.");
    const highest = highestIn(world, u.id, org);
    if (!highest) throw notFound(`The scope '${org}'`);
    const role = (req.body.role === undefined ? (highest === "owner" ? "admin" : highest) : parseRole(req.body.role)) as MemberRole;
    if (role === "owner") throw invalid("A token never acts as the Owner: what only the Owner may do stays with the person. Use admin at most.");
    if (!atLeast(highest, role)) throw forbidden(`A token's role is no higher than yours: you hold ${highest} at most in '${org}'.`);
    if (world.tokens.filter((t) => t.active && t.organisation === org).length >= 50) throw conflict("You hold 50 live tokens here; revoke one first.");
    const secret = `egp_${newId(world, "token").replace(/-/g, "")}`;
    const at = new Date().toISOString();
    const accessToken = { id: newId(world, "token-id"), name, organisation: org, role: role as TokenRole, prefix: secret.slice(0, 8), createdAt: at, expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null, lastUsedAt: null, revokedAt: null, active: true };
    world.tokens.unshift(accessToken);
    return created({ token: secret, accessToken });
  },

  "DELETE tokens/{id}": (req, { world }) => {
    me(world);
    const t = world.tokens.find((x) => x.id === req.params.id);
    if (!t) throw notFound("The token");
    Object.assign(t, { active: false, revokedAt: new Date().toISOString() });
    return ok(t);
  },

  // Ask about an app --------------------------------------------------------------------------
  "POST apps/{id}/ask/estimate": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "viewer");
    question(req.body);
    return ok({ credits: 0.42, basis: ASK_BASIS });
  },

  "POST apps/{id}/ask": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "builder");
    const q = question(req.body);
    const budget = budgetReason(world, a.path, 0.42);
    if (budget) throw new Refusal(problem(402, "budget_exhausted", "The budget is exhausted", `${budget} This is terminal for the run: do not retry it.`, { terminal: true, bindingScope: a.path, headroomCredits: 0, neededCredits: 0.42 }));
    const over = overdraftReason(world, a.path, 0.42);
    if (over) throw new Refusal(problem(402, "overdraft_limit", "The overdraft limit is reached", `${over} Work stops until the organisation is topped up; do not retry it.`, { terminal: true, bindingScope: orgOf(a.path), headroomCredits: 0, neededCredits: 0.42 }));
    const answer = answerFor(a, q);
    charge(world, a.path, 0.13);
    world.changed.push("Credits");
    return ok({ ...answer, credits: { estimate: 0.42, charged: 0.13 } });
  },

  "GET apps/{id}/dashboard": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "viewer");
    const ranAt = new Date().toISOString();
    return ok(world.dashboard.filter((q) => q.appId === a.id).map((q) => ({ ...omit(q, "appId"), ranAt })));
  },

  "POST apps/{id}/dashboard": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "builder");
    const q = question(req.body);
    if (world.dashboard.filter((x) => x.appId === a.id).length >= 30) throw conflict("A dashboard holds at most 30 questions; remove one first.");
    const answer = a.telemetry ? answerFor(a, q) : null;
    const at = new Date().toISOString();
    const saved = { appId: a.id, id: newId(world, "question"), question: q, answer: str(req.body, "answer") ?? answer?.answer ?? "", sql: str(req.body, "sql") ?? answer?.sql ?? "", chart: (req.body.chart as AskChart | undefined) ?? answer?.chart ?? null, columns: answer?.columns ?? [], rows: answer?.rows ?? [], truncated: false, askedAt: at, ranAt: at, error: null, technical: null };
    world.dashboard.push(saved);
    return created(omit(saved, "appId"));
  },

  "DELETE apps/{id}/dashboard/{questionId}": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "builder");
    if (!world.dashboard.some((q) => q.id === req.params.questionId && q.appId === a.id)) throw notFound("The saved question");
    world.dashboard = world.dashboard.filter((q) => q.id !== req.params.questionId);
    return noContent();
  },

  // Versions and export -----------------------------------------------------------------------
  "GET apps/{id}/versions": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "viewer");
    const limit = Number(req.query.get("limit") ?? 20);
    const all = world.versions[a.id] ?? [];
    return ok({ appId: a.id, live: all.find((v) => v.live)?.commit ?? null, versions: all.slice(0, limit), hasMore: all.length > limit });
  },

  "POST apps/{id}/versions/{commit}/restore": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "builder");
    const commit = req.params.commit ?? "";
    if (!/^[0-9a-f]{1,64}$/.test(commit)) throw invalid("Name the version by its commit id.");
    const list = (world.versions[a.id] ??= []);
    const from = list.find((v) => v.commit === commit);
    if (!from) throw notFound("The version");
    for (const v of list) v.live = false;
    const u = me(world);
    const version = { commit: uuidFor(`restore:${commit}:${world.counter++}`).replace(/-/g, "").slice(0, 40), message: `Restore the version ${commit.slice(0, 12)}`, at: new Date().toISOString(), author: { kind: "person" as const, id: u.id, name: u.displayName }, live: true };
    list.unshift(version);
    const madePrivate = a.access === "public";
    if (madePrivate) a.access = "private";
    if (a.status === "failed") Object.assign(a, { status: "running", health: "healthy", healthSummary: "Running again on the restored version.", running: a.runningSetting === "always-on" ? "always-on" : "awake" });
    a.version = version.commit;
    world.changed.push("Versions", "App", "Tree");
    return ok({ version, published: true, madePrivate, publishError: null });
  },

  "POST apps/{id}/republish": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "builder");
    const newest = (world.versions[a.id] ?? [])[0];
    if (!newest) throw conflict("Nothing has been built for this app yet, so there is no version to publish again.");
    for (const v of world.versions[a.id] ?? []) v.live = v === newest;
    Object.assign(a, { status: "running", health: "healthy", healthSummary: "Running again: its newest version was built and restarted.", running: a.runningSetting === "always-on" ? "always-on" : "awake", version: newest.commit, pausedReason: a.pausedReason });
    if (a.running === "paused") a.running = "awake";
    world.notifications = world.notifications.map((n) => (n.kind === "app.crashed" && n.subject?.id === a.id ? { ...n, read: true } : n));
    world.changed.push("Versions", "App", "Tree");
    return ok({ version: newest, published: true, madePrivate: false, publishError: null });
  },

  "GET apps/{id}/export": (req, { world }) => {
    const a = app(world, req.params.id ?? "");
    requireRole(world, a.path, "owner");
    const slug = node(world, a.path)?.slug ?? "app";
    const text = `This is the demo's stand-in for ${a.name}'s export: on a live install it is a .tar.gz of the code, its whole history and the app's data.\n`;
    return { status: 200, body: new Blob([text], { type: "application/gzip" }), headers: { "content-type": "application/gzip", "content-disposition": `attachment; filename="${slug}-export.tar.gz"` } };
  },

  // Roles ---------------------------------------------------------------------------------------
  "PATCH members/{membershipId}": (req, { world }) => {
    const role = parseRole(req.body.role);
    const m = world.memberships.find((x) => x.id === req.params.membershipId);
    if (!m) throw notFound("The membership");
    requireRole(world, m.path, role === "admin" || m.role === "admin" ? "owner" : "admin");
    if (role === "owner") throw forbidden("An organisation has one Owner, the person it was provisioned for.");
    if (m.role === "owner") throw conflict("That person is the Owner here; their role is not changed by a grant.");
    m.role = role;
    world.changed.push("Members", "Me", "Tree");
    return ok({ member: memberView(world, m), invitationCode: null, expiresAt: null, emailed: false });
  },

  // Top-up requests and the overdraft -----------------------------------------------------------
  "POST credits/top-up-requests": (req, { world }) => {
    const u = me(world);
    const org = scopeOf(world, str(req.body, "organisation") ?? homeOrganisation(world, u.id));
    requireRole(world, org, "owner");
    if (org.includes("/")) throw invalid("A top-up is asked for by an organisation; pass its slug.");
    const credits = num(req.body, "credits") ?? 0;
    if (credits <= 0 || credits > 10_000_000 || Math.round(credits * 1e6) !== credits * 1e6) throw invalid("Ask for a positive number of credits.");
    if (world.topUpRequests.filter((r) => r.organisation === org && r.status === "open").length >= 5) throw conflict("Five requests are already open; FrostAura answers them first.");
    const r = { id: newId(world, "top-up-request"), organisation: org, organisationName: organisation(world, org)?.name ?? org, credits, note: (str(req.body, "note") ?? "").slice(0, 500), status: "open" as const, requestedBy: u.displayName, requestedByEmail: u.email, requestedAt: new Date().toISOString(), closedAt: null, closeNote: null, topUpEntryId: null };
    world.topUpRequests.unshift(r);
    raiseTopUpRequested(world, r.id, r.organisationName, credits, r.note);
    world.changed.push("TopUpRequests", "Operator", "Notifications");
    return created(r);
  },

  "GET credits/top-up-requests": (req, { world }) => {
    const org = scopeOf(world, req.query.get("organisation"));
    requireRole(world, org, "admin");
    return ok(world.topUpRequests.filter((r) => r.organisation === org));
  },

  "PUT credits/overdraft": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    const atOrg = !scope.includes("/");
    requireRole(world, scope, atOrg ? "owner" : "admin");
    const credits = num(req.body, "credits") ?? -1;
    if (credits < 0) throw invalid(`'${atOrg ? "overdraft_own_limit" : "overdraft_limit"}' cannot be negative.`);
    const o = organisation(world, orgOf(scope));
    if (!o) throw notFound(`The scope '${scope}'`);
    if (atOrg) {
      if (credits > o.frostauraLimit) throw invalid(`The organisation's own overdraft may be tighter than the ${o.frostauraLimit} credits FrostAura set, never deeper.`);
      o.ownLimit = credits;
    } else {
      const inherited = o.ownLimit !== null ? Math.min(o.ownLimit, o.frostauraLimit) : o.frostauraLimit;
      if (credits > inherited) throw invalid(`An overdraft here may be tighter than the ${inherited} credits inherited, never deeper.`);
      world.overdraftLimits = world.overdraftLimits.filter((l) => l.path !== scope);
      world.overdraftLimits.push({ path: scope, credits, setAt: new Date().toISOString(), setBy: me(world).id });
    }
    world.changed.push("Credits");
    return ok(creditsView(world, orgOf(scope)));
  },

  // Notifications -----------------------------------------------------------------------------
  "GET notifications": (req, { world }) => {
    const u = me(world);
    const named = req.query.get("organisation") ?? homeOrganisation(world, u.id);
    if (!named) throw new Refusal(problem(409, "no_organisation", "No organisation yet", "Notifications belong to an organisation."));
    if (named.includes("/")) throw invalid("Pass the organisation's slug.");
    const held = requireRole(world, scopeOf(world, named), "viewer");
    if (!atLeast(held.role, "admin")) {
      const grants = world.memberships.filter((m) => m.userId === u.id && m.role === "admin" && orgOf(m.path) === named);
      if (grants.length === 0) return ok({ organisation: named, unread: 0, notifications: [] });
      const mine = world.notifications.filter((n) => n.organisation === named && grants.some((g) => within(n.scope, g.path)));
      return ok({ organisation: named, unread: mine.filter((n) => !n.read).length, notifications: mine.slice(0, 50).map((n) => omit(n, "organisation")) });
    }
    const list = world.notifications.filter((n) => n.organisation === named);
    return ok({ organisation: named, unread: list.filter((n) => !n.read).length, notifications: list.slice(0, Number(req.query.get("limit") ?? 50)).map((n) => omit(n, "organisation")) });
  },

  "POST notifications/{id}/read": (req, { world }) => {
    me(world);
    const n = world.notifications.find((x) => x.id === req.params.id);
    if (!n) throw notFound("The notification");
    n.read = true;
    return noContent();
  },

  "POST notifications/read-all": (req, { world }) => {
    me(world);
    const org = req.query.get("organisation");
    let marked = 0;
    for (const n of world.notifications) {
      if (n.organisation === org && !n.read) {
        n.read = true;
        marked += 1;
      }
    }
    return ok({ marked });
  },

  // Ideas from the portfolio ------------------------------------------------------------------
  "POST ideas/suggestions/estimate": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "builder");
    return ok({ credits: 2, basis: "The measured starting figure for suggest runs, used until 3 have finished here to learn from. It can never cost more than 9.6 credits, the most its steps could cost; it is charged at what it actually costs." });
  },

  "POST ideas/suggestions": (req, { world }) => {
    const given = scopeOf(world, str(req.body, "scope"));
    requireRole(world, given, "builder");
    const scope = given.split("/").slice(0, 2).join("/");
    const name = node(world, scope)?.name ?? scope;
    const r = startRun(world, { id: newId(world, "run"), kind: "suggest", title: `Suggest ideas from ${name}`, scope, ideaId: null, estimateCredits: 2, employeeId: null, conversationId: null }, "suggest", {});
    const estimate = { credits: 2, basis: "The measured starting figure for suggest runs, used until 3 have finished here to learn from. It can never cost more than 9.6 credits, the most its steps could cost; it is charged at what it actually costs." };
    append(world, r, "estimate.made", { credits: 2, basis: "suggest", reason: estimate.basis, ceiling: 9.6 });
    append(world, r, "message", { from: "owner", kind: "ideas.suggest", text: `Suggest up to 5 new product ideas from what ${name} already holds: for each, the gap it fills, why this organisation is placed to build it, and what it would reuse.` });
    world.changed.push("Credits");
    return created({ run: r.run, estimate });
  },

  "GET ideas/suggestions": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    return ok(world.suggestions.filter((s) => within(s.scope, scope) || within(scope, s.scope)));
  },

  "POST ideas/suggestions/{id}/{action}": (req, { world }) => {
    const s = world.suggestions.find((x) => x.id === req.params.id);
    if (!s) throw notFound("The suggestion");
    requireRole(world, s.scope, "builder");
    if (s.status !== "open") throw conflict(`This suggestion is already ${s.status}.`);
    if (req.params.action === "dismiss") {
      s.status = "dismissed";
      return ok(s);
    }
    if (req.params.action !== "take") throw new Refusal(problem(404, "not_found", "Not found", "There is nothing at this address."));
    const reuse = s.reuses.length ? `\n\nIt would reuse: ${s.reuses.join("; ")}.` : "";
    const text = `${s.title}\n\n${s.idea}\n\nThe gap it fills: ${s.gap}\n\nWhy we are placed to build it: ${s.whyUs}${reuse}`;
    const idea = createIdea(world, text, strings(req.body, "constraints"), s.scope, "suggestion");
    Object.assign(s, { status: "taken", ideaId: idea.id });
    world.changed.push("Suggestions", "Tree");
    return created(idea);
  },
});
