// Conventions as the review screen shows them: `.drift/conventions.yaml`
// (status, mode, the human decision) joined with `drift census --json`
// (outliers, rank, member counts) by convention id.
import type {
  AgentsView,
  Census,
  CensusProposal,
  CheckConvention,
  CheckReport,
  ConventionsFile,
  KeyType,
  Evidence,
  Exempt,
  FromMap,
  Mode,
  Outlier,
  PolicyDifferentKind,
  PolicyException,
  RoleSelector,
  Rule,
  Tier,
  TierReasonCode,
  VerifyView,
} from "@/shared/contract/drift";
import { type RuleFamily, ruleFamily, splitKey } from "./rules";
import { isWiringRule } from "./wiring";
import { fromMapOf } from "./policy";

/** `unmined`: in the policy file but not among the current census proposals. */
export type RowStatus = "accepted" | "proposed" | "rejected" | "not_in_policy";

export interface ConventionRow {
  id: string;
  status: RowStatus;
  mode: Mode;
  summary: string;
  role: RoleSelector;
  rule: Rule;
  family: RuleFamily;
  evidence: Evidence;
  example: { path: string; symbol: string; line: number | null };
  /** Null when census did not report this id (older proposal, or census unavailable). */
  outliers: Outlier[] | null;
  outliersTotal: number | null;
  blockable: boolean;
  rank: number | null;
  members: number;
  /** `default` or `suggestion`, from census (or from check for conventions census no longer reports). */
  tier: Tier | null;
  /** Why a suggestion is not in the default tier (null for the default tier, or when unknown). */
  tierReason: TierReason | null;
  /** The language the tier reads (decision D7): `py` when any member of the role is Python (`tierLanguage`); null when unknown. */
  language: "ts" | "py" | null;
  /** Structured rule kind, what the tier is keyed on. */
  ruleKind: string | null;
  /** The rule names a package's symbol (a framework decorator, a library base class): never default tier under D5. */
  namesPackage: boolean;
  /** `passes_key` rules: whether the callee's parameter type already requires the key (census `key_type`). */
  keyType: KeyType | null;
  /**
   * Role members the rule is not about, with why: census `exempt`, or, for a policy
   * convention census does not report, the members `drift check` listed as exempt (#45).
   * Null when neither reported this id.
   */
  exempt: Exempt[] | null;
  /** Holders through an in-repo base's declaration (census `inherited`). */
  inherited: Outlier[] | null;
  /** Holders through a wrapper built on the rule's (census `derived`). */
  derived: (Outlier & { wrapper: string; from: string })[] | null;
  /** The mode drift check applies once accepted: a role under 15 members advises even when `mode` is block. */
  effectiveMode: Mode;
  /** An experimental wiring rule (#38): a suggestion that never blocks, inert while the flag is off. */
  experimental: boolean;
  /** Wiring rules: census's registry hint, lists and history; null otherwise or when census did not report it. */
  wiring: CensusProposal["wiring"] | null;
  /** Role members in files that depend on a file census could not parse for lack of stack (census `unchecked_members`, #32): their verdict may change once it is. 0 when none or not reported. */
  uncheckedMembers: number;
  /** Whether Drift shows it to agents, and why (W0): check `conventions[].agents` (the policy's decision included), else census `agents`; null when neither reported it (older drift). */
  agents: AgentsView | null;
  /** The experimental agent verifier's standing (check `conventions[].verify`, `agents.verify: on` only); null otherwise. */
  verify: VerifyView | null;
  /** Outliers a reviewer marked fine, with the reason (conventions.yaml `exceptions`); empty when none or not in the policy. */
  exceptions: PolicyException[];
  /** Files a person set apart as a different kind, answering the one question (conventions.yaml `different_kind`); empty when none. */
  differentKind: PolicyDifferentKind[];
  /** A practice a person promoted from the practice map (conventions.yaml `promoted_from_practice`): the variant id it came from; null for every other convention. */
  promotedFromPractice: string | null;
  /** Proposed from Drift's map of the code (conventions.yaml or census `from_map`), not by the miner: it did not pass through the miner's measured gates. Null for a mined convention. */
  fromMap: FromMap | null;
}

/** Which proposals the review list shows by where they come from: all, the miner's, or those from Drift's map of the code. */
export type SourceFilter = "all" | "mined" | "map";

