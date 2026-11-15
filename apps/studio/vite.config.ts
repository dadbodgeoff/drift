import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";
import { localSources } from "./scripts/local-sources.mjs";

/**
 * The Content-Security-Policy. Production (Electron and the fixture build used
 * by e2e) is strict: no inline script or style, no eval, no remote anything.
 * The dev server needs inline styles and a websocket for hot reload.
 */
export function csp(dev: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "font-src 'self'",
    "img-src 'self' data:",
    "worker-src 'self'",
    `connect-src 'self'${dev ? " ws: http://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
}

function cspPlugin(dev: boolean): Plugin {
  return { name: "studio-csp", transformIndexHtml: (html) => html.replace("%STUDIO_CSP%", csp(dev)) };
}

/** Fixture dev server: local fixtures' sources from the checkout on disk, as tests/e2e/serve.mjs serves them. */
function localSourcesPlugin(): Plugin {
  return {
    name: "studio-local-sources",
    configureServer(server) {
      const read = localSources(fileURLToPath(new URL("./fixtures", import.meta.url)));
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
        if (!/^\/local\/[^/]+\/sources\//.test(path)) return next();
        const body = read(path);
        res.statusCode = body ? 200 : 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(body ?? "not found");
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const fixture = mode === "fixture";
  return {
    base: "./",
    plugins: [react(), cspPlugin(command === "serve"), ...(fixture ? [localSourcesPlugin()] : [])],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    // Fixtures are served only in fixture mode (browser tests); the Electron build ships none.
    publicDir: fixture ? "fixtures" : false,
    define: { __STUDIO_FIXTURE__: JSON.stringify(fixture) },
    worker: { format: "es" },
    build: {
      outDir: fixture ? "dist-fixture" : "dist",
      emptyOutDir: true,
      // Never inline assets as data: URIs (fonts stay files; the CSP stays simple).
      assetsInlineLimit: 0,
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
    },
    server: { port: 5174, strictPort: true },
  };
});
