import { act, cleanup, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeStore } from "@/store";
import type { SystemStatus } from "@/store/api";
import { SystemStatusView } from "./SystemStatusView";

const CONTROL_PLANE = { key: "control-plane", name: "Control plane", state: "healthy", latencyMs: 3, detail: null } as const;

const HEALTHY: SystemStatus = {
  overall: "healthy",
  checkedAt: "2026-11-24T19:00:00Z",
  services: [
    CONTROL_PLANE,
    { key: "dock", name: "Dock", state: "healthy", latencyMs: 12, detail: "Engine 29.9.3 reachable." },
  ],
};

const DEGRADED: SystemStatus = {
  ...HEALTHY,
  overall: "unhealthy",
  services: [
    CONTROL_PLANE,
    { key: "runner", name: "Runner", state: "unhealthy", latencyMs: 2000, detail: "No answer within 2000 ms." },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderView() {
  return render(
    <Provider store={makeStore()}>
      <SystemStatusView />
    </Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SystemStatusView", () => {
  it("shows a loading state while the first check is in flight", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderView();
    const loading = screen.getByRole("status");
    expect(loading).toHaveProperty("dataset.state", "loading");
    expect(loading.textContent).toContain("Checking every service");
    expect(screen.queryByRole("list", { name: "Services" })).toBeNull();
  });

  it("lists every service when all are healthy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(HEALTHY)));
    renderView();
    expect(await screen.findByText("All services healthy")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Services" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByText("Healthy")).toHaveLength(2);
    expect(screen.getByText("Engine 29.9.3 reachable.")).toBeTruthy();
  });

  it("names the unhealthy service and why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(DEGRADED)));
    renderView();
    expect(await screen.findByText("1 of 2 services unhealthy")).toBeTruthy();
    const runner = document.querySelector('[data-service="runner"]') as HTMLElement;
    expect(runner.dataset.state).toBe("unhealthy");
    expect(within(runner).getByText("Unhealthy")).toBeTruthy();
    expect(within(runner).getByText("No answer within 2000 ms.")).toBeTruthy();
  });

  it("renders a failed read as a failure, never as an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ title: "boom" }, 502)));
    renderView();
    const alert = await screen.findByRole("alert");
    expect(alert.dataset.state).toBe("failed");
    expect(alert.textContent).toContain("System status could not be loaded");
    expect(alert.textContent).toContain("502");
    expect(screen.queryByRole("list", { name: "Services" })).toBeNull();
    expect(screen.queryByText("All services healthy")).toBeNull();
  });

  it("says so when the control plane cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    renderView();
    expect((await screen.findByRole("alert")).textContent).toContain("could not be reached");
  });

  it("keeps the last good answer, marked stale, when a later check fails", async () => {
    const fetch = vi.fn(async () => json(HEALTHY));
    vi.stubGlobal("fetch", fetch);
    renderView();
    await screen.findByText("All services healthy");

    fetch.mockImplementation(async () => json({}, 503));
    await act(async () => {
      screen.getByRole("button", { name: "Check again" }).click();
    });
    const stale = await screen.findByText(/The latest check failed/);
    expect(stale.dataset.state).toBe("stale");
    expect(stale.textContent).toContain("503");
    expect(screen.getByRole("list", { name: "Services" })).toBeTruthy();
  });
});
