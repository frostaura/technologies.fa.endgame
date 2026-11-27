import { describe, expect, it } from "vitest";
import { matchRoute, paths } from "./router";

/**
 * The console is served on an organisation's own host too (http://frostaura.localhost:8095/). There
 * Edge answers "There is no app at this address" for a path of three or more segments under a
 * division with apps (RouteSnapshot.IsAppShaped). So no console address may be three segments long,
 * or Edge would take it from the console wherever a division shares its first segment.
 */
describe("the console's addresses beside an organisation's app addresses", () => {
  const segments = (address: string) => (address.split("?")[0] ?? "").split("/").filter(Boolean).length;

  it("every console address is at most two segments", () => {
    for (const [name, build] of Object.entries(paths)) {
      const address = (build as (...args: string[]) => string)("some-id", "acme");
      expect(segments(address), `${name}: ${address}`).toBeLessThanOrEqual(2);
      expect(matchRoute(address.split("?")[0] ?? "").name, `${name}: ${address}`).not.toBe("not-found");
    }
  });

  it("no route matches a three-segment address", () => {
    for (const address of ["/apps/abc/web", "/runs/abc/x/", "/apps/notes/web/", "/assets/a/b.js"]) {
      expect(matchRoute(address).name, address).toBe("not-found");
    }
  });
});
