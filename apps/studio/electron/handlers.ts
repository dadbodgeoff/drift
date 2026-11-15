// The main process's implementation of every IPC channel. No Electron import:
// dialogs and the logger are injected, so this is unit-tested directly.
//
// Rules enforced here:
// - a repository must be one the person chose (it is in the recent list);
// - the renderer never names a program, flag or arbitrary file: it names a
//   channel; arguments were validated against the contract before this runs;
// - source reads are limited to files the last scan listed, inside the repo;
// - transcripts are read only from Claude Code's projects directory, by the
//   session ids the last listing returned;
// - the only writes to a repository are `drift review` and `drift init`.
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { RepoFacts } from "../src/shared/contract/drift";
import { slimFacts } from "../src/shared/contract/slim";
import type { AuditEntry, Decision, LogEntry, Provenance, RepoRef, Snapshot } from "../src/shared/ipc/contract";
import { DriftError, resolveDrift, runDrift } from "./drift";
import { gitInfo } from "./git";
import { InvalidArgument, neighbourGate, answerFlags, assertAnswer, assertConventionIds, assertDecision, assertGitRef, assertRelPath, assertSessionId, exemptFlags, isInside, reviewFlags } from "./ops";
import { listSessionFiles, sessionTitle } from "./sessions";
import type { Store } from "./store";

export interface Dialogs {
  chooseDirectory(title: string): Promise<string | null>;
  chooseFile(title: string): Promise<string | null>;
  chooseSavePath(name: string): Promise<string | null>;
}

export interface MainDeps {
  store: Store;
  projectsDir: string;
  dialogs: Dialogs;
  user: string;
  appVersion: string;
  platform: string;
}

const MAX_SOURCE = 2 * 1024 * 1024;
const MAX_TRANSCRIPT = 200 * 1024 * 1024;
const MAX_POLICY = 16 * 1024 * 1024;
/** What the Studio says when the binary predates `drift practices` (round 13). */
export const NO_PRACTICES = "this drift binary has no `practices` command: the practice map needs a Drift from round 13 or newer (choose one in Settings)";

export class StudioMain {
  private aborts = new Map<string, AbortController>();
  private scanned = new Map<string, Set<string>>();
  private sessionFiles = new Map<string, string>();
  private logBuf: LogEntry[] = [];
  private infoCache: { version: string | null; censusJson: boolean; path: string } | null = null;

  constructor(private readonly d: MainDeps) {}

  log(level: LogEntry["level"], message: string, data?: Record<string, unknown>) {
    this.logBuf.push({ at: Date.now(), level, source: "main", message, data });
    if (this.logBuf.length > 2000) this.logBuf.shift();
  }

  // ---------- repositories ----------

  /** A repository the person chose earlier, resolved to its real path. */
  private repo(r: RepoRef): string {
    const known = this.d.store.settings().recent.some((x) => x.path === r.path);
    if (!known) throw new InvalidArgument("unknown repository: open it with Open repository first");
    let real: string;
    try {
      real = realpathSync(r.path);
    } catch {
      throw new InvalidArgument(`${r.path} no longer exists`);
    }
    if (!statSync(real).isDirectory()) throw new InvalidArgument(`${r.path} is not a directory`);
    return real;
  }

  private repoDir(root: string) {
    return this.d.store.repoDir(root, gitInfo(root).remote);
  }

  private provenance(root: string): Provenance {
    const g = gitInfo(root);
    return { commit: g.commit, branch: g.branch, driftVersion: this.infoCache?.version ?? null };
  }

  handshake() {
    return { ipc: 1, platform: this.d.platform, appVersion: this.d.appVersion };
  }

  recentRepos(): RepoRef[] {
    return this.d.store.settings().recent.filter((r) => existsSync(r.path));
  }

  async openRepo(): Promise<RepoRef | null> {
    const dir = await this.d.dialogs.chooseDirectory("Open a repository");
    if (!dir) return null;
    const real = realpathSync(dir);
    const ref = { path: real, name: basename(real) };
    this.d.store.addRecent(ref);
    this.log("info", "repository opened", { path: real });
    return ref;
  }

  /** Add a repository without a dialog (STUDIO_OPEN_REPO, set by whoever launched the app). */
  preopen(dir: string) {
    const real = realpathSync(dir);
    this.d.store.addRecent({ path: real, name: basename(real) });
  }

  forgetRepo(r: RepoRef): RepoRef[] {
    this.d.store.update({ recent: this.d.store.settings().recent.filter((x) => x.path !== r.path) });
    return this.recentRepos();
  }

