import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import { check, type Guard } from "@/lib/guards";
import * as g from "./guards";
import type {
  ChangeEstimate,
  ConversationEstimate,
  RetryEstimate,
  AccessToken,
  AppVersions,
  AskAnswer,
  AskChart,
  AskEstimate,
  Member,
  RoleRevoked,
  MemberRole,
  NotificationFeed,
  OperatorEntry,
  OperatorOrganisation,
  OperatorTopUp,
  Pricing,
  PricingView,
  RestoreResult,
  SavedQuestion,
  Suggestion,
  SuggestionsStarted,
  TopUpRequest,
  Autonomy,
  Employee,
  EmployeeDetail,
  EmployeePatch,
  Hire,
  HireEdit,
  HireProposalRequest,
  MemoryChange,
  MemoryEntry,
  MemoryKind,
  Ontology,
  RecurringRole,
  RuleSetRequest,
  TaskItem,
  AppDetail,
  AppSettingsUpdate,
  AppShare,
  AuthOptions,
  ConversationCapabilities,
  ConversationHistory,
  ConversationRequest,
  CreateIdeaRequest,
  Credits,
  DecisionChoice,
  Idea,
  IdeaEstimate,
  Me,
  OperatorAction,
  OrganisationRef,
  Run,
  SecretList,
  SystemStatus,
  Tree,
} from "./types";

export type * from "./types";

/**
 * The console's one API. Absolute base URL on purpose: the browser resolves a relative one
 * against the page, but `fetchBaseQuery` builds a `Request` first, and outside a browser
 * (the unit tests) a relative `Request` URL throws.
 */
const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
export let API_BASE = `${origin}/api`;

/**
 * The transport seam: where the console's requests go. In the product it is the browser's own
 * `fetch` against this origin, unchanged. The demo build (ARCH-009) installs an in-browser fake
 * of the control plane here before the first request, and nothing else in the console knows.
 */
export interface Transport {
  /** The API's base address; every request and the run stream are built from it. */
  base: string;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /**
   * The platform's own address as people outside reach it, for every address the console prints
   * (an assistant's MCP address, an app's address, a new organisation's host). Unset in the
   * product, where it is the page's own origin; the demo names its world's host.
   */
  publicOrigin?: string;
}

const transport: Transport = { base: API_BASE, fetch: (input, init) => fetch(input, init) };

