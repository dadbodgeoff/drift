// Fixture data adapter: the renderer in a plain browser, against data that
// scripts/make-fixtures.mjs produced by running the real drift binary on the
// synthetic "acme" repository (and, locally, scripts/make-local-fixtures.mjs
// on large public repos for performance work). Writes (review, init, a practice
// made a convention) change only this tab's memory; history lives in localStorage.
import { parseDocument } from "yaml";
import type { AbRow, Census, CheckReport, Convention, Inventory, MapPackage, PracticesReport, PromoteOutcome, RepoFacts, ReviewQuestion, ReviewQuestions, SecurityDiff, SessionState } from "@/shared/contract/drift";
import type { History, LogEntry, PromoteRequest, RepoRef, SessionSummary, Snapshot } from "@/shared/ipc/contract";
import { fixtureConvention, fixturePromote, isRefused, promoteCommand } from "@/shared/lib/promote";
import { answerCommand, exemptCommand, reviewCommand } from "@/shared/lib/review";
import { answerPlan } from "@/shared/lib/questions";
import type { Answer } from "@/shared/ipc/contract";
import { type Decision, type Loaded, type StudiesData, type StudioApi, retain } from "./types";

interface Index {
  /**
   * `errors`: the repository has errors.json, what drift printed when it refused to run there (make-round11-fixtures.mjs).
   * `practices`: the repository has practices.json (`drift practices --json`); `map`: map.json (`drift map --json`).
   */
  repos: { id: string; path: string; name: string; local?: boolean; errors?: boolean; practices?: boolean; map?: boolean }[];
  sessions: { id: string; project: string; title: string; bytes: number; modified: number; hasState: boolean }[];
  studies: { census: string[]; ab: string[]; runs?: string[]; variants?: { path: string; variant: string }[] };
}

const PROVENANCE = { commit: "4f2a91c", branch: "main", driftVersion: "drift 0.1.0-dev" };

export class FixtureApi implements StudioApi {
  readonly mode = "fixture" as const;
  private overrides = new Map<string, Map<string, Decision>>();
  /** This tab's exceptions per repo: convention id -> member -> reason (null: removed). */
  private exceptions = new Map<string, Map<string, Map<string, string | null>>>();
  /** This tab's review-log setting per repository (`drift review --set-log`), and the events it would have recorded. */
  private reviewLog = new Map<string, boolean>();
  private logged = new Map<string, number>();
  /** This tab's files set apart per repo: convention id -> paths (`drift review --answer ID=different`). */
  private setApart = new Map<string, Map<string, Map<string, string[]>>>();
  /** This tab's practices made conventions per repo: convention id -> the convention (`drift practices promote`). */
  private promoted = new Map<string, Map<string, Convention>>();
  private idx: Promise<Index> | null = null;
  private logBuf: LogEntry[] = [];

  constructor(
    private readonly base = "./",
    private readonly delay = 150,
    /** Also list the git-ignored large fixtures (fixtures/local), which only exist where they were generated. */
    private readonly local = false,
  ) {}

  private wait<T>(v: T, ms = this.delay): Promise<T> {
    return new Promise((r) => setTimeout(() => r(v), ms));
  }

