import { act, cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOrganisation, useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { makeStore } from "@/store";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { rememberReturnTo, safeReturnTo, takeReturnTo } from "../auth/returnTo";
import { AccountView } from "./AccountView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [] };
const TWO = {
  ...ME,
  passkeys: 2,
  memberships: [
    ...ME.memberships,
    { id: "m2", scope: "beta/labs", level: "division", role: "builder", organisationId: "o2", organisationSlug: "beta", organisationName: "Beta Works" },
  ],
};

function stub(me: unknown = TWO, extra = {}) {
  return stubApi({ "GET /api/me": json(me), "GET /api/credits": json(CREDITS), "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }), ...extra });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Your account", () => {
  it("shows a skeleton, then a failed read as a failure", async () => {
    stub(undefined, { "GET /api/me": problem(500, "Down") });
    renderWithStore(<AccountView />);
    expect(await screen.findByText("Your account could not be loaded")).toBeTruthy();
  });

  it("lists the passkeys and every role held, in every organisation", async () => {
    stub();
    renderWithStore(<AccountView />);
    expect(await screen.findByText(/2 passkeys can sign you in/)).toBeTruthy();
    const roles = screen.getByRole("list", { name: "Your roles in each organisation" });
    expect(roles.textContent).toContain("Owner of the whole organisation");
    expect(roles.textContent).toContain("Builder of a division, labs");
    expect(within(roles).getByText("Working in it now")).toBeTruthy();
  });

  it("adds another passkey with this device, and says when the device said no", async () => {
    const created = { id: "cred", rawId: new Uint8Array([1]).buffer, type: "public-key", response: { clientDataJSON: new Uint8Array([1]).buffer, attestationObject: new Uint8Array([2]).buffer, getTransports: () => ["internal"] }, getClientExtensionResults: () => ({}), authenticatorAttachment: "platform" };
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    const create = vi.fn().mockResolvedValueOnce(created).mockRejectedValueOnce(Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" }));
    Object.defineProperty(navigator, "credentials", { value: { create }, configurable: true });
    const api = stub(TWO, {
      "POST /api/auth/passkey/register/options": json({ publicKey: { challenge: "AQ", rp: { name: "Endgame" }, user: { id: "AQ", name: "o@example.test", displayName: "Owner" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] } }),
      "POST /api/auth/passkey/register/complete": json(TWO),
    });
    renderWithStore(<AccountView />);
    fireEvent.click(await screen.findByRole("button", { name: "Add another passkey" }));
    expect(await screen.findByText("The new passkey is saved. Any of them signs you in now.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/api/auth/passkey/register/complete")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add another passkey" }));
    expect((await screen.findByText(/No passkey was added:/)).getAttribute("role")).toBe("alert");
  });

  it("words a first passkey as the only one (D1)", async () => {
    const created = { id: "cred", rawId: new Uint8Array([1]).buffer, type: "public-key", response: { clientDataJSON: new Uint8Array([1]).buffer, attestationObject: new Uint8Array([2]).buffer, getTransports: () => ["internal"] }, getClientExtensionResults: () => ({}), authenticatorAttachment: "platform" };
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    Object.defineProperty(navigator, "credentials", { value: { create: vi.fn().mockResolvedValueOnce(created) }, configurable: true });
    const NONE = { ...TWO, passkeys: 0 };
    stub(NONE, {
      "POST /api/auth/passkey/register/options": json({ publicKey: { challenge: "AQ", rp: { name: "Endgame" }, user: { id: "AQ", name: "o@example.test", displayName: "Owner" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] } }),
      "POST /api/auth/passkey/register/complete": json({ ...TWO, passkeys: 1 }),
    });
    renderWithStore(<AccountView />);
    expect(screen.queryByRole("button", { name: "Add another passkey" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));
    expect(await screen.findByText("The passkey is saved. It signs you in now.")).toBeTruthy();
  });

  it("switches the organisation every screen works in", async () => {
    stub();
    renderWithStore(<AccountView />);
    // The header carries a compact switcher too; this is the one on the account page itself.
    const select = (await within(await screen.findByRole("main")).findByLabelText("Working in")) as HTMLSelectElement;
    expect(select.value).toBe("acme");
    fireEvent.change(select, { target: { value: "beta" } });
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(localStorage.getItem("endgame.organisation")).toBe("beta");
  });
});

describe("the active organisation", () => {
  const wrapper = (store: ReturnType<typeof makeStore>) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    };

  it("is the person's own, then the one they chose", async () => {
    stub();
    const { result } = renderHook(() => useActiveOrganisation(), { wrapper: wrapper(makeStore()) });
    await waitFor(() => expect(result.current.organisation?.slug).toBe("acme"));
    expect(result.current.role).toBe("owner");
    act(() => chooseOrganisation("beta"));
    await waitFor(() => expect(result.current.organisation?.slug).toBe("beta"));
    // Their only grant in Beta is at a division, so they hold no role at the organisation itself.
    expect(result.current.role).toBeNull();
    expect(result.current.entered).toBe(false);
  });

  it("is the one an operator entered, as an Admin", async () => {
    window.history.replaceState(null, "", "/?organisation=globex");
    stub(
      { ...ME, isOperator: true },
      { "GET /api/tree": json({ generatedAt: "t", viewerRole: "admin", organisation: { id: "o9", slug: "globex", name: "Globex", summary: null, spend: { monthCredits: 0 }, workers: [] }, divisions: [], needsYou: [] }) },
    );
    const { result } = renderHook(() => useActiveOrganisation(), { wrapper: wrapper(makeStore()) });
    await waitFor(() => expect(result.current.organisation?.name).toBe("Globex"));
    expect(result.current).toMatchObject({ entered: true, role: "admin", organisation: { id: "o9", slug: "globex" } });
  });
});

describe("landing where you were going after signing in", () => {
  it("keeps only a console address, never the sign-in page or another site", () => {
    expect(safeReturnTo("/apps/a1?x=1")).toBe("/apps/a1?x=1");
    expect(safeReturnTo("/sign-in")).toBeNull();
    expect(safeReturnTo("//evil.example")).toBeNull();
    expect(safeReturnTo("https://evil.example/")).toBeNull();
    expect(safeReturnTo("/")).toBeNull();
  });

  it("remembers the address first asked for, and gives it back once", () => {
    window.history.replaceState(null, "", "/credits");
    expect(rememberReturnTo()).toBe("/credits");
    window.history.replaceState(null, "", "/sign-in");
    expect(rememberReturnTo()).toBe("/credits");
    expect(takeReturnTo(null)).toBe("/credits");
    expect(takeReturnTo(null)).toBeNull();
  });
});