/** The platform's origin for printed addresses: `https://endgame.example` in the demo, this page's origin in the product. */
export function platformOrigin(): string {
  if (transport.publicOrigin) return transport.publicOrigin;
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** The platform's host (no scheme), as a new organisation's address shows it. */
export function platformHost(): string {
  const o = platformOrigin();
  return o.replace(/^[a-z]+:\/\//i, "");
}

/** Replace the transport (the demo build only). Call it before the first request is made. */
export function installTransport(next: Partial<Transport>) {
  Object.assign(transport, next);
  API_BASE = transport.base;
}

/** A request through the transport, for the writes that bypass RTK Query (`store/sensitive.ts`). */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return transport.fetch(input, init);
}

/** What an endpoint's answer is checked against before it reaches the store, and what it is called on the page. */
export interface Checked {
  guard?: Guard<unknown>;
  what?: string;
}

const raw: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = (args, api, extra) =>
  fetchBaseQuery({ baseUrl: transport.base, credentials: "same-origin", fetchFn: transport.fetch })(args, api, extra);

/**
 * Every answer passes its endpoint's guard (`store/guards.ts`). An answer in a shape the screen does
 * not understand becomes a failed read naming the field — the page records it and offers a retry —
 * instead of a crash in whatever component first touched it.
 */
const checkedQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError, Checked> = async (args, api, extra) => {
  const result = await raw(args, api, {});
  if (result.error || !extra?.guard) return result;
  const checked = check(extra.guard, result.data);
  if (checked.ok) return { data: checked.value, meta: result.meta };
  return {
    error: { status: "CUSTOM_ERROR", error: `Endgame sent ${extra.what ?? "an answer"} in a shape this screen does not understand: ${checked.problem}.`, data: result.data },
    meta: result.meta,
  };
};

const guarded = <T>(guard: Guard<T>, what: string): Checked => ({ guard: guard as Guard<unknown>, what });

export const api = createApi({
  reducerPath: "api",
  baseQuery: checkedQuery,
  tagTypes: [
    "Me",
    "Tree",
    "Idea",
    "Run",
    "App",
    "Credits",
    "Conversation",
    "Secrets",
    "Shares",
    "OperatorAccess",
    "Employee",
    "Memory",
    "Hire",
    "Autonomy",
    "Ontology",
    "Tasks",
    "Dashboard",
    "Versions",
    "Members",
    "Tokens",
    "Notifications",
    "Suggestions",
    "TopUpRequests",
    "Operator",
    "Pricing",
  ],
  endpoints: (build) => ({
    // Session -----------------------------------------------------------------------------
    getMe: build.query<Me, undefined>({ query: () => "me", providesTags: ["Me"], extraOptions: guarded(g.meGuard, "your session") }),
    getAuthOptions: build.query<AuthOptions, undefined>({ query: () => "auth/options" }),
    passkeyRegisterOptions: build.mutation<{ publicKey: Record<string, unknown> }, { displayName: string; email: string }>({
      query: (body) => ({ url: "auth/passkey/register/options", method: "POST", body }),
    }),
    passkeyRegisterComplete: build.mutation<Me, { credential: Record<string, unknown> }>({
      query: (body) => ({ url: "auth/passkey/register/complete", method: "POST", body }),
      invalidatesTags: ["Me", "Tree", "Credits"],
    }),
    passkeyLoginOptions: build.mutation<{ publicKey: Record<string, unknown> }, undefined>({
      query: () => ({ url: "auth/passkey/login/options", method: "POST", body: {} }),
    }),
    passkeyLoginComplete: build.mutation<Me, { credential: Record<string, unknown> }>({
      query: (body) => ({ url: "auth/passkey/login/complete", method: "POST", body }),
      invalidatesTags: ["Me", "Tree", "Credits"],
    }),
    developmentSignIn: build.mutation<Me, undefined>({
      query: () => ({ url: "auth/development", method: "POST", body: {} }),
      invalidatesTags: ["Me", "Tree", "Credits"],
    }),
    logout: build.mutation<null, undefined>({
      query: () => ({ url: "auth/logout", method: "POST" }),
      invalidatesTags: ["Me", "Tree", "Credits"],
    }),

    // Tree --------------------------------------------------------------------------------
    /** The organisation tree; an operator in God mode names the organisation they entered. */
    getTree: build.query<Tree, string | undefined>({
      query: (organisation) => (organisation ? `tree?organisation=${encodeURIComponent(organisation)}` : "tree"),
      providesTags: ["Tree"],
      extraOptions: guarded(g.treeGuard, "the organisation"),
    }),
    createOrganisation: build.mutation<OrganisationRef, { name: string; slug: string }>({
      query: (body) => ({ url: "organisations", method: "POST", body }),
      invalidatesTags: ["Me", "Tree", "Credits"],
    }),

    // Ideas -------------------------------------------------------------------------------
    estimateIdea: build.mutation<IdeaEstimate, CreateIdeaRequest>({
      query: (body) => ({ url: "ideas/estimate", method: "POST", body }),
      extraOptions: guarded(g.estimateGuard, "the estimate"),
    }),
    createIdea: build.mutation<Idea, CreateIdeaRequest>({
      query: (body) => ({ url: "ideas", method: "POST", body }),
      invalidatesTags: ["Tree", "Credits"],
      extraOptions: guarded(g.ideaGuard, "the idea"),
    }),
    getIdea: build.query<Idea, string>({ query: (id) => `ideas/${encodeURIComponent(id)}`, providesTags: (_r, _e, id) => [{ type: "Idea", id }], extraOptions: guarded(g.ideaGuard, "the verdict") }),
    decideIdea: build.mutation<Idea, { id: string; choice: DecisionChoice; note?: string; applyChange?: boolean }>({
      query: ({ id, ...body }) => ({ url: `ideas/${encodeURIComponent(id)}/decision`, method: "POST", body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Idea", id }, "Tree", "Credits"],
      extraOptions: guarded(g.ideaGuard, "the decision"),
    }),

    // Runs --------------------------------------------------------------------------------
    getRun: build.query<Run, string>({ query: (id) => `runs/${encodeURIComponent(id)}`, providesTags: (_r, _e, id) => [{ type: "Run", id }], extraOptions: guarded(g.runGuard, "the work") }),
    controlRun: build.mutation<Run, { id: string; action: "pause" | "resume" | "cancel" }>({
      query: ({ id, action }) => ({ url: `runs/${encodeURIComponent(id)}/${action}`, method: "POST" }),
      extraOptions: guarded(g.runGuard, "the work"),
      // Optimistic: the button's effect shows at once and is rolled back if the control plane refuses.
      async onQueryStarted({ id, action }, { dispatch, queryFulfilled }) {
        const next = action === "pause" ? "paused" : action === "resume" ? "running" : "cancelled";
        const patch = dispatch(
          api.util.updateQueryData("getRun", id, (run) => {
            run.status = next;
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getRun", id, data));
        } catch {
          patch.undo();
        }
      },
    }),
    answerApproval: build.mutation<null, { runId: string; approvalId: string; decision: "approve" | "reject"; note?: string }>({
      query: ({ runId, approvalId, ...body }) => ({
        url: `runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["Tree"],
    }),

    // Trying again ------------------------------------------------------------------------
    /** What trying a stopped research, build or change again costs, and what of it is kept. Free; shown before the person confirms. */
    estimateRetry: build.mutation<RetryEstimate, string>({
      query: (runId) => ({ url: `runs/${encodeURIComponent(runId)}/retry/estimate`, method: "POST" }),
      extraOptions: guarded(g.retryEstimateGuard, "the estimate"),
    }),
    retryRun: build.mutation<Run, { runId: string; ideaId?: string | null }>({
      query: ({ runId }) => ({ url: `runs/${encodeURIComponent(runId)}/retry`, method: "POST" }),
      invalidatesTags: (_r, _e, { runId, ideaId }) => [{ type: "Run", id: runId }, ...(ideaId ? [{ type: "Idea" as const, id: ideaId }] : []), "Tree", "Credits"],
      extraOptions: guarded(g.runGuard, "the new attempt"),
    }),

    // Changing a built app ----------------------------------------------------------------
    estimateChange: build.mutation<ChangeEstimate, { appId: string; request: string }>({
      query: ({ appId, request }) => ({ url: `apps/${encodeURIComponent(appId)}/changes/estimate`, method: "POST", body: { request } }),
      extraOptions: guarded(g.changeEstimateGuard, "the estimate"),
    }),
    requestChange: build.mutation<Run, { appId: string; request: string }>({
      query: ({ appId, request }) => ({ url: `apps/${encodeURIComponent(appId)}/changes`, method: "POST", body: { request } }),
      invalidatesTags: (_r, _e, { appId }) => [{ type: "App", id: appId }, "Tree", "Credits"],
      extraOptions: guarded(g.runGuard, "the change"),
    }),

    // Conversation ------------------------------------------------------------------------
    /** What one message can cost at most, shown before it is sent (CLAUDE.md rule 11). */
    estimateMessage: build.query<ConversationEstimate, { scope: string; employeeId?: string; attachmentIds?: string[] }>({
      query: (body) => ({ url: "conversations/estimate", method: "POST", body }),
      extraOptions: guarded(g.conversationEstimateGuard, "the estimate"),
    }),
    startConversation: build.mutation<Run, ConversationRequest>({
      query: (body) => ({ url: "conversations", method: "POST", body }),
      extraOptions: guarded(g.runGuard, "the reply"),
    }),
    /** The conversation docked at a scope, so it survives a reload. Read once per scope; live replies stream on top. */
    getConversation: build.query<ConversationHistory, { scope: string; employeeId?: string }>({
      query: ({ scope, employeeId }) => `conversations?scope=${encodeURIComponent(scope)}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ""}`,
      providesTags: (_r, _e, { scope, employeeId }) => [{ type: "Conversation", id: employeeId ? `${scope}#${employeeId}` : scope }],
      extraOptions: guarded(g.conversationGuard, "the conversation"),
    }),
    /** What whoever answers at a scope can use: tools, skills, services, web search, assistants, file limits (ARCH-012). */
    getConversationCapabilities: build.query<ConversationCapabilities, { scope: string; employeeId?: string }>({
      query: ({ scope, employeeId }) => `conversations/capabilities?scope=${encodeURIComponent(scope)}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ""}`,
      providesTags: (_r, _e, { scope, employeeId }) => [{ type: "Conversation", id: `capabilities:${employeeId ? `${scope}#${employeeId}` : scope}` }],
      extraOptions: guarded(g.capabilitiesGuard, "what it can use here"),
    }),

    // Apps --------------------------------------------------------------------------------
    getApp: build.query<AppDetail, string>({ query: (id) => `apps/${encodeURIComponent(id)}`, providesTags: (_r, _e, id) => [{ type: "App", id }], extraOptions: guarded(g.appGuard, "the app") }),
    updateAppSettings: build.mutation<AppDetail, { id: string; settings: AppSettingsUpdate }>({
      query: ({ id, settings }) => ({ url: `apps/${encodeURIComponent(id)}/settings`, method: "POST", body: settings }),
      extraOptions: guarded(g.appGuard, "the app"),
      async onQueryStarted({ id, settings }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          api.util.updateQueryData("getApp", id, (app) => {
            Object.assign(app.settings, settings);
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getApp", id, data));
          dispatch(api.util.invalidateTags(["Tree"]));
        } catch {
          patch.undo();
        }
      },
    }),

    // Sharing: the list and removal. Inviting returns a one-time code, so it never passes through
    // the store — see `store/sensitive.ts`.
    getShares: build.query<AppShare[], string>({
      query: (appId) => `apps/${encodeURIComponent(appId)}/shares`,
      providesTags: (_r, _e, appId) => [{ type: "Shares", id: appId }],
      extraOptions: guarded(g.sharesGuard, "who it is shared with"),
    }),
    removeShare: build.mutation<null, { appId: string; email: string }>({
      query: ({ appId, email }) => ({ url: `apps/${encodeURIComponent(appId)}/shares?email=${encodeURIComponent(email)}`, method: "DELETE" }),
      async onQueryStarted({ appId, email }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          api.util.updateQueryData("getShares", appId, (shares) => {
            const i = shares.findIndex((s) => s.email === email);
            if (i >= 0) shares.splice(i, 1);
          }),
        );
        try {
          await queryFulfilled;
          dispatch(api.util.invalidateTags([{ type: "App", id: appId }, "Tree"]));
        } catch {
          patch.undo();
        }
      },
    }),

    // Secrets: names and where each was set, never a value. Setting one is in `store/sensitive.ts`,
    // so the value is never held in the store.
    getSecrets: build.query<SecretList, string>({
      query: (scope) => `secrets?scope=${encodeURIComponent(scope)}`,
      providesTags: (_r, _e, scope) => [{ type: "Secrets", id: scope }],
      extraOptions: guarded(g.secretsGuard, "the secrets"),
    }),
    removeSecret: build.mutation<null, { scope: string; name: string }>({
      query: ({ scope, name }) => ({ url: `secrets?scope=${encodeURIComponent(scope)}&name=${encodeURIComponent(name)}`, method: "DELETE" }),
      async onQueryStarted({ scope, name }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          api.util.updateQueryData("getSecrets", scope, (list) => {
            list.effective = list.effective.filter((s) => !(s.name === name && s.setAtPath === scope));
          }),
        );
        try {
          await queryFulfilled;
          // An inherited secret of the same name may apply again; every scope's list may change.
          dispatch(api.util.invalidateTags(["Secrets"]));
        } catch {
          patch.undo();
        }
      },
    }),

    // Operator access ----------------------------------------------------------------------
    getOperatorAccess: build.query<OperatorAction[], string>({
      query: (organisation) => `audit/operator-access?organisation=${encodeURIComponent(organisation)}`,
      providesTags: ["OperatorAccess"],
      extraOptions: guarded(g.operatorAccessGuard, "the operator log"),
    }),

    // Credits -----------------------------------------------------------------------------
    getCredits: build.query<Credits, string>({
      query: (scope) => `credits?scope=${encodeURIComponent(scope)}`,
      providesTags: ["Credits"],
      extraOptions: guarded(g.creditsGuard, "the credits"),
    }),

    // System ------------------------------------------------------------------------------
    getSystemStatus: build.query<SystemStatus, undefined>({ query: () => "system/status", extraOptions: guarded(g.systemGuard, "the system status") }),

    // The workforce ------------------------------------------------------------------------
    getEmployees: build.query<Employee[], { scope: string; includeReleased?: boolean }>({
      query: ({ scope, includeReleased }) => `employees?scope=${encodeURIComponent(scope)}${includeReleased ? "&includeReleased=true" : ""}`,
      providesTags: ["Employee"],
      extraOptions: guarded(g.employeesGuard, "the workforce"),
    }),
    getEmployee: build.query<EmployeeDetail, string>({
      query: (id) => `employees/${encodeURIComponent(id)}`,
      providesTags: (_r, _e, id) => [{ type: "Employee", id }],
      extraOptions: guarded(g.employeeDetailGuard, "the employee"),
    }),
    updateEmployee: build.mutation<Employee, { id: string; patch: EmployeePatch }>({
      query: ({ id, patch }) => ({ url: `employees/${encodeURIComponent(id)}`, method: "PATCH", body: patch }),
      extraOptions: guarded(g.employeeGuard, "the employee"),
      // Optimistic: status and budget change at once, and go back if the control plane refuses.
      async onQueryStarted({ id, patch }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getEmployee", id, (d) => {
            if (patch.status) d.employee.status = patch.status;
            if (patch.clearMonthlyCreditLimit) d.employee.jobDescription.monthlyCreditLimit = null;
            if (patch.jobDescription?.monthlyCreditLimit !== undefined) d.employee.jobDescription.monthlyCreditLimit = patch.jobDescription.monthlyCreditLimit;
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.updateQueryData("getEmployee", id, (d) => void (d.employee = data)));
          dispatch(api.util.invalidateTags(["Tree", "Ontology"]));
        } catch {
          undo.undo();
        }
      },
    }),
    employeeAction: build.mutation<Employee, { id: string; action: "release" | "rehire" | "reassign" | "stop"; scope?: string }>({
      query: ({ id, action, scope }) => ({ url: `employees/${encodeURIComponent(id)}/${action}`, method: "POST", body: scope ? { scope } : {} }),
      extraOptions: guarded(g.employeeGuard, "the employee"),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Employee", id }, "Employee", "Tree", "Ontology", "Memory"],
    }),
    getMemory: build.query<MemoryEntry[], { id: string; includeArchived?: boolean }>({
      query: ({ id, includeArchived }) => `employees/${encodeURIComponent(id)}/memory${includeArchived ? "?includeArchived=true" : ""}`,
      providesTags: (_r, _e, { id }) => [{ type: "Memory", id }],
      extraOptions: guarded(g.memoryGuard, "the memory"),
    }),
    getMemoryChanges: build.query<MemoryChange[], string>({
      query: (id) => `employees/${encodeURIComponent(id)}/memory/changes?limit=100`,
      providesTags: (_r, _e, id) => [{ type: "Memory", id: `${id}#changes` }],
      extraOptions: guarded(g.memoryChangesGuard, "the memory's history"),
    }),
    addMemory: build.mutation<MemoryEntry, { id: string; title: string; body: string; kind: MemoryKind; includeArchived: boolean }>({
      query: ({ id, title, body, kind }) => ({ url: `employees/${encodeURIComponent(id)}/memory`, method: "POST", body: { title, body, kind } }),
      extraOptions: guarded(g.memoryEntryGuard, "the new entry"),
      async onQueryStarted({ id, title, body, kind, includeArchived }, { dispatch, queryFulfilled }) {
        const tempId = `pending-${Date.now()}`;
        const at = new Date().toISOString();
        const undo = dispatch(
          api.util.updateQueryData("getMemory", { id, includeArchived }, (list) => {
            list.unshift({ id: tempId, employeeId: id, scope: "", title, body, kind, sourceRunId: null, createdAt: at, updatedAt: at, lastReviewedAt: null, archived: false });
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.updateQueryData("getMemory", { id, includeArchived }, (list) => list.map((e) => (e.id === tempId ? data : e))));
          dispatch(api.util.invalidateTags([{ type: "Memory", id: `${id}#changes` }, { type: "Employee", id }]));
        } catch {
          undo.undo();
        }
      },
    }),
    correctMemory: build.mutation<MemoryEntry, { id: string; entryId: string; title: string; body: string; kind: MemoryKind; includeArchived: boolean }>({
      query: ({ id, entryId, title, body, kind }) => ({ url: `employees/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}`, method: "PATCH", body: { title, body, kind } }),
      extraOptions: guarded(g.memoryEntryGuard, "the corrected entry"),
      async onQueryStarted({ id, entryId, title, body, kind, includeArchived }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getMemory", { id, includeArchived }, (list) => {
            const e = list.find((x) => x.id === entryId);
            if (e) Object.assign(e, { title, body, kind });
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.updateQueryData("getMemory", { id, includeArchived }, (list) => list.map((e) => (e.id === entryId ? data : e))));
          dispatch(api.util.invalidateTags([{ type: "Memory", id: `${id}#changes` }]));
        } catch {
          undo.undo();
        }
      },
    }),
    removeMemory: build.mutation<null, { id: string; entryId: string; why: string | null; includeArchived: boolean }>({
      query: ({ id, entryId, why }) => ({ url: `employees/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}${why ? `?why=${encodeURIComponent(why)}` : ""}`, method: "DELETE" }),
      async onQueryStarted({ id, entryId, includeArchived }, { dispatch, queryFulfilled }) {
        const undo = dispatch(api.util.updateQueryData("getMemory", { id, includeArchived }, (list) => list.filter((e) => e.id !== entryId)));
        try {
          await queryFulfilled;
          dispatch(api.util.invalidateTags([{ type: "Memory", id: `${id}#changes` }, { type: "Employee", id }]));
        } catch {
          undo.undo();
        }
      },
    }),
    reviewMemory: build.mutation<Run, string>({
      query: (id) => ({ url: `employees/${encodeURIComponent(id)}/reviews`, method: "POST" }),
      extraOptions: guarded(g.runGuard, "the review"),
      invalidatesTags: (_r, _e, id) => [{ type: "Employee", id }],
    }),
    getRecurringRoles: build.query<RecurringRole[], string>({
      query: (scope) => `employees/recurring-roles?scope=${encodeURIComponent(scope)}`,
      providesTags: [{ type: "Hire", id: "ROLES" }],
      extraOptions: guarded(g.recurringRolesGuard, "the recurring roles"),
    }),

    // Hires --------------------------------------------------------------------------------
    getHires: build.query<Hire[], { scope: string; status?: string }>({
      query: ({ scope, status }) => `hires?scope=${encodeURIComponent(scope)}${status ? `&status=${encodeURIComponent(status)}` : ""}`,
      providesTags: [{ type: "Hire", id: "LIST" }],
      extraOptions: guarded(g.hiresGuard, "the hire proposals"),
    }),
    getHire: build.query<Hire, string>({
      query: (id) => `hires/${encodeURIComponent(id)}`,
      providesTags: (_r, _e, id) => [{ type: "Hire", id }],
      extraOptions: guarded(g.hireGuard, "the hire proposal"),
    }),
    editHire: build.mutation<Hire, { id: string; edit: HireEdit }>({
      query: ({ id, edit }) => ({ url: `hires/${encodeURIComponent(id)}`, method: "PATCH", body: edit }),
      extraOptions: guarded(g.hireGuard, "the hire proposal"),
      async onQueryStarted({ id, edit }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getHire", id, (h) => {
            if (edit.name !== undefined) h.name = edit.name;
            if (edit.role !== undefined) h.role = edit.role;
            if (edit.reason !== undefined) h.reason = edit.reason;
            if (edit.expectedMonthlyCredits !== undefined) h.expectedMonthlyCredits = edit.expectedMonthlyCredits;
            if (edit.jobDescription?.mandate !== undefined) h.jobDescription.mandate = edit.jobDescription.mandate;
            if (edit.jobDescription?.monthlyCreditLimit !== undefined) h.jobDescription.monthlyCreditLimit = edit.jobDescription.monthlyCreditLimit;
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getHire", id, data));
          dispatch(api.util.invalidateTags(["Tree"]));
        } catch {
          undo.undo();
        }
      },
    }),
    decideHire: build.mutation<Hire, { id: string; decision: "accept" | "decline"; note?: string }>({
      query: ({ id, decision, note }) => ({ url: `hires/${encodeURIComponent(id)}/${decision}`, method: "POST", body: note ? { note } : {} }),
      extraOptions: guarded(g.hireGuard, "the hire proposal"),
      async onQueryStarted({ id, decision }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getHire", id, (h) => {
            h.status = decision === "accept" ? "accepted" : "declined";
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getHire", id, data));
          dispatch(api.util.invalidateTags(["Tree", { type: "Hire", id: "LIST" }, "Employee", "Ontology"]));
        } catch {
          undo.undo();
        }
      },
    }),
    proposeHire: build.mutation<Hire, HireProposalRequest>({
      query: (body) => ({ url: "hires", method: "POST", body }),
      extraOptions: guarded(g.hireGuard, "the hire proposal"),
      invalidatesTags: [{ type: "Hire", id: "LIST" }, "Tree", "Employee"],
    }),

    // Autonomy -----------------------------------------------------------------------------
    getAutonomy: build.query<Autonomy, string>({
      query: (scope) => `autonomy?scope=${encodeURIComponent(scope)}`,
      providesTags: (_r, _e, scope) => [{ type: "Autonomy", id: scope }],
      extraOptions: guarded(g.autonomyGuard, "the autonomy settings"),
    }),
    setAutonomy: build.mutation<Autonomy, { scope: string; autonomy?: "auto" | "checkpoints"; checkpoints?: { start?: boolean; plan?: boolean; hire?: boolean } }>({
      query: (body) => ({ url: "autonomy", method: "PUT", body }),
      extraOptions: guarded(g.autonomyGuard, "the autonomy settings"),
      async onQueryStarted({ scope, autonomy, checkpoints }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getAutonomy", scope, (a) => {
            if (autonomy) {
              a.autonomy = autonomy;
              a.autonomySetAtPath = scope;
            }
            for (const [key, on] of Object.entries(checkpoints ?? {})) if (on !== undefined) a.checkpoints[key] = { on, setAtPath: scope };
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getAutonomy", scope, data));
          dispatch(api.util.invalidateTags(["Autonomy"]));
        } catch {
          undo.undo();
        }
      },
    }),
    clearAutonomy: build.mutation<Autonomy, { scope: string; key: string }>({
      query: ({ scope, key }) => ({ url: `autonomy?scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}`, method: "DELETE" }),
      extraOptions: guarded(g.autonomyGuard, "the autonomy settings"),
      async onQueryStarted({ scope }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getAutonomy", scope, data));
          dispatch(api.util.invalidateTags(["Autonomy"]));
        } catch {
          // The page shows the refusal; nothing was changed optimistically.
        }
      },
    }),
    setRuleSet: build.mutation<Autonomy, RuleSetRequest>({
      query: (body) => ({ url: "autonomy/rule-sets", method: "PUT", body }),
      extraOptions: guarded(g.autonomyGuard, "the rule sets"),
      async onQueryStarted(rule, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getAutonomy", rule.scope, (a) => {
            const next = { stage: rule.stage, deny: rule.deny, ask: rule.ask, allow: rule.allow, checkpoints: rule.checkpoints, setAtPath: rule.scope, overrides: [] as string[] };
            const i = a.ruleSets.findIndex((r) => r.stage === rule.stage);
            if (i >= 0) a.ruleSets[i] = { ...next, overrides: a.ruleSets[i]?.setAtPath !== rule.scope ? [a.ruleSets[i]?.setAtPath ?? ""] : (a.ruleSets[i]?.overrides ?? []) };
            else a.ruleSets.push(next);
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getAutonomy", rule.scope, data));
          dispatch(api.util.invalidateTags(["Autonomy"]));
        } catch {
          undo.undo();
        }
      },
    }),
    clearRuleSet: build.mutation<Autonomy, { scope: string; stage: string }>({
      query: ({ scope, stage }) => ({ url: `autonomy/rule-sets?scope=${encodeURIComponent(scope)}&stage=${encodeURIComponent(stage)}`, method: "DELETE" }),
      extraOptions: guarded(g.autonomyGuard, "the rule sets"),
      async onQueryStarted({ scope }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getAutonomy", scope, data));
          dispatch(api.util.invalidateTags(["Autonomy"]));
        } catch {
          // The page shows the refusal.
        }
      },
    }),

    // The ontology and tasks ---------------------------------------------------------------
    getOntology: build.query<Ontology, { scope: string; view: "org-chart" | "data-flow" | "all" }>({
      query: ({ scope, view }) => `ontology?scope=${encodeURIComponent(scope)}&view=${view}`,
      providesTags: ["Ontology"],
      extraOptions: guarded(g.ontologyGuard, "the organisation graph"),
    }),
    getTasks: build.query<TaskItem[], { scope: string; limit?: number; employeeId?: string }>({
      query: ({ scope, limit, employeeId }) => `tasks?scope=${encodeURIComponent(scope)}&limit=${limit ?? 100}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ""}`,
      providesTags: ["Tasks"],
      extraOptions: guarded(g.tasksGuard, "the recent work"),
    }),

    // Ask about this app ---------------------------------------------------------------------
    estimateAsk: build.mutation<AskEstimate, { appId: string; question: string }>({
      query: ({ appId, question }) => ({ url: `apps/${encodeURIComponent(appId)}/ask/estimate`, method: "POST", body: { question } }),
      extraOptions: guarded(g.askEstimateGuard, "the estimate"),
    }),
    askApp: build.mutation<AskAnswer, { appId: string; question: string }>({
      query: ({ appId, question }) => ({ url: `apps/${encodeURIComponent(appId)}/ask`, method: "POST", body: { question } }),
      extraOptions: guarded(g.askAnswerGuard, "the answer"),
      invalidatesTags: ["Credits"],
    }),
    getDashboard: build.query<SavedQuestion[], string>({
      query: (appId) => `apps/${encodeURIComponent(appId)}/dashboard`,
      providesTags: (_r, _e, appId) => [{ type: "Dashboard", id: appId }],
      extraOptions: guarded(g.dashboardGuard, "the dashboard"),
    }),
    saveQuestion: build.mutation<SavedQuestion, { appId: string; question: string; sql: string; chart: AskChart; answer: string; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }>({
      query: ({ appId, question, sql, chart, answer }) => ({ url: `apps/${encodeURIComponent(appId)}/dashboard`, method: "POST", body: { question, sql, chart, answer } }),
      extraOptions: guarded(g.savedQuestionGuard, "the saved question"),
      // Optimistic: the question joins the dashboard at once and leaves it again if refused.
      async onQueryStarted({ appId, question, sql, chart, answer, columns, rows, truncated }, { dispatch, queryFulfilled }) {
        const tempId = `pending-${Date.now()}`;
        const at = new Date().toISOString();
        const undo = dispatch(
          api.util.updateQueryData("getDashboard", appId, (list) => {
            list.push({ id: tempId, question, answer, sql, chart, columns, rows, truncated, askedAt: at, ranAt: at, error: null, technical: null });
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.updateQueryData("getDashboard", appId, (list) => list.map((q) => (q.id === tempId ? data : q))));
        } catch {
          undo.undo();
        }
      },
    }),
    removeQuestion: build.mutation<null, { appId: string; questionId: string }>({
      query: ({ appId, questionId }) => ({ url: `apps/${encodeURIComponent(appId)}/dashboard/${encodeURIComponent(questionId)}`, method: "DELETE" }),
      async onQueryStarted({ appId, questionId }, { dispatch, queryFulfilled }) {
        const undo = dispatch(api.util.updateQueryData("getDashboard", appId, (list) => list.filter((q) => q.id !== questionId)));
        try {
          await queryFulfilled;
        } catch {
          undo.undo();
        }
      },
    }),

    // Versions ---------------------------------------------------------------------------------
    getVersions: build.query<AppVersions, { appId: string; limit: number }>({
      query: ({ appId, limit }) => `apps/${encodeURIComponent(appId)}/versions?limit=${limit}`,
      providesTags: (_r, _e, { appId }) => [{ type: "Versions", id: appId }],
      extraOptions: guarded(g.versionsGuard, "the history"),
    }),
    restoreVersion: build.mutation<RestoreResult, { appId: string; commit: string }>({
      query: ({ appId, commit }) => ({ url: `apps/${encodeURIComponent(appId)}/versions/${encodeURIComponent(commit)}/restore`, method: "POST" }),
      extraOptions: guarded(g.restoreGuard, "the restore"),
      invalidatesTags: (_r, _e, { appId }) => [{ type: "Versions", id: appId }, { type: "App", id: appId }, "Tree"],
    }),

    // People -----------------------------------------------------------------------------------
    getMembers: build.query<Member[], string>({
      query: (scope) => `members?scope=${encodeURIComponent(scope)}`,
      providesTags: (_r, _e, scope) => [{ type: "Members", id: scope }],
      extraOptions: guarded(g.membersGuard, "the people"),
    }),
    changeRole: build.mutation<Member, { scope: string; membershipId: string; role: MemberRole }>({
      query: ({ membershipId, role }) => ({ url: `members/${encodeURIComponent(membershipId)}`, method: "PATCH", body: { role } }),
      extraOptions: guarded(g.invitationGuard, "the changed grant"),
      transformResponse: (r: { member: Member }) => r.member,
      async onQueryStarted({ scope, membershipId, role }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getMembers", scope, (list) => {
            const m = list.find((x) => x.membershipId === membershipId);
            if (m) m.role = role;
          }),
        );
        try {
          await queryFulfilled;
          dispatch(api.util.invalidateTags(["Members", "Me", "Tree"]));
        } catch {
          undo.undo();
        }
      },
    }),
    removeMember: build.mutation<RoleRevoked, { scope: string; membershipId: string }>({
      query: ({ membershipId }) => ({ url: `members/${encodeURIComponent(membershipId)}`, method: "DELETE" }),
      extraOptions: guarded(g.roleRevokedGuard, "the removed role"),
      async onQueryStarted({ scope, membershipId }, { dispatch, queryFulfilled }) {
        const undo = dispatch(api.util.updateQueryData("getMembers", scope, (list) => list.filter((x) => x.membershipId !== membershipId)));
        try {
          await queryFulfilled;
          dispatch(api.util.invalidateTags(["Members"]));
        } catch {
          undo.undo();
        }
      },
    }),

    // AI assistant access ------------------------------------------------------------------------
    getTokens: build.query<AccessToken[], undefined>({ query: () => "tokens", providesTags: ["Tokens"], extraOptions: guarded(g.accessTokensGuard, "the assistant access") }),
    revokeToken: build.mutation<AccessToken, string>({
      query: (id) => ({ url: `tokens/${encodeURIComponent(id)}`, method: "DELETE" }),
      extraOptions: guarded(g.accessTokenGuard, "the revoked access"),
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const at = new Date().toISOString();
        const undo = dispatch(
          api.util.updateQueryData("getTokens", undefined, (list) => {
            const t = list.find((x) => x.id === id);
            if (t) Object.assign(t, { active: false, revokedAt: at });
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.updateQueryData("getTokens", undefined, (list) => list.map((t) => (t.id === id ? data : t))));
        } catch {
          undo.undo();
        }
      },
    }),

    // Notifications ----------------------------------------------------------------------------
    getNotifications: build.query<NotificationFeed, string>({
      query: (organisation) => `notifications?organisation=${encodeURIComponent(organisation)}&limit=50`,
      providesTags: ["Notifications"],
      extraOptions: guarded(g.notificationsGuard, "your notifications"),
    }),
    markRead: build.mutation<null, { organisation: string; id: string }>({
      query: ({ id }) => ({ url: `notifications/${encodeURIComponent(id)}/read`, method: "POST" }),
      async onQueryStarted({ organisation, id }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getNotifications", organisation, (feed) => {
            const n = feed.notifications.find((x) => x.id === id);
            if (n && !n.read) {
              n.read = true;
              feed.unread = Math.max(0, feed.unread - 1);
            }
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          undo.undo();
        }
      },
    }),
    markAllRead: build.mutation<{ marked: number }, string>({
      query: (organisation) => ({ url: `notifications/read-all?organisation=${encodeURIComponent(organisation)}`, method: "POST" }),
      async onQueryStarted(organisation, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getNotifications", organisation, (feed) => {
            for (const n of feed.notifications) n.read = true;
            feed.unread = 0;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          undo.undo();
        }
      },
    }),

    // Ideas from the portfolio -------------------------------------------------------------------
    estimateSuggestions: build.mutation<AskEstimate, string>({
      query: (scope) => ({ url: "ideas/suggestions/estimate", method: "POST", body: { scope } }),
      extraOptions: guarded(g.estimateGuard, "the estimate"),
    }),
    startSuggestions: build.mutation<SuggestionsStarted, string>({
      query: (scope) => ({ url: "ideas/suggestions", method: "POST", body: { scope } }),
      extraOptions: guarded(g.suggestionsStartedGuard, "the request for ideas"),
      invalidatesTags: ["Credits"],
    }),
    getSuggestions: build.query<Suggestion[], string>({
      query: (scope) => `ideas/suggestions?scope=${encodeURIComponent(scope)}`,
      providesTags: (_r, _e, scope) => [{ type: "Suggestions", id: scope }],
      extraOptions: guarded(g.suggestionsGuard, "the suggested ideas"),
    }),
    takeSuggestion: build.mutation<Idea, { scope: string; id: string; constraints: string[] }>({
      query: ({ id, constraints }) => ({ url: `ideas/suggestions/${encodeURIComponent(id)}/take`, method: "POST", body: { constraints } }),
      extraOptions: guarded(g.ideaGuard, "the new idea"),
      async onQueryStarted({ scope, id }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getSuggestions", scope, (list) => {
            const x = list.find((q) => q.id === id);
            if (x) x.status = "taken";
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(
            api.util.updateQueryData("getSuggestions", scope, (list) => {
              const x = list.find((q) => q.id === id);
              if (x) x.ideaId = data.id;
            }),
          );
          dispatch(api.util.invalidateTags(["Tree", "Credits"]));
        } catch {
          undo.undo();
        }
      },
    }),
    dismissSuggestion: build.mutation<Suggestion, { scope: string; id: string }>({
      query: ({ id }) => ({ url: `ideas/suggestions/${encodeURIComponent(id)}/dismiss`, method: "POST" }),
      extraOptions: guarded(g.suggestionGuard, "the suggestion"),
      async onQueryStarted({ scope, id }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getSuggestions", scope, (list) => {
            const x = list.find((q) => q.id === id);
            if (x) x.status = "dismissed";
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          undo.undo();
        }
      },
    }),

    // Top-ups and the overdraft ----------------------------------------------------------------
    getTopUpRequests: build.query<TopUpRequest[], string>({
      query: (organisation) => `credits/top-up-requests?organisation=${encodeURIComponent(organisation)}`,
      providesTags: ["TopUpRequests"],
      extraOptions: guarded(g.topUpRequestsGuard, "your top-up requests"),
    }),
    requestTopUp: build.mutation<TopUpRequest, { organisation: string; credits: number; note: string }>({
      query: (body) => ({ url: "credits/top-up-requests", method: "POST", body }),
      extraOptions: guarded(g.topUpRequestGuard, "the top-up request"),
      async onQueryStarted({ organisation, credits, note }, { dispatch, queryFulfilled }) {
        const tempId = `pending-${Date.now()}`;
        const undo = dispatch(
          api.util.updateQueryData("getTopUpRequests", organisation, (list) => {
            list.unshift({ id: tempId, organisation, organisationName: "", credits, note, status: "open", requestedBy: "", requestedByEmail: null, requestedAt: new Date().toISOString(), closedAt: null, closeNote: null, topUpEntryId: null });
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.updateQueryData("getTopUpRequests", organisation, (list) => list.map((r) => (r.id === tempId ? data : r))));
          dispatch(api.util.invalidateTags(["Notifications"]));
        } catch {
          undo.undo();
        }
      },
    }),
    setOverdraft: build.mutation<Credits, { organisation: string; scope: string; credits: number }>({
      query: ({ scope, credits }) => ({ url: "credits/overdraft", method: "PUT", body: { scope, credits } }),
      extraOptions: guarded(g.creditsGuard, "the credits"),
      async onQueryStarted({ organisation, scope, credits }, { dispatch, queryFulfilled }) {
        // At the organisation the Owner's own limit changes at once; beneath it the answer says.
        const undo = dispatch(
          api.util.updateQueryData("getCredits", organisation, (c) => {
            if (scope === organisation && c.overdraft) c.overdraft.ownLimit = credits;
          }),
        );
        try {
          const { data } = await queryFulfilled;
          if (scope === organisation) dispatch(api.util.upsertQueryData("getCredits", organisation, data));
          else dispatch(api.util.invalidateTags(["Credits"]));
        } catch {
          undo.undo();
        }
      },
    }),

    // God mode -----------------------------------------------------------------------------------
    getOperatorOrganisations: build.query<OperatorOrganisation[], undefined>({
      query: () => "operator/organisations",
      providesTags: ["Operator"],
      extraOptions: guarded(g.operatorOrganisationsGuard, "every organisation"),
    }),
    enterOrganisation: build.mutation<OperatorEntry, string>({
      query: (slug) => ({ url: `operator/organisations/${encodeURIComponent(slug)}/enter`, method: "POST" }),
      extraOptions: guarded(g.operatorEntryGuard, "the entry"),
    }),
    setOperatorOverdraft: build.mutation<OperatorOrganisation, { slug: string; credits: number }>({
      query: ({ slug, credits }) => ({ url: `operator/organisations/${encodeURIComponent(slug)}/overdraft`, method: "PUT", body: { credits } }),
      extraOptions: guarded(g.operatorOrganisationGuard, "the organisation"),
      async onQueryStarted({ slug, credits }, { dispatch, queryFulfilled }) {
        const undo = dispatch(
          api.util.updateQueryData("getOperatorOrganisations", undefined, (list) => {
            const o = list.find((x) => x.slug === slug);
            if (o) o.overdraft.frostauraLimit = credits;
          }),
        );
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.updateQueryData("getOperatorOrganisations", undefined, (list) => list.map((o) => (o.slug === slug ? data : o))));
        } catch {
          undo.undo();
        }
      },
    }),
    getOperatorTopUps: build.query<OperatorTopUp[], string | undefined>({
      query: (organisation) => (organisation ? `operator/top-ups?organisation=${encodeURIComponent(organisation)}` : "operator/top-ups"),
      providesTags: ["Operator"],
      extraOptions: guarded(g.operatorTopUpsGuard, "the top-ups"),
    }),
    topUp: build.mutation<{ id: string }, { organisation: string; credits: number; note: string; idempotencyKey: string; requestId?: string }>({
      query: (body) => ({ url: "credits/top-ups", method: "POST", body }),
      invalidatesTags: ["Operator", "TopUpRequests", "Credits"],
    }),
    getOperatorTopUpRequests: build.query<TopUpRequest[], string | undefined>({
      query: (status) => (status ? `operator/top-up-requests?status=${encodeURIComponent(status)}` : "operator/top-up-requests"),
      providesTags: ["TopUpRequests"],
      extraOptions: guarded(g.topUpRequestsGuard, "the top-up requests"),
    }),
    closeTopUpRequest: build.mutation<TopUpRequest, { id: string; status: "fulfilled" | "declined"; note?: string; topUpEntryId?: string }>({
      query: ({ id, ...body }) => ({ url: `operator/top-up-requests/${encodeURIComponent(id)}/close`, method: "POST", body }),
      extraOptions: guarded(g.topUpRequestGuard, "the top-up request"),
      invalidatesTags: ["TopUpRequests", "Operator"],
    }),
    getPricing: build.query<PricingView, undefined>({ query: () => "operator/pricing", providesTags: ["Pricing"], extraOptions: guarded(g.pricingGuard, "the prices") }),
    setPricing: build.mutation<PricingView, Pricing>({
      query: (body) => ({ url: "operator/pricing", method: "PUT", body }),
      extraOptions: guarded(g.pricingGuard, "the prices"),
      async onQueryStarted(pricing, { dispatch, queryFulfilled }) {
        const undo = dispatch(api.util.updateQueryData("getPricing", undefined, (v) => void (v.pricing = pricing)));
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData("getPricing", undefined, data));
        } catch {
          undo.undo();
        }
      },
    }),
  }),
});

