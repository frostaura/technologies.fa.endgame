import { afterEach, describe, expect, it } from "vitest";
import { routerBasename, signInUrl, signOutUrl, signUpUrl } from "./router.js";
import { setBase } from "./testing.js";

afterEach(() => setBase("http://localhost/"));

describe("routerBasename", () => {
  it("is empty at a subdomain root", () => {
    setBase("https://acme.frostaura.net/");
    expect(routerBasename()).toBe("");
  });

  it("is the prefix, without a trailing slash, under a path", () => {
    setBase("https://endgame.frostaura.net/acme/labs/demo/");
    expect(routerBasename()).toBe("/acme/labs/demo");
  });
});

describe("sign-in addresses", () => {
  it("live under the app's own address and return where asked", () => {
    setBase("https://endgame.frostaura.net/acme/labs/demo/");
    expect(signInUrl("/acme/labs/demo/notes/new")).toBe(
      "https://endgame.frostaura.net/acme/labs/demo/_endgame/auth/sign-in?returnTo=%2Facme%2Flabs%2Fdemo%2Fnotes%2Fnew",
    );
    expect(signUpUrl("/acme/labs/demo/")).toBe("https://endgame.frostaura.net/acme/labs/demo/_endgame/auth/sign-up?returnTo=%2Facme%2Flabs%2Fdemo%2F");
    expect(signOutUrl()).toBe("https://endgame.frostaura.net/acme/labs/demo/_endgame/auth/sign-out");
  });

  it("return to the current page by default", () => {
    const origin = window.location.origin;
    setBase(`${origin}/`);
    window.history.pushState({}, "", `${origin}/notes/3?tab=history`);
    expect(signInUrl()).toBe(`${origin}/_endgame/auth/sign-in?returnTo=%2Fnotes%2F3%3Ftab%3Dhistory`);
  });
});
