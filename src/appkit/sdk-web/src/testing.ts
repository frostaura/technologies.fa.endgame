/** Test helpers: put a <base> on the page, as the app's server does on every request. */
export function setBase(href: string): void {
  document.head.querySelectorAll("base").forEach((b) => b.remove());
  const base = document.createElement("base");
  base.href = href;
  document.head.prepend(base);
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });
}
