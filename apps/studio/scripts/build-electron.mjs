// Bundle the Electron main process and preload into dist-electron/ as CommonJS
// (a sandboxed preload must be a single CommonJS file).
import { build } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
for (const entry of ["main", "preload"]) {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    build: {
      outDir: "dist-electron",
      emptyOutDir: entry === "main",
      ssr: `electron/${entry}.ts`,
      target: "node22",
      sourcemap: false,
      minify: false,
      rollupOptions: {
        external: ["electron", /^node:/],
        output: { format: "cjs", entryFileNames: `${entry}.cjs` },
      },
    },
    ssr: { noExternal: true },
  });
}
console.log("built dist-electron/main.cjs and dist-electron/preload.cjs");
