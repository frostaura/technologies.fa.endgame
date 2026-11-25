import type { Pricing } from "@/store/types";
import { requireOperator, scopeOf } from "../access";
import { area, conflict, invalid, notFound, num, ok, str } from "../http";
import { operatorOrganisationView } from "../views";
import { newId, organisation, orgOf, type World } from "../world";

/** `OperatorEndpoints.cs`: God mode — every organisation, entering one, overdrafts, top-ups, requests, prices. */

function log(world: World, org: string, action: string, detail: Record<string, unknown>) {
  const u = requireOperator(world);
  world.operatorLog.unshift({ id: newId(world, "op"), organisation: org, at: new Date().toISOString(), action, operator: { id: u.id, email: u.email, displayName: u.displayName }, detail });
  world.changed.push("OperatorAccess");
}

area("OperatorEndpoints", {
  "GET operator/organisations": (_req, { world }) => {
    requireOperator(world);
    return ok(world.organisations.map((o) => operatorOrganisationView(world, o.slug)));
  },

  "POST operator/organisations/{slug}/enter": (req, { world }) => {
    requireOperator(world);
    const slug = req.params.slug ?? "";
    if (slug.includes("/")) throw invalid("Name an organisation by its slug.");
    const o = organisation(world, scopeOf(world, slug));
    if (!o) throw notFound(`The scope '${slug}'`);
    if (!world.entered.includes(slug)) world.entered.push(slug);
    log(world, slug, "organisation.entered", { scope: slug });
    return ok({ organisationId: o.id, organisation: o.slug, role: "admin", enteredAt: new Date().toISOString(), logged: "This entry is in the organisation's operator log, which its Owner reads." });
  },

  "PUT operator/organisations/{slug}/overdraft": (req, { world }) => {
    requireOperator(world);
    const o = organisation(world, scopeOf(world, req.params.slug));
    if (!o) throw notFound(`The scope '${req.params.slug ?? ""}'`);
    const credits = num(req.body, "credits") ?? -1;
    if (credits < 0) throw invalid("'overdraft_limit' cannot be negative.");
    o.frostauraLimit = credits;
    if (o.ownLimit !== null && o.ownLimit > credits) o.ownLimit = credits;
    log(world, o.slug, "overdraft.set", { credits });
    world.changed.push("Operator", "Credits");
    return ok(operatorOrganisationView(world, o.slug));
  },

  "GET operator/top-ups": (req, { world }) => {
    requireOperator(world);
    const org = req.query.get("organisation");
    return ok(world.topUps.filter((t) => !org || t.organisation === org).slice(0, 500).map((t) => ({ id: t.id, organisation: t.organisation, organisationName: organisation(world, t.organisation)?.name ?? t.organisation, credits: t.credits, note: t.note, at: t.at, by: t.by, byEmail: t.byEmail })));
  },

  "GET operator/top-up-requests": (req, { world }) => {
    requireOperator(world);
    const status = req.query.get("status");
    if (status && !["open", "fulfilled", "declined"].includes(status)) throw invalid("status is open, fulfilled or declined.");
    return ok(world.topUpRequests.filter((r) => !status || r.status === status));
  },

  "POST operator/top-up-requests/{id}/close": (req, { world }) => {
    requireOperator(world);
    const status = str(req.body, "status");
    if (status !== "fulfilled" && status !== "declined") throw invalid("status is fulfilled or declined.");
    const r = world.topUpRequests.find((x) => x.id === req.params.id);
    if (!r) throw notFound("The top-up request");
    if (r.status !== "open") throw conflict(`This request is already ${r.status}.`);
    const entry = str(req.body, "topUpEntryId");
    if (entry && !world.topUps.some((t) => t.id === entry && t.organisation === r.organisation)) throw invalid("topUpEntryId names no top-up of this organisation.");
    const note = str(req.body, "note") ?? null;
    Object.assign(r, { status, closedAt: new Date().toISOString(), closeNote: note, topUpEntryId: entry ?? null });
    log(world, orgOf(r.organisation), `topup_request.${status}`, { requestId: r.id, credits: r.credits, note });
    world.changed.push("TopUpRequests", "Operator");
    return ok(r);
  },

  "GET operator/pricing": (_req, { world }) => {
    requireOperator(world);
    return ok(world.pricing);
  },

  "PUT operator/pricing": (req, { world }) => {
    const u = requireOperator(world);
    const p = req.body as unknown as Pricing;
    const faults: string[] = [];
    if (!(typeof p.creditsPerUsd === "number" && p.creditsPerUsd > 0)) faults.push("Credits:CreditsPerUsd must be positive.");
    if (!(typeof p.margin === "number" && p.margin >= 1)) faults.push("Credits:Margin is a factor on cost; 1.0 is no margin, and below 1.0 would sell work for less than it costs.");
    if (!p.hosting || typeof p.hosting !== "object") faults.push("hosting holds the four hosting rates.");
    else if (Object.values(p.hosting).some((v) => typeof v !== "number" || v < 0)) faults.push("Hosting rates cannot be negative.");
    if (!(typeof p.defaultAppModelMonthlyCredits === "number" && p.defaultAppModelMonthlyCredits >= 0)) faults.push("defaultAppModelMonthlyCredits cannot be negative.");
    if (faults.length) throw invalid(faults.join(" "));
    const at = new Date().toISOString();
    world.pricing = { pricing: p, source: "stored", updatedAt: at, updatedBy: u.displayName, history: [{ at, by: u.displayName, byEmail: u.email, before: world.pricing.pricing, after: p }, ...world.pricing.history] };
    world.changed.push("Pricing");
    return ok(world.pricing);
  },
});
