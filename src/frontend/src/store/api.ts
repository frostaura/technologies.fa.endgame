import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AppDetail,
  AppSettingsUpdate,
  AuthOptions,
  ConversationRequest,
  CreateIdeaRequest,
  Credits,
  DecisionChoice,
  Idea,
  IdeaEstimate,
  Me,
  OrganisationRef,
  Run,
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

export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({ baseUrl: API_BASE, credentials: "same-origin" }),
  tagTypes: ["Me", "Tree", "Idea", "Run", "App", "Credits"],
  endpoints: (build) => ({
    // Session -----------------------------------------------------------------------------
    getMe: build.query<Me, undefined>({ query: () => "me", providesTags: ["Me"] }),
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
    getTree: build.query<Tree, undefined>({ query: () => "tree", providesTags: ["Tree"] }),
    createOrganisation: build.mutation<OrganisationRef, { name: string; slug: string }>({
      query: (body) => ({ url: "organisations", method: "POST", body }),
      invalidatesTags: ["Me", "Tree", "Credits"],
    }),

    // Ideas -------------------------------------------------------------------------------
    estimateIdea: build.mutation<IdeaEstimate, CreateIdeaRequest>({
      query: (body) => ({ url: "ideas/estimate", method: "POST", body }),
    }),
    createIdea: build.mutation<Idea, CreateIdeaRequest>({
      query: (body) => ({ url: "ideas", method: "POST", body }),
      invalidatesTags: ["Tree", "Credits"],
    }),
    getIdea: build.query<Idea, string>({ query: (id) => `ideas/${encodeURIComponent(id)}`, providesTags: (_r, _e, id) => [{ type: "Idea", id }] }),
    decideIdea: build.mutation<Idea, { id: string; choice: DecisionChoice; note?: string }>({
      query: ({ id, ...body }) => ({ url: `ideas/${encodeURIComponent(id)}/decision`, method: "POST", body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Idea", id }, "Tree", "Credits"],
    }),

    // Runs --------------------------------------------------------------------------------
    getRun: build.query<Run, string>({ query: (id) => `runs/${encodeURIComponent(id)}`, providesTags: (_r, _e, id) => [{ type: "Run", id }] }),
    controlRun: build.mutation<Run, { id: string; action: "pause" | "resume" | "cancel" }>({
      query: ({ id, action }) => ({ url: `runs/${encodeURIComponent(id)}/${action}`, method: "POST" }),
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
    }),

    // Apps --------------------------------------------------------------------------------
    getApp: build.query<AppDetail, string>({ query: (id) => `apps/${encodeURIComponent(id)}`, providesTags: (_r, _e, id) => [{ type: "App", id }] }),
    updateAppSettings: build.mutation<AppDetail, { id: string; settings: AppSettingsUpdate }>({
      query: ({ id, settings }) => ({ url: `apps/${encodeURIComponent(id)}/settings`, method: "POST", body: settings }),
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

    // Credits -----------------------------------------------------------------------------
    getCredits: build.query<Credits, string>({
      query: (scope) => `credits?scope=${encodeURIComponent(scope)}`,
      providesTags: ["Credits"],
    }),

    // System ------------------------------------------------------------------------------
    getSystemStatus: build.query<SystemStatus, undefined>({ query: () => "system/status" }),
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
  useGetAppQuery,
  useUpdateAppSettingsMutation,
  useGetCreditsQuery,
  useGetSystemStatusQuery,
} = api;
