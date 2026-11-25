/**
 * TEST ONLY. The breadth endpoints' answers, in the shapes a running control plane sent on
 * 2026-11-25 (read from `/api/notifications`, `/api/apps/{id}/versions`, `/api/operator/*`,
 * `/api/members`, `/api/credits`) and, where nothing could be read without writing, from the
 * control plane's own records (`BreadthEndpoints.cs`, `AskService.cs`). Content is invented.
 */

export const NOTIFICATIONS = {
  organisation: "acme",
  unread: 2,
  notifications: [
    {
      id: "n1",
      kind: "security.finding",
      severity: "urgent",
      title: "The security review found 1 problem",
      detail: "In \"Build: Ledger\". Publishing waits until they are fixed.",
      scope: "acme",
      subject: { kind: "run", id: "r9" },
      createdAt: "2026-11-25T02:08:25Z",
      read: false,
      emailedAt: "2026-11-25T02:08:26Z",
    },
    {
      id: "n2",
      kind: "verdict",
      severity: "info",
      title: "A verdict is waiting: A personal health trends app. A device or script posts my health readings such as weight, resting heart rate and slee...",
      detail: "The case against first. This idea is three commodities bolted together. Each one is already solved, free. Verdict: do not build.",
      scope: "acme",
      subject: { kind: "idea", id: "i1" },
      createdAt: "2026-11-25T02:08:20Z",
      read: false,
      emailedAt: null,
    },
    { id: "n3", kind: "budget.80", severity: "info", title: "Tools has used 80% of its budget", detail: "800 of 1,000 credits this month.", scope: "acme/tools", subject: null, createdAt: "2026-11-20T10:00:00Z", read: true, emailedAt: null },
  ],
};

export const VERSIONS = {
  appId: "a1",
  live: "f2a84f83c1f6d2852e9f62f57720ec931052273d",
  versions: [
    { commit: "f2a84f83c1f6d2852e9f62f57720ec931052273d", message: "Fix ownership check on book status update\n\nThe updateBookStatus endpoint previously allowed any signed-in user.", at: "2026-11-25T01:56:57Z", author: { kind: "employee", id: "e1", name: "Theo" }, live: true },
    { commit: "286e261c088fd1f147ecaaed4df9e1b8a953ef88", message: "Record progress: docs-and-shell is built and checked", at: "2026-11-25T01:53:06Z", author: { kind: "factory", id: null, name: "The factory" }, live: false },
    { commit: "0a38497783f51c9f0e344298c429e72d336b8814", message: "frontend-books: replace the Notes screens with the Books screens\n\nweb/src/books/ replaces web/src/notes/.", at: "2026-11-25T01:48:33Z", author: { kind: "employee", id: "e1", name: "Theo" }, live: false },
    { commit: "87213d5c3d55b42f383cebb2dab910528b41c00b", message: "Start from the app kit", at: "2026-11-25T01:40:07Z", author: { kind: "person", id: null, name: "Endgame" }, live: false },
  ],
  hasMore: true,
};

export const ASK_ESTIMATE = { credits: 0.42, basis: "Up to 3 model calls (writing the query, one repair that is never charged, and the answer), each priced at the most it could cost." };

export const ASK_ANSWER = {
  question: "Which days are busiest?",
  answer: "Tuesday and Thursday are the busiest days.",
  chart: { kind: "bar", x: "day", y: ["visits"], series: [{ name: "visits", points: [{ x: "Mon", y: 52 }, { x: "Tue", y: 96 }, { x: "Thu", y: 88 }] }] },
  sql: "select to_char(at, 'Dy') as day, count(*) as visits from requests group by 1",
  columns: ["day", "visits"],
  rows: [
    { day: "Mon", visits: 52 },
    { day: "Tue", visits: 96 },
    { day: "Thu", visits: 88 },
  ],
  truncated: false,
  credits: { estimate: 0.42, charged: 0.11 },
};

export const SAVED = {
  id: "q1",
  question: "How many visits a day?",
  answer: "About forty a day this week.",
  sql: "select date_trunc('day', at) as day, count(*) as visits from requests group by 1 order by 1",
  chart: { kind: "line", x: "day", y: ["visits"], series: [{ name: "visits", points: [{ x: "2026-11-20T00:00:00Z", y: 30 }, { x: "2026-11-21T00:00:00Z", y: 44 }] }] },
  columns: ["day", "visits"],
  rows: [{ day: "2026-11-20T00:00:00Z", visits: 30 }],
  truncated: false,
  askedAt: "2026-11-24T10:00:00Z",
  ranAt: "2026-11-25T02:00:00Z",
  error: null,
  technical: null,
};

