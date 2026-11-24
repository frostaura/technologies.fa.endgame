import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigate } from "@/lib/router";
import type { SecretList } from "@/store/types";
import { ME, json, problem, renderWithStore, stubApi, type Route } from "@/test/harness";
import { SecretsView } from "./SecretsView";

const CREDITS = { scope: "acme", balance: 5, month: { spent: 0, ai: 0, hosting: 0 }, monthsLeftAtPace: null, budgets: [], estimates: null, notCharged: { credits: 0, repairs: 0 }, overdraft: null, topUps: [], heldCredits: 0, available: 5 };
const TREE = {
  generatedAt: "2026-11-24T10:00:00Z",
  viewerRole: "owner",
  organisation: { id: "o1", slug: "acme", name: "Acme", summary: null, spend: { monthCredits: 0 }, workers: [] },
  divisions: [{ id: "d1", slug: "tools", name: "Tools", spend: { monthCredits: 0 }, workers: [], projects: [{ id: "p1", slug: "ledger", name: "Ledger", stage: "live", ideaId: null, note: null, progress: null, spend: { monthCredits: 0 }, workers: [], apps: [] }] }],
  needsYou: [],
};
const LIST: SecretList = {
  scope: "acme/tools",
  effective: [
    { name: "MAIL_KEY", setAtLevel: "organisation", setAtPath: "acme", setAt: "2026-11-01T00:00:00Z", inherited: true, overrides: [] },
    { name: "MAPS_KEY", setAtLevel: "division", setAtPath: "acme/tools", setAt: "2026-11-02T00:00:00Z", inherited: false, overrides: ["acme"] },
  ],
  setBelow: [{ name: "PAY_KEY", setAtPath: "acme/tools/ledger" }],
};

function stub(secrets: Route, extra: Record<string, Route> = {}) {
  return stubApi({ "GET /api/me": json(ME), "GET /api/credits": json(CREDITS), "GET /api/tree": json(TREE), "GET /api/secrets": secrets, ...extra });
}

