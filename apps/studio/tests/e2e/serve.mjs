// A static server for the fixture build (dist-fixture), with the same CSP the
// page declares. Used by the e2e suite and the screenshot script.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { localSources } from "../../scripts/local-sources.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".jsonl": "text/plain; charset=utf-8",
  ".gz": "application/gzip",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".yaml": "text/plain; charset=utf-8",
  ".lock": "text/plain; charset=utf-8",
};

export function serve(dir, port = 0) {
  const root = resolve(dir);
  // Local fixtures' sources come from the checkout on disk (never copied into fixtures/local).
  const local = localSources(root);
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (/^\/local\/[^/]+\/sources\//.test(url.pathname)) {
      const body = local(decodeURIComponent(url.pathname));
      if (body) res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(body);
      else res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, p);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/plain; charset=utf-8", "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}
