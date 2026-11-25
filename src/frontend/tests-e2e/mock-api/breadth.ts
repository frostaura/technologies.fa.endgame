/**
 * TEST ONLY. The breadth endpoints of the mock control plane: ask and the dashboard, versions and the
 * export, members, assistant access, notifications, ideas from the portfolio, top-up requests, the
 * overdraft and God mode — in the shapes the running control plane sent on 2026-11-25 (ARCH-004).
 * Every name and figure is invented.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export interface BreadthState {
  failAsk: boolean;
  dashboard: Record<string, Record<string, unknown>[]>;
  versions: Record<string, Record<string, unknown>[]>;
  members: Record<string, unknown>[];
  tokens: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  suggestions: Record<string, unknown>[];
  topUpRequests: Record<string, unknown>[];
  operatorOrgs: Record<string, unknown>[];
  topUps: Record<string, unknown>[];
  pricing: Record<string, unknown>;
  pricingHistory: Record<string, unknown>[];
}

export function breadthState(): BreadthState {
  return {
    failAsk: false,
    dashboard: {
      app1: [
        {
          id: "q1",
          question: "How many visits a day this week?",
          answer: "About two hundred a day, busiest on Tuesday.",
          sql: "select date_trunc('day', at) as day, count(*) as visits from requests group by 1 order by 1",
          chart: { kind: "line", x: "day", y: ["visits"], series: [{ name: "visits", points: [0, 1, 2, 3, 4].map((d) => ({ x: ago(60 * 24 * (5 - d)), y: [180, 240, 210, 190, 233][d] })) }] },
          columns: ["day", "visits"],
          rows: [{ day: ago(60 * 24), visits: 233 }],
          truncated: false,
          askedAt: ago(60 * 24 * 2),
          ranAt: now(),
          error: null,
        },
      ],
    },
    versions: {
      app1: [
        { commit: "9f1c2e7a4b5d6c8e0f1a2b3c4d5e6f708192a3b4", message: "Let members cancel a booking up to an hour before\n\nCancelBooking checks the hour in BookingsEndpoints.cs.", at: ago(60 * 3), author: { kind: "employee", id: "e2", name: "Lin" }, live: true },
        { commit: "8e0b1d6f3a4c5b7d9e0f1a2b3c4d5e6f70819203", message: "Record progress: cancel-booking is built and checked", at: ago(60 * 4), author: { kind: "factory", id: null, name: "The factory" }, live: false },
        { commit: "7d9a0c5e2f3b4a6c8d9e0f1a2b3c4d5e6f708192", message: "Changed the welcome wording", at: ago(60 * 24 * 9), author: { kind: "person", id: "u1", name: "Fixture Owner" }, live: false },
      ],
    },
    members: [
      { membershipId: "ms1", userId: "u1", email: "owner@example.test", displayName: "Fixture Owner", scope: "northwind", role: "owner", hasPasskey: true, grantedAt: ago(60 * 24 * 40) },
      { membershipId: "ms2", userId: "u2", email: "kit@example.test", displayName: "Kit", scope: "northwind", role: "builder", hasPasskey: true, grantedAt: ago(60 * 24 * 12) },
      { membershipId: "ms3", userId: "u3", email: "rae@example.test", displayName: "Rae", scope: "northwind/software", role: "viewer", hasPasskey: false, grantedAt: ago(60 * 5) },
    ],
    tokens: [{ id: "t1", name: "Laptop assistant", organisation: "northwind", role: "builder", prefix: "egp_7a1f", createdAt: ago(60 * 24 * 5), expiresAt: ago(-60 * 24 * 85), lastUsedAt: ago(30), revokedAt: null, active: true }],
    notifications: [
      { id: "n1", kind: "security.finding", severity: "urgent", title: "The security review found 1 problem", detail: "In \"Build: Booking desk\". Publishing waits until they are fixed.", scope: "northwind", subject: { kind: "run", id: "run-build" }, createdAt: ago(10), read: false, emailedAt: ago(10) },
      { id: "n2", kind: "verdict", severity: "info", title: "A verdict is waiting: Court ladder", detail: "The case against first. Three club apps already run ladders for free. Verdict: do not build.", scope: "northwind", subject: { kind: "idea", id: "idea-ladder" }, createdAt: ago(40), read: false, emailedAt: null },
      { id: "n3", kind: "budget.80", severity: "info", title: "Software has used 80% of its budget", detail: "800 of 1,000 credits this month.", scope: "northwind/software", subject: null, createdAt: ago(60 * 24), read: true, emailedAt: null },
    ],
    suggestions: [
      { id: "s1", scope: "northwind", runId: "run-suggest-0", title: "Court ladder league", idea: "A ladder league for club members to challenge one another, using the courts they already book.", gap: "Clubs run ladders on paper sheets by the door.", whyUs: "Northwind already runs the club's bookings and its members sign in there.", reuses: ["Booking desk", "Member sign-in"], status: "open", ideaId: null, createdAt: ago(60) },
      { id: "s2", scope: "northwind", runId: "run-suggest-0", title: "Kitchen stock alerts", idea: "Tell the kitchen when a staple is running low, from what Field notes records.", gap: "Stock runs out unnoticed.", whyUs: "Field notes already records the kitchen's deliveries.", reuses: ["Field notes"], status: "open", ideaId: null, createdAt: ago(60) },
    ],
    topUpRequests: [{ id: "tr1", organisation: "northwind", organisationName: "Northwind", credits: 2000, note: "For the December builds", status: "open", requestedBy: "u1", requestedByEmail: "owner@example.test", requestedAt: ago(90), closedAt: null, closeNote: null, topUpEntryId: null }],
    operatorOrgs: [
      { id: "org1", slug: "northwind", name: "Northwind", status: "active", createdAt: ago(60 * 24 * 60), balance: 9548, standing: "in-credit", overdraft: { frostauraLimit: 3000, ownLimit: 1000, effective: 1000 }, apps: 3, lastActivityAt: ago(2), openTopUpRequests: 1 },
      { id: "org2", slug: "harbour", name: "Harbour Co", status: "active", createdAt: ago(60 * 24 * 9), balance: -420, standing: "overdrawn", overdraft: { frostauraLimit: 1000, ownLimit: null, effective: 1000 }, apps: 1, lastActivityAt: ago(60 * 5), openTopUpRequests: 0 },
    ],
    topUps: [{ id: "tu1", organisation: "northwind", organisationName: "Northwind", credits: 10000, note: "Added by FrostAura", at: ago(60 * 24 * 10), by: "op-u1", byEmail: "support@example.test" }],
    pricing: { creditsPerUsd: 100, margin: 1.2, hosting: { usdPerAwakeHour: 0.002, usdPerGbHourMemory: 0.004, usdPerGbMonthStorage: 0.1, usdPerMillionRequests: 0.2 }, defaultAppModelMonthlyCredits: 500 },
    pricingHistory: [{ at: ago(60 * 24 * 3), by: "op-u1", byEmail: "support@example.test", before: { margin: 1.0 }, after: { margin: 1.2 } }],
  };
}

type Send = (res: ServerResponse, status: number, body?: unknown) => void;
type Problem = (res: ServerResponse, status: number, title: string, detail?: string, code?: string) => void;

interface Ctx {
  b: BreadthState;
  isOperator: boolean;
  viewerRole: string;
  orgSlug: string | null;
  credits: () => Record<string, unknown>;
  setOwnLimit: (scope: string, credits: number) => void;
}

/** Answers a breadth request, or returns false when the path is not one of these. */
export async function handleBreadth(req: IncomingMessage, res: ServerResponse, path: string, method: string, url: URL, body: unknown, ctx: Ctx, send: Send, problem: Problem): Promise<boolean> {
  const b = ctx.b;
  const B = (body ?? {}) as Record<string, unknown>;
  let m: RegExpMatchArray | null;

  // Ask about this app ---------------------------------------------------------------------
  if ((m = path.match(/^\/api\/apps\/([^/]+)\/ask\/estimate$/)) && method === "POST") {
    send(res, 200, { credits: 0.42, basis: "Up to 3 model calls (writing the query, one repair that is never charged, and the answer), each priced at the most it could cost." });
    return true;
  }
  if ((m = path.match(/^\/api\/apps\/([^/]+)\/ask$/)) && method === "POST") {
    const question = String(B.question ?? "");
    if (b.failAsk || /delete|drop/i.test(question)) {
      problem(res, 422, "That question could not be turned into a safe query", "Try asking it another way.", "ask_unanswerable");
      return true;
    }
    send(res, 200, {
      question,
      answer: "Tuesday and Thursday evenings are the busiest.",
      chart: { kind: "bar", x: "day", y: ["bookings"], series: [{ name: "bookings", points: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x, i) => ({ x, y: [52, 96, 61, 88, 40, 70, 34][i] })) }] },
      sql: "select to_char(at, 'Dy') as day, count(*) as bookings from events where name = 'booking.made' group by 1",
      columns: ["day", "bookings"],
      rows: [{ day: "Tue", bookings: 96 }],
      truncated: false,
      credits: { estimate: 0.42, charged: 0.12 },
    });
    return true;
  }
  if ((m = path.match(/^\/api\/apps\/([^/]+)\/dashboard(?:\/([^/]+))?$/))) {
    const list = (b.dashboard[m[1] as string] ??= []);
    if (method === "GET") send(res, 200, list);
    else if (method === "POST") {
      const saved = { id: `q-${randomBytes(3).toString("hex")}`, question: B.question, answer: B.answer ?? "", sql: B.sql, chart: B.chart ?? null, columns: ["day", "bookings"], rows: [{ day: "Tue", bookings: 96 }], truncated: false, askedAt: now(), ranAt: now(), error: null };
      list.push(saved);
      send(res, 201, saved);
    } else if (method === "DELETE") {
      const i = list.findIndex((q) => q.id === m?.[2]);
      if (i >= 0) list.splice(i, 1);
      send(res, 204);
    }
    return true;
  }

  // Versions and export ----------------------------------------------------------------------
  if ((m = path.match(/^\/api\/apps\/([^/]+)\/versions$/)) && method === "GET") {
    const list = b.versions[m[1] as string] ?? [];
    const limit = Number(url.searchParams.get("limit") ?? 50);
    send(res, 200, { appId: m[1], live: list.find((v) => v.live)?.commit ?? null, versions: list.slice(0, limit), hasMore: list.length > limit });
    return true;
  }
  if ((m = path.match(/^\/api\/apps\/([^/]+)\/versions\/([^/]+)\/restore$/)) && method === "POST") {
    const list = (b.versions[m[1] as string] ??= []);
    const from = list.find((v) => v.commit === m?.[2]);
    if (!from) {
      problem(res, 404, "Not found", "No such version.");
      return true;
    }
    for (const v of list) v.live = false;
    const version = { commit: randomBytes(20).toString("hex"), message: `Restore “${String(from.message).split("\n")[0]}”`, at: now(), author: { kind: "person", id: "u1", name: "Fixture Owner" }, live: true };
    list.unshift(version);
    send(res, 200, { version, published: true, madePrivate: false, publishError: null });
    return true;
  }
  if ((m = path.match(/^\/api\/apps\/([^/]+)\/export$/)) && method === "GET") {
    if (ctx.viewerRole !== "owner") {
      problem(res, 403, "Forbidden", "Only the Owner can export an app.");
      return true;
    }
    res.writeHead(200, { "content-type": "application/gzip", "content-disposition": 'attachment; filename="desk-export.tar.gz"' }).end(Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
    return true;
  }

  // People -----------------------------------------------------------------------------------
  if (path === "/api/members" && method === "GET") {
    if (ctx.viewerRole !== "owner" && ctx.viewerRole !== "admin") problem(res, 403, "Forbidden", "This needs the admin role here.");
    else send(res, 200, b.members);
    return true;
  }
  if (path === "/api/members" && method === "POST") {
    const email = String(B.email ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      problem(res, 400, "That is not an e-mail address");
      return true;
    }
    const member = { membershipId: `ms-${randomBytes(3).toString("hex")}`, userId: `u-${randomBytes(3).toString("hex")}`, email, displayName: B.displayName ?? email, scope: B.scope, role: B.role, hasPasskey: false, grantedAt: now() };
    b.members.push(member);
    send(res, 201, { member, invitationCode: randomBytes(12).toString("hex"), expiresAt: ago(-60 * 24 * 14), emailed: false });
    return true;
  }
  if ((m = path.match(/^\/api\/members\/([^/]+)$/))) {
    const member = b.members.find((x) => x.membershipId === m?.[1]);
    if (!member) {
      problem(res, 404, "Not found");
      return true;
    }
    if (method === "PATCH") {
      if (B.role === "admin" && ctx.viewerRole !== "owner") {
        await new Promise((r) => setTimeout(r, 300));
        problem(res, 403, "Forbidden", "Only the Owner grants the Admin role.");
        return true;
      }
      member.role = B.role;
      send(res, 200, { member, invitationCode: null, expiresAt: null, emailed: false });
    } else if (method === "DELETE") {
      b.members.splice(b.members.indexOf(member), 1);
      send(res, 204);
    }
    return true;
  }

  // AI assistant access ------------------------------------------------------------------------
  if (path === "/api/tokens" && method === "GET") {
    send(res, 200, b.tokens);
    return true;
  }
  if (path === "/api/tokens" && method === "POST") {
    const accessToken = { id: `t-${randomBytes(3).toString("hex")}`, name: B.name, organisation: B.organisation, role: B.role ?? "admin", prefix: "egp_9c2d", createdAt: now(), expiresAt: B.expiresInDays ? ago(-60 * 24 * Number(B.expiresInDays)) : null, lastUsedAt: null, revokedAt: null, active: true };
    b.tokens.unshift(accessToken);
    send(res, 201, { token: `egp_${randomBytes(24).toString("hex")}`, accessToken });
    return true;
  }
  if ((m = path.match(/^\/api\/tokens\/([^/]+)$/)) && method === "DELETE") {
    const t = b.tokens.find((x) => x.id === m?.[1]);
    if (!t) {
      problem(res, 404, "Not found");
      return true;
    }
    Object.assign(t, { active: false, revokedAt: now() });
    send(res, 200, t);
    return true;
  }

  // Notifications ------------------------------------------------------------------------------
  if (path === "/api/notifications" && method === "GET") {
    const admin = ctx.viewerRole === "owner" || ctx.viewerRole === "admin";
    const list = admin ? b.notifications : [];
    send(res, 200, { organisation: ctx.orgSlug ?? "", unread: list.filter((n) => !n.read).length, notifications: list });
    return true;
  }
  if ((m = path.match(/^\/api\/notifications\/([^/]+)\/read$/)) && method === "POST") {
    const n = b.notifications.find((x) => x.id === m?.[1]);
    if (n) n.read = true;
    send(res, 204);
    return true;
  }
  if (path === "/api/notifications/read-all" && method === "POST") {
    const marked = b.notifications.filter((n) => !n.read).length;
    for (const n of b.notifications) n.read = true;
    send(res, 200, { marked });
    return true;
  }

  // Ideas from the portfolio ---------------------------------------------------------------------
  if (path === "/api/ideas/suggestions/estimate" && method === "POST") {
    send(res, 200, { credits: 83.57, basis: "Up to 6 steps reading what the organisation holds, each priced at the most it could cost." });
    return true;
  }
  if (path === "/api/ideas/suggestions" && method === "POST") {
    const run = { id: "run-suggest-1", kind: "suggest", title: "Ideas from the portfolio", scope: B.scope, status: "queued", startedAt: now(), finishedAt: null, lastSeq: 2, ideaId: null, estimateCredits: 84, spentCredits: 0, employeeId: null, conversationId: null, budgetExhausted: false, outcome: null, summary: null, createdAt: now() };
    send(res, 201, { run, estimate: { credits: 83.57, basis: "suggest" } });
    return true;
  }
  if (path === "/api/ideas/suggestions" && method === "GET") {
    send(res, 200, b.suggestions);
    return true;
  }
  if ((m = path.match(/^\/api\/ideas\/suggestions\/([^/]+)\/(take|dismiss)$/)) && method === "POST") {
    const x = b.suggestions.find((s) => s.id === m?.[1]);
    if (!x || x.status !== "open") {
      problem(res, 409, "Conflict", "This suggestion was already taken or set aside.");
      return true;
    }
    if (m[2] === "dismiss") {
      x.status = "dismissed";
      send(res, 200, x);
      return true;
    }
    x.status = "taken";
    return false; // The server turns it into an idea with its own fixtures.
  }

  // Top-ups and the overdraft --------------------------------------------------------------------
  if (path === "/api/credits/top-up-requests" && method === "GET") {
    send(res, 200, b.topUpRequests);
    return true;
  }
  if (path === "/api/credits/top-up-requests" && method === "POST") {
    const r = { id: `tr-${randomBytes(3).toString("hex")}`, organisation: ctx.orgSlug, organisationName: "Northwind", credits: Number(B.credits), note: B.note ?? "", status: "open", requestedBy: "u1", requestedByEmail: "owner@example.test", requestedAt: now(), closedAt: null, closeNote: null, topUpEntryId: null };
    b.topUpRequests.unshift(r);
    send(res, 201, r);
    return true;
  }
  if (path === "/api/credits/overdraft" && method === "PUT") {
    const credits = Number(B.credits);
    const c = ctx.credits() as { overdraft: { frostauraLimit: number } };
    if (credits > c.overdraft.frostauraLimit) {
      problem(res, 400, "Too deep", `The deepest FrostAura allows is ${c.overdraft.frostauraLimit} below zero.`);
      return true;
    }
    ctx.setOwnLimit(String(B.scope), credits);
    send(res, 200, ctx.credits());
    return true;
  }

  // God mode ---------------------------------------------------------------------------------------
  if (path.startsWith("/api/operator/") || (path === "/api/credits/top-ups" && method === "POST") || (path === "/api/organisations" && method === "POST" && B.ownerEmail)) {
    if (!ctx.isOperator) {
      problem(res, 403, "Forbidden", "Only FrostAura operators may do this.");
      return true;
    }
  }
  if (path === "/api/operator/organisations" && method === "GET") {
    send(res, 200, b.operatorOrgs);
    return true;
  }
  if ((m = path.match(/^\/api\/operator\/organisations\/([^/]+)\/enter$/)) && method === "POST") {
    send(res, 200, { organisationId: "org1", organisation: m[1], role: "admin", enteredAt: now(), logged: "in the organisation's operator log, which its Owner reads" });
    return true;
  }
  if ((m = path.match(/^\/api\/operator\/organisations\/([^/]+)\/overdraft$/)) && method === "PUT") {
    const o = b.operatorOrgs.find((x) => x.slug === m?.[1]) as { overdraft: { frostauraLimit: number; effective: number; ownLimit: number | null } } | undefined;
    if (!o) {
      problem(res, 404, "Not found");
      return true;
    }
    o.overdraft.frostauraLimit = Number(B.credits);
    o.overdraft.effective = Math.min(o.overdraft.frostauraLimit, o.overdraft.ownLimit ?? Number.POSITIVE_INFINITY);
    send(res, 200, o);
    return true;
  }
  if (path === "/api/operator/top-ups" && method === "GET") {
    send(res, 200, b.topUps);
    return true;
  }
  if (path === "/api/credits/top-ups" && method === "POST") {
    const named = b.operatorOrgs.find((x) => x.slug === B.organisation) as { name?: string } | undefined;
    const entry = { id: `tu-${randomBytes(3).toString("hex")}`, organisation: B.organisation, organisationName: named?.name ?? B.organisation, credits: Number(B.credits), note: B.note, at: now(), by: "op-u1", byEmail: "support@example.test" };
    b.topUps.unshift(entry);
    const r = b.topUpRequests.find((x) => x.id === B.requestId);
    if (r) Object.assign(r, { status: "fulfilled", closedAt: now(), topUpEntryId: entry.id });
    const o = b.operatorOrgs.find((x) => x.slug === B.organisation) as { balance: number; openTopUpRequests: number } | undefined;
    if (o) {
      o.balance += Number(B.credits);
      if (r) o.openTopUpRequests = Math.max(0, o.openTopUpRequests - 1);
    }
    send(res, 200, { id: entry.id, amount: entry.credits, createdAt: entry.at, organisation: B.organisation });
    return true;
  }
  if (path === "/api/operator/top-up-requests" && method === "GET") {
    send(res, 200, b.topUpRequests);
    return true;
  }
  if ((m = path.match(/^\/api\/operator\/top-up-requests\/([^/]+)\/close$/)) && method === "POST") {
    const r = b.topUpRequests.find((x) => x.id === m?.[1]);
    if (!r) {
      problem(res, 404, "Not found");
      return true;
    }
    Object.assign(r, { status: B.status, closedAt: now(), closeNote: B.note ?? null });
    send(res, 200, r);
    return true;
  }
  if (path === "/api/operator/pricing" && method === "GET") {
    send(res, 200, { pricing: b.pricing, source: "stored", updatedAt: b.pricingHistory[0]?.at ?? null, updatedBy: "op-u1", history: b.pricingHistory });
    return true;
  }
  if (path === "/api/operator/pricing" && method === "PUT") {
    if (Number(B.margin) < 1) {
      problem(res, 400, "Invalid", "The margin is at least 1.0.");
      return true;
    }
    b.pricingHistory.unshift({ at: now(), by: "op-u1", byEmail: "support@example.test", before: b.pricing, after: B });
    b.pricing = B;
    send(res, 200, { pricing: b.pricing, source: "stored", updatedAt: now(), updatedBy: "op-u1", history: b.pricingHistory });
    return true;
  }
  if (path === "/api/organisations" && method === "POST" && B.ownerEmail) {
    const slug = String(B.slug ?? "");
    if (String(B.description ?? "").trim().length < 10) {
      problem(res, 400, "Invalid request", "Say what the organisation does, in 10 to 1000 characters: it is screened against FrostAura's red lines before it is set up.", "invalid_request");
      return true;
    }
    if (slug === "www" || slug === "endgame") {
      problem(res, 409, "That name is reserved", `"${slug}" is one of FrostAura's own addresses.`, "reserved_name");
      return true;
    }
    b.operatorOrgs.push({ id: `org-${slug}`, slug, name: B.name, status: "active", createdAt: now(), balance: 0, standing: "in-credit", overdraft: { frostauraLimit: 0, ownLimit: null, effective: 0 }, apps: 0, lastActivityAt: null, openTopUpRequests: 0 });
    send(res, 201, { id: `org-${slug}`, slug, name: B.name, ownerEmail: B.ownerEmail, ownerInvitationCode: randomBytes(12).toString("hex"), invitationExpiresAt: ago(-60 * 24 * 14), invitationEmailed: false, nameCheck: { slug, source: "built-in", note: null }, screening: { method: "model", result: "clear", reason: "It makes garden tools; no red line is crossed." } });
    return true;
  }

  void req;
  return false;
}