/** Whether a row passes the source filter: `map` keeps the rows proposed from Drift's map of the code, `mined` every other. */
export function passesSource(r: Pick<ConventionRow, "fromMap">, f: SourceFilter): boolean {
  return f === "all" || (f === "map") === (r.fromMap !== null);
}

/** Whether any row was proposed from Drift's map of the code: the source filter is shown only then. */
export function hasFromMap(rows: readonly Pick<ConventionRow, "fromMap">[]): boolean {
  return rows.some((r) => r.fromMap !== null);
}

/** `path#symbol`: how drift.lock and conventions.yaml `exceptions` name a member. */
export function memberKey(o: Pick<Outlier, "path" | "symbol">): string {
  return `${o.path}#${o.symbol}`;
}

/** A member a reviewer marked fine, with where census or check last saw it (line null when neither lists it now). */
export interface FineOutlier {
  member: string;
  path: string;
  symbol: string;
  line: number | null;
  reason: string;
}

/**
 * A card's outliers split by the reviewer's exceptions: those still to look at (census outliers not marked fine) and
 * those marked fine, with the reason. One count each, so the card never states two different numbers for the same set.
 */
export function splitOutliers(row: Pick<ConventionRow, "outliers" | "exceptions" | "exempt">): { open: Outlier[]; fine: FineOutlier[] } {
  const fineBy = new Map(row.exceptions.map((e) => [e.member, e.reason]));
  const open = (row.outliers ?? []).filter((o) => !fineBy.has(memberKey(o)));
  const seen = new Map<string, Outlier>();
  for (const o of [...(row.outliers ?? []), ...(row.exempt ?? [])]) if (!seen.has(memberKey(o))) seen.set(memberKey(o), o);
  const fine = row.exceptions.map((e) => {
    const at = seen.get(e.member);
    const i = e.member.indexOf("#");
    return { member: e.member, path: at?.path ?? e.member.slice(0, i), symbol: at?.symbol ?? e.member.slice(i + 1), line: at?.line ?? null, reason: e.reason };
  });
  return { open, fine };
}

/**
 * A suggestion's rule-family record on suggestion-tier labels only (W0's family table, crates/drift-mine/data/family-admission.json,
 * as check or census report it in `agents`): accepted of n labelled cards. Null for the default tier, or when Drift reported no record.
 */
export function suggestionRecord(row: Pick<ConventionRow, "tier" | "agents">): { accepted: number; n: number; rate: number } | null {
  const a = row.agents;
  if (row.tier !== "suggestion" || !a || typeof a.accepted !== "number" || typeof a.n !== "number" || a.n <= 0) return null;
  return { accepted: a.accepted, n: a.n, rate: a.accepted / a.n };
}

/** Labelled cards a family record needs before the Studio treats its rate as known (the admission bar's `min_cards`). */
export const RECORD_MIN_CARDS = 10;

/**
 * Whether "Block anyway" on a suggestion is offered as the red, danger-styled action: only when its family's
 * suggestion-tier record is known (at least RECORD_MIN_CARDS labelled) and at least half accepted. Otherwise the
 * Studio offers a neutral "Block…" (still confirmed, still `--block --force`) [STRICT: an unknown record is not a good one].
 */
export function forceBlockIsDanger(row: Pick<ConventionRow, "tier" | "agents">): boolean {
  const r = suggestionRecord(row);
  return !!r && r.n >= RECORD_MIN_CARDS && r.rate >= 0.5;
}

/**
 * The review queue's counts, from one set: `toReview` is what "To review" lists (proposed, and census proposals not yet in the
 * policy), `done` the decided ones (accepted or rejected), `total` both. The progress line, the "To review" tab and the
 * navigation badge all read these, so they never disagree ("2 of 2 reviewed" beside "To review 1").
 */
export function reviewCounts(rows: readonly Pick<ConventionRow, "status">[]): { done: number; toReview: number; total: number; notInPolicy: number } {
  let done = 0;
  let toReview = 0;
  let notInPolicy = 0;
  for (const r of rows) {
    if (r.status === "accepted" || r.status === "rejected") done++;
    else {
      toReview++;
      if (r.status === "not_in_policy") notInPolicy++;
    }
  }
  return { done, toReview, total: done + toReview, notInPolicy };
}

