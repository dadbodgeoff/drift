// Sources for the git-ignored local fixtures (fixtures/local, scripts/make-local-fixtures.mjs), read
// from the checkout on disk when a request asks for one, never copied: third-party code stays out of
// the repository and out of the build. The same rules as the desktop app's `readSource`
// (electron/handlers.ts): only a file the fixture's facts list, inside the checkout after symbolic
// links are resolved, a regular file of at most 2 MB. Anything else is "not available".
//
// Used by tests/e2e/serve.mjs (the e2e and screenshot server) and the fixture dev server (vite.config.ts).
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { gunzipSync } from "node:zlib";

const MAX_SOURCE = 2 * 1024 * 1024;

/**
 * A reader for `<fixtures>/local/<id>/sources/<path>` URLs: returns the file's bytes, or null when the
 * URL is not one, the repo's index entry names no `sourceRoot`, or the file may not be read.
 */
export function localSources(fixturesDir) {
  const scanned = new Map();
  const index = () => {
    const p = join(fixturesDir, "local", "index.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).repos ?? [] : [];
  };
  const listed = (id) => {
    if (!scanned.has(id)) {
      const f = join(fixturesDir, "local", id, "facts.json.gz");
      scanned.set(id, existsSync(f) ? new Set(JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")).files.map((x) => x.path)) : new Set());
    }
    return scanned.get(id);
  };
  return (urlPath) => {
    const m = /^\/?local\/([^/]+)\/sources\/(.+)$/.exec(urlPath);
    if (!m) return null;
    const [, id, rel] = m;
    if (rel.split("/").some((p) => p === ".." || p === "." || p === "") || rel.startsWith("/") || rel.includes("\0")) return null;
    const repo = index().find((r) => r.id === id);
    if (!repo?.sourceRoot || !existsSync(repo.sourceRoot)) return null;
    if (!listed(id).has(rel)) return null;
    let root;
    let real;
    try {
      root = realpathSync(repo.sourceRoot);
      real = realpathSync(join(root, rel));
    } catch {
      return null;
    }
    if (!real.startsWith(root + sep)) return null;
    const st = statSync(real);
    if (!st.isFile() || st.size > MAX_SOURCE) return null;
    return readFileSync(real);
  };
}
