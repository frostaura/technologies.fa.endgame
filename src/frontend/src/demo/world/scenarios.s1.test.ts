import { describe, expect, it } from "vitest";
import { dispatch } from "../server/index";
import type { World } from "../server/world";
import { buildWorld } from "./scenarios";
import "./scenarios.s1";

/** The identity-and-access scenarios (docs/flows/01) and the control-plane behaviour they rely on. */

const as = (persona: string, scenario: string): World => buildWorld(scenario, persona).world;
const call = (w: World, method: string, p: string, body: Record<string, unknown> = {}) => {
  const [pathname, query] = p.split("?");
  return dispatch(w, method, pathname ?? "", new URLSearchParams(query ?? ""), body);
};
const detail = (r: { body?: unknown }) => (r.body as { detail?: string }).detail;

describe("the identity-and-access scenarios", () => {
  it("lists, counts and revokes only the caller's own keys, as AccessTokenService does", async () => {
    const mine = await call(as("owner", "default"), "GET", "tokens");
    expect((mine.body as { name: string }[]).map((t) => t.name)).toEqual(["Mara's desktop assistant", "Old laptop"]);
    expect(Object.keys((mine.body as object[])[0] ?? {})).not.toContain("userId");
    const theirs = await call(as("admin", "default"), "GET", "tokens");
    expect(theirs.body).toEqual([]);
    const full = as("owner", "s1-keys-at-limit");
    const refused = await call(full, "POST", "tokens", { name: "One more", organisation: "northwind", role: "builder", expiresInDays: 30 });
    expect(refused.status).toBe(409);
    expect(detail(refused)).toBe("You hold 50 live tokens here; revoke one first.");
  });

  it("fails the first session check as a gateway would, then answers", async () => {
    const w = as("owner", "s1-session-check-fails");
    expect((await call(w, "GET", "me")).status).toBe(503);
    expect((await call(w, "GET", "me")).status).toBe(200);
  });

  it("offers the development sign-in only in a development deployment", async () => {
    expect((await call(as("signed-out", "default"), "GET", "auth/options")).body).toEqual({ passkey: true, developmentSignIn: false });
    expect((await call(as("signed-out", "default"), "POST", "auth/development")).status).toBe(404);
    const dev = as("signed-out", "s1-development-sign-in");
    expect((await call(dev, "GET", "auth/options")).body).toEqual({ passkey: true, developmentSignIn: true });
    const signedIn = await call(dev, "POST", "auth/development");
    expect(signedIn.status).toBe(200);
    expect((signedIn.body as { user: { displayName: string; email: string } }).user).toMatchObject({ displayName: "Development owner", email: "dev@northwind.example" });
  });

  it("puts each app in the state its flow needs", () => {
    const tutor = (w: World) => w.apps.find((a) => a.name === "Tutor Match");
    expect(tutor(as("signed-out", "s1-app-public"))?.access).toBe("public");
    expect(tutor(as("signed-out", "s1-app-not-published"))?.status).toBe("building");
    const court = (w: World) => w.apps.find((a) => a.name === "Court booking");
    expect(court(as("end-user", "s1-app-made-private"))?.access).toBe("private");
    const unshared = as("end-user", "s1-app-unshared");
    expect(unshared.shares.filter((s) => s.appId === court(unshared)?.id && s.registered)).toEqual([]);
  });
});
