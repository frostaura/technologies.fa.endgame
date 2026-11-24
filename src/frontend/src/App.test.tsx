import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { App } from "./App";
import { fromBase64Url, toBase64Url } from "./features/auth/webauthn";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("App — the session decides what renders", () => {
  it("shows the opening skeleton while the session is checked", () => {
    stubApi({ "GET /api/me": "pending" });
    renderWithStore(<App />);
    expect(screen.getByRole("status").dataset.state).toBe("loading");
  });

  it("sends a signed-out visitor to sign-in, with no development sign-in unless advertised", async () => {
    stubApi({ "GET /api/me": problem(401, "Not signed in"), "GET /api/auth/options": json({ passkey: true, developmentSignIn: false }) });
    renderWithStore(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe("/sign-in"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("button", { name: "Development sign-in" })).toBeNull();
  });

  it("offers the development sign-in only when the API advertises it, and signs in with it", async () => {
    let signedIn = false;
    const api = stubApi({
      "GET /api/me": () => (signedIn ? json(ME) : problem(401, "Not signed in")),
      "GET /api/auth/options": json({ passkey: true, developmentSignIn: true }),
      "POST /api/auth/development": () => {
        signedIn = true;
        return json(ME);
      },
      "GET /api/tree": "pending",
      "GET /api/credits": json(CREDITS),
    });
    renderWithStore(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Development sign-in" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(api.calls.some((c) => c.path === "/api/auth/development")).toBe(true);
  });

  it("records a failed session check, which is not the same as signed out", async () => {
    stubApi({ "GET /api/me": problem(502, "Bad gateway") });
    renderWithStore(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain("Endgame could not check who you are");
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("keeps system status behind technical mode, and remembers the mode", async () => {
    window.history.replaceState(null, "", "/system");
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/system/status": "pending" });
    renderWithStore(<App />);
    expect(await screen.findByRole("heading", { name: "System status is technical detail" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to technical mode" }));
    expect(await screen.findByRole("heading", { name: "System status" })).toBeTruthy();
    expect(window.localStorage.getItem("endgame.mode")).toBe("technical");
    expect(screen.getByRole("button", { name: "Technical" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("answers an unknown address plainly", async () => {
    window.history.replaceState(null, "", "/nowhere/at/all");
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS) });
    renderWithStore(<App />);
    expect(await screen.findByRole("heading", { name: "Nothing lives at this address" })).toBeTruthy();
  });
});

describe("passkey encoding", () => {
  it("round-trips base64url without padding", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(new Uint8Array(fromBase64Url(encoded))).toEqual(bytes);
  });
});