/** The verifier status the Studio shows: `verified by agent (2/3)` or `not verified`; null when verification is off or not reported. */
export function verifyText(row: Pick<ConventionRow, "verify">): string | null {
  const v = row.verify;
  if (!v) return null;
  if (v.state === "passed" && typeof v.passes === "number" && typeof v.samples === "number") return `verified by agent (${v.passes}/${v.samples})`;
  return "not verified";
}

/** The note the Studio shows on a convention agents are not shown (Drift's own words); null when agents are shown it or it is unknown. */
export function agentsHiddenText(row: Pick<ConventionRow, "agents">): string | null {
  const a = row.agents;
  if (!a || a.shown_to_agents !== false) return null;
  return typeof a.text === "string" && a.text ? a.text : "not shown to agents";
}

/** Drift's words for a default-tier block candidate (`drift_mine::admission::CANDIDATE_TEXT`, decision D13). */
export const BLOCK_CANDIDATE_TEXT = "block candidate: reaches agents once you accept it";

/**
 * Whether the Studio marks a convention as a block candidate (decision D13): Drift reported reason `candidate` (a
 * default-tier card no person has accepted: not shown to agents until accepted). Never for an accepted or a rejected
 * row, whose census record predates the decision; never when Drift did not say (older drift).
 */
export function isBlockCandidate(row: Pick<ConventionRow, "agents" | "status">): boolean {
  // A proposal only (`drift review --json` asks proposed default-tier cards): census reports every default-tier card it
  // mined as a candidate, so its record says so of a card a person has since accepted or rejected too.
  return row.agents?.reason === "candidate" && row.agents.shown_to_agents === false && (row.status === "proposed" || row.status === "not_in_policy");
}

/**
 * The Python proposals state census reports (decision D13-py): `off` while census says so (`python_proposals`, with how
 * many it did not make), `on_or_older` when it says nothing (the default, or an older drift that always made them), null
 * without a census.
 */
export type PythonProposalsState = { state: "off"; withheld: number; optIn: string } | { state: "on_or_older" };

export function pythonProposals(census: Pick<Census, "python_proposals"> | null | undefined): PythonProposalsState | null {
  if (!census) return null;
  const p = census.python_proposals;
  if (!p || typeof p !== "object") return { state: "on_or_older" };
  const withheld = typeof p.withheld === "number" && p.withheld >= 0 ? p.withheld : 0;
  const optIn = typeof p.opt_in === "string" && p.opt_in ? p.opt_in : "proposals: {python: on} in .drift/config.yaml";
  return { state: "off", withheld, optIn };
}

/** What the Conventions view says while Python proposals are off (a person's `proposals: {python: off}`, or a Drift from when off was the default) and census withheld some; null otherwise. */
export function pythonProposalsText(p: PythonProposalsState | null | undefined): string | null {
  if (!p || p.state !== "off" || p.withheld === 0) return null;
  return `${p.withheld} Python ${p.withheld === 1 ? "proposal" : "proposals"} not made: Python mined proposals are off`;
}

/**
 * Why a convention is a suggestion. `language_advise`: a Python convention (Python advises
 * only, decision D7); `rule_kind_d7`: a decorator, base-class or JSX-wrapper rule, which D7
 * moved out of the default tier; `rule_kind`: any other rule kind outside the default tier's
 * allowlist; `names_package`: the rule's target is a package's symbol (decision D5);
 * `small_role`: the role has fewer members than the default tier needs.
 */
export type TierReason = TierReasonCode;

const TIER_REASONS: TierReason[] = ["language_advise", "rule_kind_d7", "rule_kind", "names_package", "small_role"];

/** D5's default-tier kinds that decision D7 moved to the suggestion tier (`drift_mine::tier::D5_DEFAULT_RULE_KINDS`). */
export const D7_MOVED_RULE_KINDS = ["wrapped_by:decorator", "wrapped_by:extends", "wrapped_by:jsx"];

/**
 * The language of a path (`drift_mine::tier::language_of`): Python for a `.py`/`.pyi` file or a Python package
 * manifest (`pyproject.toml`, `requirements*.txt`, `setup.cfg`, `Pipfile`), TypeScript/JavaScript otherwise. The one
 * place the Studio reads a language off a path: the track-record hints and the tier fallback both use it.
 */
