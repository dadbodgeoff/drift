// Finding and running the drift binary. Always execFile (no shell), with a
// timeout, an output cap, a minimal environment and cancellation.
import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { type DriftOp, acceptableExit, driftArgs, driftEnv, driftErrorLine } from "./ops";

export interface DriftBinary {
  path: string | null;
  source: "settings" | "bundled" | "path" | "none";
}

/** `.cmd` and `.bat` files cannot run without a shell (CVE-2024-27980), and the Studio never uses one. */
const isBatch = (p: string) => /\.(cmd|bat)$/i.test(p);

function executable(p: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    if (platform === "win32") return !isBatch(p);
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(p: string): string | null {
  try {
    return statSync(p).size <= 64 * 1024 ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

/** npm's package-name grammar: lowercase, URL-safe, at most one `@scope/`; never `..` or `\\`. */
const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const validPackageName = (n: string) => n.length <= 214 && NPM_NAME.test(n) && !n.includes("..");

function packageName(dir: string): unknown {
  try {
    return (JSON.parse(readText(join(dir, "package.json")) ?? "null") as { name?: unknown } | null)?.name;
  } catch {
    return undefined;
  }
}

/**
 * On Windows, npm (and pnpm, Yarn) install `drift` as a `drift.cmd` shim that runs
 * `node <pkg>/bin/drift.js`, which in turn runs `drift.exe` from the per-platform
 * package. Follow the shim, as data, to that `drift.exe`: the package the shim's script
 * belongs to must list `<name>-win32-<arch>` in its optionalDependencies, which is found
 * the way Node resolves it (the package's own node_modules, then each parent's).
 */
export function exeBehindShim(shim: string, arch: string = process.arch): string | null {
  const text = readText(shim);
  const rel = text?.match(/"%~?dp0%?[\\/]([^"%*]+?\.[cm]?js)"/i)?.[1];
  if (!rel) return null;
  const script = join(dirname(shim), ...rel.split(/[\\/]/));
  let pkgDir = dirname(dirname(script)); // <pkg>/bin/drift.js
  let manifest: { name?: unknown; optionalDependencies?: Record<string, unknown> };
  try {
    manifest = JSON.parse(readText(join(pkgDir, "package.json")) ?? "null") ?? {};
  } catch {
    return null;
  }
  if (typeof manifest.name !== "string" || !validPackageName(manifest.name)) return null;
  const platformPkg = `${manifest.name}-win32-${arch}`;
  if (!validPackageName(platformPkg) || !Object.hasOwn(manifest.optionalDependencies ?? {}, platformPkg)) return null;
  const inPackage = join(...platformPkg.split("/"), "bin", "drift.exe");
  for (let i = 0; i < 64; i++) {
    if (basename(pkgDir) !== "node_modules") {
      const modules = join(pkgDir, "node_modules");
      const exe = join(modules, inPackage);
      // Exactly `<...>/node_modules/<platformPkg>/bin/drift.exe`, in a package of that name.
      if (relative(modules, exe) === inPackage && packageName(dirname(dirname(exe))) === platformPkg && executable(exe, "win32")) return exe;
    }
    const up = dirname(pkgDir);
    if (up === pkgDir) break;
    pkgDir = up;
  }
  return null;
}

/** A binary that can be run without a shell: on Windows, `drift.exe` directly or behind a shim. */
function runnable(p: string, platform: NodeJS.Platform): string | null {
  if (platform === "win32" && isBatch(p)) return exeBehindShim(p);
  return executable(p, platform) ? p : null;
}

/**
 * Where a packaged Studio carries its own drift: `<resources>/bin/drift[.exe]`, put there by
 * `extraResources` in scripts/package-config.ts. Null when running from source (no resources).
 */
export function bundledDrift(resourcesPath: string | null | undefined, platform: NodeJS.Platform = process.platform): string | null {
  return resourcesPath && isAbsolute(resourcesPath) ? join(resourcesPath, "bin", platform === "win32" ? "drift.exe" : "drift") : null;
}

/**
 * The configured binary, else the one this build carries, else the first `drift` on PATH
 * (plus common install dirs). The bundled binary comes before PATH because it is the Drift
 * this Studio was built and tested with: an older `drift` on PATH may lack commands or
 * schemas the views need. A person who wants another one chooses it in Settings.
 */
export function resolveDrift(configured: string | null, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, bundled: string | null = null): DriftBinary {
  // Only absolute paths: drift runs with the repository as its working directory, so a
  // relative path would name a different file there than the one checked here.
  const fromSettings = configured && isAbsolute(configured) ? runnable(configured, platform) : null;
  if (fromSettings) return { path: fromSettings, source: "settings" };
  if (bundled && isAbsolute(bundled) && executable(bundled, platform)) return { path: bundled, source: "bundled" };
  // On Windows `drift.exe` itself, else the `drift.cmd` npm installs, followed to its `drift.exe`.
  const names = platform === "win32" ? ["drift.exe", "drift.cmd"] : ["drift"];
  const home = env.HOME ?? env.USERPROFILE ?? "";
  const dirs = [...(env.PATH ?? "").split(delimiter), join(home, ".cargo", "bin"), "/usr/local/bin", "/opt/homebrew/bin"].filter((d) => isAbsolute(d));
  for (const d of dirs)
    for (const n of names) {
      const found = existsSync(join(d, n)) ? runnable(join(d, n), platform) : null;
      if (found) return { path: found, source: "path" };
    }
  return { path: null, source: "none" };
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}

export class DriftError extends Error {
  constructor(
    message: string,
    readonly result?: RunResult,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT = 512 * 1024 * 1024;

export function runDrift(bin: string, root: string, op: DriftOp, opts: { cacheDir: string; signal?: AbortSignal; cwd?: string }): Promise<RunResult> {
  const args = driftArgs(root, op);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { env: driftEnv(process.env, opts.cacheDir), cwd: opts.cwd ?? root, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, signal: opts.signal, windowsHide: true, encoding: "utf8" },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((err as unknown as { code: number }).code as number) : err ? -1 : 0;
        const r: RunResult = { code, stdout: String(stdout), stderr: String(stderr), ms: Date.now() - t0 };
        if (opts.signal?.aborted) return reject(new DriftError("cancelled", r));
        if (err && !acceptableExit(op.op, code)) {
          const msg = driftErrorLine(r.stderr) ?? (err as Error).message;
          return reject(new DriftError(`drift ${op.op} failed: ${msg}`, r));
        }
        resolve(r);
      },
    );
  });
}
