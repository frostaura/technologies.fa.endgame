import type { Member, MemberRole } from "@/store/types";
import { homeOrganisation, me, operatorVisit, requireRole, roleAt, scopeOf } from "../access";
import { area, conflict, created, forbidden, invalid, isEmail, noContent, notFound, num, ok, problem, Refusal, str } from "../http";
import { creditsView, treeView } from "../views";
import { newId, orgOf, organisation, uuidFor, within, type DemoMembership, type World } from "../world";
import { redLineOf } from "../../world/story";

/** `TreeEndpoints.cs`: the tree, organisations, members (list, invite, revoke), credits, top-ups. */

const RESERVED = ["www", "api", "app", "apps", "admin", "endgame", "console", "mail", "smtp", "status", "docs", "auth", "login", "internal", "static", "assets", "cdn", "god", "operator", "support"];
const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}[a-z0-9]$/;

export function parseRole(v: unknown): MemberRole {
  if (v === "owner" || v === "admin" || v === "builder" || v === "viewer") return v;
  throw invalid(`'${String(v ?? "")}' is not a role: use owner, admin, builder or viewer.`);
}

export function memberView(world: World, m: DemoMembership): Member {
  const u = world.users.find((x) => x.id === m.userId);
  const pending = (u?.passkeys ?? 0) === 0;
  return { membershipId: m.id, userId: m.userId, email: u?.email ?? "", displayName: u?.displayName ?? "", scope: m.path, role: m.role, hasPasskey: !pending, grantedAt: m.grantedAt, invitationExpiresAt: pending ? (u?.invitation?.expiresAt ?? null) : null };
}

function code(world: World) {
  const id = newId(world, "code").replace(/-/g, "").toUpperCase();
  return `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8, 12)}`;
}

export function invitationFor(world: World, email: string, displayName: string) {
  let u = world.users.find((x) => x.email === email);
  if (!u) {
    u = { id: uuidFor(`user:${email}`), displayName: displayName || (email.split("@")[0] ?? email), email, passkeys: 0, isOperator: false, invitation: null };
    world.users.push(u);
  }
  if (u.passkeys === 0) u.invitation = { code: code(world), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() };
  return u;
}

const LINES: Record<string, string> = {
  "tobacco-gambling-finance": "tobacco, exploitative gambling or predatory finance",
  weapons: "weapons used against civilians",
  "animal-harm": "animal harm and industrial cruelty",
  surveillance: "surveillance and authoritarian tooling",
};

/** `OrganisationScreening`: what the organisation does, screened by a model, or by the operator when none answers. */
function screen(world: World, name: string, description: string | undefined, manual: unknown): { method: "model" | "manual"; reason: string; description: string } {
  const what = (description ?? "").trim();
  if (what.length < 10 || what.length > 1000) throw invalid("Say what the organisation does, in 10 to 1000 characters: it is screened against FrostAura's red lines before it is set up.");
  const refuse = (line: string | null, reason: string, method: "model" | "manual") =>
    new Refusal(problem(422, "red_line", "FrostAura does not set this organisation up", `What it does crosses a red line — ${line ? (LINES[line] ?? "one of FrostAura's red lines") : "one of FrostAura's red lines"}: ${reason}`, { line, method }));
  if (manual && typeof manual === "object") {
    const m = manual as { decision?: unknown; reason?: unknown; line?: unknown };
    if (m.decision !== "clear" && m.decision !== "breach") throw invalid("A manual screening decides 'clear' (no red line is crossed) or 'breach'.");
    const reason = typeof m.reason === "string" ? m.reason.trim() : "";
    if (reason.length < 10 || reason.length > 1000) throw invalid("A manual screening needs a written reason of 10 to 1000 characters.");
    if (m.decision === "breach") throw refuse(typeof m.line === "string" && LINES[m.line] ? m.line : null, reason, "manual");
    return { method: "manual", reason, description: what };
  }
  if (world.modelsOffline)
    throw new Refusal(problem(503, "screening_unavailable", "The organisation could not be screened", "It is screened against FrostAura's red lines before it is set up, and no model could be reached. Try again shortly, or record your own screening decision with a written reason."));
  const breach = redLineOf(`${name}. ${what}`);
  if (breach) throw refuse(breach.line, breach.reasoning, "model");
  return { method: "model", reason: "It crosses none of the red lines: what it does harms no one and watches no one.", description: what };
}