export function conventionLanguage(examplePath: string): "python" | "typescript" {
  const path = examplePath.split("#")[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return ext === "py" || ext === "pyi" || name === "pyproject.toml" || name === "setup.cfg" || name === "Pipfile" || (name.startsWith("requirements") && name.endsWith(".txt")) ? "python" : "typescript";
}

/**
 * The language the tier reads for a convention (decision D7), as `tier`'s code (`ts` | `py`): the CLI's own
 * `language` (census and check JSON: Python when any member of the role is Python), else conventions.yaml's
 * `evidence.python_members`, else the example's path; null when none of them is known.
 */
export function tierLanguage(reported: unknown, evidence: Evidence | null | undefined, examplePath: string | null | undefined): "ts" | "py" | null {
  if (reported === "ts" || reported === "py") return reported;
  if ((evidence?.python_members ?? 0) > 0) return "py";
  if (examplePath == null || examplePath === "") return null;
  return conventionLanguage(examplePath) === "python" ? "py" : "ts";
}

/**
 * The tier reason: the CLI's own `tier_reason` when it reports one; otherwise read off the
 * JSON it does report (the default tier's languages, rule-kind allowlist and member threshold
 * in census `params.tier`, and the convention's language, `tierLanguage`), in the product's
 * order: language, rule kind, target, role size. Never from summary text. Under a tier with
 * languages, an unknown language gives no reason (a Python rule must not read as a kind reason).
 */
export function tierReason(tier: Tier | null, ruleKind: string | null, members: number, census: Census | null, reported?: unknown, language?: "ts" | "py" | null, namesPackage?: boolean): TierReason | null {
  if (tier !== "suggestion") return null;
  if (typeof reported === "string" && (TIER_REASONS as string[]).includes(reported)) return reported as TierReason;
  const def = census?.params?.tier;
  if (!def) return null;
  // D7: a language outside the default tier's languages (Python) advises only, whatever the rule.
  if (def.default_languages) {
    if (language == null) return null;
    if (!def.default_languages.includes(language)) return "language_advise";
  }
  if (!ruleKind) return null;
  if (!def.default_rule_kinds.includes(ruleKind)) return def.decision === "D7" && D7_MOVED_RULE_KINDS.includes(ruleKind) ? "rule_kind_d7" : "rule_kind";
  if (namesPackage) return "names_package";
  if (members < def.min_members) return "small_role";
  // D5: a default-tier kind in a large enough role is a suggestion only because of its target.
  if (def.target === "in_repo") return "names_package";
  return null;
}

/** Census `unchecked_members` (#32) as the Conventions view says it; null when there are none. */
export function uncheckedMembersText(n: number | null | undefined): string | null {
  if (!n || n < 1) return null;
  return `${n} ${n === 1 ? "member" : "members"} not checked (file too large to parse)`;
}

/** Census `unchecked` (#32): files left out of every count, as the Conventions view says it; null when there are none. */
export function uncheckedFilesText(paths: readonly string[] | null | undefined): string | null {
  const n = paths?.length ?? 0;
  if (!n) return null;
  return `${n} ${n === 1 ? "file" : "files"} not checked (file too large to parse)`;
}

/** A reported `agents` object, or null when absent or malformed. */
function agentsView(v: unknown): AgentsView | null {
  if (!v || typeof v !== "object") return null;
  const a = v as AgentsView;
  return typeof a.shown_to_agents === "boolean" && typeof a.text === "string" ? a : null;
}

/** A reported `verify` object, or null when absent or malformed. */
function verifyView(v: unknown): VerifyView | null {
  if (!v || typeof v !== "object") return null;
  const x = v as VerifyView;
  return typeof x.state === "string" && typeof x.text === "string" ? x : null;
}

/** Roles with fewer members may advise but never block (MIN_BLOCK_ROLE_SIZE). */
export const MIN_BLOCK_ROLE_SIZE = 15;

/**
 * Whether Drift's show policy hides this policy convention (crates/drift-mine/src/show.rs, eval/study/PLAN-R10.md §4): a
 * proposal no person decided (no `agents` choice, not a wiring rule) that an older drift wrote to conventions.yaml, of a
 * card the product no longer shows. A drift with the show policy drops such a proposal when it reads the file, so its
 * `check --format json` `conventions[]` (every policy convention as Drift reads it) leaves it out, and census does not
 * propose it. The Studio reads the file itself, so it leaves it out on the same evidence: listed in neither. A check
 * report without `conventions[]` (an older drift) hides nothing.
 */
export function hiddenByShowPolicy(c: ConventionsFile["conventions"][number], census: Census | null, check: CheckReport | null): boolean {
  // A proposal from Drift's map of the code goes through none of mining's gates, the show policy among them.
  if (c.status !== "proposed" || c.agents != null || c.from_map != null || isWiringRule(c.rule) || !Array.isArray(check?.conventions)) return false;
  if (check.conventions.some((k) => k.id === c.id)) return false;
  return !(census?.proposals ?? []).some((p) => p.id === c.id);
}

export function conventionRows(policy: ConventionsFile | null, census: Census | null, check: CheckReport | null = null): ConventionRow[] {
  const byId = new Map<string, CensusProposal>((census?.proposals ?? []).map((p) => [p.id, p]));
  const checked = new Map<string, CheckConvention>((check?.conventions ?? []).map((c) => [c.id, c]));
  const minBlock = census?.params?.min_block_role_size ?? MIN_BLOCK_ROLE_SIZE;
  // Older drift has no `conventions` in check: the violations still carry the effective mode.
  const violationMode = new Map<string, string>();
  for (const v of check?.violations ?? []) violationMode.set(v.id, v.mode);
  // `check --format json` `exempt` (#45): only base-class, decorator and wrapper conventions, omitted when empty.
  const checkExempt = new Map<string, Exempt[]>();
  for (const e of Array.isArray(check?.exempt) ? check.exempt : []) {
    if (!e || typeof e.id !== "string" || typeof e.path !== "string" || typeof e.symbol !== "string" || typeof e.line !== "number" || typeof e.reason !== "string") continue;
    const list = checkExempt.get(e.id) ?? [];
    list.push({ path: e.path, symbol: e.symbol, line: e.line, reason: e.reason, ...(typeof e.code === "string" ? { code: e.code } : {}) });
    checkExempt.set(e.id, list);
  }
  const rows: ConventionRow[] = [];
  const seen = new Set<string>();
  for (const c of policy?.conventions ?? []) {
    // Gone, not deferred (PLAN-R10 §6): a proposal the show policy hides is not a row anywhere.
    if (hiddenByShowPolicy(c, census, check)) continue;
    const p = byId.get(c.id);
    const k = checked.get(c.id);
    const ex = splitKey(c.example);
    const members = p?.role.members ?? k?.members ?? c.evidence.total;
    const tier = p?.tier ?? k?.tier ?? null;
    const ruleKind = p?.rule_kind ?? k?.rule_kind ?? null;
    const language = tierLanguage(p?.language ?? k?.language, p?.evidence ?? c.evidence, p?.example.path ?? ex.path);
    const effectiveMode: Mode = k?.effective_mode ?? (violationMode.get(c.id) === "block" ? "block" : violationMode.has(c.id) ? "advise" : c.mode === "block" && members < minBlock ? "advise" : c.mode);
    // Members a person set apart as a different kind (the one question): census mines afresh and still lists them as
    // outliers; drift check (and `drift review --show`) applies the policy and lists them as exempt, code
    // `different_kind`. As review does: not outliers, but members the rule is not about [STRICT: only those check
    // exempts, so an entry point that was not confirmed stays an outlier].
    const apart = (checkExempt.get(c.id) ?? []).filter((e) => e.code === "different_kind");
    const apartKeys = new Set(apart.map(memberKey));
    const outliers = p ? p.outliers.filter((o) => !apartKeys.has(memberKey(o))) : null;
    const censusExempt = new Set((p?.exempt ?? []).map(memberKey));
    rows.push({
      id: c.id,
      status: c.status,
      mode: c.mode,
      summary: c.summary,
      role: c.role,
      rule: c.rule,
      family: ruleFamily(c.rule),
      // The policy file holds the evidence refreshed at the last `drift init`;
      // census is fresher when present.
      evidence: p?.evidence ?? c.evidence,
      example: p ? { ...p.example } : { path: ex.path, symbol: ex.symbol, line: null },
      outliers,
      outliersTotal: p ? Math.max(0, p.outliers_total - (p.outliers.length - outliers!.length)) : null,
      // Wiring rules never block (drift review --block refuses them, even with --force).
      blockable: isWiringRule(c.rule) ? false : (p?.blockable ?? c.evidence.total >= minBlock),
      rank: p?.rank ?? null,
      members,
      tier,
      tierReason: tierReason(tier, ruleKind, members, census, p?.tier_reason ?? k?.tier_reason, language, p?.names_package ?? k?.names_package),
      language,
      ruleKind,
      namesPackage: p?.names_package ?? k?.names_package ?? false,
      keyType: p?.key_type ?? null,
      exempt: p ? [...(p.exempt ?? []), ...apart.filter((e) => !censusExempt.has(memberKey(e)))] : (checkExempt.get(c.id) ?? null),
      inherited: p ? (p.inherited ?? []) : null,
      derived: p ? (p.derived ?? []) : null,
      effectiveMode: isWiringRule(c.rule) ? "advise" : effectiveMode,
      experimental: isWiringRule(c.rule),
      wiring: p?.wiring ?? null,
      uncheckedMembers: p?.unchecked_members ?? 0,
      agents: agentsView(k?.agents) ?? agentsView(p?.agents),
      verify: verifyView(k?.verify),
      exceptions: c.exceptions ?? [],
      differentKind: c.different_kind ?? [],
      promotedFromPractice: c.promoted_from_practice ?? null,
      fromMap: fromMapOf(c.from_map ?? p?.from_map),
    });
    seen.add(c.id);
  }
  for (const p of census?.proposals ?? []) {
    if (seen.has(p.id)) continue;
    const language = tierLanguage(p.language, p.evidence, p.example.path);
    rows.push({
      id: p.id,
      status: "not_in_policy",
      mode: "advise",
      summary: p.summary,
      role: p.role,
      rule: p.rule,
      family: ruleFamily(p.rule),
      evidence: p.evidence,
      example: { ...p.example },
      outliers: p.outliers,
      outliersTotal: p.outliers_total,
      blockable: isWiringRule(p.rule) ? false : p.blockable,
      rank: p.rank,
      members: p.role.members,
      tier: p.tier ?? null,
      tierReason: tierReason(p.tier ?? null, p.rule_kind ?? null, p.role.members, census, p.tier_reason, language, p.names_package),
      language,
      ruleKind: p.rule_kind ?? null,
      namesPackage: p.names_package ?? false,
      keyType: p.key_type ?? null,
      exempt: p.exempt ?? [],
      inherited: p.inherited ?? [],
      derived: p.derived ?? [],
      effectiveMode: "advise",
      experimental: isWiringRule(p.rule),
      wiring: p.wiring ?? null,
      uncheckedMembers: p.unchecked_members ?? 0,
      agents: agentsView(p.agents),
      verify: null,
      exceptions: [],
      differentKind: [],
      promotedFromPractice: null,
      fromMap: fromMapOf(p.from_map),
    });
  }
  return rows;
}

export interface ConventionCounts {
  proposed: number;
  accepted: number;
  /** Accepted conventions drift check blocks on: the effective mode (`check --format json` `effective_mode`), not the policy's. */
  blocking: number;
  /** Accepted with `mode: block` in the policy but advising, because the role is too small to block. */
  blockInPolicyOnly: number;
  rejected: number;
  notInPolicy: number;
}

export function countConventions(rows: ConventionRow[]): ConventionCounts {
  const n = { proposed: 0, accepted: 0, blocking: 0, blockInPolicyOnly: 0, rejected: 0, notInPolicy: 0 };
  for (const r of rows) {
    if (r.status === "accepted") {
      n.accepted++;
      if (r.effectiveMode === "block") n.blocking++;
      else if (r.mode === "block") n.blockInPolicyOnly++;
    } else if (r.status === "proposed") n.proposed++;
    else if (r.status === "rejected") n.rejected++;
    else n.notInPolicy++;
  }
  return n;
}

/** A review decision, as `drift review` flags (`force_block` is `--block --force`). */
export type Decision = "accept" | "reject" | "block" | "force_block" | "advise";

/** The decision `b` makes: suggestions block only with `--force`, after a person confirms it. */
export function blockDecision(row: ConventionRow): Decision {
  return row.tier === "suggestion" && row.blockable ? "force_block" : "block";
}

/** Blocking in name only: the policy says block, the role is too small, so check advises. */
export function blocksInNameOnly(row: ConventionRow): boolean {
  return row.status === "accepted" && row.mode === "block" && row.effectiveMode === "advise";
}

/** What a decision will do, said plainly for the confirmation dialog. */
export function describeDecision(d: Decision, row: ConventionRow): string {
  switch (d) {
    case "accept":
      return row.status === "accepted" && row.mode === "block"
        ? `Accept ${row.id}: it stays in block mode (drift review --accept keeps the mode).`
        : `Accept ${row.id}: drift check and agent hooks will advise on new violations.`;
    case "reject":
      return `Reject ${row.id}: it will never be proposed again.`;
    case "block":
      return row.blockable
        ? `Accept ${row.id} in block mode: new violations fail drift check and block the agent's turn.`
        : `Accept ${row.id}: its role has ${row.members} members (blocking needs ${MIN_BLOCK_ROLE_SIZE}), so Drift will accept it as advise.`;
    case "force_block":
      return `Block ${row.id} although it is a suggestion (drift review --block --force): suggestions are weaker conventions, so its new violations would fail drift check and block agents on advice-grade evidence.`;
    case "advise":
      return `Set ${row.id} back to advise: it stays accepted; new violations are reported but never fail drift check.`;
  }
}

/** Why a suggestion is a suggestion, in words. */
export function tierReasonText(row: Pick<ConventionRow, "tierReason" | "ruleKind" | "members">, minMembers = MIN_BLOCK_ROLE_SIZE): string | null {
  switch (row.tierReason) {
    case "language_advise":
      return "Python conventions advise only (decision D7)";
    case "rule_kind_d7":
      return `decorators, base classes and JSX wrappers are suggestions since decision D7${row.ruleKind ? ` (${row.ruleKind})` : ""}`;
    case "rule_kind":
      return `rule kind is suggestion-only${row.ruleKind ? ` (${row.ruleKind})` : ""}`;
    case "names_package":
      return "names a package symbol";
    case "small_role":
      return `${row.members} members; the default tier needs ${minMembers}`;
    default:
      return null;
  }
}

/**
 * A convention's language (D7) for people: the tag and what it means. `python_members` (census
 * evidence) says how many of the role's members made it Python; null when the language is unknown.
 */
export function languageText(language: "ts" | "py" | null, evidence?: Pick<Evidence, "python_members"> | null, members?: number): { label: string; why: string } | null {
  if (language === "py") {
    const n = evidence?.python_members;
    const some = n != null && members != null && n < members ? `${n} of its ${members} members are Python` : "its members are Python";
    return { label: "Python", why: `A Python convention: ${some}, and under decision D7 a convention with any Python member advises only.` };
  }
  if (language === "ts") return { label: "TypeScript/JavaScript", why: "A TypeScript/JavaScript convention: no member of its role is Python, so decision D7's default tier (call wrappers and layering) can hold it." };
  return null;
}

/** Why a check violation's convention is a suggestion, in words (`check --format json` `conventions[]`, which carries the CLI's own reason). */
export function checkTierReasonText(c: CheckConvention | null | undefined, minMembers = MIN_BLOCK_ROLE_SIZE): string | null {
  if (!c || c.tier !== "suggestion") return null;
  const reason = tierReason(c.tier, c.rule_kind ?? null, c.members, null, c.tier_reason, c.language ?? null, c.names_package);
  return tierReasonText({ tierReason: reason, ruleKind: c.rule_kind ?? null, members: c.members }, minMembers);
}

/** What the callee's parameter type says about a `passes_key` rule's key, for a reviewer. */
export function keyTypeText(k: KeyType | null, key: string): string | null {
  switch (k) {
    case "required":
      return `The callee's parameter type requires \`${key}\`: the compiler already enforces it, so this convention mostly names the key.`;
    case "optional":
      return `The callee's parameter type makes \`${key}\` optional: passing it is the team's choice, which this convention records.`;
    case "mixed":
      return `The callee's parameter type requires \`${key}\` at some calls and not at others.`;
    case "unknown":
      return `Drift could not read the callee's parameter type (no annotation, a union, or an uninstalled package).`;
    default:
      return null;
  }
}
