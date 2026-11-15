// Study runs (every metrics.json under eval/study/runs/<run>: the run, its views/<view>,
// its parts such as dev-v3's ts/py/py2, and the parts' views), as eval/study/metrics.mjs
// --json writes them. Read defensively: runs written by older metrics.mjs lack the
// per-language tables (#24), and the first Python run predates the tier block.

export interface Rate {
  k: number;
  n: number;
  p: number | null;
  lo: number | null;
  hi: number | null;
  /** Repo-cluster intervals (bootstrap and cluster-t), with the number of clusters. */
  boot?: { lo: number | null; hi: number | null; clusters: number };
  t?: { lo: number | null; hi: number | null; clusters: number };
}

export interface TierStats {
  shown: number;
  labelled: number;
  accept: number;
  trivial: number;
  wrong: number;
  unlabelled: number;
  /** ACCEPT over all shown, unlabelled counted as WRONG: the target definition. */
  acceptShown: Rate | null;
  /** (ACCEPT + TRIVIAL) over all shown, unlabelled counted as WRONG. */
  notWrongShown: Rate | null;
}

export interface LanguageRow {
  language: string;
  repos: string[];
  overall: TierStats;
  defaultTier: TierStats;
  suggestionTier: TierStats;
  /** D1: default-tier accept target, judged per language on the point estimate. `met` is null when no verdict is printed (not a primary held-out run). */
  target: { criterion: string; threshold: number; value: number | null; met: boolean | null } | null;
  /** D4: the not-wrong target, judged the same way. */
  notWrongTarget: { criterion: string; threshold: number; value: number | null; met: boolean | null } | null;
  /**
   * Per rule family within the language (metrics.json `by_language[].families[]`, since #68), each tier in the
   * pooled shape of `overall`; most shown first. Empty for runs scored before #68.
   */
  families: FamilyRow[];
}

/** One rule family within a language: all shown, the default tier and the suggestion tier, each over all shown. */
export interface FamilyRow {
  family: string;
  name: string;
  overall: TierStats;
  defaultTier: TierStats;
  suggestionTier: TierStats;
}

/** `by_language[].families[]`: a family without a name is dropped; older runs (no array) give none. Most shown first, then by name. */
export function parseFamilyRows(v: unknown): FamilyRow[] {
  return arr(v)
    .map((f) => {
      const o = obj(f);
      const family = strOr(o.family);
      return { family, name: strOr(o.name, family), overall: tierStats(o.overall), defaultTier: tierStats(o.default_tier), suggestionTier: tierStats(o.suggestion_tier) };
    })
    .filter((f) => f.family || f.name)
    .sort((a, b) => b.overall.shown - a.overall.shown || a.name.localeCompare(b.name, "en"));
}

/** Whether a run's tier gives this language no default tier (D7: Python advises only). */
export function languageAdvisesOnly(r: Pick<StudyRun, "tier">, language: string): boolean {
  return !!r.tier?.languages && language === "python" && !r.tier.languages.includes("py");
}

