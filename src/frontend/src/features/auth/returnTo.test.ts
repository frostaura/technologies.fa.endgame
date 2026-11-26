import { afterEach, describe, expect, it } from "vitest";
import { navigate, routeByHash } from "@/lib/router";
import { forgetReturnTo, rememberReturnTo, takeReturnTo } from "./returnTo";

afterEach(() => window.sessionStorage.clear());

describe("the address a signed-out visitor first asked for (ID-02)", () => {
  it("is the console's own address when addresses live after the # (the demo), not the page's path", () => {
    routeByHash();
    navigate("/credits?scope=northwind");
    expect(rememberReturnTo()).toBe("/credits?scope=northwind");
    expect(takeReturnTo(null)).toBe("/credits?scope=northwind");
    expect(takeReturnTo(null)).toBeNull();
  });

  it("keeps nothing when the sign-in screen follows a session on this page, and drops what was kept", () => {
    routeByHash();
    navigate("/run/r1");
    expect(rememberReturnTo()).toBe("/run/r1");
    navigate("/operator");
    expect(rememberReturnTo(false)).toBeNull();
    expect(takeReturnTo(null)).toBeNull();
  });

  it("is forgotten on sign-out", () => {
    routeByHash();
    navigate("/people");
    rememberReturnTo();
    forgetReturnTo();
    expect(takeReturnTo(null)).toBeNull();
  });
});
