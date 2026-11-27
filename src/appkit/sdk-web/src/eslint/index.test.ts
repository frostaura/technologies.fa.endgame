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

const locationRule = plugin.rules?.["no-location-read"] as Parameters<RuleTester["run"]>[1];

tester.run("no-location-read", locationRule, {
  valid: [
    // Navigations away from the app (or a full reload) are what `location` is for.
    "location.assign(signInUrl())",
    "window.location.assign(error.signInUrl ?? signInUrl())",
    "window.location.replace(signOutUrl())",
    "location.reload()",
    "window.location.href = signInUrl()",
    "window.location = signInUrl()",
    // The router's own location is the right way to read the address.
    "const location = useLocation(); const where = location.pathname + location.search;",
    "function Page({ location }) { return location.hash; }",
    "const [params] = useSearchParams(); params.get('court');",
    "const { id } = useParams();",
    // Other objects' `location` properties are not the address.
    "const where = court.location.name;",
  ],
  invalid: [
    { code: "const q = new URLSearchParams(window.location.search);", errors: [{ messageId: "read", data: { property: "search", use: "useSearchParams()" } }] },
    { code: "const q = new URLSearchParams(location.search);", errors: [{ messageId: "read", data: { property: "search", use: "useSearchParams()" } }] },
    { code: "const tab = window.location.hash.slice(1);", errors: [{ messageId: "read", data: { property: "hash", use: "useLocation().hash" } }] },
    { code: "const id = location.pathname.split('/').pop();", errors: [{ messageId: "read", data: { property: "pathname", use: "useParams()" } }] },
    { code: "const here = document.location.href;", errors: [{ messageId: "read" }] },
    { code: "const here = globalThis.location.href;", errors: [{ messageId: "read" }] },
    { code: "const here = window.location['search'];", errors: [{ messageId: "read" }] },
    { code: "const { search } = window.location;", errors: [{ messageId: "whole" }] },
    { code: "const where = String(window.location);", errors: [{ messageId: "whole" }] },
    { code: "const where = location.toString();", errors: [{ messageId: "read" }] },
    { code: "const host = window.location.origin;", errors: [{ messageId: "host", data: { property: "origin" } }] },
  ],
});

const formatRule = plugin.rules?.["no-unsafe-format"] as Parameters<RuleTester["run"]>[1];

// R7-1: a built app formatted a date a browser let through with Intl.DateTimeFormat(...).format(new Date(value)); it threw
// RangeError while rendering and the page went blank. Apps format through the kit's helpers, which never throw.
tester.run("no-unsafe-format", formatRule, {
  valid: [
    'formatDateTime(note.createdAt)',
    'formatDate(value, { fallback: "Pick a date" })',
    "formatNumber(count)",
    // Other `format` calls are not the browser's formatters.
    'dayjs(value).format("D MMM")',
    "formatter.format(x)",
    'const label = value.toString();',
  ],
  invalid: [
    { code: 'new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso))', errors: [{ messageId: "intl" }] },
    { code: "Intl.DateTimeFormat().format(date)", errors: [{ messageId: "intl" }] },
    { code: "new Intl.NumberFormat().format(n)", errors: [{ messageId: "intl" }] },
    { code: "new Intl.DateTimeFormat().formatToParts(date)", errors: [{ messageId: "intl" }] },
    { code: "new Intl.RelativeTimeFormat().format(-1, 'day')", errors: [{ messageId: "intl" }] },
    { code: "const f = new Intl.DateTimeFormat(); f.format(d);", errors: [{ messageId: "intl" }] },
    { code: "new Date(value).toLocaleString()", errors: [{ messageId: "locale", data: { method: "toLocaleString" } }] },
    { code: "date.toLocaleDateString('en-GB')", errors: [{ messageId: "locale", data: { method: "toLocaleDateString" } }] },
    { code: "date.toLocaleTimeString()", errors: [{ messageId: "locale", data: { method: "toLocaleTimeString" } }] },
    { code: "total.toLocaleString()", errors: [{ messageId: "locale", data: { method: "toLocaleString" } }] },
  ],
});
