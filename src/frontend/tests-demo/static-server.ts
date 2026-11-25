import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

/**
 * TEST ONLY. Serves the built demo (dist-demo/) under a sub-path, as GitHub Pages will:
 * `node tests-demo/static-server.ts <port> <sub-path>`. Nothing else is served.
 */
const port = Number(process.argv[2] ?? 5571);
const prefix = (process.argv[3] ?? "/technologies.fa.endgame/demo/").replace(/\/?$/, "/");
const root = path.join(import.meta.dirname, "..", "dist-demo");
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".js": "text/javascript", ".css": "text/css" };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(404).end();
    return;
  }
  const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1");
