// The live end-to-end test: the real Electron app, the real drift binary, a real repository.
// Where tests/e2e/run.mjs drives the renderer in Chromium on fixtures, this launches the
// desktop app itself (Playwright's Electron support) and walks the main path a person takes:
// open a repository, see what `drift init` proposed in the conventions queue, run a check,
// list the entry points in the security view, and see which drift the Studio found.
//
//   DRIFT_BIN=/path/to/drift node tests/e2e/live.mjs          # the app from source (npm run build first)
//   STUDIO_APP=release/out/linux-unpacked/drift-studio node tests/e2e/live.mjs
//                                                              # a packaged app and the drift it carries
//
// DRIFT_BIN    the drift to use (chosen in Settings before launch). Required from source; with
//              STUDIO_APP it is optional, and without it the packaged app must find its own.
// STUDIO_APP   a packaged Studio's executable (scripts/package.mjs --dir writes one).
// ELECTRON_OVERRIDE_DIST_PATH  a directory holding the electron executable, when the electron
//              package has not downloaded one (electron's own variable).
// On Linux without a display, run it under xvfb-run. Writes test-results/live-*.png on failure.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { parse } from "yaml";
import { writeBeacon } from "../../scripts/synth-beacon.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..", "..");
const require = createRequire(join(appDir, "package.json"));
const OUT = join(appDir, "test-results");
mkdirSync(OUT, { recursive: true });

function fail(msg) {
  console.error(`live: ${msg}`);
  process.exit(2);
}

const packaged = process.env.STUDIO_APP ? resolve(process.env.STUDIO_APP) : null;
const chosen = process.env.DRIFT_BIN ? resolve(process.env.DRIFT_BIN) : null;

/** The drift a packaged app carries, beside its executable (electron/drift.ts `bundledDrift`). */
function carried(exe) {
  const resources = process.platform === "darwin" ? join(dirname(exe), "..", "Resources") : join(dirname(exe), "resources");
  return join(resources, "bin", process.platform === "win32" ? "drift.exe" : "drift");
}

