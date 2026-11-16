import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { exeBehindShim, resolveDrift } from "../../electron/drift";
import { gitInfo } from "../../electron/git";
import { NO_PRACTICES, NO_PROMOTE, StudioMain } from "../../electron/handlers";
import { InvalidArgument, acceptableExit, assertConventionIds, assertGitRef, assertMember, assertReason, assertRelPath, driftArgs, driftEnv, exemptFlags, isInside, promoteFlags, reviewFlags, writesRepository } from "../../electron/ops";
import { promoteFlags as shownPromoteFlags } from "../../src/shared/lib/promote";
import { exemptCommand, reviewFlags as shownFlags } from "../../src/shared/lib/review";
import { ExceptionReason, MemberKey, PromoteRequest, channels } from "../../src/shared/ipc/contract";
import { listSessionFiles, sessionTitle } from "../../electron/sessions";
import { Store } from "../../electron/store";
import { readRuns } from "../../src/entities/study/runs";

describe("argument validation and argv", () => {
  it("accepts only repo-relative paths", () => {
    expect(assertRelPath("a/./b.ts")).toBe("a/b.ts");
    for (const bad of ["", "/etc/passwd", "../x", "a/../../x", "a\\b", "C:/x", "a\0b"]) expect(() => assertRelPath(bad)).toThrow(InvalidArgument);
  });
  it("checks containment", () => {
    expect(isInside("/r", "/r/a/b")).toBe(true);
    expect(isInside("/r", "/r")).toBe(false);
    expect(isInside("/r", "/rx/a")).toBe(false);
    expect(isInside("/r", "/r/../etc")).toBe(false);
  });
  it("builds drift argv from fixed pieces, never a shell string", () => {
    expect(driftArgs("/r", { op: "check" })).toEqual(["--root", "/r", "check", "--format", "json"]);
    expect(driftArgs("/r", { op: "review", decision: "block", ids: ["D-abcdef", "D-abcdef"] })).toEqual(["--root", "/r", "review", "--block", "D-abcdef"]);
    expect(() => driftArgs("/r", { op: "review", decision: "accept", ids: ["D-abcdef;rm -rf /"] })).toThrow(InvalidArgument);
    expect(() => assertConventionIds([])).toThrow();
  });
  it("passes drift a minimal environment with the Studio's cache", () => {
    const env = driftEnv({ PATH: "/bin", HOME: "/h", NODE_OPTIONS: "--x", DRIFT_CACHE_DIR: "/repo/.drift" }, "/cache");
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", DRIFT_CACHE_DIR: "/cache", DRIFT_REVIEW_VIA: "studio" });
  });
});