export const {
  useGetMeQuery,
  useGetAuthOptionsQuery,
  usePasskeyRegisterOptionsMutation,
  usePasskeyRegisterCompleteMutation,
  usePasskeyLoginOptionsMutation,
  usePasskeyLoginCompleteMutation,
  useDevelopmentSignInMutation,
  useLogoutMutation,
  useGetTreeQuery,
  useCreateOrganisationMutation,
  useEstimateIdeaMutation,
  useCreateIdeaMutation,
  useGetIdeaQuery,
  useDecideIdeaMutation,
  useGetRunQuery,
  useControlRunMutation,
  useAnswerApprovalMutation,
  useStartConversationMutation,
  useGetConversationQuery,
  useGetConversationCapabilitiesQuery,
  useEstimateRetryMutation,
  useRetryRunMutation,
  useEstimateChangeMutation,
  useRequestChangeMutation,
  useEstimateMessageQuery,
  useGetSharesQuery,
  useRemoveShareMutation,
  useGetSecretsQuery,
  useRemoveSecretMutation,
  useGetOperatorAccessQuery,
  useGetAppQuery,
  useUpdateAppSettingsMutation,
  useGetCreditsQuery,
  useGetSystemStatusQuery,
  useGetEmployeesQuery,
  useGetEmployeeQuery,
  useUpdateEmployeeMutation,
  useEmployeeActionMutation,
  useGetMemoryQuery,
  useGetMemoryChangesQuery,
  useAddMemoryMutation,
  useCorrectMemoryMutation,
  useRemoveMemoryMutation,
  useReviewMemoryMutation,
  useGetRecurringRolesQuery,
  useGetHiresQuery,
  useGetHireQuery,
  useEditHireMutation,
  useDecideHireMutation,
  useProposeHireMutation,
  useGetAutonomyQuery,
  useSetAutonomyMutation,
  useClearAutonomyMutation,
  useSetRuleSetMutation,
  useClearRuleSetMutation,
  useGetOntologyQuery,
  useGetTasksQuery,
  useEstimateAskMutation,
  useAskAppMutation,
  useGetDashboardQuery,
  useSaveQuestionMutation,
  useRemoveQuestionMutation,
  useGetVersionsQuery,
  useRestoreVersionMutation,
  useGetMembersQuery,
  useChangeRoleMutation,
  useRemoveMemberMutation,
  useGetTokensQuery,
  useRevokeTokenMutation,
  useGetNotificationsQuery,
  useMarkReadMutation,
  useMarkAllReadMutation,
  useEstimateSuggestionsMutation,
  useStartSuggestionsMutation,
  useGetSuggestionsQuery,
  useTakeSuggestionMutation,
  useDismissSuggestionMutation,
  useGetTopUpRequestsQuery,
  useRequestTopUpMutation,
  useSetOverdraftMutation,
  useGetOperatorOrganisationsQuery,
  useEnterOrganisationMutation,
  useSetOperatorOverdraftMutation,
  useGetOperatorTopUpsQuery,
  useTopUpMutation,
  useGetOperatorTopUpRequestsQuery,
  useCloseTopUpRequestMutation,
  useGetPricingQuery,
  useSetPricingMutation,
} = api;

