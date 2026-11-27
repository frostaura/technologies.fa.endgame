import { describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { seek } from "./engine";
import { node, type World } from "./world";
import { buildWorld } from "../world/scenarios";
import { IDS, ORG } from "../world/default";

/**
 * Where the demo's builds go, as `BuildWorkflow.PlaceAsync` places them (R9-1): a build from an idea is always a new app,
 * in a new project of its own. A verdict whose project slug is already taken never joins that project — it gets the next
 * free address — and the owner reads where it goes on the "Placed" line and first on the plan's approval card.
 */

const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};

describe("placing a build (R9-1)", () => {
  it("never builds a new idea into a project that is already there, and says where it goes before the plan is agreed", async () => {
    const w = buildWorld("default", "owner").world;
    const division = `${ORG}/technologies`;
    const taken = w.nodes.find((n) => n.path.startsWith(`${division}/`) && n.path.split("/").length === 3);
    if (!taken) throw new Error("The default world has a project in Technologies.");
    const idea = w.ideas.find((i) => i.id === IDS.ideaAllergen);
    const verdict = idea?.verdict as { placement: { project: string } };
    // Research suggests the slug of a project that already has a live app.
    verdict.placement.project = taken.path.split("/")[2] ?? "";
    await call(w, "PUT", "autonomy", { scope: division, autonomy: "checkpoints", checkpoints: { plan: true } });
    const decided = await call(w, "POST", `ideas/${IDS.ideaAllergen}/decision`, { choice: "build" });
    expect(decided.status).toBe(200);
    seek(w, "build:waiting-on-plan", () => undefined);

    const run = w.runs.filter((r) => r.run.kind === "build").pop();
    if (!run) throw new Error("The decision started a build.");
    const placed = run.events.find((e) => e.payload.step === "placement")?.payload.data as { projectPath: string; appPath: string; newApp: boolean };
    expect(placed.projectPath).toBe(`${taken.path}-2`);
    expect(placed.appPath).toBe(`${taken.path}-2/web`);
    expect(placed.newApp).toBe(true);
    const where = `Allergen Labels is a new app. It will live in Technologies as a new project of its own, beside ${taken.name}.`;
    expect(run.events.find((e) => e.payload.title === "Placed")?.payload.text).toBe(where);
    const asked = w.approvals.filter((a) => a.runId === run.run.id).pop();
    expect(asked?.title).toBe("Accept this plan?");
    expect(String(asked?.detail).startsWith(where)).toBe(true);
    // The project that was there keeps its name and its apps; the new one is the idea's own.
    expect(node(w, taken.path)?.name).toBe(taken.name);
    expect(node(w, `${taken.path}-2`)?.name).toBe("Allergen Labels");
  });

  it("names the app a change is made to on the plan's approval", async () => {
    const w = buildWorld("default", "owner").world;
    const app = w.apps.find((a) => a.publishedAt);
    if (!app) throw new Error("The default world has a published app.");
    const division = app.path.split("/").slice(0, 2).join("/");
    await call(w, "PUT", "autonomy", { scope: division, autonomy: "checkpoints", checkpoints: { plan: true } });
    const started = await call(w, "POST", `apps/${app.id}/changes`, { request: "Add a short note to each entry." });
    expect(started.status).toBe(201);
    seek(w, "change:waiting-on-plan", () => undefined);
    const id = (started.body as { id: string }).id;
    const asked = w.approvals.filter((a) => a.runId === id).pop();
    expect(asked?.title).toBe("Accept this plan for the change?");
    expect(String(asked?.detail)).toMatch(/^This changes .+, the app already built and running in .+\. Nothing else is touched\./);
  });
});
