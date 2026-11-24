import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

export type HealthState = "healthy" | "unhealthy";

export interface ServiceHealth {
  key: string;
  name: string;
  state: HealthState;
  latencyMs: number;
  detail: string | null;
}

export interface SystemStatus {
  overall: HealthState;
  checkedAt: string;
  services: ServiceHealth[];
}

/**
 * The console's one API. Absolute base URL on purpose: the browser resolves a relative one
 * against the page, but `fetchBaseQuery` builds a `Request` first, and outside a browser
 * (the unit tests) a relative `Request` URL throws.
 */
const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({ baseUrl: `${origin}/api` }),
  endpoints: (build) => ({
    getSystemStatus: build.query<SystemStatus, undefined>({
      query: () => "system/status",
    }),
  }),
});

export const { useGetSystemStatusQuery } = api;