/** The electron executable for a run from source, without letting the electron package download one. */
function electronFromSource() {
  const pkg = dirname(require.resolve("electron/package.json"));
  const pathTxt = join(pkg, "path.txt");
  const rel = existsSync(pathTxt) ? readFileSync(pathTxt, "utf8").trim() : null;
  const over = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  if (over) return join(over, rel ?? (process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron"));
  if (rel && existsSync(join(pkg, "dist", rel))) return join(pkg, "dist", rel);
  fail("Electron is not downloaded: run `node node_modules/electron/install.js`, or set ELECTRON_OVERRIDE_DIST_PATH");
}

let executablePath;
let args;
let setupDrift;
if (packaged) {
  if (!existsSync(packaged)) fail(`STUDIO_APP ${packaged} does not exist`);
  executablePath = packaged;
  args = [];
  setupDrift = chosen ?? carried(packaged);
  if (!existsSync(setupDrift)) fail(`the packaged app carries no drift at ${setupDrift}`);
} else {
  if (!chosen) fail("set DRIFT_BIN to a drift binary (or STUDIO_APP to a packaged Studio)");
  for (const f of ["dist/index.html", "dist-electron/main.cjs"]) if (!existsSync(join(appDir, f))) fail(`${f} is missing: run \`npm run build -w drift-studio\` first`);
  executablePath = electronFromSource();
  args = [appDir];
  setupDrift = chosen;
}
const expectedSource = chosen ? "settings" : "bundled";

// A small real repository, written by the same generator as the beacon fixture, committed.
const tmp = mkdtempSync(join(tmpdir(), "drift-studio-live-"));
const repo = join(tmp, "beacon");
writeBeacon(repo);
const git = (...a) => execFileSync("git", ["-c", "user.name=Studio test", "-c", "user.email=studio-test@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: repo, stdio: "pipe" });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "beacon");

// `drift init`, as a person runs it first: it writes .drift/conventions.yaml with what it proposes.
const driftEnv = { ...process.env, DRIFT_CACHE_DIR: join(tmp, "cache") };
const drift = (...a) => execFileSync(setupDrift, ["--root", repo, ...a], { env: driftEnv, encoding: "utf8", maxBuffer: 1 << 28 });
const version = drift("--version").trim();
drift("init");
const policy = parse(readFileSync(join(repo, ".drift", "conventions.yaml"), "utf8"));
const proposed = (policy.conventions ?? []).filter((c) => c.status === "proposed").map((c) => c.id).sort();
if (proposed.length === 0) fail("drift init proposed nothing on the test repository");
const entryPoints = JSON.parse(drift("security", "--json")).entry_points ?? [];
if (entryPoints.length === 0) fail("drift security lists no entry point on the test repository");
console.log(`live: ${version}, ${proposed.length} proposed conventions, ${entryPoints.length} entry points; ${packaged ? `packaged app ${packaged}` : "app from source"}, drift found via ${expectedSource}`);

// An isolated profile; DRIFT_BIN is chosen in Settings as a person would.
const userData = join(tmp, "user-data");
mkdirSync(join(userData, "studio"), { recursive: true });
if (chosen) writeFileSync(join(userData, "studio", "settings.json"), JSON.stringify({ driftPath: chosen, recent: [], studiesDir: null }));
const env = { ...process.env, STUDIO_USER_DATA: userData };
// Electron refuses some NODE_OPTIONS, and a dev server URL would load another renderer.
delete env.NODE_OPTIONS;
delete env.STUDIO_DEV_URL;
delete env.STUDIO_OPEN_REPO;

const results = [];
let page;
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").join("\n       ")}`);
    await page?.screenshot({ path: join(OUT, `live-${name.replace(/\W+/g, "-")}.png`) }).catch(() => undefined);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
const go = async (route) => {
  await page.evaluate((h) => (location.hash = h), `#/${route}`);
  await page.waitForFunction(() => !document.querySelector(".st-loading, .dui-skeleton"), null, { timeout: 120_000 }).catch(() => undefined);
};

const app = await electron.launch({ executablePath, args, env, timeout: 60_000 });
const problems = [];
try {
  page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  await step("the window is the sandboxed, isolated app", async () => {
    expect(page.url().startsWith("studio://app/"), `served from studio://app: ${page.url()}`);
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const p = w.webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    });
    expect(prefs.sandbox === true && prefs.contextIsolation === true && prefs.nodeIntegration === false, `web preferences: ${JSON.stringify(prefs)}`);
    expect((await page.evaluate(() => typeof window.require)) === "undefined", "no Node in the renderer");
  });

  await step("open a repository", async () => {
    await page.waitForSelector("button:has-text('Open repository')", { timeout: 30_000 });
    // The native folder dialog cannot be clicked; answer it in the main process with the repository.
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await page.click("button:has-text('Open repository')");
    await page.waitForSelector(".st-shell", { timeout: 30_000 });
    await page.waitForFunction((name) => document.body.innerText.includes(name), basename(repo), { timeout: 30_000 });
  });

  await step("the conventions queue shows what drift init proposed", async () => {
    await go("conventions");
    await page.waitForSelector(".st-qitem", { timeout: 180_000 });
    await page.waitForFunction((n) => document.querySelectorAll(".st-qitem[data-id]").length >= n, proposed.length, { timeout: 60_000 }).catch(() => undefined);
    const shown = (await page.$$eval(".st-qitem[data-id]", (els) => els.map((e) => e.getAttribute("data-id")))).sort();
    const missing = proposed.filter((id) => !shown.includes(id));
    expect(missing.length === 0, `proposed by drift init but not in the queue: ${missing.join(", ")} (shown: ${shown.join(", ")})`);
  });

  await step("the check view runs drift check", async () => {
    await go("check");
    await page.waitForSelector(".ck-scope__cmd", { timeout: 180_000 });
    expect((await page.textContent(".ck-scope__cmd")).trim() === "drift check --format json", "the whole repository, by default");
    await page.waitForSelector(".st-group, .dui-empty", { timeout: 180_000 });
    expect((await page.locator(".dui-error").count()) === 0, `an error: ${await page.locator(".dui-error").first().textContent().catch(() => "")}`);
  });

  await step("the security view lists the entry points", async () => {
    await go("security");
    await page.waitForSelector(".dui-table__row", { timeout: 180_000 });
    expect((await page.textContent(".ck-scope__cmd")).trim() === "drift security --json", "the whole repository, by default");
    const first = entryPoints[0];
    await page.fill("input[aria-label='Filter entry points']", first.path);
    await page.waitForSelector(`.dui-table__row:has-text('${first.path}')`, { timeout: 30_000 });
    expect((await page.locator(".dui-error").count()) === 0, "no error");
  });

  await step(`settings says which drift it found (${expectedSource})`, async () => {
    await go("settings");
    await page.waitForSelector(".st-settings", { timeout: 30_000 });
    await page.waitForFunction((v) => document.querySelector(".st-settings")?.textContent?.includes(v), version, { timeout: 60_000 });
    const text = await page.textContent(".st-settings");
    expect(new RegExp(`Found via\\s*${expectedSource}`).test(text), `found via ${expectedSource}: ${text.slice(0, 400)}`);
  });

  await step("no console errors", async () => {
    expect(problems.length === 0, problems.join("\n"));
  });
} finally {
  await app.close().catch(() => undefined);
  rmSync(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`live: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
