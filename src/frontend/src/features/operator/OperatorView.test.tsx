import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_ORGS, OPERATOR_TOP_UPS, PRICING, TOP_UP_REQUESTS } from "@/test/breadth";
import { ME, json, problem, renderWithStore, stubApi } from "@/test/harness";
import { OperatorView } from "./OperatorView";
import { pricingRows } from "./operatorModel";

const OPERATOR = { user: { id: "op1", displayName: "Operator", email: "op@example.test" }, organisation: null, isOperator: true, passkeys: 0, memberships: [] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stub(extra = {}) {
  return stubApi({
    "GET /api/me": json(OPERATOR),
    "GET /api/operator/organisations": json(OPERATOR_ORGS),
    "GET /api/operator/top-up-requests": json(TOP_UP_REQUESTS),
    "GET /api/operator/top-ups": json(OPERATOR_TOP_UPS),
    "GET /api/operator/pricing": json(PRICING),
    ...extra,
  });
}

describe("God mode", () => {
  it("is closed to anyone who is not an operator, and says why", async () => {
    stubApi({ "GET /api/me": json(ME), "GET /api/credits": json({}), "GET /api/notifications": json({ organisation: "acme", unread: 0, notifications: [] }) });
    renderWithStore(<OperatorView />);
    expect(await screen.findByText("God mode is for FrostAura operators")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Organisations" })).toBeNull();
  });

  it("is marked as God mode on every screen", async () => {
    stub();
    renderWithStore(<OperatorView />);
    expect((await screen.findByRole("note", { name: "God mode" })).textContent).toContain("logged where its Owner can read it");
  });

  it("shows loading, failed and every organisation with balance, standing, overdraft, apps and last activity", async () => {
    stub({ "GET /api/operator/organisations": "pending" });
    renderWithStore(<OperatorView />);
    expect((await screen.findByText("Loading every organisation")).closest("[data-state]")?.getAttribute("data-state")).toBe("loading");
    cleanup();
    stub({ "GET /api/operator/organisations": problem(500, "No list") });
    renderWithStore(<OperatorView />);
    expect(await screen.findByText("The organisations could not be loaded")).toBeTruthy();
    cleanup();
    stub();
    renderWithStore(<OperatorView />);
    const card = (await screen.findByRole("list", { name: "Organisations" })).querySelector('[data-org="acme"]') as HTMLElement;
    expect(within(card).getByText("4,967")).toBeTruthy();
    expect(within(card).getByText("In credit")).toBeTruthy();
    expect(within(card).getByText("0 below zero")).toBeTruthy();
    expect(within(card).getByText("One top-up request is waiting.")).toBeTruthy();
  });

  it("enters an organisation, saying plainly where the entry is logged", async () => {
    stub({ "POST /api/operator/organisations/acme/enter": json({ organisationId: "o1", organisation: "acme", role: "admin", enteredAt: new Date().toISOString(), logged: "in Acme's operator log, which its Owner reads" }) });
    renderWithStore(<OperatorView />);
    const card = (await screen.findByRole("list", { name: "Organisations" })).querySelector('[data-org="acme"]') as HTMLElement;
    expect(within(card).getByText(/Entering is logged where Acme’s Owner can read it/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Enter Acme" }));
    expect(await within(card).findByText("Logged: in Acme's operator log, which its Owner reads")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Open its org chart" }).getAttribute("href")).toBe("/?organisation=acme");
  });

  it("fulfils a top-up request with a top-up naming it, once, with one key", async () => {
    const api = stub({ "POST /api/credits/top-ups": json({ id: "tu2" }) });
    renderWithStore(<OperatorView />);
    const request = (await screen.findByRole("list", { name: "Waiting requests" })).querySelector('[data-request="tr1"]') as HTMLElement;
    fireEvent.click(within(request).getByRole("button", { name: "Add the credits" }));
    fireEvent.click(within(request).getByRole("button", { name: "Add it and close the request" }));
    expect(await within(request).findByText(/Added 2,000 credits to Acme/)).toBeTruthy();
    const body = api.calls.find((c) => c.path === "/api/credits/top-ups")?.body as Record<string, unknown>;
    expect(body).toMatchObject({ organisation: "acme", credits: 2000, requestId: "tr1" });
    expect(typeof body.idempotencyKey).toBe("string");
  });

  it("declines a request with a reason the Owner reads", async () => {
    const api = stub({ "POST /api/operator/top-up-requests/tr1/close": json({ ...TOP_UP_REQUESTS[0], status: "declined" }) });
    renderWithStore(<OperatorView />);
    const request = (await screen.findByRole("list", { name: "Waiting requests" })).querySelector('[data-request="tr1"]') as HTMLElement;
    fireEvent.click(within(request).getByRole("button", { name: "Decline" }));
    fireEvent.change(within(request).getByLabelText("Why (the Owner reads this)"), { target: { value: "Pay the last one first" } });
    fireEvent.click(within(request).getByRole("button", { name: "Decline it" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/close"))?.body).toEqual({ status: "declined", note: "Pay the last one first" }));
  });

  it("sets an organisation's deepest overdraft at once and rolls it back when refused", async () => {
    stub({ "PUT /api/operator/organisations/acme/overdraft": () => new Promise<Response>((r) => setTimeout(() => r(problem(400, "Not a number")), 60)) });
    renderWithStore(<OperatorView />);
    const card = (await screen.findByRole("list", { name: "Organisations" })).querySelector('[data-org="acme"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Deepest overdraft" }));
    fireEvent.change(within(card).getByLabelText("The most it may go below zero"), { target: { value: "3000" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(card).getByText("Set by you: 3,000")).toBeTruthy());
    expect(await within(card).findByText(/The overdraft was not changed: Not a number/)).toBeTruthy();
    await waitFor(() => expect(within(card).getByText("Set by you: 0")).toBeTruthy());
  });

  it("closes the deepest-overdraft form once it is saved, and says what holds now (D57)", async () => {
    const acme = OPERATOR_ORGS.find((o) => o.slug === "acme") as (typeof OPERATOR_ORGS)[number];
    stub({ "PUT /api/operator/organisations/acme/overdraft": json({ ...acme, overdraft: { ...acme.overdraft, frostauraLimit: 3000 } }) });
    renderWithStore(<OperatorView />);
    const card = (await screen.findByRole("list", { name: "Organisations" })).querySelector('[data-org="acme"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Deepest overdraft" }));
    fireEvent.change(within(card).getByLabelText("The most it may go below zero"), { target: { value: "3000" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    expect(await within(card).findByText(/may now go 3,000 below zero at most/)).toBeTruthy();
    expect(within(card).queryByLabelText("The most it may go below zero")).toBeNull();
    expect(within(card).getByRole("button", { name: "Deepest overdraft" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("refuses a margin below one and asks before changing the prices", async () => {
    const api = stub({ "PUT /api/operator/pricing": json({ ...PRICING, pricing: { ...PRICING.pricing, margin: 1.2 }, source: "stored", updatedAt: "2026-11-25T03:00:00Z" }) });
    renderWithStore(<OperatorView />);
    const margin = await screen.findByLabelText("Margin");
    fireEvent.change(margin, { target: { value: "0.9" } });
    expect(screen.getByText(/At least 1.0/)).toBeTruthy();
    fireEvent.change(margin, { target: { value: "1.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the prices" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Confirm the new prices" })).getByRole("button", { name: "Change the prices" }));
    expect(await screen.findByText("The new prices hold from now on, for every organisation.")).toBeTruthy();
    expect((api.calls.find((c) => c.method === "PUT")?.body as { margin: number }).margin).toBe(1.2);
  });

  it("provisions an organisation for an invited Owner and shows their code once", async () => {
    const api = stub({
      "POST /api/organisations": json(
        {
          id: "o2",
          slug: "beta-works",
          name: "Beta Works",
          ownerEmail: "b@example.test",
          ownerInvitationCode: "owner-code-xyz",
          invitationExpiresAt: "2026-12-09T00:00:00Z",
          invitationEmailed: true,
          nameCheck: { slug: "beta-works", source: "built-in", note: null },
          screening: { method: "model", result: "clear", reason: "It makes garden tools." },
          balance: 0,
          creditsNote: "Beta Works has no credits until you top it up: its first piece of work waits for budget until then.",
        },
        201,
      ),
    });
    const { store } = renderWithStore(<OperatorView />);
    fireEvent.change(await screen.findByLabelText("Its name"), { target: { value: "Beta Works" } });
    expect((screen.getByLabelText("Its address name") as HTMLInputElement).value).toBe("beta-works");
    fireEvent.change(screen.getByLabelText("The Owner's e-mail"), { target: { value: "b@example.test" } });
    // What it does is required: it is screened against the red lines before anything is set up.
    expect((screen.getByRole("button", { name: "Set it up" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/What it does is screened against FrostAura’s red lines before it is set up/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What it does"), { target: { value: "Makes and sells garden tools." } });
    fireEvent.click(screen.getByRole("button", { name: "Set it up" }));
    const code = await screen.findByRole("status", { name: "The Owner's invitation code" });
    expect(within(code).getByText("owner-code-xyz")).toBeTruthy();
    expect(code.textContent).toContain("The code was e-mailed to them too.");
    expect(code.textContent).toContain("It was screened against the red lines and crosses none: It makes garden tools.");
    expect(code.textContent).toContain("Beta Works has no credits until you top it up: its first piece of work waits for budget until then.");
    expect(api.calls.find((c) => c.path === "/api/organisations")?.body).toEqual({ name: "Beta Works", slug: "beta-works", ownerEmail: "b@example.test", description: "Makes and sells garden tools." });
    expect(JSON.stringify(store.getState())).not.toContain("owner-code-xyz");
  });

  it("asks for the operator's own screening, with a reason, when no model can be reached; a breach is refused", async () => {
    let attempt = 0;
    const api = stub({
      "POST /api/organisations": () =>
        ++attempt === 1
          ? json({ status: 503, code: "screening_unavailable", title: "The organisation could not be screened", detail: "It is screened against FrostAura's red lines before it is set up, and no model could be reached. Try again shortly, or record your own screening decision with a written reason." }, 503)
          : json({ status: 422, code: "red_line", title: "FrostAura does not set this organisation up", detail: "What it does crosses a red line — surveillance and authoritarian tooling: It tracks protesters." }, 422),
    });
    renderWithStore(<OperatorView />);
    fireEvent.change(await screen.findByLabelText("Its name"), { target: { value: "Watch" } });
    fireEvent.change(screen.getByLabelText("The Owner's e-mail"), { target: { value: "w@example.test" } });
    fireEvent.change(screen.getByLabelText("What it does"), { target: { value: "Tracks protesters for clients." } });
    fireEvent.click(screen.getByRole("button", { name: "Set it up" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no model could be reached");
    const own = screen.getByRole("group", { name: "Screen it yourself" });
    fireEvent.change(within(own).getByLabelText("Your decision"), { target: { value: "breach" } });
    expect((screen.getByRole("button", { name: "Set it up" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(own).getByLabelText("Why"), { target: { value: "It is surveillance of citizens." } });
    fireEvent.click(screen.getByRole("button", { name: "Set it up" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("surveillance and authoritarian tooling: It tracks protesters."));
    expect(api.calls.filter((c) => c.path === "/api/organisations")[1]?.body).toMatchObject({ screening: { decision: "breach", reason: "It is surveillance of citizens." } });
  });

  it("names each top-up's organisation by its display name, and its address name only in technical mode", async () => {
    stub({ "GET /api/operator/top-ups": json([{ ...OPERATOR_TOP_UPS[0], organisation: "acme-hq", organisationName: "Acme Holdings" }]) });
    const { unmount } = renderWithStore(<OperatorView />);
    const list = await screen.findByRole("list", { name: "Top-ups" });
    expect(within(list).getByText("Acme Holdings")).toBeTruthy();
    expect(list.textContent).not.toContain("acme-hq");
    unmount();

    localStorage.setItem("endgame.mode", "technical");
    renderWithStore(<OperatorView />);
    const technical = await screen.findByRole("list", { name: "Top-ups" });
    expect(within(technical).getByText("Acme Holdings")).toBeTruthy();
    expect(technical.textContent).toContain("acme-hq");
  });

  it("reads a price change figure by figure", () => {
    expect(pricingRows({ margin: 1, hosting: { usdPerAwakeHour: 0.002 } }, { margin: 1.2, hosting: { usdPerAwakeHour: 0.002 } })).toEqual([{ label: "Margin", before: "1", after: "1.2" }]);
  });
});
