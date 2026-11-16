// Package Drift Studio with electron-builder: stage the built app and the platform's drift
// binary under release/, write the configuration (scripts/package-config.ts) and run the
// packager. Run `npm run build -w drift-studio` first.
//
//   node scripts/package.mjs [--linux] [--mac] [--win] [--x64] [--arm64] [--dir] [--config-only]
//                            --drift [<os>-<arch>=]<path> ...
//
// --drift      the drift binary to carry, once per platform and architecture built (os is
//              linux, mac or win); a bare path is for the one platform and architecture asked.
// --dir        an unpacked app only (release/out/<os>-unpacked), for the live end-to-end test.
// --config-only  stage and write release/electron-builder.json, do not run the packager.
//
// The packager is found as ELECTRON_BUILDER (the path of electron-builder's cli.js) or as an
// installed electron-builder package. Signing and notarisation come from the environment
// variables listed in apps/studio/README.md; without them the build is unsigned and every
// artifact name says so. STUDIO_RELEASE=1 refuses to build unsigned.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builderConfig, macSigned, releaseProblems } from "./package-config.ts";

const app = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(app, "package.json"));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const fail = (msg) => {
  console.error(`package: ${msg}`);
  process.exit(2);
};

const HOST = { linux: "linux", darwin: "mac", win32: "win" }[process.platform];
const DEFAULT_ARCHS = { linux: ["x64"], mac: ["arm64", "x64"], win: ["x64"] };
const platforms = ["linux", "mac", "win"].filter((p) => has(`--${p}`));
if (platforms.length === 0) {
  if (!HOST) fail(`no packaging target for ${process.platform}`);
  platforms.push(HOST);
}
const archFlags = ["x64", "arm64"].filter((a) => has(`--${a}`));
const wanted = platforms.flatMap((p) => (archFlags.length ? archFlags : DEFAULT_ARCHS[p]).map((a) => `${p}-${a}`));

// --drift [<os>-<arch>=]<path>, repeatable.
const drifts = new Map();
argv.forEach((a, i) => {
  if (a !== "--drift") return;
  const v = argv[i + 1] ?? fail("--drift needs a path");
  const m = v.match(/^((?:linux|mac|win)-(?:x64|arm64))=(.+)$/);
  if (m) drifts.set(m[1], resolve(m[2]));
  else if (wanted.length === 1) drifts.set(wanted[0], resolve(v));
  else fail(`--drift ${v}: name the platform and architecture (<os>-<arch>=<path>) when building ${wanted.join(", ")}`);
});
// Fail closed: a downloadable build without its drift would open on "drift was not found".
for (const w of wanted) if (!drifts.has(w)) fail(`no drift binary for ${w}: pass --drift ${w}=<path> (the release workflow builds one per target)`);

for (const f of ["dist/index.html", "dist-electron/main.cjs", "dist-electron/preload.cjs"])
  if (!existsSync(join(app, f))) fail(`${f} is missing: run \`npm run build -w drift-studio\` first`);

const problems = releaseProblems(platforms, process.env, process.platform);
if (problems.length) fail(`STUDIO_RELEASE=1 refuses an unsigned build:\n  ${problems.join("\n  ")}`);

// Stage: the app as vite built it, with a package.json of its own and no node_modules.
const studio = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
const rel = join(app, "release");
const stageApp = join(rel, "app");
const stageBin = join(rel, "bin");
rmSync(stageApp, { recursive: true, force: true });
rmSync(stageBin, { recursive: true, force: true });
rmSync(join(rel, "out"), { recursive: true, force: true });
mkdirSync(stageApp, { recursive: true });
cpSync(join(app, "dist"), join(stageApp, "dist"), { recursive: true });
cpSync(join(app, "dist-electron"), join(stageApp, "dist-electron"), { recursive: true });
// The deb target refuses to build without a project homepage. The workspace's Cargo.toml is
// the one place the repository URL is written, so it is read from there.
const homepage = /^repository\s*=\s*"([^"]+)"/m.exec(readFileSync(join(app, "..", "..", "Cargo.toml"), "utf8"))?.[1];
if (!homepage) fail("no repository URL in the workspace Cargo.toml (the deb package needs a homepage)");
const manifest = { name: studio.name, productName: "Drift Studio", version: studio.version, description: studio.description, license: studio.license, author: "The Drift authors", homepage, main: studio.main };
writeFileSync(join(stageApp, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const [key, src] of drifts) {
  if (!existsSync(src) || !statSync(src).isFile()) fail(`--drift ${key}=${src}: not a file`);
  const exe = key.startsWith("win-") ? "drift.exe" : "drift";
  mkdirSync(join(stageBin, key), { recursive: true });
  copyFileSync(src, join(stageBin, key, exe));
  // Workflow artifacts lose the executable bit; the packaged app checks it.
  chmodSync(join(stageBin, key, exe), 0o755);
  const hostKey = `${HOST}-${process.arch}`;
  if (key === hostKey) {
    const v = spawnSync(join(stageBin, key, exe), ["--version"], { encoding: "utf8" });
    if (v.status !== 0) fail(`${src} --version exited ${v.status}: ${v.stderr}`);
    console.log(`package: carrying ${v.stdout.trim()} for ${key}`);
  } else console.log(`package: carrying ${src} for ${key}`);
}

const electronVersion = JSON.parse(readFileSync(require.resolve("electron/package.json"), "utf8")).version;
const config = builderConfig(process.env, { version: studio.version, electronVersion, appDir: "release/app", binDir: "release/bin", outDir: "release/out" }, process.platform);
const configPath = join(rel, "electron-builder.json");
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`package: wrote ${configPath}`);
if (has("--config-only")) process.exit(0);

let cli = process.env.ELECTRON_BUILDER;
if (!cli) {
  try {
    cli = require.resolve("electron-builder/cli.js");
  } catch {
    fail("electron-builder is not installed: install it (see apps/studio/README.md, Packaging) or set ELECTRON_BUILDER to its cli.js");
  }
}
const env = { ...process.env };
// Without an identity, never let electron-builder pick one from the keychain.
if (!macSigned(env)) env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
const args = [cli, "--projectDir", app, "--config", configPath, "--publish", "never", ...platforms.map((p) => `--${p}`), ...archFlags.map((a) => `--${a}`), ...(has("--dir") ? ["--dir"] : [])];
console.log(`package: electron-builder ${args.slice(1).join(" ")}`);
const r = spawnSync(process.execPath, args, { cwd: app, env, stdio: "inherit" });
if (r.status !== 0) fail(`electron-builder exited ${r.status ?? r.signal}`);

// Checksums of what a person downloads (the installers and archives, not the unpacked dirs).
const out = join(rel, "out");
const files = readdirSync(out).filter((f) => /\.(AppImage|deb|dmg|zip|exe)$/.test(f) && statSync(join(out, f)).isFile()).sort();
if (files.length) {
  const sums = [];
  for (const f of files) {
    const h = createHash("sha256");
    for await (const chunk of createReadStream(join(out, f))) h.update(chunk);
    sums.push(`${h.digest("hex")}  ${f}`);
  }
  writeFileSync(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);
  console.log(`package: ${files.length} artifacts in ${out}:\n  ${files.join("\n  ")}`);
}
