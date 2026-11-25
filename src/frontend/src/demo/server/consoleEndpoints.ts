/**
 * TEST SUPPORT. Reads every METHOD + path the console calls out of `store/api.ts` (every endpoint
 * block, injected ones too) and `store/sensitive.ts`, without running them: string literals,
 * template literals (nested too), ternaries and lookups in a constant map (`PLURAL[level]`) are all
 * resolved to every address they can make; any other expression stands for one sample segment.
 * It throws, naming the endpoint, only when an address truly cannot be read.
 */

export interface ConsoleCall {
  method: string;
  path: string;
  from: string;
}

/** The index of the quote closing the string or template that opens at `at` (templates nest). */
function closeOf(text: string, at: number): number {
  const q = text[at];
  for (let i = at + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") i += 1;
    else if (q === "`" && c === "$" && text[i + 1] === "{") i = closeBrace(text, i + 2);
    else if (c === q) return i;
  }
  return text.length;
}

/** The index of the `}` closing a `${` whose body starts at `from`. */
function closeBrace(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (c === '"' || c === "'" || c === "`") i = closeOf(text, i);
    else if (c === "{") depth += 1;
    else if (c === "}") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return text.length;
}

/** The expression starting at `from`, up to a top-level `,`, `;`, line end or an unmatched closing bracket. */
export function expressionAt(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      i = closeOf(text, i);
      continue;
    }
    if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) {
      if (depth === 0) return text.slice(from, i).trim();
      depth -= 1;
    } else if ((c === "," || c === ";" || c === "\n") && depth === 0) return text.slice(from, i).trim();
  }
  return text.slice(from).trim();
}

/** The top-level index of `ch`, outside strings and brackets, or -1. */
function topLevel(expr: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i] ?? "";
    if (c === '"' || c === "'" || c === "`") i = closeOf(expr, i);
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

function wrapped(expr: string): boolean {
  if (!expr.startsWith("(")) return false;
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i] ?? "";
    if (c === '"' || c === "'" || c === "`") i = closeOf(expr, i);
    else if (c === "(") depth += 1;
    else if (c === ")" && --depth === 0) return i === expr.length - 1;
  }
  return false;
}

/** Every string an address expression can make. */
export function valuesOf(raw: string, consts: Map<string, string[]>): string[] {
  let expr = raw.trim();
  while (wrapped(expr)) expr = expr.slice(1, -1).trim();
  const q = topLevel(expr, "?");
  if (q > 0) {
    const rest = expr.slice(q + 1);
    const colon = topLevel(rest, ":");
    if (colon > 0) return [...valuesOf(rest.slice(0, colon), consts), ...valuesOf(rest.slice(colon + 1), consts)];
  }
  const first = expr[0];
  if ((first === '"' || first === "'") && closeOf(expr, 0) === expr.length - 1) return [expr.slice(1, -1)];
  if (first === "`" && closeOf(expr, 0) === expr.length - 1) return expand(expr.slice(1, -1), consts);
  const lookup = expr.match(/^(\w+)\[[^\]]+\]$/);
  if (lookup?.[1] && consts.has(lookup[1])) return consts.get(lookup[1]) ?? [];
  return ["x1"];
}

/** A template's body, every way its `${…}` parts can be filled. */
export function expand(template: string, consts: Map<string, string[]>): string[] {
  let results = [""];
  let i = 0;
  while (i < template.length) {
    const at = template.indexOf("${", i);
    if (at < 0) {
      const tail = template.slice(i);
      results = results.map((r) => r + tail);
      break;
    }
    const literal = template.slice(i, at);
    const end = closeBrace(template, at + 2);
    const values = valuesOf(template.slice(at + 2, end), consts);
    results = results.flatMap((r) => values.map((v) => r + literal + v));
    i = end + 1;
  }
  return results;
}

/** Constant maps a file builds addresses from, e.g. `const PLURAL = { division: "divisions", … }`. */
export function constantsOf(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of text.matchAll(/const (\w+)(?::[^=]+)? = \{([^{}]*)\};/g)) {
    const values = [...(m[2] ?? "").matchAll(/:\s*"([^"]*)"/g)].map((v) => v[1] ?? "");
    if (m[1] && values.length > 0) out.set(m[1], values);
  }
  return out;
}

const looksLikeAddress = (t: string) => /^[a-z][a-z-]*(\/|$)/.test(t);
const clean = (t: string) => t.replace(/\?.*$/, "").replace(/^\/+/, "");

export function consoleCalls(apiSource: string, sensitiveSource: string): ConsoleCall[] {
  const out: ConsoleCall[] = [];
  const consts = constantsOf(apiSource);
  for (const block of apiSource.split(/\n\s+(?=\w+: build\.(?:query|mutation)<)/).slice(1)) {
    const name = block.match(/^(\w+):/)?.[1] ?? "?";
    const at = block.indexOf("query:");
    const query = at < 0 ? "" : block.slice(at);
    const method = query.match(/method: "(\w+)"/)?.[1] ?? "GET";
    // `query: (x) => ({ url, method, body })` names the address as `url`; a bare arrow returns it.
    const url = query.match(/\burl:\s*/);
    const arrow = query.indexOf("=>");
    const expr = url?.index !== undefined ? expressionAt(query, url.index + url[0].length) : arrow >= 0 ? expressionAt(query, arrow + 2) : "";
    const paths = [...new Set(valuesOf(expr, consts).map(clean))].filter(looksLikeAddress);
    if (paths.length === 0) throw new Error(`could not read the address of ${name} (from ${JSON.stringify(expr.slice(0, 80))})`);
    for (const p of paths) out.push({ method, path: p, from: `api.ts ${name}` });
  }
  const sconsts = constantsOf(sensitiveSource);
  for (const m of sensitiveSource.matchAll(/send(?:<\w+>)?\("(\w+)",\s*/g)) {
    const expr = expressionAt(sensitiveSource, (m.index ?? 0) + m[0].length);
    if (expr === "path") continue;
    for (const p of new Set(valuesOf(expr, sconsts).map(clean))) out.push({ method: m[1] ?? "GET", path: p, from: "sensitive.ts send" });
  }
  for (const m of sensitiveSource.matchAll(/apiFetch\(`\$\{API_BASE\}\/(.*?)`/g)) {
    if (m[1] === "${path}") continue;
    for (const p of expand(m[1] ?? "", sconsts)) out.push({ method: "GET", path: clean(p), from: "sensitive.ts apiFetch" });
  }
  return out;
}
