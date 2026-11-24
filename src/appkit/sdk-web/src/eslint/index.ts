import type { ESLint, Rule } from "eslint";

/**
 * The ESLint side of the address rules (ARCH-005): an Endgame app is served under
 * `/<org>/<division>/<project>/` and at the root of a subdomain from the same build, so a URL that
 * starts with "/" escapes the app's prefix and breaks under a path. In-app routes are the
 * exception — `<Link to="/notes">` and `navigate("/notes")` are resolved by the router against its
 * basename — so `to` props and `navigate()` are allowed.
 */

type Node = Rule.Node;

/** JSX attributes that the browser resolves itself — against `<base>`, unless they start with "/". */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formAction", "poster", "srcSet", "data"]);

/** Calls whose first argument is a URL the browser fetches or opens. */
const URL_CALLS = new Set(["fetch", "api", "apiUrl", "useApiQuery", "sendBeacon", "importScripts"]);

/** `location.assign(…)`, `location.replace(…)` and `window.open(…)`. Other `replace` calls are strings. */
function isNavigationCall(callee: Node): boolean {
  if (callee.type === "Identifier") return callee.name === "open";
  if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return false;
  const object = callee.object;
  const objectName =
    object.type === "Identifier" ? object.name : object.type === "MemberExpression" && object.property.type === "Identifier" ? object.property.name : null;
  if (callee.property.name === "open") return objectName === "window";
  return (callee.property.name === "assign" || callee.property.name === "replace") && objectName === "location";
}

/** Constructors whose first argument is a URL. */
const URL_CONSTRUCTORS = new Set(["URL", "Request", "EventSource", "WebSocket", "Worker", "SharedWorker"]);

function leadingText(node: Node | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") return node.quasis[0]?.value.cooked ?? null;
  return null;
}

function calleeName(callee: Node): string | null {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") return callee.property.name;
  return null;
}

const noRootRelativeUrl: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow URLs that start with '/', which escape the app's address prefix." },
    schema: [],
    messages: {
      rootRelative:
        "'{{url}}' starts with '/', so it ignores the app's address prefix and breaks under /<org>/<division>/<project>/. " +
        "Write it without the leading slash (resolved against <base>), use api('…') for the API, or <Link to=\"…\"> for in-app routes.",
      otherHost:
        "'{{url}}' loads from another host. Self-host the asset (import it, or put it in public/); call other services from the server.",
    },
  },
  create(context) {
    const check = (node: Node | null | undefined) => {
      const text = leadingText(node);
      if (text === null || !node) return;
      if (text.startsWith("//")) context.report({ node, messageId: "otherHost", data: { url: text } });
      else if (text.startsWith("/")) context.report({ node, messageId: "rootRelative", data: { url: text } });
    };

    return {
      JSXAttribute(node: Node) {
        // JSX nodes are not in ESTree's core types; read them structurally.
        const attribute = node as unknown as { name: { name?: unknown }; value: Node | { type: "JSXExpressionContainer"; expression: Node } | null };
        if (typeof attribute.name.name !== "string" || !URL_ATTRIBUTES.has(attribute.name.name)) return;
        const value = attribute.value;
        if (!value) return;
        check(value.type === "JSXExpressionContainer" ? (value as { expression: Node }).expression : (value as Node));
      },
      CallExpression(node: Node) {
        if (node.type !== "CallExpression") return;
        const callee = node.callee as Node;
        const name = calleeName(callee);
        if ((name && URL_CALLS.has(name)) || isNavigationCall(callee)) check(node.arguments[0] as Node | undefined);
      },
      NewExpression(node: Node) {
        if (node.type !== "NewExpression") return;
        const name = calleeName(node.callee as Node);
        if (name && URL_CONSTRUCTORS.has(name)) check(node.arguments[0] as Node | undefined);
      },
      AssignmentExpression(node: Node) {
        if (node.type !== "AssignmentExpression" || node.left.type !== "MemberExpression") return;
        const property = node.left.property;
        if (property.type === "Identifier" && property.name === "href") check(node.right as Node);
      },
    };
  },
};

/** `import endgame from "@endgame/appkit/eslint"` → `plugins: { endgame }`, rules `endgame/no-root-relative-url`. */
const plugin: ESLint.Plugin = {
  meta: { name: "@endgame/appkit", version: "0.1.0" },
  rules: { "no-root-relative-url": noRootRelativeUrl },
};

export default plugin;