// Managing the tree, the cascade's values and an app's republish ----------------------------------
// Injected rather than inlined, so each part of the console adds its endpoints without touching the rest.

/** The argument a screen reads the tree with: the organisation's slug, or nothing for the person's own. */
export type TreeArg = string | undefined;

const PLURAL: Record<import("./types").ManagedLevel, string> = { division: "divisions", project: "projects", app: "apps" };

const withCascade = api.enhanceEndpoints({ addTagTypes: ["Cascade"] });

export const manageApi = withCascade.injectEndpoints({
  endpoints: (build) => ({
    /** The effective values of one kind at a scope, each with the level that set it. */
    getCascade: build.query<import("./types").CascadeValue[], { scope: string; kind: import("./types").CascadeKind }>({
      query: ({ scope, kind }) => `cascade?scope=${encodeURIComponent(scope)}&kind=${encodeURIComponent(kind)}`,
      providesTags: (_r, _e, { scope, kind }) => [{ type: "Cascade", id: `${kind}@${scope}` }],
      extraOptions: guarded(g.cascadeValuesGuard, "what applies here"),
    }),
    /** What levels beneath a scope set, each with where: what a lower level replaces or adds. */
    getCascadeBelow: build.query<import("./types").CascadeValue[], { scope: string; kind: import("./types").CascadeKind }>({
      query: ({ scope, kind }) => `cascade/below?scope=${encodeURIComponent(scope)}&kind=${encodeURIComponent(kind)}`,
      providesTags: ["Cascade"],
      extraOptions: guarded(g.cascadeValuesGuard, "what lower levels set"),
    }),
    /** Sets a value at the scope's own level. Context is optimistic on the list it belongs to. */
    setCascade: build.mutation<import("./types").CascadeValue, { scope: string; kind: import("./types").CascadeKind; key: string; value: unknown }>({
      query: (body) => ({ url: "cascade", method: "PUT", body }),
      extraOptions: guarded(g.cascadeValueGuard, "the saved value"),
      async onQueryStarted({ scope, kind, key, value }, { dispatch, queryFulfilled }) {
        const level = (["organisation", "division", "project", "app"] as const)[Math.max(0, scope.split("/").length - 1)] ?? "app";
        const undo = dispatch(
          manageApi.util.updateQueryData("getCascade", { scope, kind }, (list) => {
            const i = list.findIndex((v) => v.key === key);
            const overrides = i >= 0 && list[i]?.setAtPath !== scope ? [list[i]?.setAtPath ?? ""] : (list[i]?.overrides ?? []);
            const next = { kind, key, value, setAtLevel: level, setAtPath: scope, setAt: new Date().toISOString(), overrides };
            if (i >= 0) list[i] = next;
            else list.push(next);
          }),
        );
        try {
          await queryFulfilled;
          dispatch(withCascade.util.invalidateTags(["Cascade", "Credits", "App", "Tree"]));
        } catch {
          undo.undo();
        }
      },
    }),
    /** Removes the value set at the scope's own level; the inherited one applies again. */
    removeCascade: build.mutation<null, { scope: string; kind: import("./types").CascadeKind; key: string }>({
      query: ({ scope, kind, key }) => ({ url: `cascade?scope=${encodeURIComponent(scope)}&kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(key)}`, method: "DELETE" }),
      async onQueryStarted({ scope, kind, key }, { dispatch, queryFulfilled }) {
        const undo = dispatch(manageApi.util.updateQueryData("getCascade", { scope, kind }, (list) => list.filter((v) => !(v.key === key && v.setAtPath === scope))));
        try {
          await queryFulfilled;
          dispatch(withCascade.util.invalidateTags(["Cascade", "Credits", "App", "Tree"]));
        } catch {
          undo.undo();
        }
      },
    }),
    createNode: build.mutation<import("./types").TreeNode, { level: import("./types").ManagedLevel; parent: string; name: string; slug: string }>({
      query: ({ level, ...body }) => ({ url: PLURAL[level], method: "POST", body }),
      extraOptions: guarded(g.treeNodeGuard, "the new part"),
      invalidatesTags: ["Tree", "Credits", "Ontology"],
    }),
    /** Renames, archives or reactivates a node: shown at once on the tree it was read with, and put back if refused. */
    updateNode: build.mutation<import("./types").TreeNode, { level: import("./types").ManagedLevel | "organisation"; id: string; name?: string; status?: string; tree?: TreeArg }>({
      query: ({ level, id, name, status }) => ({
        url: `${level === "organisation" ? "organisations" : PLURAL[level]}/${encodeURIComponent(id)}`,
        method: "PATCH",
        body: { ...(name !== undefined ? { name } : {}), ...(status !== undefined ? { status } : {}) },
      }),
      extraOptions: guarded(g.treeNodeGuard, "the changed part"),
      async onQueryStarted({ id, name, status }, { dispatch, getState, queryFulfilled }) {
        // Every tree read on screen shows it (the person's own and an entered or chosen organisation's).
        const undos = api.util.selectCachedArgsForQuery(getState() as never, "getTree").map((arg) => dispatch(
          api.util.updateQueryData("getTree", arg, (t) => {
            const patch = (n: { id: string; name: string }) => {
              if (n.id !== id) return;
              if (name !== undefined) n.name = name;
              if (status !== undefined) {
                (n as { status?: string }).status = status;
                (n as { archived?: boolean }).archived = status === "archived";
              }
            };
            if (t.organisation) patch(t.organisation);
            for (const d of t.divisions) {
              patch(d);
              for (const p of d.projects) {
                patch(p);
                for (const a of p.apps) patch(a);
              }
            }
          }),
        ));
        try {
          await queryFulfilled;
          dispatch(api.util.invalidateTags(["Tree", "App", "Credits", "Me", "Ontology"]));
        } catch {
          for (const undo of undos) undo.undo();
        }
      },
    }),
    deleteNode: build.mutation<null, { level: import("./types").ManagedLevel; id: string }>({
      query: ({ level, id }) => ({ url: `${PLURAL[level]}/${encodeURIComponent(id)}`, method: "DELETE" }),
      invalidatesTags: ["Tree", "Credits", "Ontology"],
    }),
    /** Builds the app's newest version again and restarts it. */
    republishApp: build.mutation<import("./types").RestoreResult, string>({
      query: (appId) => ({ url: `apps/${encodeURIComponent(appId)}/republish`, method: "POST" }),
      extraOptions: guarded(g.restoreGuard, "the restart"),
      invalidatesTags: (_r, _e, appId) => [{ type: "Versions", id: appId }, { type: "App", id: appId }, "Tree"],
    }),
    /** Moves an employee, keeping or setting who it reports to (left out, it reports to nobody). */
    reassignEmployee: build.mutation<Employee, { id: string; scope: string; reportsTo: string | null }>({
      query: ({ id, scope, reportsTo }) => ({ url: `employees/${encodeURIComponent(id)}/reassign`, method: "POST", body: { scope, ...(reportsTo ? { reportsTo } : {}) } }),
      extraOptions: guarded(g.employeeGuard, "the employee"),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Employee", id }, "Employee", "Tree", "Ontology", "Memory"],
    }),
    /** Brings a released employee back, where it was or somewhere else, with its memory. */
    rehireEmployee: build.mutation<Employee, { id: string; scope?: string }>({
      query: ({ id, scope }) => ({ url: `employees/${encodeURIComponent(id)}/rehire`, method: "POST", body: scope ? { scope } : {} }),
      extraOptions: guarded(g.employeeGuard, "the employee"),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Employee", id }, "Employee", "Tree", "Ontology", "Memory"],
    }),
    /** An employee's whole record, released ones included, to list who was let go. */
    getEmployeesWithReleased: build.query<Employee[], string>({
      query: (scope) => `employees?scope=${encodeURIComponent(scope)}&includeReleased=true`,
      providesTags: ["Employee"],
      extraOptions: guarded(g.employeesGuard, "the workforce"),
    }),
  }),
});

export const {
  useGetCascadeQuery,
  useGetCascadeBelowQuery,
  useSetCascadeMutation,
  useRemoveCascadeMutation,
  useCreateNodeMutation,
  useUpdateNodeMutation,
  useDeleteNodeMutation,
  useRepublishAppMutation,
  useGetEmployeesWithReleasedQuery,
  useReassignEmployeeMutation,
  useRehireEmployeeMutation,
} = manageApi;