  // ---------- the binary ----------

  private bin(): string {
    const b = resolveDrift(this.d.store.settings().driftPath);
    if (!b.path) throw new DriftError("drift was not found: install it or choose the binary in Settings");
    return b.path;
  }

  async driftInfo() {
    const b = resolveDrift(this.d.store.settings().driftPath);
    if (!b.path) return { path: null, version: null, censusJson: false, source: "none" as const, error: "drift is not on PATH; choose the binary in Settings" };
    if (this.infoCache?.path !== b.path) {
      try {
        const v = await runDrift(b.path, ".", { op: "version" }, { cacheDir: this.d.store.dir, cwd: this.d.store.dir });
        const h = await runDrift(b.path, ".", { op: "censusHelp" }, { cacheDir: this.d.store.dir, cwd: this.d.store.dir });
        this.infoCache = { path: b.path, version: v.stdout.trim() || null, censusJson: /--json/.test(h.stdout) };
      } catch (e) {
        return { path: b.path, version: null, censusJson: false, source: b.source, error: (e as Error).message };
      }
    }
    this.log("info", "drift binary", { path: b.path, version: this.infoCache!.version });
    return { path: b.path, version: this.infoCache!.version, censusJson: this.infoCache!.censusJson, source: b.source };
  }

  async chooseDrift(reset: boolean) {
    if (reset) this.d.store.update({ driftPath: null });
    else {
      const f = await this.d.dialogs.chooseFile("Choose the drift binary");
      if (f) this.d.store.update({ driftPath: f });
    }
    this.infoCache = null;
    return this.driftInfo();
  }

  private async run(root: string, op: Parameters<typeof runDrift>[2], requestId?: string) {
    const ac = new AbortController();
    if (requestId) this.aborts.set(requestId, ac);
    try {
      if (!this.infoCache) await this.driftInfo();
      const r = await runDrift(this.bin(), root, op, { cacheDir: join(this.repoDir(root), "drift-cache"), signal: ac.signal });
      this.log("info", `drift ${op.op}`, { root, ms: r.ms, code: r.code });
      return r;
    } catch (e) {
      this.log("error", `drift ${op.op} failed`, { root, error: (e as Error).message });
      throw e;
    } finally {
      if (requestId) this.aborts.delete(requestId);
    }
  }

  cancel(requestId: string): boolean {
    const ac = this.aborts.get(requestId);
    ac?.abort();
    return !!ac;
  }

  // ---------- drift JSON ----------

  async facts(r: RepoRef, opts: { refresh: boolean }, requestId?: string) {
    const root = this.repo(r);
    const dir = this.repoDir(root);
    const slimPath = join(dir, "facts-slim.json");
    if (!opts.refresh && existsSync(slimPath)) {
      try {
        const data = JSON.parse(readFileSync(slimPath, "utf8")) as RepoFacts;
        this.scanned.set(root, new Set(data.files.map((f) => f.path)));
        return { data, at: statSync(slimPath).mtimeMs, cached: true, provenance: this.provenance(root) };
      } catch {
        // fall through to a fresh scan
      }
    }
    const full = join(dir, "facts-full.json");
    const res = await this.run(root, { op: "scan", out: full }, requestId);
    const data = slimFacts(JSON.parse(readFileSync(full, "utf8")) as RepoFacts);
    rmSync(full, { force: true });
    writeFileSync(slimPath, JSON.stringify(data));
    this.scanned.set(root, new Set(data.files.map((f) => f.path)));
    return { data, at: Date.now(), cached: false, ms: res.ms, provenance: this.provenance(root) };
  }

  private async json(r: RepoRef, op: "census" | "check" | "security" | "practices" | "map", requestId?: string, base: string | null = null) {
    const root = this.repo(r);
    let res: Awaited<ReturnType<StudioMain["run"]>>;
    try {
      res = await this.run(root, op === "census" || op === "practices" || op === "map" ? { op } : { op, base: base ? assertGitRef(base) : null }, requestId);
    } catch (e) {
      // A Drift from before the practice map (round 13) has no `practices` subcommand: say so, not clap's last line.
      if (op === "practices" && e instanceof DriftError && /unrecognized subcommand/.test(e.result?.stderr ?? "")) throw new DriftError(NO_PRACTICES);
      throw e;
    }
    let data: unknown;
    try {
      data = JSON.parse(res.stdout);
    } catch {
      throw new DriftError(`drift ${op} did not print JSON (is this binary too old for ${op === "census" ? "census --json" : "JSON output"}?)`);
    }
    const provenance = this.provenance(root);
    // The gate drift ran with (driftEnv passes DRIFT_NEIGHBOUR_GATE through): the Check view and Attention say it.
    return { data, at: Date.now(), cached: false, ms: res.ms, provenance: op === "check" ? { ...provenance, neighbourGate: neighbourGate(process.env) } : provenance };
  }

