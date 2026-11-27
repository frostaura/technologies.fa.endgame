import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemStatus } from "@/store/api";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { SystemRoute } from "./SystemRoute";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };

const STATUS: SystemStatus = {
  overall: "unhealthy",
  checkedAt: "2026-11-24T19:00:00Z",
  services: [
    { key: "control-plane", name: "Control plane", state: "healthy", latencyMs: 3, detail: null },
    { key: "runner", name: "Runner", state: "unhealthy", latencyMs: 2000, detail: "No answer within 2000 ms." },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the System page in normal mode (console-desktop 49)", () => {
  it("answers whether Endgame is working, in plain words, without naming a service", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/system/status": json(STATUS) });
    renderWithStore(<SystemRoute />);
    expect(await screen.findByRole("heading", { name: "Part of Endgame is not answering" })).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "While it is not answering" })).toBeTruthy();
    // Rule 12: normal mode never names infrastructure.
    const main = screen.getByRole("heading", { name: "Is Endgame working?" }).closest("main") ?? document.body;
    expect(main.textContent).not.toMatch(/Runner|Control plane|2000 ms/);
  });

  it("says everything is working when every part answered", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/system/status": json({ ...STATUS, overall: "healthy", services: STATUS.services.map((s) => ({ ...s, state: "healthy" })) }) });
    renderWithStore(<SystemRoute />);
    expect(await screen.findByRole("heading", { name: "Everything is working" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "While it is not answering" })).toBeNull();
  });

  it("is a failure, not a quiet system, when the check cannot be read, and switches to the technical view", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/system/status": problem(503, "Unavailable") });
    renderWithStore(<SystemRoute />);
    expect(await screen.findByText("Endgame could not be asked how it is")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to technical mode" }));
    expect(await screen.findByRole("heading", { name: "System status" })).toBeTruthy();
  });
});