area("TreeEndpoints", {
  "GET tree": (req, { world }) => {
    const u = me(world);
    const named = req.query.get("organisation");
    if (named) {
      const held = organisation(world, named) ? roleAt(world, u.id, named) : null;
      if (!held) throw notFound(`The organisation '${named}'`);
      if (held.viaOperator) {
        operatorVisit(world, u, named);
        if (!world.entered.includes(named)) world.entered.push(named);
      }
      return ok(treeView(world, u.id, named));
    }
    const home = homeOrganisation(world, u.id);
    return ok(treeView(world, u.id, home ?? ""));
  },

  "POST organisations": (req, { world }) => {
    const u = me(world);
    const slug = (str(req.body, "slug") ?? "").trim();
    const name = (str(req.body, "name") ?? "").trim();
    if (!SLUG.test(slug)) throw invalid(`'${slug}' is not a valid slug: use 2-40 lower-case letters, digits and single hyphens, starting and ending with a letter or digit.`);
    // `ReservedNames.CheckAsync`: Endgame's own names, refused as the control plane refuses them.
    if (RESERVED.includes(slug)) throw new Refusal(problem(409, "reserved_name", "That name is reserved", `'${slug}' cannot name an organisation: it is one of Endgame's own names.`));
    if (!name) throw invalid("The organisation needs a name.");
    const firstRun = !world.memberships.some((m) => m.userId === u.id) && world.organisations.length === 0;
    if (!firstRun && !u.isOperator) throw forbidden("Organisations are provisioned by FrostAura; there is no self-serve sign-up.");
    if (slug === "frostaura" || slug === "academy") throw new Refusal(problem(409, "reserved_name", "That name is reserved", `'${slug}' cannot name an organisation: FrostAura already uses it as a subdomain.`));
    if (organisation(world, slug)) throw conflict(`An organisation is already called '${slug}'.`);
    const ownerEmail = (str(req.body, "ownerEmail") ?? "").trim().toLowerCase();
    const ownerDisplayName = (str(req.body, "ownerDisplayName") ?? "").trim();
    if (!firstRun && !isEmail(ownerEmail)) throw invalid("Give a valid e-mail address.");
    if (ownerDisplayName.length > 200) throw invalid("A display name is at most 200 characters.");
    // Provisioning screens what the organisation does against the red lines before anything exists.
    const screened = firstRun ? null : screen(world, name, str(req.body, "description"), req.body.screening);
    const at = new Date().toISOString();
    world.organisations.push({ id: uuidFor(`org:${slug}`), slug, name, status: "active", createdAt: at, balance: 0, frostauraLimit: 0, ownLimit: null, lastActivityAt: at });
    world.nodes.push({ id: uuidFor(`node:${slug}`), path: slug, slug, name, level: "organisation", createdAt: at, stage: null, ideaId: null, note: null });
    world.employees.push({
      id: uuidFor(`employee:${slug}:security`),
      kind: "employee",
      name: "Security reviewer",
      role: "Security reviewer",
      status: "idle",
      standing: "security-reviewer",
      scope: slug,
      reportsTo: null,
      briefedBy: null,
      jobDescription: { mandate: "Review every app before it is published, against the security checklist. Never changes code.", scope: slug, tools: ["read_file", "search", "git_diff", "load_skill", "remember"], services: [], monthlyCreditLimit: null, modelTier: "evaluate" },
      idle: { flagged: false, since: null, afterDays: 14 },
      currentRun: null,
      lastRunId: null,
      lastActiveAt: null,
      createdAt: at,
      releasedAt: null,
      memoryEntries: 0,
      brief: null,
    });
    const ownerUser = firstRun ? u : invitationFor(world, ownerEmail, ownerDisplayName);
    world.memberships.push({ id: newId(world, "membership"), userId: ownerUser.id, path: slug, role: "owner", grantedAt: at });
    world.changed.push("Me", "Tree", "Credits", "Operator");
    if (screened) {
      const operator = { id: u.id, email: u.email, displayName: u.displayName };
      world.operatorLog.unshift(
        { id: newId(world, "op"), organisation: slug, at, action: "organisation.provisioned", operator, detail: { ownerUserId: ownerUser.id, description: screened.description } },
        { id: newId(world, "op"), organisation: slug, at, action: "organisation.screened", operator, detail: { method: screened.method, result: "clear", line: null, reason: screened.reason, by: u.id, at } },
      );
    }
    return created({
      id: uuidFor(`org:${slug}`),
      slug,
      name,
      ownerEmail: ownerUser.email,
      ownerInvitationCode: ownerUser.invitation?.code ?? null,
      invitationExpiresAt: ownerUser.invitation?.expiresAt ?? null,
      invitationEmailed: false,
      nameCheck: { slug, source: "built-in", note: "No ops service is configured, so FrostAura's own subdomains were checked against the built-in list only." },
      screening: screened ? { method: screened.method, result: "clear", reason: screened.reason } : null,
    });
  },

  "GET members": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "admin");
    // Every grant that holds here: set at it or beneath it, and set above it on its chain (PPL-01).
    return ok(world.memberships.filter((m) => within(m.path, scope) || within(scope, m.path)).map((m) => memberView(world, m)));
  },

  "POST members/{membershipId}/invitation": (req, { world }) => {
    const m = world.memberships.find((x) => x.id === req.params.membershipId);
    if (!m) throw notFound("The membership");
    requireRole(world, m.path, m.role === "admin" ? "owner" : "admin");
    const u = world.users.find((x) => x.id === m.userId);
    if (!u) throw notFound("The member");
    if (u.passkeys > 0) throw conflict(`${u.displayName} already has a passkey, so they sign in with it and need no code.`);
    u.invitation = { code: code(world), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() };
    world.changed.push("Members");
    return ok({ member: memberView(world, m), invitationCode: u.invitation.code, expiresAt: u.invitation.expiresAt, emailed: false });
  },

  "POST members": (req, { world }) => {
    const role = parseRole(req.body.role);
    const scope = scopeOf(world, str(req.body, "scope"));
    const held = requireRole(world, scope, "admin");
    if (role === "owner") throw forbidden("An organisation has one Owner, the person it was provisioned for.");
    if (role === "admin" && held.role !== "owner") throw forbidden("Only the Owner manages Admins.");
    const email = (str(req.body, "email") ?? "").trim().toLowerCase();
    if (!isEmail(email)) throw invalid("Give a valid e-mail address.");
    const existing = world.users.find((x) => x.email === email);
    if (existing && world.memberships.some((m) => m.userId === existing.id && m.path === scope && m.role === "owner")) throw conflict("That person is the Owner here; their role is not changed by a grant.");
    const u = invitationFor(world, email, (str(req.body, "displayName") ?? "").trim());
    let m = world.memberships.find((x) => x.userId === u.id && x.path === scope);
    if (m) m.role = role;
    else {
      m = { id: newId(world, "membership"), userId: u.id, path: scope, role, grantedAt: new Date().toISOString() };
      world.memberships.push(m);
    }
    world.changed.push("Members");
    return ok({ member: memberView(world, m), invitationCode: u.passkeys === 0 ? (u.invitation?.code ?? null) : null, expiresAt: u.passkeys === 0 ? (u.invitation?.expiresAt ?? null) : null, emailed: false });
  },

  "DELETE members/{membershipId}": (req, { world }) => {
    const m = world.memberships.find((x) => x.id === req.params.membershipId);
    if (!m) throw notFound("The membership");
    requireRole(world, m.path, m.role === "admin" ? "owner" : "admin");
    if (m.role === "owner") throw forbidden("The Owner's role cannot be revoked.");
    world.memberships = world.memberships.filter((x) => x.id !== m.id);
    world.changed.push("Members", "Tree");
    return noContent();
  },

  "GET credits": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    return ok(creditsView(world, scope));
  },

  "POST credits/top-ups": (req, { world }) => {
    const u = me(world);
    if (!u.isOperator) throw forbidden("Credits are topped up by FrostAura (manual top-ups; there is no payment gateway).");
    const scope = scopeOf(world, str(req.body, "organisation"));
    if (scope.includes("/")) throw invalid("Top-ups are made to an organisation.");
    const credits = num(req.body, "credits") ?? 0;
    if (credits <= 0 || Math.round(credits * 1e6) !== credits * 1e6) throw invalid("A top-up is a positive number of credits, to at most six decimal places.");
    const key = str(req.body, "idempotencyKey") ?? "";
    const again = world.topUps.find((t) => t.idempotencyKey === key && key);
    if (again) return ok({ id: again.id, amount: again.credits, createdAt: again.at, organisation: again.organisation });
    const at = new Date().toISOString();
    const id = newId(world, "topup");
    const note = str(req.body, "note") ?? "";
    world.topUps.unshift({ id, organisation: scope, credits, note, at, by: u.displayName, byEmail: u.email, idempotencyKey: key });
    const org = organisation(world, scope);
    if (org) org.balance += credits;
    world.operatorLog.unshift({ id: newId(world, "op"), organisation: scope, at, action: "credits.top_up", operator: { id: u.id, email: u.email, displayName: u.displayName }, detail: { credits, note, entryId: id } });
    const requestId = str(req.body, "requestId");
    const request = requestId ? world.topUpRequests.find((r) => r.id === requestId && r.status === "open") : undefined;
    if (request) {
      // The answer is on the record as well as the top-up (OP-06): the Owner reads that their request was met.
      const closeNote = note.slice(0, 500);
      Object.assign(request, { status: "fulfilled", closedAt: at, topUpEntryId: id, closeNote });
      world.operatorLog.unshift({ id: newId(world, "op"), organisation: scope, at, action: "topup_request.fulfilled", operator: { id: u.id, email: u.email, displayName: u.displayName }, detail: { requestId: request.id, credits, note: closeNote } });
    }
    // A top-up restores at once: apps paused at the overdraft limit wake.
    if (org && org.balance > -(org.ownLimit !== null ? Math.min(org.ownLimit, org.frostauraLimit) : org.frostauraLimit)) {
      for (const a of world.apps) if (orgOf(a.path) === scope && a.pausedReason === "overdraft") Object.assign(a, { pausedReason: null, running: "asleep", status: "sleeping", health: "healthy", healthSummary: "Asleep; it wakes on the next visit." });
    }
    world.changed.push("Operator", "TopUpRequests", "Credits", "Tree", "App", "OperatorAccess", "Notifications");
    return ok({ id, amount: credits, createdAt: at, organisation: scope });
  },
});