describe("main-process handlers", () => {
  const tmp = mkdtempSync(join(tmpdir(), "studio-"));
  const repo = join(tmp, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(tmp, "secret.txt"), "top secret");
  symlinkSync(join(tmp, "secret.txt"), join(repo, "src", "link.ts"));
  const projects = join(tmp, "projects");
  const proj = join(projects, repo.replace(/[^A-Za-z0-9-]/g, "-"));
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "11111111-2222-3333-4444-555555555555.jsonl"), '{"type":"user","message":{"role":"user","content":"Add an endpoint"}}\n');
  mkdirSync(join(projects, "-elsewhere"), { recursive: true });
  writeFileSync(join(projects, "-elsewhere", "other.jsonl"), "{}\n");
  const store = new Store(join(tmp, "data"));
  const main = new StudioMain({
    store,
    projectsDir: projects,
    user: "tester",
    appVersion: "0",
    platform: "linux",
    dialogs: { chooseDirectory: async () => repo, chooseFile: async () => null, chooseSavePath: async () => null },
  });
  const ref = { path: repo, name: "repo" };

  it("loads study runs one by one: an unreadable metrics.json is reported, the rest still load", async () => {
    const study = join(tmp, "drift", "eval", "study");
    for (const r of ["good", "torn"]) mkdirSync(join(study, "runs", r), { recursive: true });
    writeFileSync(join(study, "labels.jsonl"), "");
    writeFileSync(join(study, "runs", "good", "metrics.json"), JSON.stringify({ run: "eval/study/runs/good" }));
    writeFileSync(join(study, "runs", "torn", "metrics.json"), '{"run": ');
    const m = new StudioMain({ store: new Store(join(tmp, "data-studies")), projectsDir: projects, user: "t", appVersion: "0", platform: "linux", dialogs: { chooseDirectory: async () => join(tmp, "drift"), chooseFile: async () => null, chooseSavePath: async () => null } });
    const s = await m.loadStudies({ choose: true });
    expect(s?.runs.find((r) => r.path === "eval/study/runs/good")?.metrics).toEqual({ run: "eval/study/runs/good" });
    expect(s?.runs.find((r) => r.path === "eval/study/runs/torn")?.error).toMatch(/could not be read/);
  });

  it("loads calibrations (shift and agreement per part) and dev manifests, never held-out manifests", async () => {
    const evalDir = join(tmp, "drift2", "eval");
    const calib = join(evalDir, "study", "runs", "calib-x");
    mkdirSync(join(calib, "ts"), { recursive: true });
    writeFileSync(join(evalDir, "study", "labels.jsonl"), "");
    writeFileSync(join(calib, "shift.json"), JSON.stringify({ n: 3, kappa: 0.5 }));
    writeFileSync(join(calib, "ts", "metrics.json"), JSON.stringify({ run: "eval/study/runs/calib-x/ts" }));
    writeFileSync(join(calib, "ts", "agreement.json"), JSON.stringify({ n: 3, kappa: 0.9 }));
    writeFileSync(join(evalDir, "repos-py-2.json"), JSON.stringify({ "//": "dev set", repos: [{ name: "a", language: "Python" }] }));
    writeFileSync(join(evalDir, "holdout-primary.json"), JSON.stringify({ repos: [{ name: "secret" }] }));
    const m = new StudioMain({ store: new Store(join(tmp, "data-studies2")), projectsDir: projects, user: "t", appVersion: "0", platform: "linux", dialogs: { chooseDirectory: async () => join(tmp, "drift2"), chooseFile: async () => null, chooseSavePath: async () => null } });
    const s = await m.loadStudies({ choose: true });
    expect(s?.runs).toEqual([{ path: "eval/study/runs/calib-x/ts", metrics: { run: "eval/study/runs/calib-x/ts" }, calibration: true }]);
    expect(s?.calibrations).toEqual([{ path: "eval/study/runs/calib-x", shift: { n: 3, kappa: 0.5 }, agreements: [{ path: "eval/study/runs/calib-x/ts", agreement: { n: 3, kappa: 0.9 } }] }]);
    expect(s?.manifests).toEqual([{ path: "eval/repos-py-2.json", note: "dev set", repos: 1, language: "Python" }]);
  });

  it("finds runs scored per part at any depth, their variants, agreement and adjudication exclusions (#44 layout)", async () => {
    const evalDir = join(tmp, "drift4", "eval");
    const part = join(evalDir, "study", "runs", "dev-q-2027-01-01", "py");
    const view = join(part, "views", "d5");
    mkdirSync(view, { recursive: true });
    mkdirSync(join(part, "relabel", "adjudication"), { recursive: true });
    writeFileSync(join(evalDir, "study", "labels.jsonl"), "");
    writeFileSync(join(view, "metrics.json"), JSON.stringify({ run: "eval/study/runs/dev-q-2027-01-01/py/views/d5", kind: "precision" }));
    writeFileSync(join(view, "metrics-without-X.json"), JSON.stringify({ run: "eval/study/runs/dev-q-2027-01-01/py/views/d5", kind: "precision", exposure: { exposed: ["X"] } }));
    writeFileSync(join(view, "metrics.md"), "not json");
    writeFileSync(join(part, "relabel", "agreement.json"), JSON.stringify({ n: 4, kappa: 0.5 }));
    writeFileSync(join(part, "relabel", "adjudication", "queue.json"), JSON.stringify({ excluded: { repos: ["X"], uids: ["X/D-1"], reason: "why" }, cases: [] }));
    writeFileSync(join(part, "queue.json"), JSON.stringify({ excluded: { repos: ["not an adjudication"] } }));
    const m = new StudioMain({ store: new Store(join(tmp, "data-studies4")), projectsDir: projects, user: "t", appVersion: "0", platform: "linux", dialogs: { chooseDirectory: async () => join(tmp, "drift4"), chooseFile: async () => null, chooseSavePath: async () => null } });
    const s = await m.loadStudies({ choose: true });
    const rel = "eval/study/runs/dev-q-2027-01-01/py";
    expect(s?.runs.map((r) => [r.path, r.variant ?? null])).toEqual([
      [`${rel}/views/d5`, null],
      [`${rel}/views/d5`, "without-X"],
    ]);
    expect(s?.agreements).toEqual([{ path: `${rel}/relabel`, agreement: { n: 4, kappa: 0.5 } }]);
    expect(s?.exclusions).toEqual([{ path: `${rel}/relabel/adjudication`, excluded: { repos: ["X"], uids: ["X/D-1"], reason: "why" } }]);
    const { runs } = readRuns(s!.runs, s!);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ part: "py", viewName: "d5", exposure: { exposed: ["X"] }, agreement: { kappa: 0.5 }, exclusions: [{ repos: ["X"] }] });
  });

  it("does not make a precision run a calibration because a stray shift.json sits beside it", async () => {
    const evalDir = join(tmp, "drift3", "eval");
    const run = join(evalDir, "study", "runs", "dev-z");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(evalDir, "study", "labels.jsonl"), "");
    writeFileSync(join(run, "shift.json"), JSON.stringify({ n: 1 }));
    writeFileSync(join(run, "metrics.json"), JSON.stringify({ run: "eval/study/runs/dev-z", kind: "precision" }));
    const m = new StudioMain({ store: new Store(join(tmp, "data-studies3")), projectsDir: projects, user: "t", appVersion: "0", platform: "linux", dialogs: { chooseDirectory: async () => join(tmp, "drift3"), chooseFile: async () => null, chooseSavePath: async () => null } });
    const s = await m.loadStudies({ choose: true });
    const { runs } = readRuns(s!.runs);
    expect(runs).toHaveLength(1);
    expect(runs[0].calibration).toBe(false);
  });

  it("refuses repositories the person did not open", async () => {
    await expect(main.readSource({ path: tmp, name: "x" }, "secret.txt")).rejects.toThrow(/unknown repository/);
  });

  it("reads only files the last scan listed, inside the repository", async () => {
    await main.openRepo();
    // Pretend a scan happened (no binary in unit tests).
    (main as unknown as { scanned: Map<string, Set<string>> }).scanned.set(repo, new Set(["src/a.ts", "src/link.ts"]));
    expect(await main.readSource(ref, "src/a.ts")).toBe("export const a = 1;\n");
    expect(await main.readSource(ref, "src/link.ts")).toBeNull(); // symlink out of the repo
    expect(await main.readSource(ref, "src/other.ts")).toBeNull(); // not scanned
  });

  it("lists this repository's sessions and reads them by id only", () => {
    const list = main.listSessions(ref, { all: false });
    expect(list.map((s) => s.title)).toEqual(["Add an endpoint"]);
    expect(main.readTranscript(ref, list[0].id)).toContain("Add an endpoint");
    expect(() => main.readTranscript(ref, "../../secret")).toThrow();
    expect(main.listSessions(ref, { all: true })).toHaveLength(2);
  });

  it("keeps history in its own directory", () => {
    const s = { at: Date.now(), commit: null, files: 1, pending: [], newViolations: ["x"], unguarded: [], reaching: [], sinks: [], leaks: [] };
    expect(main.recordSnapshot(ref, s).snapshots).toHaveLength(1);
    expect(main.clearHistory(ref).snapshots).toHaveLength(0);
  });

  it("keeps unreadable history aside instead of overwriting the audit trail", () => {
    const dir = store.repoDir(repo, null);
    writeFileSync(join(dir, "history.json"), "{ not json");
    expect(store.history(dir)).toEqual({ snapshots: [], audit: [] });
    const kept = readdirSync(dir).filter((f) => f.startsWith("history.unreadable-"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(dir, kept[0]), "utf8")).toBe("{ not json");
  });

  it("finds sessions by Claude Code's directory naming and reads titles", () => {
    expect(listSessionFiles(projects, repo)).toHaveLength(1);
    expect(sessionTitle('{"type":"user","message":{"content":"<command-name>x"}}\n{"type":"user","message":{"content":"Real prompt"}}')).toBe("Real prompt");
  });

  it("reads git provenance without running git", () => {
    const g = join(tmp, "g");
    mkdirSync(join(g, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(join(g, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(g, ".git", "refs", "heads", "main"), "4f2a91c0aa00000000000000000000000000000a\n");
    writeFileSync(join(g, ".git", "config"), '[remote "origin"]\n\turl = git@example.com:o/r.git\n');
    expect(gitInfo(g)).toEqual({ commit: "4f2a91c", branch: "main", remote: "git@example.com:o/r.git" });
    expect(gitInfo(tmp)).toEqual({ commit: null, branch: null, remote: null });
  });
});

describe("finding drift on Windows without a shell", () => {
  // npm's cmd-shim (global installs) and pnpm's (`%~dp0`, a local node_modules/.bin).
  const npmShim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@acme\\drift\\bin\\drift.js" %*\r\n';
  const pnpmShim = '@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\..\\@acme\\drift\\bin\\drift.js" %*\r\n) ELSE (\r\n  node  "%~dp0\\..\\@acme\\drift\\bin\\drift.js" %*\r\n)\r\n';
  const manifest = JSON.stringify({ name: "@acme/drift", optionalDependencies: { "@acme/drift-win32-x64": "1.0.0" } });
  const put = (p: string, body: string) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  /** The per-platform package, as npm/build.mjs lays it out. */
  const platformPackage = (dir: string, name = "@acme/drift-win32-x64") => {
    put(join(dir, "package.json"), JSON.stringify({ name }));
    put(join(dir, "bin", "drift.exe"), "MZ");
    return join(dir, "bin", "drift.exe");
  };

  it("follows a global npm shim to drift.exe in the nested platform package", () => {
    const prefix = mkdtempSync(join(tmpdir(), "npm-global-"));
    put(join(prefix, "drift.cmd"), npmShim);
    put(join(prefix, "node_modules", "@acme", "drift", "package.json"), manifest);
    const exe = platformPackage(join(prefix, "node_modules", "@acme", "drift", "node_modules", "@acme", "drift-win32-x64"));
    expect(exeBehindShim(join(prefix, "drift.cmd"), "x64")).toBe(exe);
    // PATH holds only the shim: the Studio runs drift.exe, never drift.cmd.
    expect(resolveDrift(null, { PATH: prefix }, "win32")).toEqual({ path: exe, source: "path" });
    // A shim chosen in Settings is followed too.
    expect(resolveDrift(join(prefix, "drift.cmd"), { PATH: "" }, "win32")).toEqual({ path: exe, source: "settings" });
    // No package for this architecture: nothing to run.
    expect(exeBehindShim(join(prefix, "drift.cmd"), "arm64")).toBeNull();
  });

  it("follows a local .bin shim to the hoisted platform package", () => {
    const proj = mkdtempSync(join(tmpdir(), "npm-local-"));
    const bin = join(proj, "node_modules", ".bin");
    put(join(bin, "drift.cmd"), pnpmShim);
    put(join(proj, "node_modules", "@acme", "drift", "package.json"), manifest);
    const exe = platformPackage(join(proj, "node_modules", "@acme", "drift-win32-x64"));
    expect(exeBehindShim(join(bin, "drift.cmd"), "x64")).toBe(exe);
  });

  it("never returns a .cmd or .bat, nor follows a shim for some other package", () => {
    const d = mkdtempSync(join(tmpdir(), "shim-"));
    put(join(d, "drift.cmd"), npmShim);
    put(join(d, "drift.bat"), "@echo off\r\n");
    put(join(d, "node_modules", "@acme", "drift", "package.json"), JSON.stringify({ name: "@acme/drift" }));
    expect(exeBehindShim(join(d, "drift.cmd"), "x64")).toBeNull();
    expect(exeBehindShim(join(d, "drift.bat"), "x64")).toBeNull();
    expect(resolveDrift(join(d, "drift.bat"), { PATH: d }, "win32")).toEqual({ path: null, source: "none" });
    // A real drift.exe on PATH comes first; a relative PATH entry is never used.
    put(join(d, "drift.exe"), "MZ");
    expect(resolveDrift(null, { PATH: relative(process.cwd(), d) }, "win32")).toEqual({ path: null, source: "none" });
    expect(resolveDrift(relative(process.cwd(), join(d, "drift.exe")), { PATH: "" }, "win32")).toEqual({ path: null, source: "none" });
    expect(resolveDrift(null, { PATH: d }, "win32")).toEqual({ path: join(d, "drift.exe"), source: "path" });
  });

  it("stays inside node_modules whatever the shim and manifest say", () => {
    const root = mkdtempSync(join(tmpdir(), "shim-escape-"));
    const bin = join(root, "a", "b", "c");
    put(join(bin, "drift.cmd"), '"%dp0%\\..\\elsewhere\\x\\bin\\drift.js" %*\r\n');
    const evil = "../../../evil";
    put(join(bin, "..", "elsewhere", "x", "package.json"), JSON.stringify({ name: evil, optionalDependencies: { [`${evil}-win32-x64`]: "1" } }));
    platformPackage(join(root, "evil-win32-x64"), `${evil}-win32-x64`);
    expect(exeBehindShim(join(bin, "drift.cmd"), "x64")).toBeNull();
    // A well-formed name, but the platform package found there is some other package.
    put(join(bin, "..", "elsewhere", "x", "package.json"), manifest);
    platformPackage(join(bin, "..", "elsewhere", "x", "node_modules", "@acme", "drift-win32-x64"), "@acme/not-drift");
    expect(exeBehindShim(join(bin, "drift.cmd"), "x64")).toBeNull();
  });
});

describe("review decisions and diff bases (#15, #19, #23)", () => {
  it("builds --block --force and --advise, and shows exactly what it runs", () => {
    expect(driftArgs("/r", { op: "review", decision: "force_block", ids: ["D-abcdef"] })).toEqual(["--root", "/r", "review", "--block", "D-abcdef", "--force"]);
    expect(driftArgs("/r", { op: "review", decision: "advise", ids: ["D-abcdef"] })).toEqual(["--root", "/r", "review", "--advise", "D-abcdef"]);
    for (const d of ["accept", "reject", "block", "force_block", "advise"] as const) expect(shownFlags(d, ["D-abcdef"])).toEqual(reviewFlags(d, ["D-abcdef"]));
    expect(() => driftArgs("/r", { op: "review", decision: "nuke" as never, ids: ["D-abcdef"] })).toThrow(InvalidArgument);
  });

  it("passes --diff-base only a plain git ref", () => {
    expect(driftArgs("/r", { op: "check", base: "origin/main" })).toEqual(["--root", "/r", "check", "--format", "json", "--diff-base", "origin/main"]);
    expect(driftArgs("/r", { op: "check", base: null })).toEqual(["--root", "/r", "check", "--format", "json"]);
    for (const ok of ["main", "origin/main", "v1.2.0", "release/2026-11", "4f2a91c", "feature_x+y"]) expect(assertGitRef(ok)).toBe(ok);
    for (const bad of ["", "-x", "--output=/tmp/x", "a..b", "HEAD@{1}", "main^", "main~1", "a:b", "x/", "x.lock", "a//b", ".hidden", "a/.b", "a b", "a\nb", "x".repeat(201)])
      expect(() => assertGitRef(bad), bad).toThrow(InvalidArgument);
  });
});

describe("a reviewer's exception (fine because…, workstream F)", () => {
  it("builds --exempt/--unexempt with every value attached by =, so a reason that reads like a flag stays a value", () => {
    expect(driftArgs("/r", { op: "exempt", id: "D-abcdef", member: "app/api/ping/route.ts#GET", reason: "--accept D-123456  now" })).toEqual([
      "--root",
      "/r",
      "review",
      "--exempt=D-abcdef",
      "--member=app/api/ping/route.ts#GET",
      "--reason=--accept D-123456 now",
    ]);
    expect(driftArgs("/r", { op: "exempt", id: "D-abcdef", member: "a.ts##priv", reason: null })).toEqual(["--root", "/r", "review", "--unexempt=D-abcdef", "--member=a.ts##priv"]);
    // What the Studio shows is what the main process runs.
    expect(exemptCommand("/r", "D-abcdef", "a b.ts#x", "public, by design")).toBe('drift --root /r review --exempt=D-abcdef "--member=a b.ts#x" "--reason=public, by design"');
    expect(exemptCommand("/r", "D-abcdef", "a.ts#x", null)).toBe("drift --root /r review --unexempt=D-abcdef --member=a.ts#x");
    expect(exemptFlags("D-abcdef", "a.ts#x", "ok")).toEqual(["--exempt=D-abcdef", "--member=a.ts#x", "--reason=ok"]);
  });

  it("refuses a malformed member, id or reason, in the main process and in the channel schema", () => {
    for (const bad of ["a.ts", "#x", "a.ts#", "/a.ts#x", "../a.ts#x", "a/./b.ts#x", "a//b.ts#x", "a\\b.ts#x", "a.ts#x\ny", "x".repeat(1025) + "#y", 3]) {
      expect(() => assertMember(bad), String(bad)).toThrow(InvalidArgument);
      expect(MemberKey.safeParse(bad).success, String(bad)).toBe(false);
    }
    for (const ok of ["a/b.ts#C.m", "a.ts##priv", "apps/web/app/(dash)/[slug]/page.tsx#default"]) {
      expect(assertMember(ok)).toBe(ok);
      expect(MemberKey.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["", "   ", "x".repeat(121), "bell\u0007", "nul\u0000"]) {
      expect(() => assertReason(bad), JSON.stringify(bad)).toThrow(InvalidArgument);
      expect(ExceptionReason.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(assertReason("  two\n lines ")).toBe("two lines");
    expect(assertReason("x".repeat(120))).toHaveLength(120);
    expect(() => driftArgs("/r", { op: "exempt", id: "D-nope", member: "a.ts#x", reason: "ok" })).toThrow(InvalidArgument);
  });
});

describe("the practice map (drift practices, PLAN-R13 §4)", () => {
  it("runs practices --json; the only practices write is its own channel, promote, apart from the dry run", () => {
    expect(driftArgs("/r", { op: "practices" })).toEqual(["--root", "/r", "practices", "--json"]);
    expect(driftArgs("/r", { op: "map" })).toEqual(["--root", "/r", "map", "--json"]);
    expect(channels.map.res.safeParse({ data: { schema: 1, packages: [] }, at: 1, cached: false, provenance: { commit: null, branch: null, driftVersion: null } }).success).toBe(true);
    expect(Object.keys(channels).filter((c) => /promote/i.test(c)).sort()).toEqual(["promote", "promotePreview"]);
    expect(writesRepository("practices")).toBe(false);
    expect(writesRepository("promotePreview")).toBe(false);
    expect(writesRepository("promote")).toBe(true);
  });

  // A stand-in drift: `--version` and `census --help` answer; practices and practices promote answer as the script's
  // modes say, and every promote argv is appended to argv.log beside the binary.
  function fakeDrift(dir: string, practices: string, promote = "exit 3"): string {
    const bin = join(dir, "drift");
    writeFileSync(
      bin,
      `#!/bin/sh
case "$*" in
  --version) echo "drift 0.1.0-test" ;;
  "census --help") echo "--json" ;;
  *"practices promote"*) echo "$*" >> "${join(dir, "argv.log")}"; ${promote} ;;
  *"practices --json"*) ${practices} ;;
  *) exit 3 ;;
esac
`,
    );
    chmodSync(bin, 0o755);
    return bin;
  }

  function setup(practices: string, promote?: string) {
    const tmp = mkdtempSync(join(tmpdir(), "studio-practices-"));
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    const store = new Store(join(tmp, "data"));
    store.update({ driftPath: fakeDrift(tmp, practices, promote) });
    const main = new StudioMain({ store, projectsDir: join(tmp, "projects"), user: "tester", appVersion: "0", platform: "linux", dialogs: { chooseDirectory: async () => repo, chooseFile: async () => null, chooseSavePath: async () => null } });
    return { tmp, repo, store, main, ref: { path: repo, name: "repo" } };
  }

  it("reads drift practices --json, and says plainly when the binary predates it", async () => {
    const ok = setup(`echo '{"version":1,"summary":{"population":0,"known":0,"none":0,"unknown":0,"coverage":0,"concerns_at_target":0,"target":0.9},"concerns":[],"not_covered":[]}'`);
    await ok.main.openRepo();
    const r = await ok.main.practices(ok.ref);
    expect((r.data as { version: number }).version).toBe(1);
    expect(channels.practices.res.safeParse(r).success).toBe(true);
    const old = setup(`echo "error: unrecognized subcommand 'practices'" >&2; echo "" >&2; echo "For more information, try '--help'." >&2; exit 2`);
    await old.main.openRepo();
    await expect(old.main.practices(old.ref)).rejects.toThrow(NO_PRACTICES);
  });

  const PROMOTED = JSON.stringify({
    written: true,
    place: "app/api",
    convention: { id: "D-4c1e07", summary: "authn in app/api: wrap withAuth", status: "accepted", mode: "advise", promoted_from_practice: "P-0f0acb" },
    candidate: { concern: "authn", unit: "entry_point", place: { package: "", dir: "app/api" }, ways: [{ id: "P-0f0acb", key: "wrap:lib/auth.ts#withAuth", label: "wrap withAuth", members: 38 }], other_ways: [], follows: 38, exceptions: [{ path: "app/api/r38/route.ts", symbol: "GET", line: 1 }, { path: "app/api/r39/route.ts", symbol: "GET", line: 1 }], unknown: 0, total: 40, example: { path: "app/api/r00/route.ts", symbol: "GET", line: 3 }, forced: false },
    baselined: 2,
    replay: null,
    preview: "authn in app/api: 38 of 40 entry points use wrap withAuth.",
  });

  it("builds practices promote argv: the place, each other way once, block when asked; the preview always --dry-run", () => {
    const req = { id: "P-0f0acb", place: "app/api", with: ["P-111111", "P-0f0acb", "P-111111", "P-222222"], block: false };
    expect(driftArgs("/r", { op: "promotePreview", promote: req })).toEqual(["--root", "/r", "practices", "promote", "P-0f0acb", "--in", "app/api", "--with", "P-111111", "--with", "P-222222", "--dry-run", "--json"]);
    expect(driftArgs("/r", { op: "promote", promote: { ...req, block: true } })).toEqual(["--root", "/r", "practices", "promote", "P-0f0acb", "--in", "app/api", "--with", "P-111111", "--with", "P-222222", "--block", "--json"]);
    expect(driftArgs("/r", { op: "promote", promote: { id: "P-0f0acb", place: ".", with: [], block: false } })).toEqual(["--root", "/r", "practices", "promote", "P-0f0acb", "--in", ".", "--json"]);
    // What the Studio shows is exactly what it runs.
    for (const dry of [true, false]) expect(shownPromoteFlags(req, dry)).toEqual(promoteFlags(req, dry));
    expect(acceptableExit("promote", 2)).toBe(true);
    expect(acceptableExit("promotePreview", 2)).toBe(true);
    expect(acceptableExit("practices", 2)).toBe(false);
    expect(acceptableExit("promote", 1)).toBe(false);
  });

  it("refuses a malformed variant id or place, in the main process and in the channel schema", () => {
    const ok = { id: "P-0f0acb", place: "apps/web/app/api", with: [], block: false };
    expect(PromoteRequest.safeParse(ok).success).toBe(true);
    expect(PromoteRequest.safeParse({ ...ok, place: "." }).success).toBe(true);
    for (const place of ["", "/etc", "../x", "a/../b", "a//b", "a/./b", "-x", "--force", "a\\b", "a\nb", "a/"]) {
      expect(PromoteRequest.safeParse({ ...ok, place }).success, place).toBe(false);
      expect(() => driftArgs("/r", { op: "promotePreview", promote: { ...ok, place } }), place).toThrow(InvalidArgument);
    }
    for (const id of ["D-0f0acb", "P-0F0ACB", "P-0f0ac", "--force", ""]) {
      expect(PromoteRequest.safeParse({ ...ok, id }).success, id).toBe(false);
      expect(PromoteRequest.safeParse({ ...ok, with: [id] }).success, id).toBe(false);
      expect(() => driftArgs("/r", { op: "promote", promote: { ...ok, id } }), id).toThrow(InvalidArgument);
    }
    expect(PromoteRequest.safeParse({ ...ok, block: "yes" }).success).toBe(false);
  });

  it("previews with --dry-run, writes and audits only on promote, and shows a refusal (exit 2) as Drift's message", async () => {
    const ok = setup(`exit 3`, `echo '${PROMOTED}'`);
    await ok.main.openRepo();
    const req = { id: "P-0f0acb", place: "app/api", with: [], block: false };
    const preview = await ok.main.promotePreview(ok.ref, req);
    expect(channels.promotePreview.res.safeParse(preview).success).toBe(true);
    expect(ok.main.history(ok.ref).audit.filter((a) => a.decision === "promote")).toEqual([]);
    const written = await ok.main.promote(ok.ref, req);
    expect((written as { convention: { id: string } }).convention.id).toBe("D-4c1e07");
    const audit = ok.main.history(ok.ref).audit.filter((a) => a.decision === "promote");
    expect(audit.map((a) => [a.ids, a.ok])).toEqual([[["D-4c1e07"], true]]);
    expect(audit[0]?.command).toContain("practices promote P-0f0acb --in app/api --json");
    const argv = readFileSync(join(ok.tmp, "argv.log"), "utf8").trim().split("\n");
    expect(argv.map((l) => l.split(" ").slice(2).join(" "))).toEqual(["practices promote P-0f0acb --in app/api --dry-run --json", "practices promote P-0f0acb --in app/api --json"]);

    const refusal = JSON.stringify({ refused: { code: "too_small", place: "app/api", units: 3, min: 8 }, message: "app/api has 3 entry points of authn Drift could read; a convention needs at least 8." });
    const no = setup(`exit 3`, `echo '${refusal}'; echo 'refused' >&2; exit 2`);
    await no.main.openRepo();
    const r = await no.main.promote(no.ref, req);
    expect(channels.promote.res.safeParse(r).success).toBe(true);
    expect((r as { message: string }).message).toContain("needs at least 8");
    expect(no.main.history(no.ref).audit.filter((a) => a.decision === "promote")).toEqual([]);
  });

  it("says plainly when the binary predates practices promote, and shows Drift's error for bad arguments", async () => {
    const old = setup(`exit 3`, `echo "error: unexpected argument 'promote' found" >&2; exit 2`);
    await old.main.openRepo();
    await expect(old.main.promotePreview(old.ref, { id: "P-0f0acb", place: ".", with: [], block: false })).rejects.toThrow(NO_PROMOTE);
    const bad = setup(`exit 3`, `echo "error: --block and --force cannot be used together" >&2; exit 2`);
    await bad.main.openRepo();
    await expect(bad.main.promotePreview(bad.ref, { id: "P-0f0acb", place: ".", with: [], block: true })).rejects.toThrow(/drift practices promote failed/);
  });
});
