// `drift practices --json` (version 1, eval/study/PLAN-R13.md §0.3), shaped for the Practices view. Pure functions:
// sorting, shares, the coverage bar, the per-package filter and the cross-package comparison. Drift decides every
// count; nothing here classifies code.
import { PRACTICE_CONCERNS, PRACTICE_PRIMARY, type PracticeConcern, type PracticeConcernId, type PracticeExample, type PracticeFinding, type PracticeGroup, type PracticeRecipe, type PracticeUnknownReason, type PracticeVariant, type PracticesReport } from "@/shared/contract/drift";
import { notReadCount } from "@/entities/basis";

/** `members / total`, 0 for an empty population. */
export function share(members: number, total: number): number {
  return total > 0 ? members / total : 0;
}

/** A share as Drift's text form prints it: `96%`, `<1%` for a small non-zero share, `0%`. */
export function pct(x: number): string {
  if (x > 0 && x < 0.005) return "<1%";
  return `${Math.round(x * 100)}%`;
}

/** Variants by members (descending), then key, as Drift sorts them (§3 "Sorting"); `none` sorts by its count too. */
export function sortVariants<T extends { members: number; key: string }>(vs: readonly T[]): T[] {
  return [...vs].sort((a, b) => b.members - a.members || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Concerns in the frozen order of §0.1 (unknown ids last, by id). */
export function sortConcerns(cs: readonly PracticeConcern[]): PracticeConcern[] {
  const at = (id: string) => {
    const i = (PRACTICE_CONCERNS as readonly string[]).indexOf(id);
    return i < 0 ? PRACTICE_CONCERNS.length : i;
  };
  return [...cs].sort((a, b) => at(a.id) - at(b.id) || (a.id < b.id ? -1 : 1));
}

export interface Counts {
  total: number;
  known: number;
  /** Authentication that identifies the caller and turns no one away, counted apart from known (newer drift). */
  identified?: number;
  /** Nothing found in what Drift read. */
  none: number;
  unknown: number;
}

export interface CoverageBar extends Counts {
  /** Shares of the population, summing to 1 (all 0 when it is empty). */
  knownShare: number;
  identifiedShare: number;
  noneShare: number;
  unknownShare: number;
  /** `(known + identified + none) / total`. */
  coverage: number;
  target: number;
  atTarget: boolean;
  /** Unknown units that would have to become known or none to reach the target (0 at target). */
  toTarget: number;
}

/** The coverage bar of a population against the target (§3 "Coverage per concern": `(known + identified + none) / total`). */
export function coverageBar(c: Counts, target: number): CoverageBar {
  const identified = c.identified ?? 0;
  const coverage = share(c.known + identified + c.none, c.total);
  // Within floating error of the target counts as at it (0.9 of 10 units is 9 units).
  const atTarget = c.total > 0 && coverage >= target - 1e-9;
  const toTarget = c.total > 0 && !atTarget ? Math.max(0, Math.ceil(target * c.total - 1e-9) - (c.known + identified + c.none)) : 0;
  return { ...c, identified, knownShare: share(c.known, c.total), identifiedShare: share(identified, c.total), noneShare: share(c.none, c.total), unknownShare: share(c.unknown, c.total), coverage, target, atTarget, toTarget };
}

/** The largest known variant (§3: the variant others are set apart from), or null when none is known. */
export function dominantOf(c: PracticeConcern): PracticeVariant | null {
  return sortVariants(c.variants).find((v) => v.kind === "known") ?? null;
}

/** A variant's letter in its concern's stack (A, B, C, … as the text form names them). */
export function letterOf(c: PracticeConcern, id: string): string {
  const i = sortVariants(c.variants).findIndex((v) => v.id === id);
  return i < 0 ? "?" : i < 26 ? String.fromCharCode(65 + i) : `#${i + 1}`;
}

/** What an exception or a divergence names: a variant of the concern, `none` or `unknown`. */
export function variantName(c: PracticeConcern, id: string): string {
  if (id === "unknown") return "unknown";
  if (id === "none") return "none";
  const v = c.variants.find((x) => x.id === id);
  return v ? `${letterOf(c, id)} ${v.label}` : id;
}

// ---------- packages ----------

/** Every package the report profiles, largest population first, then by name. */
export function packagesOf(r: PracticesReport): string[] {
  const size = new Map<string, number>();
  for (const c of r.concerns) for (const p of c.by_package) size.set(p.package, (size.get(p.package) ?? 0) + p.total);
  return [...size].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p);
}

export interface VariantRow {
  variant: PracticeVariant;
  /** In the scope shown: the whole repository, or one package. */
  members: number;
  share: number;
}

export interface ConcernScope {
  concern: PracticeConcern;
  /** The package shown, or null for the whole repository. */
  package: string | null;
  counts: Counts;
  bar: CoverageBar;
  variants: VariantRow[];
}

/**
 * A concern in a scope. For a package, from `by_package`: its total, and each variant's members and share there;
 * known and none are the members of its known and none variants, and unknown the rest of the package's total.
 * Null when the concern has no unit in the package.
 */
export function concernIn(c: PracticeConcern, pkg: string | null, target: number): ConcernScope | null {
  if (pkg === null) {
    const counts = { total: c.population.total, known: c.population.known, identified: c.population.identified ?? 0, none: c.population.none, unknown: c.population.unknown };
    return { concern: c, package: null, counts, bar: coverageBar(counts, target), variants: sortVariants(c.variants).map((v) => ({ variant: v, members: v.members, share: share(v.members, c.population.total) })) };
  }
  const bp = c.by_package.find((p) => p.package === pkg);
  if (!bp || bp.total === 0) return null;
  const byId = new Map(c.variants.map((v) => [v.id, v]));
  const rows: VariantRow[] = [];
  for (const x of bp.variants) {
    const v = byId.get(x.id);
    if (v && x.members > 0) rows.push({ variant: v, members: x.members, share: share(x.members, bp.total) });
  }
  rows.sort((a, b) => b.members - a.members || (a.variant.key < b.variant.key ? -1 : a.variant.key > b.variant.key ? 1 : 0));
  const known = rows.filter((r) => r.variant.kind === "known").reduce((s, r) => s + r.members, 0);
  const identified = rows.filter((r) => r.variant.kind === "identified").reduce((s, r) => s + r.members, 0);
  const none = rows.filter((r) => r.variant.kind === "none").reduce((s, r) => s + r.members, 0);
  const counts = { total: bp.total, known, identified, none, unknown: Math.max(0, bp.total - known - identified - none) };
  return { concern: c, package: pkg, counts, bar: coverageBar(counts, target), variants: rows };
}

/** The concern list for a scope: concerns with units there, in §0.1 order. */
export function concernsIn(r: PracticesReport, pkg: string | null): ConcernScope[] {
  return sortConcerns(r.concerns)
    .map((c) => concernIn(c, pkg, r.summary.target))
    .filter((x): x is ConcernScope => !!x && x.counts.total > 0);
}

/** Every concern in a scope together, as `summary` gives it for the whole repository. */
export function summaryIn(r: PracticesReport, pkg: string | null): { bar: CoverageBar; atTarget: number; concerns: number } {
  const rows = concernsIn(r, pkg);
  const counts =
    pkg !== null
    ? rows.reduce((s, x) => ({ total: s.total + x.counts.total, known: s.known + x.counts.known, identified: s.identified + (x.counts.identified ?? 0), none: s.none + x.counts.none, unknown: s.unknown + x.counts.unknown }), { total: 0, known: 0, identified: 0, none: 0, unknown: 0 })
    : { total: r.summary.population, known: r.summary.known, identified: r.summary.identified ?? 0, none: r.summary.none, unknown: r.summary.unknown };
  return { bar: coverageBar(counts, r.summary.target), atTarget: rows.filter((x) => x.bar.atTarget).length, concerns: rows.length };
}

/**
 * Examples in a package (by path), all of them for the whole repository. The root package (`""`) cannot be told
 * by its path from the others, so it keeps them all.
 */
export function examplesIn<T extends PracticeExample>(xs: readonly T[], pkg: string | null): T[] {
  return pkg ? xs.filter((e) => e.path === pkg || e.path.startsWith(`${pkg}/`)) : [...xs];
}

/** A package as Drift prints it: `.` for the root package. */
export function pkgLabel(p: string): string {
  return p === "" ? "." : p;
}

// ---------- the cross-package comparison ----------

export interface Comparison {
  /** Variants that appear in at least one package, in the repository's order. */
  variants: PracticeVariant[];
  rows: {
    package: string;
    total: number;
    coverage: number;
    /** Share of the package's units per variant id (0 when absent). */
    shares: Record<string, number>;
    members: Record<string, number>;
    /** The package's dominant known variant when it differs from the repository's (`divergence`). */
    divergent: { dominant: string; members: number } | null;
  }[];
  /** The repository's dominant known variant. */
  repoDominant: string | null;
}

/** Packages side by side for one concern (`by_package` and `divergence`); null with fewer than two packages. */
export function comparison(c: PracticeConcern): Comparison | null {
  if (c.by_package.length < 2) return null;
  const present = new Set(c.by_package.flatMap((p) => p.variants.filter((v) => v.members > 0).map((v) => v.id)));
  const variants = sortVariants(c.variants).filter((v) => present.has(v.id));
  const rows = c.by_package.map((p) => {
    const shares: Record<string, number> = {};
    const members: Record<string, number> = {};
    for (const v of p.variants) {
      shares[v.id] = share(v.members, p.total);
      members[v.id] = v.members;
    }
    const d = c.divergence.find((x) => x.package === p.package);
    return { package: p.package, total: p.total, coverage: p.coverage, shares, members, divergent: d ? { dominant: d.dominant, members: d.members } : null };
  });
  return { variants, rows, repoDominant: c.divergence[0]?.repo_dominant ?? dominantOf(c)?.id ?? null };
}

// ---------- what sets a variant apart ----------

const ATTRIBUTE: Record<string, (v: string) => string> = {
  package: (v) => `in package ${v}`,
  dir: (v) => `under ${v}`,
  role: (v) => `in role ${v}`,
  entry: (v) => `${v} entry points`,
  method: (v) => `${v} handlers`,
  stem: (v) => `files named ${v}`,
  route: (v) => `routes under /${v.replace(/^\//, "")}`,
  lang: (v) => `in ${v}`,
  imports: (v) => `importing ${v}`,
  wrap: (v) => `also using ${v}`,
};

/** An attribute (`dir:apps/web/app/api/webhooks`) in words (`under apps/web/app/api/webhooks`). */
export function attributeText(attribute: string): string {
  const i = attribute.indexOf(":");
  const kind = i < 0 ? attribute : attribute.slice(0, i);
  const value = i < 0 ? "" : attribute.slice(i + 1);
  return ATTRIBUTE[kind]?.(value) ?? attribute;
}

/**
 * "9/9 of B under app/api/webhooks vs 0/170 of A" (§3): a property of the counts, no verdict. For the dominant
 * variant itself the comparison is with the rest of the population.
 */
export function setsApartText(c: PracticeConcern, v: PracticeVariant, s: PracticeVariant["sets_apart"][number]): string {
  const d = dominantOf(c);
  const self = letterOf(c, v.id);
  const other = d && d.id !== v.id ? letterOf(c, d.id) : "the rest";
  return `${s.in_variant[0]}/${s.in_variant[1]} of ${self} ${attributeText(s.attribute)} vs ${s.in_dominant[0]}/${s.in_dominant[1]} of ${other}`;
}

/** The one-line hint the text form prints after a variant: its main place, and what sets it apart first. */
export function variantHint(v: PracticeVariant): string {
  const place = v.where.dirs[0]?.dir ?? v.where.packages[0]?.package ?? null;
  const apart = v.sets_apart[0];
  return [place, apart ? `sets apart: ${attributeText(apart.attribute)} ${apart.in_variant[0]}/${apart.in_variant[1]} vs ${apart.in_dominant[0]}/${apart.in_dominant[1]}` : null].filter(Boolean).join("; ");
}

// ---------- unknown and gaps ----------

/** Why units are unknown (§0.3), and what would make them known. */
export const UNKNOWN_REASON: Record<PracticeUnknownReason, { label: string; hint: string }> = {
  unparsed: { label: "file not parsed", hint: "A file of the unit was skipped or failed to parse; the Attention view lists skipped files by reason." },
  opaque_wrapper: { label: "opaque wrapper", hint: "A wrapper Drift cannot see into. Name what it does under practices: in .drift/config.yaml." },
  unresolved: { label: "unresolved", hint: "An instrument whose definition Drift could not resolve (an import outside the scan, or a path alias it does not know)." },
  no_symbol: { label: "no symbol", hint: "The entry point's handler is not in its file (a re-export Drift could not follow)." },
  dynamic: { label: "dynamic", hint: "Computed callees or spread arguments: what runs is decided at run time." },
  body_unreadable: { label: "body not readable", hint: "The handler awaits a call whose body Drift cannot read (an unresolved import, a callee the facts do not define, a service built by a dependency). It may be the check, so nothing found is not an absence." },
  not_followed: { label: "handed to a callee", hint: "A tenant id from a header or the route is passed to a callee whose checks Drift does not follow. It may be enforced there." },
  route_not_matched: { label: "test route not matched", hint: "A test of the package requests a route that is not a literal (reverse(), a variable) and names no target. It may be the one that covers this entry point." },
  unclassified: { label: "unclassified", hint: "An instrument no vocabulary, usage or declaration classifies. One line under practices: in .drift/config.yaml makes it known." },
  partly_read: { label: "read in part", hint: "A function the unit runs was read except for a method of a value whose type Drift does not know (a parameter's member, a configuration value). It may be where the concern is decided, so nothing found is not an absence. The instrument is that function." },
  forwarded: { label: "handed to another service", hint: "The request is handed on to another service over HTTP, which may decide it. The instrument is the function that hands it on." },
  signature_not_proven: { label: "signature check not proven", hint: "A webhook signature verifier is called, and nothing proves a failed verification stops the request: its result may be ignored, what it raises swallowed or only logged, or it runs for some requests only. Make the failure leave the handler (let it raise, or answer 400/401) on every request." },
  check_not_proven: { label: "check found, not proven", hint: "A check was found but is not proven to be this unit's practice: it does not run on every request, or only its name says what it is. The unit is unknown; where the unit always runs the check, one line under practices: in .drift/config.yaml settles it." },
};

export function unknownReason(r: string): { label: string; hint: string } {
  return UNKNOWN_REASON[r as PracticeUnknownReason] ?? { label: r, hint: "" };
}

/** Concerns below the target in a scope, furthest first: where the map has gaps. */
export function gaps(rows: readonly ConcernScope[]): ConcernScope[] {
  return rows.filter((r) => !r.bar.atTarget).sort((a, b) => a.bar.coverage - b.bar.coverage || b.counts.unknown - a.counts.unknown || (a.concern.id < b.concern.id ? -1 : 1));
}

// ---------- recipe and findings (the default view; Drift ranks and caps them) ----------

/** Concerns outside the recipe (logging, config, data_access, testing): reported as a preview. */
export function isPreview(id: string): boolean {
  return !(PRACTICE_PRIMARY as readonly string[]).includes(id);
}

export function concernTitle(r: PracticesReport, id: string): string {
  return r.concerns.find((c) => c.id === id)?.title ?? id;
}

/** A variant's label in its concern (`none`, `unknown` and unknown ids read as themselves). */
export function variantLabel(r: PracticesReport, concern: string, id: string): string {
  return r.concerns.find((c) => c.id === concern)?.variants.find((v) => v.id === id)?.label ?? id;
}

/** The recipes of a package (all of them for the whole repository), in Drift's order. */
export function recipesIn(r: PracticesReport, pkg: string | null): PracticeRecipe[] {
  return (r.recipes ?? []).filter((x) => pkg === null || x.package === pkg);
}

/**
 * The findings of a package plus the repository-wide ones (unknown instruments), in Drift's order (`null`: the whole
 * repository; `""`: the root package). A helper copied across packages belongs to the packages its listed copies are
 * in, by path: the root package's copies are those under no other package's directory.
 */
export function findingsIn(r: PracticesReport, pkg: string | null): PracticeFinding[] {
  const others = packagesOf(r).filter((p) => p !== "");
  const inPkg = (path: string) => (pkg === "" ? !others.some((p) => path.startsWith(`${p}/`)) : path.startsWith(`${pkg}/`));
  return (r.findings ?? []).filter((f) => {
    if (pkg === null || f.package === pkg) return true;
    if (f.package !== null) return false;
    if (f.kind !== "duplicate_helper") return true;
    return (f.copies ?? []).some((c) => inPkg(c.path));
  });
}

/** Recipe concerns in the order PRACTICE_PRIMARY lists them. */
export function recipeConcerns(x: PracticeRecipe): PracticeRecipe["concerns"] {
  const at = (id: PracticeConcernId) => PRACTICE_PRIMARY.indexOf(id);
  return [...x.concerns].sort((a, b) => at(a.concern) - at(b.concern));
}

/** Where the second variant of a recipe concern differs from the first; `attribute` null is an unexplained split. */
export function differsText(d: NonNullable<PracticeRecipe["concerns"][number]["differs"]>): string {
  return d.attribute ? `${d.members} ${attributeText(d.attribute)}` : `${d.members}, and nothing sets them apart`;
}

/** The finding kinds in Drift's rank order (`FindingKind` in crates/drift-mine/src/practices/mod.rs). */
export const FINDING_KIND: Record<PracticeFinding["kind"], { label: string; tone: "warning" | "danger" | "info" }> = {
  unscoped_key: { label: "Unscoped key", tone: "danger" },
  unexplained_split: { label: "Unexplained split", tone: "warning" },
  none: { label: "None", tone: "danger" },
  unknown: { label: "Unknown", tone: "info" },
  duplicate_helper: { label: "Duplicate helper", tone: "warning" },
};

/** The area a duplicate helper is filed under: named in `not_covered`, no concern of the map. */
export const HYGIENE = "hygiene";

/** The copies of a duplicate helper that Drift counted and did not list. */
export function copiesMore(f: PracticeFinding): number {
  return Math.max(0, f.members - (f.copies?.length ?? 0));
}

/** One finding in words, from what Drift says (nothing recomputed). */
export function findingText(r: PracticesReport, f: PracticeFinding): { title: string; detail: string } {
  const title = concernTitle(r, f.concern);
  const where = f.package === null ? "across the repository" : `in ${pkgLabel(f.package)}`;
  const unit = (n: number) => `${n} ${unitOf(r, f.concern, n)}`;
  if (f.kind === "unscoped_key") {
    const key = f.key ?? "a key";
    return {
      title: `${title} ${where}: ${unit(f.members)} ${f.members === 1 ? "takes" : "take"} ${key} from the request, and nothing checks or scopes it`,
      detail: `The caller is signed in and every body the request runs was read to the end, so a signed-in caller can name any ${key}. Drift says this only where the facts prove it: a route whose authorization is unknown, or whose work goes to code Drift cannot read, is not listed.`,
    };
  }
  if (f.kind === "duplicate_helper") {
    const shared = f.shared_calls ?? 0;
    const more = copiesMore(f);
    return {
      title: `${f.key ?? "A helper"} is defined in ${f.members} files ${f.package === null ? "across packages" : `in ${pkgLabel(f.package)}`}`,
      detail: `Same name, and the copies share ${shared} ${shared === 1 ? "call" : "calls"}: one helper written ${f.members === 2 ? "twice" : `${f.members} times`}. Drift reads what the copies call, not their text.${more > 0 ? ` ${more} more ${more === 1 ? "copy is" : "copies are"} not listed.` : ""}`,
    };
  }
  if (f.kind === "unexplained_split") {
    const [a, b] = f.variants.map((id) => variantLabel(r, f.concern, id));
    return { title: `${title} ${where}: two ways, and nothing sets them apart`, detail: `${unit(f.members)} do ${b ?? "another way"} where most do ${a ?? "the first way"}; no package, directory, role or kind of entry point separates them.` };
  }
  if (f.kind === "none") {
    const label = f.variants[0] ? variantLabel(r, f.concern, f.variants[0]) : "none";
    const v = r.concerns.find((c) => c.id === f.concern)?.variants.find((x) => x.id === f.variants[0]);
    return { title: `${title} ${where}: ${unit(f.members)}, ${label.replace(/^none: /, "")}${notReadCount(v?.not_read)}`, detail: "Nothing found in what Drift read, not a fact about the code: something Drift does not know may do it, and what it saw and did not read is listed with each unit. Meant (webhooks, health checks, public pages) or a gap: Drift does not say which." };
  }
  return {
    title: `${title}: ${unit(f.members)} ${f.members === 1 ? "uses" : "use"} ${f.instrument ?? "an instrument"} Drift cannot classify`,
    detail: f.config_hint ? "One line in .drift/config.yaml says what it does, and makes them known." : "No config line would make it known: Drift could not resolve it, or it is not an instrument a line can name.",
  };
}

function unitOf(r: PracticesReport, concern: string, n: number): string {
  const u = (r.concerns.find((c) => c.id === concern)?.unit ?? "unit").replace(/_/g, " ");
  return n === 1 ? u : u.endsWith("s") ? u : `${u}s`;
}

// ---------- groups: variants sharing their decisive instrument (newer drift) ----------

/** A concern's groups, in Drift's order, for the whole repository (Drift groups no package); null when Drift gave none. */
export function groupsOf(c: PracticeConcern, pkg: string | null): PracticeGroup[] | null {
  return pkg === null && c.groups?.length ? c.groups : null;
}

/** What a group shares, in words: its instrument, how it is applied, and for authn the caller class. */
export function groupHint(g: PracticeGroup): string {
  const parts: string[] = [];
  if (g.instrument) parts.push(`shares ${g.instrument}`);
  if (g.mechanisms.length) parts.push(`by ${g.mechanisms.join(", ")}`);
  if (g.class) parts.push(`callers: ${g.class}`);
  return parts.join(" · ");
}

/** A group's sub-variants not listed in `top` (Drift caps it). */
export function groupMore(g: PracticeGroup): number {
  return Math.max(0, g.variants - g.top.length);
}