export const MEMBERS = [
  { membershipId: "ms1", userId: "u1", email: "o@example.test", displayName: "Owner", scope: "acme", role: "owner", hasPasskey: true, grantedAt: "2026-11-24T23:41:13Z" },
  { membershipId: "ms2", userId: "u2", email: "kit@example.test", displayName: "Kit", scope: "acme/tools", role: "builder", hasPasskey: false, grantedAt: "2026-11-25T01:00:00Z" },
];

export const TOKENS = [
  { id: "t1", name: "Laptop assistant", organisation: "acme", role: "builder", prefix: "egp_ab12", createdAt: "2026-11-20T10:00:00Z", expiresAt: "2027-02-18T10:00:00Z", lastUsedAt: "2026-11-25T01:00:00Z", revokedAt: null, active: true },
  { id: "t2", name: "Old script", organisation: "acme", role: "viewer", prefix: "egp_cd34", createdAt: "2026-10-01T10:00:00Z", expiresAt: null, lastUsedAt: null, revokedAt: "2026-11-01T10:00:00Z", active: false },
];

export const SUGGESTIONS = [
  { id: "s1", scope: "acme", runId: "r7", title: "Court ladder", idea: "A ladder for club members to challenge each other.", gap: "Clubs track ladders on paper.", whyUs: "Acme already runs bookings for the club.", reuses: ["Bookings", "Member sign-in"], status: "open", ideaId: null, createdAt: "2026-11-25T01:00:00Z" },
  { id: "s2", scope: "acme", runId: "r7", title: "Coach notes", idea: "Notes a coach keeps per player.", gap: "Coaches use spreadsheets.", whyUs: "The members are already here.", reuses: [], status: "dismissed", ideaId: null, createdAt: "2026-11-25T01:00:00Z" },
];

export const TOP_UP_REQUESTS = [
  { id: "tr1", organisation: "acme", organisationName: "Acme", credits: 2000, note: "For the December build", status: "open", requestedBy: "u1", requestedByEmail: "o@example.test", requestedAt: "2026-11-25T01:00:00Z", closedAt: null, closeNote: null, topUpEntryId: null },
];

export const OPERATOR_ORGS = [
  { id: "o1", slug: "acme", name: "Acme", status: "active", createdAt: "2026-11-24T23:41:13Z", balance: 4967.01, standing: "in-credit", overdraft: { frostauraLimit: 0, ownLimit: null, effective: 0 }, apps: 1, lastActivityAt: "2026-11-25T02:06:34Z", openTopUpRequests: 1 },
];

export const OPERATOR_TOP_UPS = [{ id: "tu1", organisation: "acme", credits: 5000, note: "Opening balance", at: "2026-11-24T23:41:45Z", by: "op1", byEmail: "operator@example.test" }];

export const PRICING = {
  pricing: { creditsPerUsd: 100, margin: 1.0, hosting: { usdPerAwakeHour: 0.002, usdPerGbHourMemory: 0.004, usdPerGbMonthStorage: 0.1, usdPerMillionRequests: 0.2 }, defaultAppModelMonthlyCredits: 500 },
  source: "defaults",
  updatedAt: null,
  updatedBy: null,
  history: [],
};

export const ONTOLOGY_APP = {
  scope: "acme/tools/ledger/web",
  generatedAt: "2026-11-25T02:11:14Z",
  nodes: [
    { id: "app:a1", type: "app", name: "Ledger web", scope: "acme/tools/ledger/web", status: "running", attributes: { version: "f2a84f8" } },
    { id: "service:telemetry", type: "service", name: "telemetry", scope: null, status: null, attributes: null },
    { id: "service:identity", type: "service", name: "identity", scope: null, status: null, attributes: null },
  ],
  edges: [
    { from: "app:a1", to: "service:telemetry", type: "depends-on", label: null },
    { from: "app:a1", to: "service:identity", type: "depends-on", label: null },
    { from: "app:a1", to: "service:telemetry", type: "data-flows-to", label: "operational telemetry" },
  ],
  views: { "org-chart": ["owns", "works-on", "reports-to"], "data-flow": ["depends-on", "data-flows-to"] },
};