  census(r: RepoRef, id?: string) {
    return this.json(r, "census", id);
  }
  check(r: RepoRef, opts?: { base: string | null }, id?: string) {
    return this.json(r, "check", id, opts?.base ?? null);
  }
  security(r: RepoRef, opts?: { base: string | null }, id?: string) {
    return this.json(r, "security", id, opts?.base ?? null);
  }

  /** `drift practices --json`: what the codebase does for each concern (facts, not rules; exit 0). */
  practices(r: RepoRef, id?: string) {
    return this.json(r, "practices", id);
  }

  /** `drift map --json`: packages with their production (`depends_on`) and test (`dependencies_test`) dependencies. Read-only. */
  map(r: RepoRef, id?: string) {
    return this.json(r, "map", id);
  }

  policy(r: RepoRef) {
    const root = this.repo(r);
    const read = (rel: string) => {
      const p = join(root, rel);
      try {
        if (statSync(p).size > MAX_POLICY) return null;
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    };
    return { conventions: read(".drift/conventions.yaml"), lock: read("drift.lock") };
  }

  // ---------- writes (explicit person actions) ----------

  async review(r: RepoRef, decision: Decision, ids: string[]): Promise<AuditEntry> {
    const root = this.repo(r);
    const clean = assertConventionIds(ids);
    const command = `drift --root ${root} review ${reviewFlags(assertDecision(decision), clean).join(" ")}`;
    let entry: AuditEntry;
    try {
      const res = await this.run(root, { op: "review", decision, ids: clean });
      entry = { at: Date.now(), user: this.d.user, decision, ids: clean, command, ok: true, output: `${res.stdout}${res.stderr}`.trim().slice(0, 4000) };
    } catch (e) {
      entry = { at: Date.now(), user: this.d.user, decision, ids: clean, command, ok: false, output: (e as Error).message.slice(0, 4000) };
    }
    const dir = this.repoDir(root);
    const h = this.d.store.history(dir);
    this.d.store.saveHistory(dir, { ...h, audit: [...h.audit, entry] });
    return entry;
  }

  /** A reviewer's "fine because…": `drift review --exempt` (or `--unexempt` with a null reason), audited like a decision. */
  async exempt(r: RepoRef, id: string, member: string, reason: string | null): Promise<AuditEntry> {
    const root = this.repo(r);
    const flags = exemptFlags(id, member, reason);
    const [cid] = assertConventionIds([id]);
    const decision = reason === null ? "unexempt" : "exempt";
    const command = `drift --root ${root} review ${flags.map((f) => (/[\s"'`$\\]/.test(f) ? JSON.stringify(f) : f)).join(" ")}`;
    let entry: AuditEntry;
    try {
      const res = await this.run(root, { op: "exempt", id: cid, member, reason });
      entry = { at: Date.now(), user: this.d.user, decision, ids: [cid], command, ok: true, output: `${res.stdout}${res.stderr}`.trim().slice(0, 4000) };
    } catch (e) {
      entry = { at: Date.now(), user: this.d.user, decision, ids: [cid], command, ok: false, output: (e as Error).message.slice(0, 4000) };
    }
    const dir = this.repoDir(root);
    const h = this.d.store.history(dir);
    this.d.store.saveHistory(dir, { ...h, audit: [...h.audit, entry] });
    return entry;
  }

  /** The opt-in review log on or off (`drift review --set-log`): Drift's output. */
  async setReviewLog(r: RepoRef, on: boolean): Promise<string> {
    const root = this.repo(r);
    const res = await this.run(root, { op: "setLog", on });
    return `${res.stdout}${res.stderr}`.trim().slice(0, 4000);
  }

  /** The review log as a study file (`drift review --export-log`), to a path the person chooses. */
  async exportReviewLog(r: RepoRef, opts: { includePaths: boolean }): Promise<{ path: string | null; output: string }> {
    const root = this.repo(r);
    const out = await this.d.dialogs.chooseSavePath("drift-review-log.json");
    if (!out) return { path: null, output: "" };
    const res = await this.run(root, { op: "exportLog", out, includePaths: opts.includePaths });
    return { path: out, output: `${res.stdout}${res.stderr}`.trim().slice(0, 4000) };
  }

  /**
   * The review log's study export, read back: `drift review --export-log` (ids and paths hashed) to a file in the app's
   * data directory, parsed and deleted. Null when the log is off or holds nothing (Drift writes no file then, or one
   * without events).
   */
  async reviewLogExport(r: RepoRef): Promise<unknown> {
    const root = this.repo(r);
    const out = join(this.repoDir(root), "review-log-export.json");
    rmSync(out, { force: true });
    try {
      try {
        await this.run(root, { op: "exportLog", out, includePaths: false });
      } catch (e) {
        // `no review log in .drift/review-log` (exit 2): never turned on, or nothing recorded yet.
        if (e instanceof DriftError && /no review log/.test(e.message)) return null;
        throw e;
      }
      if (!existsSync(out)) return null;
      const data = JSON.parse(readFileSync(out, "utf8")) as { schema?: unknown; events?: unknown };
      return data.schema === "drift-review-log" && Array.isArray(data.events) && data.events.length ? data : null;
    } finally {
      rmSync(out, { force: true });
    }
  }

  /** Cards the person opened, for the review log (`drift review --shown`; Drift records nothing while it is off). Never fails the view. */
  async reviewShown(r: RepoRef, ids: string[]): Promise<boolean> {
    const root = this.repo(r);
    try {
      await this.run(root, { op: "shown", ids: assertConventionIds(ids) });
      return true;
    } catch {
      return false;
    }
  }

  /** `drift review --json`: each block candidate's one question ("Are these the same kind of thing?"). */
  async reviewQuestions(r: RepoRef) {
    const root = this.repo(r);
    const res = await this.run(root, { op: "questions" });
    try {
      return JSON.parse(res.stdout) as unknown;
    } catch {
      throw new DriftError("drift review --json did not print JSON (is this binary older than the one-question review?)");
    }
  }

  /** A block candidate's answer: `drift review --answer`, audited like a decision. */
  async answer(r: RepoRef, id: string, answer: string, setApart: string[], confirmEntry: string[]): Promise<AuditEntry> {
    const root = this.repo(r);
    const flags = answerFlags(id, answer, setApart, confirmEntry);
    const [cid] = assertConventionIds([id]);
    const a = assertAnswer(answer);
    const command = `drift --root ${root} review ${flags.join(" ")}`;
    let entry: AuditEntry;
    try {
      const res = await this.run(root, { op: "answer", id: cid, answer: a, setApart, confirmEntry });
      entry = { at: Date.now(), user: this.d.user, decision: a, ids: [cid], command, ok: true, output: `${res.stdout}${res.stderr}`.trim().slice(0, 4000) };
    } catch (e) {
      entry = { at: Date.now(), user: this.d.user, decision: a, ids: [cid], command, ok: false, output: (e as Error).message.slice(0, 4000) };
    }
    const dir = this.repoDir(root);
    const h = this.d.store.history(dir);
    this.d.store.saveHistory(dir, { ...h, audit: [...h.audit, entry] });
    return entry;
  }

  async init(r: RepoRef) {
    const root = this.repo(r);
    const res = await this.run(root, { op: "init" });
    return res.stdout.trim().split("\n").slice(0, 3).join("\n");
  }

  // ---------- reads ----------

  async readSource(r: RepoRef, rel: string): Promise<string | null> {
    const root = this.repo(r);
    const path = assertRelPath(rel);
    if (!this.scanned.has(root)) await this.facts(r, { refresh: false });
    if (!this.scanned.get(root)?.has(path)) return null;
    let real: string;
    try {
      real = realpathSync(join(root, path));
    } catch {
      return null;
    }
    if (!isInside(root, real)) return null;
    const st = statSync(real);
    if (!st.isFile() || st.size > MAX_SOURCE) return null;
    return readFileSync(real, "utf8");
  }

  listSessions(r: RepoRef, opts: { all: boolean }) {
    const root = this.repo(r);
    const files = listSessionFiles(this.d.projectsDir, opts.all ? null : root);
    return files.map((f) => {
      this.sessionFiles.set(f.id, f.file);
      let head: string;
      try {
        head = readFileSync(f.file, { encoding: "utf8", flag: "r" }).slice(0, 64 * 1024);
      } catch {
        head = "";
      }
      return {
        id: f.id,
        project: f.project,
        title: sessionTitle(head),
        modified: f.modified,
        bytes: f.bytes,
        hasState: existsSync(join(root, ".drift", "cache", "sessions", `${f.id}.json`)),
      };
    });
  }

  readTranscript(r: RepoRef, id: string): string {
    this.repo(r);
    const sid = assertSessionId(id);
    let file = this.sessionFiles.get(sid);
    if (!file) {
      for (const f of listSessionFiles(this.d.projectsDir, null)) this.sessionFiles.set(f.id, f.file);
      file = this.sessionFiles.get(sid);
    }
    if (!file) throw new InvalidArgument("unknown session");
    const real = realpathSync(file);
    if (!isInside(realpathSync(this.d.projectsDir), real)) throw new InvalidArgument("session file is outside Claude Code's projects directory");
    if (statSync(real).size > MAX_TRANSCRIPT) throw new InvalidArgument("transcript is larger than 200 MB");
    return readFileSync(real, "utf8");
  }

  readSessionState(r: RepoRef, id: string) {
    const root = this.repo(r);
    const sid = assertSessionId(id);
    const p = join(root, ".drift", "cache", "sessions", `${sid}.json`);
    try {
      if (statSync(p).size > MAX_POLICY) return null;
      return JSON.parse(readFileSync(p, "utf8")) as unknown;
    } catch {
      return null;
    }
  }

  async loadStudies(opts: { choose: boolean }) {
    let dir = this.d.store.settings().studiesDir;
    if (opts.choose || !dir) {
      dir = await this.d.dialogs.chooseDirectory("Choose a Drift checkout (or its eval directory)");
      if (!dir) return null;
      this.d.store.update({ studiesDir: dir });
    }
    const evalDir = [join(dir, "eval"), dir].find((d) => existsSync(join(d, "study", "labels.jsonl")));
    if (!evalDir) return null;
    const study = join(evalDir, "study");
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
    const census: Record<string, unknown> = {};
    for (const d of [study, join(study, "census")]) {
      if (!existsSync(d)) continue;
      for (const f of (await import("node:fs")).readdirSync(d).filter((x) => /^census-.+\.json$/.test(x))) {
        try {
          census[f.slice(7, -5)] = JSON.parse(readFileSync(join(d, f), "utf8"));
        } catch {
          // skip unreadable
        }
      }
    }
    const abDir = join(evalDir, "agent-ab");
    const ab = existsSync(abDir)
      ? (await import("node:fs"))
          .readdirSync(abDir)
          .filter((f) => /^results-.+\.json$/.test(f))
          .map((f) => ({ name: f.slice(8, -5), rows: JSON.parse(readFileSync(join(abDir, f), "utf8")) as unknown[] }))
      : [];
    // Runs: metrics.mjs --json output wherever a run keeps it (small JSON files, capped): the run itself,
    // `views/<view>`, a part (`calib-…/ts`, `dev-v3-…/py`) and a part's views (`dev-v3-…/py/views/d5`), found by
    // a bounded walk rather than a fixed layout. `metrics-<variant>.json` beside a metrics.json is the same
    // scoring with a different option (`metrics-without-CTFd.json`: `--exclude-repos CTFd`).
    const fs = await import("node:fs");
    const runs: { path: string; metrics?: unknown; error?: string; calibration?: boolean; variant?: string }[] = [];
    const calibrations: { path: string; shift?: unknown; agreements: { path: string; agreement: unknown }[] }[] = [];
    const agreements: { path: string; agreement: unknown }[] = [];
    const exclusions: { path: string; excluded: unknown }[] = [];
    const runsDir = join(study, "runs");
    const readJson = (p: string): unknown => (existsSync(p) && fs.statSync(p).size <= MAX_POLICY ? JSON.parse(fs.readFileSync(p, "utf8")) : undefined);
    const tryJson = (p: string): unknown => {
      try {
        return readJson(p);
      } catch {
        return undefined; // unreadable: not shown
      }
    };
    const readMetrics = (dir: string, rel: string, calibration: boolean, variant?: string) => {
      const p = join(dir, variant ? `metrics-${variant}.json` : "metrics.json");
      if (!existsSync(p)) return; // not a scored run
      const v = variant ? { variant } : {};
      try {
        if (fs.statSync(p).size > MAX_POLICY) runs.push({ path: rel, ...v, error: `${basename(p)} is larger than 16 MB` });
        else runs.push({ path: rel, metrics: JSON.parse(fs.readFileSync(p, "utf8")), ...(calibration ? { calibration } : {}), ...v });
      } catch (e) {
        runs.push({ path: rel, ...v, error: `${basename(p)} could not be read: ${(e as Error).message.slice(0, 200)}` });
      }
    };
    const dirs = (d: string) =>
      existsSync(d)
        ? fs
            .readdirSync(d, { withFileTypes: true })
            .filter((x) => x.isDirectory() && !x.isSymbolicLink())
            .sort((a, b) => a.name.localeCompare(b.name))
        : [];
    const MAX_DEPTH = 4;
    const MAX_DIRS = 400;
    for (const r of dirs(runsDir)) {
      const dir = join(runsDir, r.name);
      const rel = `eval/study/runs/${r.name}`;
      // A calibration run carries the label shift between rubrics (shift.json) beside its parts.
      const calibration = existsSync(join(dir, "shift.json"));
      let seen = 0;
      const walk = (d: string, relD: string, depth: number) => {
        if (++seen > MAX_DIRS) return;
        readMetrics(d, relD, calibration);
        for (const f of fs.readdirSync(d).filter((x) => /^metrics-[\w.-]+\.json$/.test(x)).sort()) readMetrics(d, relD, calibration, f.slice("metrics-".length, -".json".length));
        // Labeller agreement (A/B before adjudication) and the repos an adjudication excluded, as data.
        const a = tryJson(join(d, "agreement.json"));
        if (a !== undefined) agreements.push({ path: relD, agreement: a });
        if (basename(d) === "adjudication") {
          const q = tryJson(join(d, "queue.json"));
          const ex = q && typeof q === "object" ? (q as { excluded?: unknown }).excluded : undefined;
          if (ex) exclusions.push({ path: relD, excluded: ex });
        }
        if (depth < MAX_DEPTH) for (const v of dirs(d)) walk(join(d, v.name), `${relD}/${v.name}`, depth + 1);
      };
      walk(dir, rel, 0);
      if (calibration) {
        const c: (typeof calibrations)[number] = { path: rel, agreements: [] };
        try {
          c.shift = readJson(join(dir, "shift.json"));
          for (const v of dirs(dir)) {
            const a = readJson(join(dir, v.name, "agreement.json"));
            if (a !== undefined) c.agreements.push({ path: `${rel}/${v.name}`, agreement: a });
          }
        } catch {
          // shown without what failed to parse
        }
        calibrations.push(c);
      }
    }
    // Dev manifests only: eval/repos*.json. Held-out manifests (eval/holdout*.json) are never read.
    const manifests: { path: string; note: string; repos: number; language: string | null }[] = [];
    for (const f of fs.readdirSync(evalDir).filter((x) => /^repos[\w-]*\.json$/.test(x)).sort()) {
      try {
        const m = readJson(join(evalDir, f)) as { "//"?: unknown; repos?: { language?: unknown }[] } | undefined;
        if (!m || !Array.isArray(m.repos)) continue;
        const lang = m.repos.find((x) => typeof x.language === "string")?.language;
        manifests.push({ path: `eval/${f}`, note: typeof m["//"] === "string" ? m["//"].slice(0, 400) : "", repos: m.repos.length, language: typeof lang === "string" ? lang : null });
      } catch {
        // unreadable manifest: not listed
      }
    }
    return { source: evalDir, labels: read(join(study, "labels.jsonl")) ?? "", secondOpinion: read(join(study, "second-opinion.jsonl")), census, ab, runs, calibrations, agreements, exclusions, manifests };
  }

  // ---------- history, logs, export ----------

  history(r: RepoRef) {
    return this.d.store.history(this.repoDir(this.repo(r)));
  }
  recordSnapshot(r: RepoRef, s: Snapshot) {
    const dir = this.repoDir(this.repo(r));
    const h = this.d.store.history(dir);
    return this.d.store.saveHistory(dir, { ...h, snapshots: [...h.snapshots, s] });
  }
  clearHistory(r: RepoRef) {
    return this.d.store.clearHistory(this.repoDir(this.repo(r)));
  }
  logs() {
    return this.logBuf.slice();
  }
  addLog(e: LogEntry) {
    this.logBuf.push({ ...e, source: "renderer" });
    if (this.logBuf.length > 2000) this.logBuf.shift();
    return null;
  }
  async saveText(name: string, text: string) {
    const p = await this.d.dialogs.chooseSavePath(name.replace(/[^\w.-]+/g, "-"));
    if (!p) return false;
    writeFileSync(p, text);
    return true;
  }
}
