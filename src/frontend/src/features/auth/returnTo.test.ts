import { afterEach, describe, expect, it } from "vitest";
import { navigate, routeByHash } from "@/lib/router";
import { rememberReturnTo, takeReturnTo } from "./returnTo";

afterEach(() => window.sessionStorage.clear());

describe("the address a signed-out visitor first asked for (ID-02)", () => {
  it("is the console's own address when addresses live after the # (the demo), not the page's path", () => {
    routeByHash();
    navigate("/credits?scope=northwind");
    expect(rememberReturnTo()).toBe("/credits?scope=northwind");
    expect(takeReturnTo(null)).toBe("/credits?scope=northwind");
    expect(takeReturnTo(null)).toBeNull();
  });
});
