import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

/**
 * A static server for the assembled site, mounted under a sub-path exactly as GitHub Pages
 * mounts it, so tests and the PDF step see what visitors see. Unknown paths get 404.html.
 *
 *   node tools/serve.ts <dir> <port> [--base /technologies.fa.endgame/]
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

export function serve(dir: string, port: number, base = "/") {
  const root = path.resolve(dir);
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    if (url === prefix.slice(0, -1)) {
      res.writeHead(301, { Location: prefix });
      res.end();
      return;
    }
    let rel = url.startsWith(prefix) ? url.slice(prefix.length) : null;
    if (rel !== null && (rel === "" || rel.endsWith("/"))) rel += "index.html";
    const file = rel === null ? null : path.join(root, rel);
    if (file && file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(res);
      return;
    }
    const notFound = path.join(root, "404.html");
    res.writeHead(404, { "Content-Type": TYPES[".html"] });
    if (existsSync(notFound)) createReadStream(notFound).pipe(res);
    else res.end("Not found");
  });
  return new Promise<typeof server>((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.main) {
  const [dir = "../../site", portArg = "5610"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const at = process.argv.indexOf("--base");
  const base = at > 0 ? process.argv[at + 1] ?? "/" : "/";
  await serve(dir, Number(portArg), base);
  process.stdout.write(`Serving ${path.resolve(dir)} at http://127.0.0.1:${portArg}${base}\n`);
}
