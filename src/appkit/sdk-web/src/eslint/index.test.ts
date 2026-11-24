import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import plugin from "./index.js";

// RuleTester reports through the test framework's own hooks.
Object.assign(RuleTester, { afterAll, describe, it, itOnly: it.only });

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

const rule = plugin.rules?.["no-root-relative-url"] as Parameters<RuleTester["run"]>[1];

tester.run("no-root-relative-url", rule, {
  valid: [
    'api("notes")',
    "api(`notes/${id}`)",
    'fetch(apiUrl("notes"))',
    '<img src="./logo.svg" />',
    '<a href="notes/1">Note</a>',
    '<a href={signInUrl()}>Sign in</a>',
    // The router resolves these against its basename.
    '<Link to="/notes">Notes</Link>',
    'navigate("/notes/1")',
    // Strings that are not URLs.
    '"a/b".replace("/", "-")',
    'path.split("/")',
    'new URL("notes", document.baseURI)',
  ],
  invalid: [
    { code: 'fetch("/api/notes")', errors: [{ messageId: "rootRelative" }] },
    { code: 'api("/notes")', errors: [{ messageId: "rootRelative" }] },
    { code: "api(`/notes/${id}`)", errors: [{ messageId: "rootRelative" }] },
    { code: '<img src="/logo.svg" />', errors: [{ messageId: "rootRelative" }] },
    { code: '<a href="/notes">Notes</a>', errors: [{ messageId: "rootRelative" }] },
    { code: '<a href={"/notes"}>Notes</a>', errors: [{ messageId: "rootRelative" }] },
    { code: '<form action="/api/notes" />', errors: [{ messageId: "rootRelative" }] },
    { code: 'new URL("/api/notes", document.baseURI)', errors: [{ messageId: "rootRelative" }] },
    { code: 'new EventSource("/api/stream")', errors: [{ messageId: "rootRelative" }] },
    { code: 'window.location.href = "/notes"', errors: [{ messageId: "rootRelative" }] },
    { code: 'location.assign("/notes")', errors: [{ messageId: "rootRelative" }] },
    { code: 'window.open("/notes")', errors: [{ messageId: "rootRelative" }] },
    { code: '<link href="//fonts.example.com/inter.css" />', errors: [{ messageId: "otherHost" }] },
  ],
});