beforeEach(() => navigate("/secrets?scope=acme%2Ftools", { replace: true }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SecretsView", () => {
  it("shows a skeleton while the names load", () => {
    stub("pending");
    renderWithStore(<SecretsView />);
    expect(screen.getByRole("status", { name: "" }).dataset.state).toBe("loading");
  });

  it("records a refusal as a failure, never as an empty list", async () => {
    stub(problem(403, "This needs the admin role at 'acme/tools'"));
    renderWithStore(<SecretsView />);
    const alert = await screen.findByRole("alert");
    expect(alert.dataset.state).toBe("failed");
    expect(alert.textContent).toContain("You cannot see the secrets here");
    expect(alert.textContent).toContain("This needs the admin role at 'acme/tools' (403)");
    expect(screen.queryByText(/No secrets apply/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Add a secret" })).toBeNull();
  });

  it("says plainly when nothing applies", async () => {
    stub(json({ scope: "acme/tools", effective: [], setBelow: [] }));
    renderWithStore(<SecretsView />);
    expect((await screen.findByText("No secrets apply to Tools")).closest("[data-state]")?.getAttribute("data-state")).toBe("empty");
    expect(screen.getByText(/Nothing beneath Tools sets a secret of its own/)).toBeTruthy();
  });

  it("names each secret, the level that set it and what it overrides, and those set beneath — never a value", async () => {
    const api = stub(json(LIST));
    renderWithStore(<SecretsView />);
    expect(await screen.findByRole("heading", { name: "Secrets for Tools" })).toBeTruthy();
    expect(api.calls.find((c) => c.path.startsWith("/api/secrets"))?.path).toBe("/api/secrets?scope=acme%2Ftools");
    const list = screen.getByRole("list", { name: "Secrets" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("MAIL_KEY")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "Acme" }).getAttribute("href")).toBe("/secrets?scope=acme");
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "Set its own here" })).toBeTruthy();
    expect(within(rows[0] as HTMLElement).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText("Set here")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("Replaces the one set at Acme.")).toBeTruthy();
    const below = screen.getByRole("list", { name: "Set beneath" });
    expect(within(below).getByRole("link", { name: "Ledger" }).getAttribute("href")).toBe("/secrets?scope=acme%2Ftools%2Fledger");
    expect(screen.getByRole("navigation", { name: "Where you are" }).textContent).toBe("Acme/Tools/Secrets");
  });

  it("checks the name, sends the value once, clears it, and never keeps it in the store", async () => {
    let saved = false;
    const api = stub(() => json(saved ? { ...LIST, effective: [...LIST.effective, { name: "STRIPE_API_KEY", setAtLevel: "division", setAtPath: "acme/tools", setAt: "2026-11-25T00:00:00Z", inherited: false, overrides: [] }] } : LIST), {
      "PUT /api/secrets": () => {
        saved = true;
        return json({ name: "STRIPE_API_KEY", setAtLevel: "division", setAtPath: "acme/tools", setAt: "2026-11-25T00:00:00Z", inherited: false, overrides: [] });
      },
    });
    const { store } = renderWithStore(<SecretsView />);
    const form = await screen.findByRole("region", { name: "Add a secret" });
    const name = within(form).getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "1bad" } });
    fireEvent.blur(name);
    expect(within(form).getByText(/Use capital letters, digits and underscores/)).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Save the secret" }));
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);

    // Typed in lower case with a hyphen, it becomes the UPPER_SNAKE_CASE the control plane wants.
    fireEvent.change(name, { target: { value: "stripe-api-key" } });
    expect(name.value).toBe("STRIPE_API_KEY");
    const value = within(form).getByLabelText("Value") as HTMLInputElement;
    expect(value.type).toBe("password");
    fireEvent.change(value, { target: { value: "sk_live_secret_value" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save the secret" }));
    expect(value.value).toBe("");
    expect(await within(form).findByText("STRIPE_API_KEY is saved. Its value is sealed and will not be shown.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: "acme/tools", name: "STRIPE_API_KEY", value: "sk_live_secret_value" });
    expect(JSON.stringify(store.getState())).not.toContain("sk_live_secret_value");
    expect(document.body.textContent).not.toContain("sk_live_secret_value");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Secrets" })).getByText("STRIPE_API_KEY")).toBeTruthy());
  });

  it("takes a refused secret back off the list and says why", async () => {
    const pending: { answer?: (r: Response) => void } = {};
    stub(json(LIST), { "PUT /api/secrets": () => new Promise<Response>((resolve) => (pending.answer = resolve)) });
    renderWithStore(<SecretsView />);
    const form = await screen.findByRole("region", { name: "Add a secret" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "NEW_KEY" } });
    fireEvent.change(within(form).getByLabelText("Value"), { target: { value: "v" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save the secret" }));
    // Optimistic: the name is listed at once.
    expect(await within(screen.getByRole("list", { name: "Secrets" })).findByText("NEW_KEY")).toBeTruthy();
    await waitFor(() => expect(pending.answer).toBeDefined());
    pending.answer?.(problem(403, "This needs the admin role"));
    expect(await within(form).findByText(/NEW_KEY was not saved: This needs the admin role \(403\) Nothing changed/)).toBeTruthy();
    // The store batches its notifications to the next frame; the row goes then.
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Secrets" })).queryByText("NEW_KEY")).toBeNull());
  });

  it("replaces a secret set here with a new value, naming it", async () => {
    const api = stub(json(LIST), { "PUT /api/secrets": json(LIST.effective[1]) });
    renderWithStore(<SecretsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    fireEvent.change(screen.getByLabelText("New value for MAPS_KEY"), { target: { value: "next" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace the secret" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ scope: "acme/tools", name: "MAPS_KEY", value: "next" }));
  });

  it("removes a secret only after it is confirmed, saying what applies again", async () => {
    const api = stub(json(LIST), { "DELETE /api/secrets": json(null, 204) });
    renderWithStore(<SecretsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    const confirm = screen.getByRole("group", { name: "Confirm removing MAPS_KEY" });
    expect(confirm.textContent).toContain("The one set at Acme applies again.");
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove it" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "DELETE")?.path).toBe("/api/secrets?scope=acme%2Ftools&name=MAPS_KEY"));
  });

  it("puts a refused removal back and says why", async () => {
    stub(json(LIST), { "DELETE /api/secrets": problem(403, "Not yours to remove") });
    renderWithStore(<SecretsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove it" }));
    expect(await screen.findByText(/MAPS_KEY was not removed: Not yours to remove \(403\) It still applies/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Secrets" })).getByText("MAPS_KEY")).toBeTruthy();
  });

  it("uses the organisation when no scope is named", async () => {
    navigate("/secrets", { replace: true });
    const api = stub(json({ scope: "acme", effective: [], setBelow: [] }));
    renderWithStore(<SecretsView />);
    await screen.findByText("No secrets apply to Acme");
    expect(api.calls.find((c) => c.path.startsWith("/api/secrets"))?.path).toBe("/api/secrets?scope=acme");
  });
});