export interface StudyRun {
  /** `eval/study/runs/dev-ts-r2-2026-11-05`, `.../views/rule5` or `.../dev-v3-2026-11-06/py/views/d5`. */
  path: string;
  name: string;
  /** Everything below the run, `views` left out (`rule5`, `ts` for a calibration part, `py/d5`). */
  view: string | null;
  /** The part of the run the scoring is in (`py`, `py2`, `ts`), for runs scored per part; null when the run is scored as one. */
  part: string | null;
  /** The view's own name (`d5`, `rule5`), null for the run or part itself. */
  viewName: string | null;
  /** `metrics-<variant>.json`: the same scoring with another option (`without-CTFd`); folded into `variants` of the run it varies. */
  variant: string | null;
  /**
   * The run `metrics.mjs` scored (metrics.json `run`). Usually `path`, but a part's own metrics.json can hold
   * the scoring of one of its views (relabel3: `ts/metrics.json` is `metrics.mjs` on `ts/views/d7`, beside
   * `ts/views/d7/metrics-carried-only.json`), and a variant of that scoring belongs to it.
   */
  scoredAs: string;
  /** The labels file `metrics.mjs` read (metrics.json `labels`, e.g. `<part>/final.jsonl`), when it says. */
  labels: string | null;
  variants: StudyRun[];
  /** The exposure check (`--exclude-repos`): the exposed repos and the rates without them; from the run or one of its variants. */
  exposure: Exposure | null;
  /** Labeller agreement for this run or part (its `agreement.json`, A/B before adjudication). */
  agreement: LabelShift | null;
  /** What adjudication excluded in this run or part (`adjudication/queue.json` `excluded`). */
  exclusions: Exclusion[];
  role: string;
  secondary: boolean;
  headlineEligible: boolean;
  language: string;
  driftCommit: string | null;
  driftVersion: string | null;
  manifest: string | null;
  /**
   * `target: "in_repo"`: D5, the default tier admits only rules whose targets are the repository's own.
   * `languages`: D7, the languages that may be in the default tier (`["ts"]`; Python advises only), null before D7.
   * `decision`: the decision that defines the tier, from the tier block (`D7`) or read off it (`D5`: in-repo targets).
   */
  tier: { kind: string; minMembers: number | null; ruleKinds: string[]; preRegistered: boolean; target: string | null; languages: string[] | null; decision: string | null } | null;
  overall: TierStats;
  defaultTier: TierStats;
  suggestionTier: TierStats | null;
  byLanguage: LanguageRow[] | null;
  /** D2: per-language rates without the set's course-material repos. */
  sensitivity: { without: string[]; byLanguage: { language: string; removed: string[]; with: { defaultTier: TierStats; overall: TierStats }; without: { defaultTier: TierStats; overall: TierStats } }[] } | null;
  /** D3: repos whose census or init failed, reported as failures and not swapped. */
  failedRepos: { name: string; status: string }[];
  families: { family: string; name: string; shown: number; accept: number; trivial: number; wrong: number; acceptRate: Rate | null }[];
  repos: { name: string; shown: number; accept: number; trivial: number; wrong: number }[];
  wrongBecause: Record<string, number>;
  /** The labelling rubric (metrics.json `rubric`, `rubric_sha256(s)`, `label_rubrics`); `mixed` when labels span rubrics. */
  rubric: RubricInfo;
  /** Decisions recorded with the run (metrics.json `decisions`). */
  decisions: StudyDecision[];
  /** A calibration measures how a rubric moves labels; its rates are not a precision result. */
  calibration: boolean;
  /** For a calibration: its shift and agreement files, repo-relative, as metrics.json `calibration` names them. */
  calibrationFiles: { shift: string | null; agreement: string | null } | null;
}

export interface Exposure {
  exposed: string[];
  /** Without the exposed repos: all shown, and the default tier. */
  clean: TierStats & { repos: number };
  cleanTier: TierStats;
}

/** Repos or proposals an adjudication excluded, with its reason, as `adjudication/queue.json` records it. */
export interface Exclusion {
  path: string;
  repos: string[];
  uids: string[];
  reason: string;
  at: string | null;
}

export function parseExclusion(path: string, v: unknown): Exclusion | null {
  const o = obj(v);
  const repos = arr(o.repos).map(String);
  const uids = arr(o.uids).map(String);
  if (!repos.length && !uids.length) return null;
  return { path, repos, uids, reason: strOr(o.reason), at: typeof o.at === "string" ? o.at : null };
}

export interface RubricInfo {
  /** `v3`, or null when the labels do not record one (labelled before rubric v3). */
  version: string | null;
  sha256: string | null;
  mixed: boolean;
  /** Labels per rubric (`{"v3": 37}`, `{"not recorded": 162}`). */
  labels: Record<string, number>;
}

export interface StudyDecision {
  id: string;
  date: string;
  by: string;
  status: string;
  title: string;
  rubricSha256: string | null;
}

/** The rubric in words: `v3`, `mixed (v2 120, v3 40)` or `not recorded`. */
export function rubricLabel(r: RubricInfo): string {
  if (r.mixed) return `mixed (${Object.entries(r.labels).map(([k, n]) => `${k} ${n}`).join(", ")})`;
  return r.version ?? "not recorded";
}

/** Whether runs shown side by side were labelled under different rubrics. */
export function rubricChanged(runs: StudyRun[]): boolean {
  return new Set(runs.map((r) => rubricLabel(r.rubric))).size > 1;
}

