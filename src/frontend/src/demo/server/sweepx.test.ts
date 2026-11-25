import { describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { buildWorld } from "../world/scenarios";
import "../world/scenarios.s4";
import { ORG } from "../world/default";
import type { World } from "./world";

/** The sweep lane's fixes in the fake control plane: the same rules and the same words as the real one. */

const as = (persona: string, scenario = "default"): World => buildWorld(scenario, persona).world;

const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};

const detail = (r: { body?: unknown }) => (r.body as { detail?: string }).detail;

const orgNode = (w: World) => w.nodes.find((n) => n.path === ORG && n.level === "organisation")?.id ?? "";

describe("the sweep lane's fixes", () => {
  it("says a role with its own article", async () => {
    expect(detail(await call(as("admin"), "GET", `audit/operator-access?organisation=${ORG}`))).toBe(`This needs the owner role at '${ORG}'; you are an admin there (set at ${ORG}).`);
    expect(detail(await call(as("viewer"), "POST", "ideas", { text: "A tide board for the harbour", scope: ORG }))).toBe(`This needs the builder role at '${ORG}'; you are a viewer there (set at ${ORG}).`);
  });

  it("lets an operator suspend and reinstate an organisation, and nobody else", async () => {
    for (const persona of ["owner", "admin"]) {
      const w = as(persona);
      expect(detail(await call(w, "PATCH", `organisations/${orgNode(w)}`, { status: "suspended" }))).toBe("An organisation is suspended or reinstated by FrostAura.");
    }
    const op = as("operator");
    const suspended = await call(op, "PATCH", `organisations/${orgNode(op)}`, { status: "suspended" });
    expect(suspended.status).toBe(200);
    expect((suspended.body as { status: string }).status).toBe("suspended");
    expect((await call(op, "PATCH", `organisations/${orgNode(op)}`, { status: "active" })).status).toBe(200);
    expect(op.operatorLog.filter((e) => e.organisation === ORG && e.detail.title === "Renamed, suspended or reinstated the organisation")).toHaveLength(2);
  });

  it("stops a contractor, and refuses to stop an employee or one already finished", async () => {
    const w = as("owner", "s4-contractor-working");
    const contractor = w.employees.find((e) => e.kind === "contractor" && e.status === "working");
    const employee = w.employees.find((e) => e.kind === "employee" && e.status !== "released");
    expect(contractor && employee).toBeTruthy();
    const stopped = await call(w, "POST", `employees/${contractor?.id}/stop`);
    expect((stopped.body as { status: string }).status).toBe("released");
    expect(detail(await call(w, "POST", `employees/${contractor?.id}/stop`))).toBe(`${contractor?.name} has already finished.`);
    expect(detail(await call(w, "POST", `employees/${employee?.id}/stop`))).toBe(`Only a contractor is stopped; ${employee?.name} is an employee, who is paused or let go.`);
    const briefer = await call(w, "GET", `employees/${contractor?.briefedBy?.id}`);
    expect((briefer.body as { contractors: unknown[] }).contractors).toHaveLength(0);
  });

  it("says an app is created under a project, with its article", async () => {
    const w = as("owner");
    expect(detail(await call(w, "POST", "apps", { parent: `${ORG}/operations`, name: "X", slug: "xx" }))).toBe(`An app is created under a project; '${ORG}/operations' is a division.`);
  });
});