  private async get(path: string): Promise<Response> {
    const r = await fetch(this.base + path);
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || type.includes("text/html")) throw new Error(`fixture ${path} is not available`);
    return r;
  }
  private async json<T>(path: string): Promise<T> {
    return (await this.get(path)).json() as Promise<T>;
  }
  private async text(path: string): Promise<string> {
    return (await this.get(path)).text();
  }

  private index(): Promise<Index> {
    this.idx ??= (async () => {
      const ix = await this.json<Index>("index.json");
      // Large local fixtures (git-ignored) only when asked for, so a clean
      // checkout never requests a file it does not have.
      if (this.local) {
        try {
          const local = await this.json<{ repos: Index["repos"] }>("local/index.json");
          ix.repos.push(...local.repos.map((r) => ({ ...r, local: true })));
        } catch {
          // not generated here
        }
      }
      return ix;
    })();
    return this.idx;
  }

  private async dir(repo: RepoRef): Promise<string> {
    const r = (await this.index()).repos.find((x) => x.path === repo.path);
    if (!r) throw new Error(`no fixture for ${repo.name}`);
    return r.local ? `local/${r.id}` : r.id;
  }

  private loaded<T>(data: T, cached: boolean, ms = 0, provenance: Loaded<T>["provenance"] = PROVENANCE): Loaded<T> {
    return { data, at: Date.now() - (cached ? 3_600_000 : 0), cached, ms, provenance };
  }

  /**
   * What a drift run printed when it refused this fixture's repository (`errors.json`, written by
   * scripts/make-round11-fixtures.mjs from Drift's stderr): thrown as the desktop app throws it (electron/drift.ts).
   */
  private async refused(repo: RepoRef, op: "check" | "questions" | "security"): Promise<void> {
    if (!(await this.index()).repos.find((x) => x.path === repo.path)?.errors) return;
    const errors = await this.json<Partial<Record<string, { message: string }>>>(`${await this.dir(repo)}/errors.json`);
    const e = errors[op];
    if (e) throw new Error(`drift ${op} failed: ${e.message}`);
  }

  /** How DRIFT_NEIGHBOUR_GATE was set for this fixture's check (`version.json` `neighbourGate`; off, the default, when absent). */
  private async gate(d: string): Promise<"on" | "off"> {
    try {
      return (await this.json<{ neighbourGate?: string }>(`${d}/version.json`)).neighbourGate === "on" ? "on" : "off";
    } catch {
      return "off";
    }
  }

  async handshake() {
    return { ipc: 1, platform: navigator.platform || "web", appVersion: "0.1.0" };
  }
  async recentRepos(): Promise<RepoRef[]> {
    return (await this.index()).repos.map((r) => ({ path: r.path, name: r.name }));
  }
  async openRepo(): Promise<RepoRef | null> {
    return (await this.recentRepos())[0] ?? null;
  }
  async forgetRepo(): Promise<RepoRef[]> {
    return this.recentRepos();
  }
  async driftInfo() {
    let version = PROVENANCE.driftVersion;
    try {
      version = (await this.json<{ version: string }>("acme/version.json")).version;
    } catch {
      // keep the default
    }
    return { path: "fixtures (no binary)", version, censusJson: true, source: "fixture" as const };
  }
  async chooseDrift() {
    return this.driftInfo();
  }

  async facts(repo: RepoRef, opts: { refresh: boolean; signal?: AbortSignal }): Promise<Loaded<RepoFacts>> {
    const t0 = performance.now();
    const r = await this.get(`${await this.dir(repo)}/facts.json.gz`);
    const body = r.body!.pipeThrough(new DecompressionStream("gzip"));
    const facts = (await new Response(body).json()) as RepoFacts;
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return this.wait(this.loaded(facts, !opts.refresh, Math.round(performance.now() - t0)), opts.refresh ? this.delay * 4 : 0);
  }
  async census(repo: RepoRef): Promise<Loaded<Census>> {
    return this.wait(this.loaded(await this.json<Census>(`${await this.dir(repo)}/census.json`), false));
  }
  async check(repo: RepoRef, opts?: { base?: string | null }): Promise<Loaded<CheckReport>> {
    const d = await this.dir(repo);
    await this.refused(repo, "check");
    const provenance = { ...PROVENANCE, neighbourGate: await this.gate(d) };
    if (opts?.base) {
      // The fixture repository has one recorded base: the commit before the sessions (branch `main`).
      if (opts.base !== "main") throw new Error(`drift check failed: --diff-base: base ref \`${opts.base}\` not found. Fetch it first (\`git fetch origin ${opts.base}\`). (Fixture mode has only \`main\`.)`);
      return this.wait(this.loaded(await this.json<CheckReport>(`${d}/check-diff.json`), false, 0, provenance), this.delay * 2);
    }
    return this.wait(this.loaded(await this.json<CheckReport>(`${d}/check.json`), false, 0, provenance), this.delay * 2);
  }
  async security(repo: RepoRef): Promise<Loaded<Inventory>> {
    await this.refused(repo, "security");
    return this.wait(this.loaded(await this.json<Inventory>(`${await this.dir(repo)}/security.json`), false), this.delay * 3);
  }
  async securityDiff(repo: RepoRef, opts: { base: string }): Promise<Loaded<SecurityDiff>> {
    await this.refused(repo, "security");
    // As for check: the fixture repository has one recorded base, branch `main`.
    if (opts.base !== "main") throw new Error(`drift security failed: --diff-base: base ref \`${opts.base}\` not found. Fetch it first (\`git fetch origin ${opts.base}\`). (Fixture mode has only \`main\`.)`);
    return this.wait(this.loaded(await this.json<SecurityDiff>(`${await this.dir(repo)}/security-diff.json`), false), this.delay * 3);
  }

  /** `drift practices --json` for this fixture (practices.json); a repository without one fails as a run would. */
  async practices(repo: RepoRef): Promise<Loaded<PracticesReport>> {
    const r = (await this.index()).repos.find((x) => x.path === repo.path);
    if (!r?.practices) throw new Error(`drift practices failed: fixture mode has no practices.json for ${repo.name}`);
    return this.wait(this.loaded(await this.json<PracticesReport>(`${await this.dir(repo)}/practices.json`), false), this.delay * 2);
  }

  /** `drift map --json` for this fixture (map.json); a repository without one fails as a run would. */
  async map(repo: RepoRef): Promise<Loaded<{ schema: number; packages: MapPackage[] }>> {
    const r = (await this.index()).repos.find((x) => x.path === repo.path);
    if (!r?.map) throw new Error(`drift map failed: fixture mode has no map.json for ${repo.name}`);
    return this.wait(this.loaded(await this.json<{ schema: number; packages: MapPackage[] }>(`${await this.dir(repo)}/map.json`), false));
  }

  async policy(repo: RepoRef) {
    const d = await this.dir(repo);
    let yaml: string;
    let lock: string | null;
    try {
      yaml = await this.text(`${d}/conventions.yaml`);
      lock = await this.text(`${d}/drift.lock`);
    } catch {
      return { conventions: null, lock: null };
    }
    const over = this.overrides.get(repo.path);
    const fine = this.exceptions.get(repo.path);
    const logSetting = this.reviewLog.get(repo.path);
    const apart = this.setApart.get(repo.path);
    const promoted = this.promoted.get(repo.path);
    if (!over?.size && !fine?.size && !apart?.size && !promoted?.size && logSetting === undefined) return { conventions: yaml, lock };
    // Apply this tab's decisions the way `drift review` records them.
    const doc = parseDocument(yaml);
    // `review_log: on`, absent when off (as Drift writes it).
    if (logSetting) doc.set("review_log", "on");
    else if (logSetting === false) doc.delete("review_log");
    const list = doc.get("conventions") as { items: { get(k: string): unknown; set(k: string, v: unknown): void }[] };
    // A practice made a convention in this tab: added as `drift practices promote` writes it (promoting again replaces it).
    if (promoted?.size) {
      list.items = list.items.filter((item) => !promoted.has(String(item.get("id"))));
      for (const c of promoted.values()) (list as unknown as { add(v: unknown): void }).add(doc.createNode(c));
    }
    for (const item of list.items) {
      const marks = fine?.get(String(item.get("id")));
      if (marks?.size) {
        // As `drift review --exempt` writes them: sorted by member, one per member, absent when none.
        const current = new Map<string, string>();
        const raw = (item.get("exceptions") as { toJSON?(): unknown } | undefined)?.toJSON?.();
        for (const e of Array.isArray(raw) ? (raw as { member?: unknown; reason?: unknown }[]) : []) if (typeof e.member === "string" && typeof e.reason === "string") current.set(e.member, e.reason);
        for (const [m, r] of marks) {
          if (r === null) current.delete(m);
          else current.set(m, r);
        }
        const sorted = [...current].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([member, reason]) => ({ member, reason }));
        if (sorted.length) item.set("exceptions", doc.createNode(sorted));
        else (item as unknown as { delete(k: string): void }).delete("exceptions");
      }
      // As `drift review --answer ID=different` writes them: sorted by path, one per path.
      const files = apart?.get(String(item.get("id")));
      if (files?.size) item.set("different_kind", doc.createNode([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, entry_points]) => (entry_points.length ? { path, entry_points: [...entry_points].sort() } : { path }))));
      const dec = over?.get(String(item.get("id")));
      if (!dec) continue;
      item.set("status", dec === "reject" ? "rejected" : "accepted");
      if (dec === "block" || dec === "force_block") {
        const ev = item.get("evidence") as { get(k: string): unknown };
        item.set("mode", Number(ev.get("total")) >= 15 ? "block" : "advise");
      } else if (dec === "advise") item.set("mode", "advise");
    }
    return { conventions: doc.toString(), lock };
  }

  async review(repo: RepoRef, decision: Decision, ids: string[]) {
    const over = this.overrides.get(repo.path) ?? new Map<string, Decision>();
    for (const id of ids) over.set(id, decision);
    this.overrides.set(repo.path, over);
    this.count(repo, ids.length);
    const entry = {
      at: Date.now(),
      user: "you (fixture)",
      decision,
      ids,
      command: reviewCommand(repo.path, decision, ids),
      ok: true,
      output: "fixture mode: recorded in this tab only; no file was written",
    };
    const h = await this.history(repo);
    this.saveHistory(repo, retain({ ...h, audit: [...h.audit, entry] }));
    return this.wait(entry);
  }
  async exempt(repo: RepoRef, id: string, member: string, reason: string | null) {
    const byId = this.exceptions.get(repo.path) ?? new Map<string, Map<string, string | null>>();
    const marks = byId.get(id) ?? new Map<string, string | null>();
    const clean = reason === null ? null : reason.trim().split(/\s+/).join(" ");
    marks.set(member, clean);
    byId.set(id, marks);
    this.exceptions.set(repo.path, byId);
    this.count(repo, 1);
    const entry = {
      at: Date.now(),
      user: "you (fixture)",
      decision: clean === null ? ("unexempt" as const) : ("exempt" as const),
      ids: [id],
      command: exemptCommand(repo.path, id, member, clean),
      ok: true,
      output: "fixture mode: recorded in this tab only; no file was written",
    };
    const h = await this.history(repo);
    this.saveHistory(repo, retain({ ...h, audit: [...h.audit, entry] }));
    return this.wait(entry);
  }
  private count(repo: RepoRef, n: number) {
    if (this.reviewLog.get(repo.path)) this.logged.set(repo.path, (this.logged.get(repo.path) ?? 0) + n);
  }
  async setReviewLog(repo: RepoRef, on: boolean) {
    this.reviewLog.set(repo.path, on);
    return this.wait(on ? "review log on (fixture mode: kept in this tab only; no file was written)" : "review log off (fixture mode)");
  }
  async exportReviewLog(repo: RepoRef) {
    const n = this.logged.get(repo.path) ?? 0;
    return this.wait({ path: null, output: `fixture mode: ${n} review event(s) recorded in this tab; no file was written` });
  }
  async reviewShown(repo: RepoRef, ids: string[]) {
    this.count(repo, ids.length);
    return this.wait(true, 0);
  }
  /** `drift review --json` as Drift printed it for this fixture (`review-questions.json`), less the cards decided in this tab. */
  async reviewQuestions(repo: RepoRef): Promise<ReviewQuestions> {
    const d = await this.dir(repo);
    await this.refused(repo, "questions");
    const asked = await this.json<ReviewQuestions>(`${d}/review-questions.json`);
    const decided = this.overrides.get(repo.path);
    return this.wait({ ...asked, candidates: asked.candidates.filter((q) => !decided?.has(q.id)) });
  }
  /** The review log's export as Drift wrote it for this fixture (`review-log.json`), or null (the log was never on). */
  async reviewLogExport(repo: RepoRef): Promise<unknown> {
    const d = await this.dir(repo);
    // Only where the fixture's own policy has the log on (Drift wrote an export then); turned on in this tab, it holds nothing yet.
    let on = false;
    try {
      on = /^review_log: "?on"?$/m.test(await this.text(`${d}/conventions.yaml`));
    } catch {
      // no policy
    }
    return this.wait(on ? await this.json<unknown>(`${d}/review-log.json`) : null);
  }
  async answer(repo: RepoRef, id: string, answer: Answer, setApart: string[], confirmEntry: string[]) {
    let question: ReviewQuestion | undefined;
    if (answer === "different") {
      question = (await this.reviewQuestions(repo)).candidates.find((q) => q.id === id);
      if (!question) throw new Error(`drift answer failed: ${id} is not a block candidate (a proposed default-tier convention): the question is asked of those only; use --accept or --reject; nothing was changed`);
    }
    const over = this.overrides.get(repo.path) ?? new Map<string, Decision>();
    over.set(id, answer === "not-a-convention" ? "reject" : "accept");
    this.overrides.set(repo.path, over);
    if (question) {
      // As `drift review --answer ID=different` writes them (calibrate.rs `different`): only the picked files that
      // cover a flagged member, each with the entry points confirmed in it [STRICT].
      const plan = answerPlan(question, new Set(setApart), new Set(confirmEntry));
      const byId = this.setApart.get(repo.path) ?? new Map<string, Map<string, string[]>>();
      const files = byId.get(id) ?? new Map<string, string[]>();
      for (const p of plan.setApart) files.set(p, [...new Set([...(files.get(p) ?? []), ...plan.confirmEntry.filter((m) => m.startsWith(`${p}#`)).map((m) => m.slice(p.length + 1))])]);
      byId.set(id, files);
      this.setApart.set(repo.path, byId);
    }
    this.count(repo, 1);
    const entry = {
      at: Date.now(),
      user: "you (fixture)",
      decision: answer,
      ids: [id],
      command: answerCommand(repo.path, id, answer, setApart, confirmEntry),
      ok: true,
      output: "fixture mode: recorded in this tab only; no file was written",
    };
    const h = await this.history(repo);
    this.saveHistory(repo, retain({ ...h, audit: [...h.audit, entry] }));
    return this.wait(entry);
  }
  async init() {
    return this.wait("fixture mode: the fixture repository is already initialised");
  }

  /** What promoting would record, worked out from this fixture's practice map (`practices.json`): nothing is written. */
  async promotePreview(repo: RepoRef, req: PromoteRequest): Promise<PromoteOutcome> {
    const report = (await this.practices(repo)).data;
    return this.wait(fixturePromote(report, req, false));
  }

  /** The same, recorded in this tab only (the Conventions view shows the convention); no file is written. */
  async promote(repo: RepoRef, req: PromoteRequest): Promise<PromoteOutcome> {
    const report = (await this.practices(repo)).data;
    const out = fixturePromote(report, req, true);
    if (isRefused(out)) return this.wait(out);
    const byId = this.promoted.get(repo.path) ?? new Map<string, Convention>();
    byId.set(out.convention.id, fixtureConvention(out));
    this.promoted.set(repo.path, byId);
    this.count(repo, 1);
    const entry = {
      at: Date.now(),
      user: "you (fixture)",
      decision: "promote" as const,
      ids: [out.convention.id],
      command: promoteCommand(repo.path, req, false),
      ok: true,
      output: "fixture mode: recorded in this tab only; no file was written",
    };
    const h = await this.history(repo);
    this.saveHistory(repo, retain({ ...h, audit: [...h.audit, entry] }));
    return this.wait({ ...out, preview: `${out.preview}\nfixture mode: recorded in this tab only; no file was written` });
  }

  async readSource(repo: RepoRef, path: string): Promise<string | null> {
    if (path.split("/").includes("..") || path.startsWith("/")) return null;
    try {
      return await this.text(`${await this.dir(repo)}/sources/${path.split("/").map(encodeURIComponent).join("/")}`);
    } catch {
      return null;
    }
  }

  async listSessions(repo: RepoRef, opts: { all: boolean }): Promise<SessionSummary[]> {
    const ix = await this.index();
    return ix.sessions
      .filter((s) => opts.all || s.project === repo.path)
      .map((s) => ({ id: s.id, project: s.project, title: s.title, modified: s.modified, bytes: s.bytes, hasState: s.hasState }))
      .sort((a, b) => b.modified - a.modified);
  }
  async readTranscript(_repo: RepoRef, id: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("invalid session id");
    return this.text(`acme/transcripts/${id}.jsonl`);
  }
  async readSessionState(_repo: RepoRef, id: string): Promise<SessionState | null> {
    const s = (await this.index()).sessions.find((x) => x.id === id);
    return s?.hasState ? this.json<SessionState>(`acme/sessions/${id}.json`) : null;
  }

  async loadStudies(): Promise<StudiesData | null> {
    const ix = await this.index();
    const census: Record<string, Census> = {};
    await Promise.all(
      ix.studies.census.map(async (name) => {
        census[name] = await this.json<Census>(`studies/census-${name}.json`);
      }),
    );
    const ab = await Promise.all(ix.studies.ab.map(async (name) => ({ name, rows: await this.json<AbRow[]>(`studies/results-${name}.json`) })));
    let secondOpinion: string | null;
    try {
      secondOpinion = await this.text("studies/second-opinion.jsonl");
    } catch {
      secondOpinion = null;
    }
    // Run paths are `eval/study/runs/<run>[/<part>…][/views/<view>]`; the fixture keeps them under studies/runs/.
    const at = (path: string, variant?: string) => `studies/runs/${path.replace(/^eval\/study\/runs\//, "")}/${variant ? `metrics-${variant}` : "metrics"}.json`;
    const runs: StudiesData["runs"] = await Promise.all([
      ...(ix.studies.runs ?? []).map(async (path) => ({ path, metrics: await this.json<unknown>(at(path)) })),
      ...(ix.studies.variants ?? []).map(async ({ path, variant }) => ({ path, variant, metrics: await this.json<unknown>(at(path, variant)) })),
    ]);
    // Calibrations, agreements, exclusions and dev manifests, as the main process reads them (written by make-study-fixtures.mjs).
    let extra: Pick<StudiesData, "calibrations" | "manifests" | "agreements" | "exclusions"> = { calibrations: [], manifests: [], agreements: [], exclusions: [] };
    try {
      extra = { ...extra, ...(await this.json<Partial<StudiesData>>("studies/extra.json")) };
    } catch {
      // older fixtures
    }
    const calib = extra.calibrations.map((c) => c.path);
    const flagged = runs.map((r) => (calib.some((c) => r.path === c || r.path.startsWith(`${c}/`)) ? { ...r, calibration: true } : r));
    return this.wait({ source: "fixtures/studies (eval/study, eval/agent-ab)", labels: await this.text("studies/labels.jsonl"), secondOpinion, census, ab, runs: flagged, ...extra });
  }

  private key(repo: RepoRef) {
    return `drift-studio:history:${repo.path}`;
  }
  async history(repo: RepoRef): Promise<History> {
    try {
      const raw = localStorage.getItem(this.key(repo));
      if (raw) return JSON.parse(raw) as History;
    } catch {
      // fall through
    }
    // The fixture's previous scan, so "since the last scan" has something to compare with.
    try {
      return await this.json<History>(`${await this.dir(repo)}/history.json`);
    } catch {
      return { snapshots: [], audit: [] };
    }
  }
  private saveHistory(repo: RepoRef, h: History) {
    try {
      localStorage.setItem(this.key(repo), JSON.stringify(h));
    } catch {
      // memory only
    }
  }
  async recordSnapshot(repo: RepoRef, s: Snapshot) {
    const h = await this.history(repo);
    const next = retain({ ...h, snapshots: [...h.snapshots, s] });
    this.saveHistory(repo, next);
    return next;
  }
  async clearHistory(repo: RepoRef) {
    const empty: History = { snapshots: [], audit: [] };
    this.saveHistory(repo, empty);
    return empty;
  }
  async logs() {
    return this.logBuf.slice();
  }
  async log(e: LogEntry) {
    this.logBuf.push(e);
    if (this.logBuf.length > 2000) this.logBuf.shift();
  }
  async saveText(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  onRepoChanged() {
    return () => undefined;
  }
}