/** Every decision any run records, latest record of each id, in id order. */
export function decisionsOf(runs: StudyRun[]): StudyDecision[] {
  const m = new Map<string, StudyDecision>();
  for (const r of runs) for (const d of r.decisions) if (!m.has(d.id) || d.date >= m.get(d.id)!.date) m.set(d.id, d);
  return [...m.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** A calibration's label shift (shift.json) or labeller agreement (agreement.json): prior labels against new ones. */
export interface LabelShift {
  n: number;
  exact: number | null;
  kappa: number | null;
  kappaBoot: { lo: number | null; hi: number | null; clusters: number } | null;
  /** `confusion[from][to]` over ACCEPT, TRIVIAL, WRONG. */
  confusion: Record<string, Record<string, number>>;
  a: string;
  b: string;
}

export function parseShift(v: unknown): LabelShift | null {
  const o = obj(v);
  if (typeof o.n !== "number") return null;
  const kb = obj(o.kappa_boot);
  const confusion: Record<string, Record<string, number>> = {};
  for (const [from, row] of Object.entries(obj(o.confusion))) confusion[from] = Object.fromEntries(Object.entries(obj(row)).map(([to, n]) => [to, numOr(n)]));
  return {
    n: o.n,
    exact: numOrNull(o.exact),
    kappa: numOrNull(o.kappa),
    kappaBoot: typeof kb.clusters === "number" ? { lo: numOrNull(kb.lo), hi: numOrNull(kb.hi), clusters: kb.clusters } : null,
    confusion,
    a: strOr(o.a),
    b: strOr(o.b),
  };
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOr = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOr = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

function rate(v: unknown): Rate | null {
  const o = obj(v);
  if (typeof o.n !== "number") return null;
  const ci = (x: unknown) => {
    const c = obj(x);
    return typeof c.clusters === "number" ? { lo: numOrNull(c.lo), hi: numOrNull(c.hi), clusters: c.clusters } : undefined;
  };
  return { k: numOr(o.k), n: o.n, p: numOrNull(o.p), lo: numOrNull(o.lo), hi: numOrNull(o.hi), boot: ci(o.boot), t: ci(o.t) };
}

function tierStats(v: unknown): TierStats {
  const o = obj(v);
  return {
    shown: numOr(o.shown),
    labelled: numOr(o.labelled),
    accept: numOr(o.ACCEPT),
    trivial: numOr(o.TRIVIAL),
    wrong: numOr(o.WRONG),
    unlabelled: numOr(o.unlabelled),
    acceptShown: rate(o.accept_shown) ?? rate(o.accept),
    notWrongShown: rate(o.not_wrong_shown) ?? rate(o.not_wrong),
  };
}

function target(v: unknown): LanguageRow["target"] {
  const o = obj(v);
  if (typeof o.threshold !== "number") return null;
  const value = numOrNull(o.default_tier_accept ?? o.not_wrong);
  return { criterion: strOr(o.criterion), threshold: o.threshold, value, met: typeof o.met === "boolean" ? o.met : null };
}

/** The language a run is about when its repos carry none (dev manifests): from the manifest it ran on. */
export function manifestLanguage(manifest: string | null): string {
  if (!manifest) return "unknown";
  return /-py\b|python/i.test(manifest) ? "python" : "typescript/javascript";
}

export function languageLabel(l: string): string {
  return l === "python" ? "Python" : l === "typescript/javascript" ? "TypeScript/JavaScript" : l;
}

export function parseRun(path: string, metrics: unknown, opts: { calibration?: boolean; variant?: string } = {}): StudyRun | null {
  const m = obj(metrics);
  if (typeof m.run !== "string") return null;
  const man = obj(m.manifest);
  const manifest = typeof man.path === "string" ? man.path : null;
  const fallbackLang = typeof man.language === "string" ? man.language : manifestLanguage(manifest);
  const t = obj(m.tier);
  const def = obj(t.definition);
  const parts = path.split("/");
  const vi = parts.lastIndexOf("views");
  const ri = parts.indexOf("runs");
  const drift = obj(m.drift);
  const below = ri >= 0 ? parts.slice(ri + 2) : [];
  const bv = below.indexOf("views");
  const exp = obj(m.exposure);
  const byLanguage = Array.isArray(m.by_language)
    ? m.by_language.map((g) => {
        const o = obj(g);
        const lang = strOr(o.language, "unknown");
        return {
          language: lang === "unknown" ? fallbackLang : lang,
          repos: arr(o.repos).map(String),
          overall: tierStats(o.overall),
          defaultTier: tierStats(o.default_tier),
          suggestionTier: tierStats(o.suggestion_tier),
          target: target(o.target),
          notWrongTarget: target(o.not_wrong_target),
          families: parseFamilyRows(o.families),
        };
      })
    : null;
  const sens = obj(m.sensitivity);
  const sensitivity = Array.isArray(sens.by_language)
    ? {
        without: arr(sens.without).map(String),
        byLanguage: sens.by_language.map((g) => {
          const o = obj(g);
          const side = (x: unknown) => ({ defaultTier: tierStats(obj(x).default_tier), overall: tierStats(obj(x).overall) });
          return { language: strOr(o.language), removed: arr(o.removed).map(String), with: side(o.with), without: side(o.without) };
        }),
      }
    : null;
  return {
    path,
    // `eval/study/runs/<name>[/views]/<view>`: a view, or a calibration's per-language part (`calib-…/ts`).
    name: ri >= 0 && parts[ri + 1] ? parts[ri + 1] : vi > 0 ? parts[vi - 1] : (parts.at(-1) ?? path),
    view: ri >= 0 ? below.filter((p) => p !== "views").join("/") || null : vi > 0 ? parts.slice(vi + 1).join("/") : null,
    part: (bv >= 0 ? below.slice(0, bv) : below).join("/") || null,
    viewName: bv >= 0 ? below.slice(bv + 1).join("/") || null : vi > 0 && ri < 0 ? parts.slice(vi + 1).join("/") : null,
    variant: opts.variant ?? null,
    scoredAs: m.run,
    labels: typeof m.labels === "string" ? m.labels : null,
    variants: [],
    exposure: Array.isArray(exp.exposed) ? { exposed: exp.exposed.map(String), clean: { ...tierStats(exp.clean), repos: numOr(obj(exp.clean).repos) }, cleanTier: tierStats(exp.clean_tier) } : null,
    agreement: null,
    exclusions: [],
    role: strOr(man.role, man.holdout ? "held-out" : "dev"),
    secondary: m.secondary === true,
    headlineEligible: m.headline_eligible === true,
    language: fallbackLang,
    driftCommit: typeof drift.commit === "string" ? drift.commit : null,
    driftVersion: typeof drift.version === "string" ? drift.version : null,
    manifest,
    tier: typeof def.kind === "string"
      ? {
          kind: def.kind,
          minMembers: numOrNull(t.min_members) ?? numOrNull(def.value) ?? numOrNull(obj(def.default).min_members),
          ruleKinds: arr(obj(def.default).rule_kinds).map(String),
          preRegistered: t.pre_registered === true,
          target: typeof obj(def.default).target === "string" ? (obj(def.default).target as string) : null,
          languages: Array.isArray(obj(def.default).languages) ? arr(obj(def.default).languages).map(String) : null,
          decision: typeof def.decision === "string" ? def.decision : obj(def.default).target === "in_repo" ? "D5" : null,
        }
      : null,
    overall: tierStats(m.overall),
    defaultTier: tierStats(m.default_tier),
    suggestionTier: m.suggestion_tier ? tierStats(m.suggestion_tier) : null,
    byLanguage,
    sensitivity,
    failedRepos: arr(m.failed_repos).map((r) => ({ name: strOr(obj(r).name), status: strOr(obj(r).status) })),
    families: arr(m.families).map((f) => {
      const o = obj(f);
      return { family: strOr(o.family), name: strOr(o.name, strOr(o.family)), shown: numOr(o.shown), accept: numOr(o.ACCEPT), trivial: numOr(o.TRIVIAL), wrong: numOr(o.WRONG), acceptRate: rate(o.accept) };
    }),
    repos: arr(m.repos).map((r) => {
      const o = obj(r);
      return { name: strOr(o.name), shown: numOr(o.shown), accept: numOr(o.ACCEPT), trivial: numOr(o.TRIVIAL), wrong: numOr(o.WRONG) };
    }),
    wrongBecause: Object.fromEntries(Object.entries(obj(obj(m.why).wrong_because)).map(([k, v]) => [k, numOr(v)])),
    rubric: (() => {
      const labels = Object.fromEntries(Object.entries(obj(m.label_rubrics)).map(([k, v]) => [k, numOr(v)]));
      const shas = arr(m.rubric_sha256s).map(String);
      return { version: typeof m.rubric === "string" ? m.rubric : null, sha256: typeof m.rubric_sha256 === "string" ? m.rubric_sha256 : null, mixed: shas.length > 1 || Object.keys(labels).length > 1, labels };
    })(),
    decisions: arr(m.decisions).map((d) => {
      const o = obj(d);
      return { id: strOr(o.id), date: strOr(o.date), by: strOr(o.by), status: strOr(o.status), title: strOr(o.title), rubricSha256: typeof o.rubric_sha256 === "string" ? o.rubric_sha256 : null };
    }),
    // metrics.json `kind` decides; only runs written before it existed fall back to "has shift.json".
    calibration: m.kind === "calibration" ? true : m.kind === "precision" ? false : !!opts.calibration,
    calibrationFiles:
      m.kind === "calibration" && m.calibration && typeof m.calibration === "object"
        ? { shift: typeof obj(m.calibration).shift === "string" ? (obj(m.calibration).shift as string) : null, agreement: typeof obj(m.calibration).agreement === "string" ? (obj(m.calibration).agreement as string) : null }
        : null,
  };
}

type RawRun = { path: string; metrics?: unknown; error?: string; calibration?: boolean; variant?: string };

/** A coverage run (`eval/study/apps-coverage.mjs report`): no labels, so no round of its own; listed apart. */
export interface CoverageRun {
  path: string;
  repos: number;
  /** Repos whose root census (default view) shows no card, of `repos`. */
  silentRoot: { repos: number; of: number } | null;
  /** Packages, and those with at least one shown card. */
  packages: { total: number; withShown: number | null } | null;
}

/**
 * A `metrics.json` that `eval/study/apps-coverage.mjs` wrote (its coverage measures, pre-registered in
 * PREREG-apps-coverage.md under that name): no `run` field, a repo count and the root census view. It is
 * no unreadable scoring: it measures coverage, not labels.
 */
export function parseCoverageRun(path: string, metrics: unknown): CoverageRun | null {
  const m = obj(metrics);
  if (typeof m.run === "string" || typeof m.repos !== "number" || !m.root_default || typeof m.root_default !== "object") return null;
  const silent = obj(obj(m.root_default).silent_root);
  const pk = obj(m.packages);
  const withShown = obj(obj(m.root_default).packages_with_shown);
  return {
    path,
    repos: m.repos,
    silentRoot: typeof silent.repos === "number" && typeof silent.of === "number" ? { repos: silent.repos, of: silent.of } : null,
    packages: typeof pk.total === "number" ? { total: pk.total, withShown: typeof withShown.packages === "number" ? withShown.packages : null } : null,
  };
}

/**
 * Every run that parses, and every one that does not, with why: one bad file never hides the others.
 * A variant (`metrics-<variant>.json`) is folded into the run it varies (its exposure check shown there);
 * each agreement file and adjudication exclusion goes to the run or part whose directory holds it.
 */
export function readRuns(
  raw: RawRun[],
  extra: { agreements?: { path: string; agreement: unknown }[]; exclusions?: { path: string; excluded: unknown }[] } = {},
): { runs: StudyRun[]; unreadable: { path: string; reason: string }[]; coverage: CoverageRun[] } {
  const all: StudyRun[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  const coverage: CoverageRun[] = [];
  for (const r of raw) {
    const run = r.error ? null : parseRun(r.path, r.metrics, { calibration: r.calibration, variant: r.variant });
    const cov = run || r.error || r.variant ? null : parseCoverageRun(r.path, r.metrics);
    if (run) all.push(run);
    else if (cov) coverage.push(cov);
    else unreadable.push({ path: r.variant ? `${r.path} (metrics-${r.variant}.json)` : r.path, reason: r.error ?? "metrics.json is not metrics.mjs --json output (no `run` field)" });
  }
  // A variant's base: the scoring beside it, else the one of the same run kept elsewhere (relabel3's
  // `ts/metrics.json` scores `ts/views/d7`, where `metrics-carried-only.json` sits). A variant with no
  // base stays listed, but never stands for its run (representatives).
  const baseOf = (v: StudyRun) => all.find((b) => !b.variant && b.path === v.path) ?? all.find((b) => !b.variant && b.scoredAs === v.scoredAs && b.language === v.language);
  const runs = all.filter((r) => !r.variant || !baseOf(r));
  for (const v of all.filter((r) => r.variant && !runs.includes(r))) {
    const base = baseOf(v)!;
    base.variants.push(v);
    if (!base.exposure && v.exposure) base.exposure = v.exposure;
  }
  // The directory a run's labelling lives in: the run, or its part (`dev-v3-…/py`); views share it.
  const units = [...new Set(runs.map(unitDir))].sort((a, b) => b.length - a.length);
  const owner = (p: string) => units.find((u) => p === u || p.startsWith(`${u}/`)) ?? null;
  const agreementOf = new Map<string, { path: string; agreement: unknown }>();
  for (const a of (extra.agreements ?? []).slice().sort((x, y) => x.path.length - y.path.length)) {
    const u = owner(a.path);
    if (u && !agreementOf.has(u)) agreementOf.set(u, a);
  }
  for (const r of runs) {
    const u = unitDir(r);
    r.agreement = parseShift(agreementOf.get(u)?.agreement);
    r.exclusions = (extra.exclusions ?? []).filter((e) => owner(e.path) === u).flatMap((e) => parseExclusion(e.path, e.excluded) ?? []);
  }
  return { runs: sortRuns(runs), unreadable, coverage: coverage.sort((a, b) => a.path.localeCompare(b.path)) };
}

/** `eval/study/runs/<run>[/<part>]`: where a run's (or part's) labels, agreement and adjudication are. */
export function unitDir(r: StudyRun): string {
  const i = r.path.split("/").lastIndexOf("views");
  return i > 0 ? r.path.split("/").slice(0, i).join("/") : r.path;
}

/** What a variant of a run is, in words: how it differs from the run's own scoring, and why it is not a result. */
export interface VariantInfo {
  /** `carried-only`, `without-CTFd`. */
  name: string;
  /** `metrics-<variant>.json`, where it sits. */
  file: string;
  /** `carried`: earlier rounds' labels only; `exposure`: some repos left out; `other`: another option the file does not name. */
  kind: "carried" | "exposure" | "other";
  meaning: string;
}

/**
 * A variant (`metrics-<variant>.json`) scores the same cards as its run with one option changed. Read off the file:
 * a labels file of carried labels (relabel3's `carried-only`: `metrics.mjs --labels <part>/carried.jsonl`), an
 * exposure check (`--exclude-repos`), or labels other than the run's.
 */
export function describeVariant(v: StudyRun, base: StudyRun | null): VariantInfo {
  const name = v.variant ?? "";
  const file = `${v.path}/metrics-${name}.json`;
  const fileName = (p: string) => p.split("/").pop() ?? p;
  if (/(^|\/)carried\.jsonl$/.test(v.labels ?? "") || name === "carried-only") {
    const unl = v.overall.unlabelled;
    return {
      name,
      file,
      kind: "carried",
      meaning: `Only the labels carried over from earlier rounds${v.labels ? ` (${fileName(v.labels)})` : ""}: every card relabelled in this round is unlabelled here${unl ? ` (${unl} of ${v.overall.shown} shown)` : ""}, and counted as WRONG. It shows what was at stake before the relabel; the run's result is its own scoring${base?.labels ? `, with ${fileName(base.labels)}` : ""}.`,
    };
  }
  if (v.exposure)
    return {
      name,
      file,
      kind: "exposure",
      meaning: `The exposure check: the same cards without ${v.exposure.exposed.join(", ")} (metrics.mjs --exclude-repos). The run's result keeps them; this is a check on it.`,
    };
  if (v.labels && base?.labels && v.labels !== base.labels)
    return { name, file, kind: "other", meaning: `The same cards scored with the labels in ${v.labels} instead of ${base.labels}; not the run's result.` };
  return { name, file, kind: "other", meaning: `The same cards scored with another option, as ${fileName(file)} records it; not the run's result.` };
}

/** The run (or part) and its views share labels: one "unit" per `<run>[/<part>]`. */
export function unitKey(r: StudyRun): string {
  return `${r.name}/${r.part ?? ""}`;
}

/** The decision that defines the tier the product ships (`drift_mine::tier::DECISION`). */
export const PRODUCT_TIER_DECISION = "D7";

/**
 * What to show for each run or part: scored with the product's tier when a view applies it (`py/views/d7`,
 * decision D7) or the part holds that scoring itself (relabel3's `ts/metrics.json`), else the newest rule-kind tier a view applies (`py/views/d5`; `views/rule5`, `views/rule5-py`
 * for the Python side), else the run itself.
 */
export function representatives(runs: StudyRun[]): StudyRun[] {
  const out: StudyRun[] = [];
  const seen = new Set<string>();
  for (const r of runs) {
    if (r.calibration || r.variant || seen.has(unitKey(r))) continue;
    seen.add(unitKey(r));
    const unit = runs.filter((x) => unitKey(x) === unitKey(r) && !x.calibration && !x.variant);
    const views = unit.filter((v) => v.viewName && v.tier?.kind === "rule_kind");
    const lang = unit.find((x) => !x.viewName) ?? r;
    const suffix = lang.language === "python" ? "-py" : null;
    // The product's tier, from a view, or from the run or part itself when it holds that view's scoring (relabel3).
    const product = views.find((v) => v.tier?.decision === PRODUCT_TIER_DECISION) ?? unit.find((x) => !x.viewName && x.tier?.kind === "rule_kind" && x.tier.decision === PRODUCT_TIER_DECISION);
    out.push(product ?? (suffix ? views.find((v) => v.viewName!.endsWith(suffix)) : null) ?? views.find((v) => !/-\w+$/.test(v.viewName!)) ?? views[0] ?? unit.find((x) => !x.viewName) ?? r);
  }
  return out;
}

/** The newest round per language, one entry per part (dev-v3: ts; py and py2), and every earlier round. */
export function latestAndEarlier(runs: StudyRun[]): { latest: StudyRun[]; earlier: StudyRun[] } {
  const reps = representatives(runs);
  const newest = new Map<string, string>();
  for (const r of reps) if (!newest.has(r.language)) newest.set(r.language, r.name);
  const latest = reps.filter((r) => newest.get(r.language) === r.name).sort((a, b) => (a.part ?? "").localeCompare(b.part ?? "", "en", { numeric: true }));
  // TypeScript first, then Python, then any other language in the order seen.
  const order = [...new Set(["typescript/javascript", "python", ...newest.keys()])];
  latest.sort((a, b) => order.indexOf(a.language) - order.indexOf(b.language));
  return { latest, earlier: reps.filter((r) => !latest.includes(r)) };
}

/**
 * Newest first, each run before its views. Runs are named `dev-<lang>[-rN]-<date>`: by date,
 * then by name descending, so a relabel round (`dev-py-r2-…`) comes before the round it relabels.
 */
export function sortRuns(runs: StudyRun[]): StudyRun[] {
  const key = (r: StudyRun) => r.name.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  return runs.slice().sort((a, b) => key(b).localeCompare(key(a)) || b.name.localeCompare(a.name) || (a.view ?? "").localeCompare(b.view ?? ""));
}

const tierLanguageName = (l: string) => (l === "ts" ? "TypeScript/JavaScript" : l === "py" ? "Python" : l);

/** The tier's short name on a run card: `D7 tier`, `D5 tier`, `rule-kind tier`, or what it lacks. */
export function tierLabel(r: Pick<StudyRun, "tier">): string {
  if (r.tier?.kind === "rule_kind") return r.tier.decision ? `${r.tier.decision} tier` : "rule-kind tier";
  return r.tier ? "role-size tier only, not the product's tier" : "no tier recorded";
}

/** A run whose tier gives its language no default tier at all (D7: Python advises only), so it has no default-tier rate. */
export function noDefaultTier(r: Pick<StudyRun, "tier" | "language" | "defaultTier">): boolean {
  return languageAdvisesOnly(r, r.language) && r.defaultTier.shown === 0;
}

/** How the run defines the default tier, in words. */
export function tierDefinition(r: StudyRun): string {
  if (!r.tier) return "no tier recorded (this run predates tiers)";
  const m = r.tier.minMembers ?? 15;
  if (r.tier.kind === "min_members") return `default tier: role has ≥ ${m} members`;
  if (r.tier.kind === "rule_kind" && r.tier.languages)
    return `default tier (${r.tier.decision ?? "D7"}): ${r.tier.languages.map(tierLanguageName).join(" or ")} only (Python advises only), rule kind ${r.tier.ruleKinds.join(" or ")}${r.tier.target === "in_repo" ? ", naming only the repository's own symbols," : ""} and role ≥ ${m} members`;
  if (r.tier.kind === "rule_kind")
    return `default tier: rule kind in the allowlist (${r.tier.ruleKinds.length} kinds)${r.tier.target === "in_repo" ? ", naming only the repository's own symbols (D5)," : ""} and role ≥ ${m} members`;
  return `default tier: ${r.tier.kind}`;
}
