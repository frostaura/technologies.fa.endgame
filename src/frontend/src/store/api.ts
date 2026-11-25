import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import { check, type Guard } from "@/lib/guards";
import * as g from "./guards";
import type {
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
export const API_BASE = `${origin}/api`;

/** What an endpoint's answer is checked against before it reaches the store, and what it is called on the page. */
export interface Checked {
  guard?: Guard<unknown>;
  what?: string;
}

const raw = fetchBaseQuery({ baseUrl: API_BASE, credentials: "same-origin" });

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
  tagTypes: ["Me", "Tree", "Idea", "Run", "App", "Credits", "Conversation", "Secrets", "Shares", "OperatorAccess", "Employee", "Memory", "Hire", "Autonomy", "Ontology", "Tasks"],
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
    getTree: build.query<Tree, undefined>({ query: () => "tree", providesTags: ["Tree"], extraOptions: guarded(g.treeGuard, "the organisation") }),
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
    decideIdea: build.mutation<Idea, { id: string; choice: DecisionChoice; note?: string }>({
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

    // Conversation ------------------------------------------------------------------------
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
    employeeAction: build.mutation<Employee, { id: string; action: "release" | "rehire" | "reassign"; scope?: string }>({
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
    removeMemory: build.mutation<null, { id: string; entryId: string; why: string; includeArchived: boolean }>({
      query: ({ id, entryId, why }) => ({ url: `employees/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}?why=${encodeURIComponent(why)}`, method: "DELETE" }),
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
    getTasks: build.query<TaskItem[], { scope: string; limit?: number }>({
      query: ({ scope, limit }) => `tasks?scope=${encodeURIComponent(scope)}&limit=${limit ?? 100}`,
      providesTags: ["Tasks"],
      extraOptions: guarded(g.tasksGuard, "the recent work"),
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
} = api;
