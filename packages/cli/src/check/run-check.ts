import {
  SIDE_EFFECT_IMPORT_BINDING,
  SecurityBoundaryProofSchema,
  authorizeContextExport,
  type CanonicalHelperReuseAgentContract,
  type CheckRun,
  type FactRecord,
  type FileRole,
  type Finding,
  type AcceptedConvention,
  type MachineContractVersions,
  type RequiredCheckExecution,
  type RepoContract,
  type SecurityBoundaryProof
} from "@drift/core";
import { buildEntrypointFlowProof,buildReadiness, scoreHelperSimilarity } from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { conformingExemplars,migrationSentence } from "@drift/core";
import { contractStaleness,contractStalenessWarnings } from "./contract-liveness.js";
import { EvaluationReceiptLedger,silentConventionReceipts } from "./evaluation-receipts.js";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { DriftError } from "../app/drift-error.js";
import { actorFlag,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { isClosedFindingStatus,preservedGovernanceStatus,reviewFinding } from "../domain/findings.js";
import { auditEvent,preflightGovernance } from "../domain/governance.js";
import { checkRunIdsFor,contractFingerprint,hashStable } from "../domain/identifiers.js";
import { WaivedFinding } from "../domain/preflight.js";
import { assertEnforceableContract,isApiRoutePath,matchesGlob } from "../domain/repo-paths.js";
import { importCoverageReport } from "../domain/import-coverage.js";
import { parserGapsFromDiagnostics } from "../domain/scan-status.js";
import { currentMachineContractVersions } from "../domain/versions.js";
import { collectScanData,type ScanData } from "../engine/collect-scan-data.js";
import { cleanupScanReuseManifest,createScanReuseManifest,latestIndexedScan,resolverInputFingerprint } from "../domain/scan-status.js";
import { runEngineCheck } from "../engine/engine-check.js";
import { ENGINE_TIMEOUT_FAILURE_CODE,isEngineTimeoutError } from "../engine/rust-engine.js";
import { extractImports,importFactsForFile } from "../engine/fact-extraction.js";

/**
 * Exit-code contract for `drift check`.
 *
 *   0  pass     - no blocking violation in scope
 *   2  blocked  - a new violation in a changed hunk under a block-mode convention
 *   3  refused  - fail-closed: enforcement could not be performed (engine unavailable,
 *                 stale scan, missing contract), so no pass claim is made
 *   1  error    - operational failure inside drift itself
 *
 * `blocked` is deliberately distinct from `error` so CI can distinguish "this diff
 * violates the contract" from "drift broke", and so a crash can never be mistaken for a
 * clean run.
 */
export const CHECK_EXIT_PASS = 0;
export const CHECK_EXIT_ERROR = 1;
export const CHECK_EXIT_BLOCKED = 2;
export const CHECK_EXIT_REFUSED = 3;

/**
 * BB-1: name the likely cause of an empty diff scope, to the same standard as the shallow-clone
 * refusal at `diff.ts:48` - a refusal a user cannot act on is barely better than a false pass.
 *
 * Which causes are plausible depends on how the scope was specified, so the message is built from
 * the flags rather than listing all of them every time.
 */
function emptyDiffScopeCauses(parsed: ParsedArgs): string {
  const diffFile = stringFlag(parsed, "diff-file");
  if (diffFile) {
    return `The diff file ${diffFile} contains no changed files. Regenerate it (git diff --unified=0 > ${diffFile}), or use --scope full to check the whole repository.`;
  }
  const range = stringFlag(parsed, "diff");
  if (range) {
    return `The range ${range} produced no changed files: it may name one commit twice (git diff HEAD on a clean tree), reference a merged branch, or your changes may be unstaged - git diff --unified=0 ${range} shows exactly what Drift saw. For uncommitted working-tree changes use --diff-file, and to check the whole repository use --scope full.`;
  }
  return "No --diff range or --diff-file was resolvable to changed files. Pass --diff <range>, --diff-file <path>, or --scope full.";
}
import { formatCheckText } from "../formatters/checks.js";
import { fileContentHash } from "../io/file-hash.js";
import { diffStatusFor,filesForConvention,fullRepoDiff,loadDiff,parseUnifiedDiff } from "./diff.js";
import {
  agentContractFindingFingerprint,
  canonicalHelperReuseFindingFingerprint,
  findingFingerprint
} from "./finding-fingerprint.js";
import { enforcementResultFor,isActiveConvention,isForbiddenImport } from "./rule-evaluation.js";
import { findContractWaiverForImport,isExceptedImport,isExceptedPath,waiverRequiresReapproval } from "./waivers.js";


/**
 * The symbol to publish in an evidence payload, given an import fact's local name.
 *
 * S10: a bindingless `import "@/lib/prisma";` binds nothing, and the engine records its local
 * name as the `(side-effect)` sentinel so binding-keyed lookups have a key that cannot collide
 * with a real identifier. That key is an implementation detail. Published as `symbol` it would
 * be a name the user can neither find in their file nor search for, and `EvidenceRefSchema`
 * makes `symbol` optional precisely so "there is no symbol" is expressible - so express it.
 *
 * Note the shape: absent, not empty string. `symbol` is `z.string().min(1)`, so a `?? ""`
 * stand-in would fail validation instead of degrading quietly.
 */
function evidenceSymbol(name: string | undefined): string | undefined {
  return name === undefined || name === SIDE_EFFECT_IMPORT_BINDING ? undefined : name;
}

/**
 * How to name what a file imported, in prose.
 *
 * With a binding: "prisma from @/lib/prisma". Without one, naming the sentinel would be a lie,
 * and there is nothing to name but the module itself.
 */
function importPhrase(name: string, source: string): string {
  return name === SIDE_EFFECT_IMPORT_BINDING
    ? `${source} for its side effects`
    : `${name} from ${source}`;
}

/**
 * The direct-data-access violation sentence. Kept identical to the engine's
 * (`direct_data_access_message` in crates/drift-engine/src/rules.rs) so the fallback path and
 * the engine path do not describe the same violation two ways.
 */
function directDataAccessMessage(filePath: string, name: string, source: string | undefined): string {
  const specifier = source ?? "";
  if (name === SIDE_EFFECT_IMPORT_BINDING) {
    return `${filePath} imports ${specifier} for its side effects, executing the data-access module directly; route modules should delegate through the accepted service/data-access layer.`;
  }
  return `${filePath} imports ${name} from ${specifier} directly; route modules should delegate through the accepted service/data-access layer.`;
}

/**
 * S1-01: was enforcement silently weakened by incomplete coverage?
 *
 * The engine zeroes every finding's `enforcement_result` when any API-route file in the checked
 * scope carries an unresolved-import diagnostic - one boolean for the whole check
 * (check_command.rs:37, applied at :276). Verified consequence at a48ac41: a new violating route
 * alone exits 2 with `enforcement_result: "block"`; add an adjacent route whose only sin is a
 * namespace import of a real workspace package, and the same violation comes back `"none"` and the
 * check exits 0. The violation did not change. Uncertainty was reported as success.
 *
 * The engine's demotion is contract-mandated - engine-contract only objects when some finding is
 * `"block"`, so an all-`"none"` payload is legal at any completeness. Reporting *pass* is not
 * mandated, and that is what changes here. This deliberately does not touch the demotion itself:
 * per-finding enforcement is a separate problem, and attempting it here reproduces an approach that
 * was already tried and correctly reverted.
 */
export function enforcementDegradedByCompleteness(input: {
  findings: Array<{ enforcement_result: string; convention?: { enforcement_mode?: string } }>;
}): boolean {
  // Detect the *effect*, not the cause.
  //
  // `enforcement_result_for` maps block to "block" and warn to "warn" unconditionally, so a finding
  // under a block- or warn-mode convention can only carry "none" because something zeroed it. That
  // makes the findings an exact signal and needs no plumbing.
  //
  // The plan proposed reading `checkData.completeness` instead. That is the *scan's* completeness,
  // and measured on the repro it reports `can_block: true, complete: true, reasons: []` while the
  // finding is already demoted - the demotion happens inside check-repo, whose completeness is a
  // separate measurement the CLI discards. Reading the scan's would have produced a fix that never
  // fires, which is worse than no fix.
  return input.findings.some(
    (finding) =>
      finding.enforcement_result === "none" &&
      (finding.convention?.enforcement_mode === "block" ||
        finding.convention?.enforcement_mode === "warn")
  );
}

/**
 * The exit code, as one decision.
 *
 * A real block still wins over a refusal: degradation must not mask a violation Drift did manage to
 * establish. Otherwise incomplete coverage refuses rather than passing.
 */
export function checkExitCodeFor(input: {
  blockingCount: number;
  enforcementDegraded: boolean;
  /**
   * BB-4: `--strict-contract` and a contract whose trigger resolves to nothing.
   *
   * Required, not optional, and deliberately so. This term used to live at the return statement of
   * `runCheck`, added to the exit code and to nothing else - which is how exit 3 came to sit beside
   * `check.status: "pass"` again, the exact B-3 shape the two functions below were written to make
   * impossible. A term a caller can forget to mention is a term that will diverge; making it
   * mandatory means a new call site has to answer the question rather than omit it.
   */
  contractStaleRefusal: boolean;
  /**
   * W8-1: a block-mode contract was asked to enforce through `--scope full`, which cannot block.
   *
   * Mandatory for the same reason as `contractStaleRefusal` above.
   */
  fullScopeCannotBlockRefusal: boolean;
  // The return type is the narrow union rather than `number` on purpose. `checkStatusFor` switches
  // on this value, and while it was typed `number` its `default:` arm swallowed anything that was
  // not 2 or 3 - so CHECK_EXIT_ERROR would have been reported as `status: "pass"`, an operational
  // failure labelled a clean run (D-C2). Naming the three verdicts this function can produce makes
  // that arm unreachable by construction, and makes adding a fourth a compile error rather than a
  // silent pass.
}): typeof CHECK_EXIT_PASS | typeof CHECK_EXIT_BLOCKED | typeof CHECK_EXIT_REFUSED {
  if (input.blockingCount > 0) {
    return CHECK_EXIT_BLOCKED;
  }
  return input.enforcementDegraded || input.contractStaleRefusal || input.fullScopeCannotBlockRefusal
    ? CHECK_EXIT_REFUSED
    : CHECK_EXIT_PASS;
}

/**
 * The persisted/reported status, from the same inputs as the exit code (E-1 / S1-02).
 *
 * B-3's shape was exit 3 alongside `check.status: "pass"`: the exit code told the truth
 * and the JSON did not, and the consumers Drift is built for - MCP, agents, CI steps
 * parsing the payload - read `check.status`, not `$?`. One decision, shared inputs, so
 * the two can never diverge again.
 */
export function checkStatusFor(input: {
  blockingCount: number;
  enforcementDegraded: boolean;
  contractStaleRefusal: boolean;
  fullScopeCannotBlockRefusal: boolean;
}): "pass" | "fail" | "refused" {
  const exitCode = checkExitCodeFor(input);
  switch (exitCode) {
    case CHECK_EXIT_BLOCKED:
      return "fail";
    case CHECK_EXIT_REFUSED:
      return "refused";
    case CHECK_EXIT_PASS:
      return "pass";
    default: {
      // Unreachable while checkExitCodeFor returns its three-verdict union, and typed so the
      // compiler agrees: `never` here fails the build the moment a fourth code is added without a
      // status to go with it. The previous `default: return "pass"` would have accepted it and
      // called it a clean run.
      const unreachable: never = exitCode;
      throw new Error(`Unmapped check exit code: ${String(unreachable)}`);
    }
  }
}

/**
 * W8-2: the machine-readable cause of a refusal, in the field CI already reads.
 *
 * Exit 3 says "Drift declined to answer". It does not say why, and the reason decides what the
 * operator does next: a stale contract is a configuration problem in the pipeline, a coverage gap
 * is a repo shape Drift half-understands, an unavailable engine is an install problem. Drift's own
 * reference workflow (.github/workflows/drift-check-self.yml) already branches on
 * `.failure.code` - and for the two refusals `check` returns rather than throws, that key was
 * absent, so the workflow printed "refusal, not a pass: unknown" and the operator learned nothing.
 *
 * Named `failure` and shaped like the top-level handler's own failure envelope
 * (packages/cli/src/app/failure-classification.ts) on purpose: a consumer reads one path whether
 * the refusal was thrown or returned. `type: "refusal"` is stated rather than implied, because
 * exit 3 is the only other thing carrying it and a payload read out of context has no exit code.
 */
export interface CheckFailure {
  code: string;
  type: "refusal";
  message: string;
  /** What the operator should do about it, in one sentence. */
  remediation: string;
  /** Commands that address it, in the order worth trying. */
  recovery_commands: string[];
}

/**
 * W8-1: `--scope full` structurally cannot block, so a block-mode contract must not be checked
 * through it.
 *
 * `diffStatusFor` answers `touched_existing` for every finding when the scope is `full`
 * (diff.ts), and `fullRepoDiff` marks every file `isAdded: false`, so the added-file rule that
 * would otherwise say `new_in_diff` never fires either. Only `new_in_diff` findings reach
 * `blocking_count`. Exit 2 is therefore unreachable under `--scope full` - not rare, unreachable -
 * while every doc lists the flag as an ordinary option and `drift check --scope full` on a repo
 * with a block-mode convention and a real violation exits 0.
 *
 * A gate that is green by construction is worse than no gate, so this refuses instead. Refusing
 * rather than teaching `full` to block is deliberate: whole-repo blocking is a design question
 * (what is "new" when there is no diff?) and the wrong answer would block a repo's entire
 * pre-existing debt on the first run. Failing closed states the limitation without inventing a
 * verdict.
 *
 * Warn-mode contracts are unaffected: they never claimed to block, `--scope full` reports their
 * findings honestly, and refusing them would remove the one scope in which a repo-wide inventory
 * is available.
 */
export function blockModeConventionsUnenforceableAtFullScope(input: {
  scope: string;
  conventions: Array<{ id: string; enforcement_mode?: string; expires_at?: string | null }>;
  now: string;
}): string[] {
  if (input.scope !== "full") {
    return [];
  }
  return input.conventions
    .filter(
      (convention) =>
        convention.enforcement_mode === "block" &&
        // An expired convention enforces nothing in any scope, so it is not what is being
        // silently disabled here and must not trigger the refusal.
        (!convention.expires_at || convention.expires_at > input.now)
    )
    .map((convention) => convention.id)
    .sort();
}

/**
 * The refusal's own code, from the same inputs that decided the exit code.
 *
 * Returns `undefined` when the run is not a refusal, so the key's presence in the payload is
 * itself the signal - the house pattern for `contract_staleness` and `enforcement_demotions`.
 *
 * The order matters and is not alphabetical. `full_scope_cannot_block` is a property of the
 * invocation and holds no matter what the run found, so it is named first; the other two describe
 * what happened during a run that was at least capable of blocking.
 */
export function checkRefusalFailureFor(input: {
  blockingCount: number;
  fullScopeCannotBlockRefusal: boolean;
  blockModeConventionIds: string[];
  enforcementDegraded: boolean;
  coverageGapReasons: string[];
  contractStaleRefusal: boolean;
  repoId: string;
}): CheckFailure | undefined {
  // A real block outranks a refusal (checkExitCodeFor), so a blocking run has no refusal to
  // explain. Emitting one here would contradict exit 2.
  if (input.blockingCount > 0) {
    return undefined;
  }
  if (input.fullScopeCannotBlockRefusal) {
    return {
      code: "full_scope_cannot_block",
      type: "refusal",
      message:
        `--scope full cannot block: it attributes every finding to touched_existing, and only new_in_diff findings count toward blocking_count, so exit 2 is unreachable. ` +
        `${input.blockModeConventionIds.length} block-mode convention(s) would have been enforced and were not: ${input.blockModeConventionIds.join(", ")}.`,
      remediation:
        "Run the check with --scope changed-hunks (or --scope changed-files) and a --diff range or --diff-file, which is the scope in which a block-mode convention can actually block.",
      recovery_commands: [
        `drift check --diff <range> --scope changed-hunks --repo ${input.repoId} --json`,
        `drift conventions list --repo ${input.repoId} --json`
      ]
    };
  }
  if (input.enforcementDegraded) {
    return {
      code: "enforcement_degraded_by_incomplete_coverage",
      type: "refusal",
      message:
        "A finding under an enforcing convention came back with enforcement_result \"none\", which means coverage gaps zeroed it. No pass claim is made over a check whose enforcement was silently withdrawn." +
        (input.coverageGapReasons.length > 0 ? ` Coverage gaps: ${input.coverageGapReasons.join(", ")}.` : ""),
      remediation:
        "Resolve the imports named in summary.blocked_reasons - usually a path alias Drift cannot follow or a file written before the module it imports - then rerun the check.",
      recovery_commands: [
        `drift doctor --repo ${input.repoId} --json`,
        `drift scan status --repo ${input.repoId} --json`
      ]
    };
  }
  if (input.contractStaleRefusal) {
    return {
      code: "contract_stale_under_strict",
      type: "refusal",
      message:
        "--strict-contract was passed and this contract's forbidden specifiers no longer match anything in the repo, so the gate enforces nothing.",
      remediation:
        "Update or retire the dead conventions named in summary.contract_staleness, or drop --strict-contract to accept a contract whose trigger is unplugged.",
      recovery_commands: [`drift conventions list --repo ${input.repoId} --json`]
    };
  }
  return undefined;
}

export async function runCheck(storage: SqliteDriftStorage, parsed: ParsedArgs): Promise<CommandPayload> {
  const repoId = resolveRepoId(parsed);
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }
  assertEnforceableContract(storage, repoId, contract);
  const policy = authorizeContextExport(contract, "cli-check");
  if (!policy.allowed) {
    throw new Error(`Policy denied check output: ${policy.reason}`);
  }
  // E-6 (D-2): while a convention runs weaker than block because something demoted it,
  // every check says so. A block -> warn transition that only lives in the audit log is
  // still effectively silent for the consumers that matter (agents and CI read this JSON).
  const enforcementDemotions = enforcementDemotionsForContract(storage, repoId, contract);

  const scope = stringFlag(parsed, "scope") ?? "changed-hunks";
  if (!["changed-hunks", "changed-files", "full"].includes(scope)) {
    throw new Error("--scope must be changed-hunks, changed-files, or full.");
  }

  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  // W8-1: decided here, once, from the invocation and the contract - both of which are known
  // before anything is scanned. Consumed by the exit code, the status and the failure object from
  // this one variable, so they cannot disagree.
  const blockModeConventionIds = blockModeConventionsUnenforceableAtFullScope({
    scope,
    conventions: contract.conventions,
    now
  });
  const fullScopeCannotBlockRefusal = blockModeConventionIds.length > 0;
  const { checkId, checkScanId } = checkRunIdsFor(repoId, scope, now);
  const contractFingerprintValue = contractFingerprint(contract);
  const machineContractVersions = currentMachineContractVersions();
  const rawDiff = scope === "full" ? null : loadDiff(repo.root_path, parsed);
  // BB-9 reassigns this to drop files missing from the working tree, so it is `let`.
  let parsedDiff = scope === "full"
    ? fullRepoDiff(repo.root_path)
    : parseUnifiedDiff(rawDiff ?? "");
  // BB-1: a check that examined nothing must not be indistinguishable from a clean check.
  //
  // Verified at b5c3c230: a clean tree with `--diff HEAD` returned `status: "pass"`, exit 0,
  // `changed_file_count: 0`. The count was in both outputs, but the status and the exit code were
  // byte-identical to a real pass - so a CI job or hook wired with a wrong diff spec is green
  // forever, and nothing machine-readable separates "nothing violated" from "nothing examined".
  // For a product whose exit-code contract is its brand, that was the missing fourth state.
  //
  // Refusal rather than warning, because a wrong `--diff` spec is a misconfiguration and not a
  // verdict, and fail-closed is the house style. Thrown before the scan: there is nothing to scan,
  // and a refusal that first spends 20s parsing the repo teaches users to distrust it.
  //
  // Deliberately scoped to diff-derived scopes. `--scope full` on a repo with no indexable files is
  // a different statement ("this repo has nothing Drift understands"), which `drift doctor` already
  // covers and which this refusal would mislabel as a bad diff range.
  if (
    scope !== "full" &&
    parsedDiff.files.length === 0 &&
    parsedDiff.deletedFiles.length === 0 &&
    // A pure rename emits only `rename from`/`rename to` and no hunks, so it lands here looking like
    // an empty diff. It is an ordinary refactor with a legitimately empty *content* scope - the same
    // shape as a deletion-only diff, and the bench measured the cost of getting it wrong directly:
    // taxonomy's ordinary-edit refusal rate went 0/8 to 1/8 before this clause existed.
    (parsedDiff.renamedFiles ?? []).length === 0
  ) {
    throw new DriftError(
      `Refusing to report a verdict: the diff scope is empty, so no file was examined. ${emptyDiffScopeCauses(parsed)}`,
      {
        code: "empty_diff_scope",
        userAction:
          "Check the diff range names two different commits, that your changes are staged, or use --diff-file for uncommitted working-tree changes.",
        recoveryCommands: [
          "git diff --name-only <range>",
          "drift check --diff-file <path> --repo <repo_id>",
          "drift check --scope full --repo <repo_id>"
        ],
        safeToRetry: true,
        // Same code as every other fail-closed refusal, so CI can keep one branch for
        // "Drift declined to answer" rather than one per cause.
      }
    );
  }
  // BB-9: a diff can name files that are not in the working tree.
  //
  // Reproduced at 30e2e036: a `--diff-file` patch naming an absent file produced
  // `changed_file_count: 1`, `partial_coverage: {complete: true}`, zero findings, exit 0 - and never
  // mentioned the file. This is BB-1's bug one level up: the scope is non-empty, nothing in it was
  // examinable, and completeness is claimed anyway. Real shapes: CI applying a patch to the wrong
  // checkout, a hook racing a branch switch, a stale patch file.
  //
  // Existence is tested on the filesystem rather than against the scan's file set on purpose. A file
  // that is present but not indexable (a README in the diff) is not missing, and conflating the two
  // would fire this on ordinary diffs.
  //
  // Deleted files are absent by definition and are excluded - they have their own skip path, and
  // double-counting them as "missing" is the trap this had to avoid. Renamed-away old paths never enter
  // `files` (a rename emits no hunks for them), so they need no exclusion.
  const deletedFileSet = new Set(parsedDiff.deletedFiles);
  const missingFromWorktree = scope === "full"
    ? []
    : parsedDiff.files
        .map((file) => file.path)
        .filter((filePath) => !deletedFileSet.has(filePath))
        .filter((filePath) => !existsSync(join(repo.root_path, filePath)))
        .sort();

  if (missingFromWorktree.length > 0 && missingFromWorktree.length === parsedDiff.files.length) {
    // Every named file is gone: there is nothing to examine and no verdict to give. A distinct cause
    // code from `empty_diff_scope`, because the remediations differ - an empty diff means the range is
    // wrong, this means the diff and the tree disagree about what exists.
    throw new DriftError(
      `Refusing to report a verdict: every file named by the diff is missing from the working tree (${missingFromWorktree.join(", ")}), so nothing could be examined.`,
      {
        code: "stale_diff_scope",
        userAction:
          "Regenerate the diff against this checkout, or check out the commit the diff was made against - the diff and the working tree disagree about which files exist.",
        recoveryCommands: [
          "git status --short",
          "git diff --unified=0 <range> > <path>",
          "drift check --scope full --repo <repo_id>"
        ],
        safeToRetry: true,
      }
    );
  }

  if (missingFromWorktree.length > 0) {
    // Some named files are gone. Proceed on the ones that are present - enforcement must not weaken
    // because coverage degraded, so findings on examined files stay findings - but drop the absent ones
    // from the examined set so the counts describe what was actually looked at.
    const missing = new Set(missingFromWorktree);
    parsedDiff = {
      ...parsedDiff,
      files: parsedDiff.files.filter((file) => !missing.has(file.path))
    };
  }

  const diffHash = rawDiff ? hashStable(rawDiff) : "full_scope";
  const baseline = storage.listBaselineViolations(repoId);
  const existingFindings = new Map(
    storage.listFindings(repoId).map((finding) => [finding.fingerprint, finding])
  );
  const expiredFindingsCount = expireFindingsForExpiredConventions(storage, parsed, repoId, contract, now);
  // T45: reuse the previous scan's facts for unchanged files.
  //
  // Without this every `drift check` re-parsed the whole repository through the engine, even for
  // a one-line edit: on formbricks a single-file check took 6.9s, of which 5.1s was the Node
  // process sitting idle waiting on the engine subprocess. That is the difference between a
  // usable edit-time hook and an unusable one.
  //
  // Safe because of T15's version gate - facts produced by a different engine are refused, so
  // reuse can never serve stale extraction after an upgrade.
  const previousScan = latestIndexedScan(storage.listScanManifests(repoId));
  const reuseManifest = createScanReuseManifest({
    storage,
    repoId,
    previousScan,
    currentResolverInputFingerprint: resolverInputFingerprint(repo.root_path)
  });
  let checkData: ScanData;
  try {
    checkData = await collectScanData({
      repoId,
      scanId: checkScanId,
      repoRoot: repo.root_path,
      reuseManifestPath: reuseManifest?.path
    });
  } catch (error) {
    // W8-3: an engine that had to be killed produced no scan, so there is no verdict - but it is a
    // refusal with a stated cause, not an operational error and never a pass. Caught here rather
    // than left to the top-level handler because that handler maps an unrecognised code to
    // `cli_error` and exit 1, which reads as "Drift broke" when what happened is "Drift declined".
    if (isEngineTimeoutError(error)) {
      return engineTimeoutRefusal({
        storage,
        parsed,
        repoId,
        contract,
        contractFingerprintValue,
        checkId,
        checkScanId,
        scope,
        machineContractVersions,
        policy,
        expiredFindingsCount,
        deletedFiles: parsedDiff.deletedFiles,
        error,
        now
      });
    }
    throw error;
  } finally {
    cleanupScanReuseManifest(reuseManifest);
  }
  const snapshotsByPath = new Map(checkData.snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const unindexedContractTargets = unindexedAgentContractTargets(contract, parsedDiff, snapshotsByPath);
  if (checkData.fallbackStatus.fallback_used) {
    const fallbackStatus = fallbackStatusForCheck(checkData);
    const capabilityCompleteness = capabilityCompletenessForCheck(checkData);
    const readiness = readinessForCheck({
      repoId,
      checkScanId,
      checkData,
      capabilityCompleteness,
      now
    });
    // E-1 (S1-02): this path exits CHECK_EXIT_REFUSED with blocked_reasons
    // ["typescript_fallback_used"] - it is a refusal, and it now says so. "blocked" was
    // the pre-refused vocabulary; the enum keeps it only so old stored rows stay readable.
    const check = checkEnvelope({
      checkId,
      repoId,
      contract,
      contractFingerprintValue,
      checkScanId,
      scope,
      status: "refused",
      fallbackStatus,
      capabilityCompleteness,
      machineContractVersions
    });
    storage.upsertCheckRun({
      id: checkId,
      repo_id: repoId,
      repo_contract_id: contract.id,
      contract_fingerprint: contractFingerprintValue,
      scan_id: checkScanId,
      status: "refused",
      scope: scope as "changed-hunks" | "changed-files" | "full",
      engine_source: checkData.engineSource,
      fallback_used: true,
      stale_scan: false,
      capability_complete: false,
      findings_count: 0,
      blocking_count: 0,
      machine_contract_versions: machineContractVersions,
      started_at: now,
      completed_at: now
    });
    const payload = {
      response_schema: "drift.check.result.v1",
      check,
      // W8-2: this refusal already named its cause in `blocked_reasons`, but not in the field a
      // consumer reads first. Every path that returns CHECK_EXIT_REFUSED now carries one, so
      // "refusal with no stated cause" is not a state this command can reach.
      failure: {
        code: "typescript_fallback_used",
        type: "refusal",
        message:
          `The Rust engine could not be used and the degraded TypeScript scanner answered instead, so deterministic enforcement was unavailable: ${checkData.fallbackStatus.engine_error_message ?? "no engine error recorded"}`,
        remediation:
          "Install or point Drift at a trusted drift-engine binary (DRIFT_ENGINE_BIN), then rerun. The TypeScript scanner cannot make an enforcement claim.",
        recovery_commands: ["drift doctor --json", `drift scan status --repo ${repoId} --json`]
      } satisfies CheckFailure,
      readiness,
      machine_contract_versions: machineContractVersions,
      policy,
      governance: preflightGovernance(),
      audit_integrity: storage.verifyAuditChain(repoId),
      summary: {
        repo_id: repoId,
        scope,
        findings_count: 0,
        blocking_count: 0,
        waived_findings_count: 0,
        expired_findings_count: expiredFindingsCount,
        skipped_deleted_files: parsedDiff.deletedFiles,
        engine_source: checkData.engineSource,
        affected_scope: affectedScopeSummary(parsedDiff, scope, missingFromWorktree),
        outcome: checkOutcomeSummary([], {
          waivedFindingsCount: 0,
          expiredFindingsCount,
          scope: scope as "changed-hunks" | "changed-files" | "full"
        }),
        blocked_reasons: ["typescript_fallback_used"],
        ...(enforcementDemotions.length > 0
          ? { enforcement_demotions: enforcementDemotions }
          : {})
      },
      review_items: [],
      waived_findings: [],
      diagnostics: checkData.diagnostics,
      security_boundary_proofs: [],
      next_commands: [
        "drift doctor --json",
        `drift scan status --repo ${repoId} --json`
      ],
      findings: []
    };
    return {
      // Refusal, not a violation and not a crash: the engine could not be used, so no
      // enforcement claim can be made. Fail closed with its own code.
      //
      // This is a CommandPayload exit code, not a DriftError option - `check` returns its verdict
      // rather than throwing it, so nothing about the failure-code table applies here and this
      // line has to stay. Dropping it made an engine-unavailable refusal exit 0, which is the
      // precise failure the surrounding comment exists to prevent.
      exitCode: CHECK_EXIT_REFUSED,
      payload: parsed.flags.has("json") ? payload : formatCheckText(payload)
    };
  }
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  const securityBoundaryProofs: SecurityBoundaryProof[] = [];
  // TDD §5.1.4. An accepted convention the engine cannot read, or reads and then discards
  // entirely, enforces nothing while `check` reports a clean pass. That is the shape of the D1
  // P0, so the engine now says so and the verdict carries it rather than dropping it on the floor.
  const unenforceableConventions: string[] = [];
  let waivedFindingsCount = 0;

  // Seeded from the CONTRACT, before any evaluator runs, and that ordering is the mechanism.
  //
  // Every accepted convention and every agent contract gets a receipt here saying it was not
  // reached. An evaluator that runs replaces it; an evaluator that drops the convention on the
  // floor - which is what `fileSet.size === 0` did to twelve security kinds - leaves the seeded
  // truth standing. Assembling the list from what the evaluators reported instead would put the
  // silence one level up: a convention nothing mentions would have no receipt rather than a
  // damning one.
  const receipts = new EvaluationReceiptLedger();
  for (const convention of contract.conventions) {
    receipts.seed(convention.id, convention.kind);
  }
  for (const agentContract of contract.agent_contracts ?? []) {
    receipts.seed(agentContract.id, agentContract.kind);
  }

  // W8-3: the second engine invocation of a check, and the same rule applies to it. Two call
  // sites, one refusal, so a cap that fires here cannot surface differently from one that fires
  // during collection.
  let engineOwned: Awaited<ReturnType<typeof runEngineOwnedDirectDataAccessCheck>>;
  try {
    engineOwned = await runEngineOwnedDirectDataAccessCheck({
      receipts,
      repoId,
      repoRoot: repo.root_path,
      contract,
      now,
      scope: scope as "changed-hunks" | "changed-files" | "full",
      parsedDiff,
      baseline,
      existingFindings,
      checkData,
      snapshotsByPath,
      checkId,
      checkScanId,
      contractFingerprintValue,
      diffHash
    });
  } catch (error) {
    if (isEngineTimeoutError(error)) {
      return engineTimeoutRefusal({
        storage,
        parsed,
        repoId,
        contract,
        contractFingerprintValue,
        checkId,
        checkScanId,
        scope,
        machineContractVersions,
        policy,
        expiredFindingsCount,
        deletedFiles: parsedDiff.deletedFiles,
        error,
        now
      });
    }
    throw error;
  }

  if (engineOwned) {
    findings.push(...engineOwned.findings);
    waivedFindings.push(...engineOwned.waivedFindings);
    waivedFindingsCount = engineOwned.waivedFindingsCount;
    for (const finding of findings) {
      storage.upsertFinding(finding);
    }
  } else {
    for (const convention of contract.conventions) {
    if (
      convention.kind !== "api_route_no_direct_data_access" ||
      convention.enforcement_mode === "off" ||
      convention.enforcement_capability !== "deterministic_check" ||
      !isActiveConvention(convention, now)
    ) {
      continue;
    }

    const files = filesForConvention(parsedDiff, convention, scope);
    for (const filePath of files) {
      if (!isApiRoutePath(filePath) || isExceptedPath(filePath, convention, now)) {
        continue;
      }

      for (const importUsed of importFactsForFile(checkData.facts, filePath)) {
        if (!isForbiddenImport(importUsed.value, convention.matcher.forbidden_imports ?? [])) {
          continue;
        }
        if (isExceptedImport(
          filePath,
          importUsed.name,
          importUsed.value,
          convention,
          now,
          exceptionContextForImport(checkData, filePath, importUsed)
        )) {
          continue;
        }
        const waiver = findContractWaiverForImport(filePath, importUsed.name, importUsed.value, contract, now);
        if (waiver) {
          const staleWaiver = waiverRequiresReapproval(
            waiver,
            filePath,
            snapshotsByPath.get(filePath)?.content_hash
          );
          if (staleWaiver) {
            findings.push(waiverReapprovalFinding({
              repoId,
              repoContractId: contract.id,
              conventionId: convention.id,
              checkId,
              scanId: checkData.snapshots[0]?.scan_id ?? checkScanId,
              filePath,
              line: importUsed.start_line,
              symbol: evidenceSymbol(importUsed.name),
              importSource: importUsed.value,
              fileHash: snapshotsByPath.get(filePath)?.content_hash ?? "",
              waiverId: waiver.id,
              now
            }));
          } else {
          waivedFindingsCount += 1;
          waivedFindings.push({
            waiver_id: waiver.id,
            convention_id: convention.id,
            file_path: filePath,
            symbol: evidenceSymbol(importUsed.name),
            import_source: importUsed.value,
            line: importUsed.start_line,
            reason: waiver.reason
          });
          continue;
          }
        }

        const diffStatus = diffStatusFor(filePath, importUsed.start_line, parsedDiff, scope);
        const fingerprint = findingFingerprint(
          convention.id,
          filePath,
          importUsed.name,
          importUsed.value
        );
        // T-06: one shared predicate, so this path matches legacy fingerprints exactly as the
        // engine's does.
        const status = isBaselinedFinding(baseline, convention.id, fingerprint)
          ? "pre_existing"
          : preservedGovernanceStatus(existingFindings.get(fingerprint)) ?? "new";
        const snapshot = snapshotsByPath.get(filePath);
        const finding: Finding = {
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: repoId,
          convention_id: convention.id,
          check_id: checkId,
          repo_contract_id: contract.id,
          fingerprint,
          title: "API route imports data access directly",
          message: directDataAccessMessage(filePath, importUsed.name, importUsed.value),
          severity: convention.severity,
          enforcement_result: enforcementResultFor(convention.enforcement_mode),
          status,
          diff_status: diffStatus,
          evidence_refs: [{
            id: `evidence_${fingerprint.slice(0, 16)}`,
            kind: "violation",
            file_path: filePath,
            start_line: importUsed.start_line,
            end_line: importUsed.start_line,
            symbol: evidenceSymbol(importUsed.name),
            import_source: importUsed.value,
            fact_ids: importUsed.fact_id ? [importUsed.fact_id] : [],
            scan_id: checkData.snapshots[0]?.scan_id ?? checkScanId,
            file_hash: snapshot?.content_hash ?? "",
            redaction_state: "none"
          }],
          expected_layer: "service",
          actual_layer: "data_access",
          graph_path: [filePath, importUsed.value],
          suggested_fix: directDataAccessSuggestedFix(),
          related_node_ids: [],
          created_at: now
        };
        storage.upsertFinding(finding);
        findings.push(finding);
      }
    }
  }
  }

  const engineOwnedAuth = await runEngineOwnedAuthCheck({
      receipts,
    repoId,
    repoRoot: repo.root_path,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...engineOwnedAuth.findings);
  waivedFindings.push(...engineOwnedAuth.waivedFindings);
  waivedFindingsCount += engineOwnedAuth.waivedFindingsCount;
  securityBoundaryProofs.push(...engineOwnedAuth.securityBoundaryProofs);
  unenforceableConventions.push(...engineOwnedAuth.unenforceableConventions);
  for (const finding of engineOwnedAuth.findings) {
    storage.upsertFinding(finding);
  }

  const helperReuseFindings = runCanonicalHelperReuseCheck({
      receipts,
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId,
    contractFingerprintValue,
    diffHash
  });
  findings.push(...helperReuseFindings);
  for (const finding of helperReuseFindings) {
    storage.upsertFinding(finding);
  }
  const modulePlacementFindings = runModulePlacementCheck({
      receipts,
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...modulePlacementFindings);
  for (const finding of modulePlacementFindings) {
    storage.upsertFinding(finding);
  }
  const importBoundaryFindings = runImportBoundaryCheck({
      receipts,
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...importBoundaryFindings);
  for (const finding of importBoundaryFindings) {
    storage.upsertFinding(finding);
  }
  const fileRoleFindings = runFileRoleCheck({
      receipts,
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...fileRoleFindings);
  for (const finding of fileRoleFindings) {
    storage.upsertFinding(finding);
  }
  const entrypointFlowFindings = runEntrypointFlowCheck({
      receipts,
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...entrypointFlowFindings);
  for (const finding of entrypointFlowFindings) {
    storage.upsertFinding(finding);
  }
  const requiredCheckProofFindings = runRequiredCheckProofCheck({
      receipts,
    repoId,
    contract,
    storage,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId,
    contractFingerprintValue,
    diffHash
  });
  findings.push(...requiredCheckProofFindings);
  for (const finding of requiredCheckProofFindings) {
    storage.upsertFinding(finding);
  }

  // BB-4: does each accepted convention's forbidden module still exist in this repo?
  //
  // Rename the data module and update its imports - an ordinary refactor - and the convention matches
  // nothing forever, while the check keeps reporting `pass`. The gate reports green with its trigger
  // unplugged, which is the enforcement-integrity class of bug the EW sprint spent itself on.
  const staleness = contractStaleness({
    checkData,
    conventions: contract.conventions,
    repoId
  });

  // BB-5: attach conforming exemplars and the migration sentence here, after every check has
  // contributed its findings.
  //
  // Placement is the load-bearing part. The integrity invariant - an exemplar never has an open
  // finding against the convention it exemplifies - can only be evaluated once the full finding set
  // exists. Computing exemplars inside each individual check would let a file be offered as an
  // example by one check while a later check in the same run flags it.
  attachConformingExemplars({
    findings,
    conventions: contract.conventions,
    scanFiles: checkData.files,
    facts: checkData.facts,
    baseline,
    scope
  });
  attachFindingVersionBindings(findings, machineContractVersions);
  for (const finding of findings) {
    storage.upsertFinding(finding);
  }

  // T121 (decision C): a baseline shields code nobody has touched, not a line someone rewrote.
  //
  // A baseline fingerprint match set `status: "pre_existing"` permanently, so rewriting the
  // violating line - or deleting it and adding it back - stayed exempt forever. That turned
  // "existing code is grandfathered" into "this exact violation is waived for all time", which is a
  // different and much weaker promise than the one the baseline is for.
  //
  // `diff_status: "new_in_diff"` is precisely the signal that the line itself changed, so it is what
  // separates inherited debt from a choice made in this diff. Untouched baselined code produces no
  // finding at all, and a baselined violation in a file changed elsewhere comes back
  // `touched_existing` - both still pass.
  //
  // Deliberate suppression is unaffected: `findings suppress` sets a finding status which
  // preservedGovernanceStatus carries forward, and it never writes a baseline row. So the explicit
  // mechanism stays permanent without needing to be distinguished here.
  const blockingCount = findings.filter((finding) =>
    finding.diff_status === "new_in_diff" &&
    finding.enforcement_result === "block" &&
    // A human decision still holds. `findings suppress`, accept-drift and false-positive are the
    // explicit mechanisms the decision keeps permanent, and dropping the `status === "new"` check
    // would have silently overridden all three - suppression is meant to survive a rescan.
    !isClosedFindingStatus(finding.status) &&
    finding.status !== "needs_review"
  ).length;
  // EW-2. The coverage gaps in this diff, computed once and reported unconditionally.
  //
  // These used to be derived only when enforcement had been withheld, because the two were the
  // same event: any gap zeroed every finding. They are now independent - the engine enforces
  // findings whose own chain is certain and withholds the rest - so a run can block a violation
  // and still have failed to see part of the diff. That state has to be reportable, or the
  // honesty S1-01 bought is spent the moment a real block claims the exit code (2 beats 3, so a
  // refusal never masks an established violation).
  const coverageGapReasons = (checkData.diagnostics ?? [])
    .filter((diagnostic) =>
      [
        "unresolved_import",
        "unresolved_import_symbol",
        "unsupported_namespace_import_symbol"
      ].includes(diagnostic.code)
    )
    .map((diagnostic) => diagnostic.file_path)
    .filter((filePath): filePath is string => Boolean(filePath))
    .filter((filePath) => parsedDiff.files.some((file) => file.path === filePath))
    .map((filePath) => `unresolved_route_import:${filePath}`)
    .filter((reason, index, all) => all.indexOf(reason) === index)
    // A file the scan could not read is a coverage gap too, and it was the one kind that never
    // reached this list.
    //
    // The scan already knows: `repo_completeness` counts skipped files and reports the repo scope
    // as incomplete, and that verdict is persisted (graph_completeness holds `complete=0` with the
    // reason). The check simply never read it, so a repo with a non-UTF-8 API route answered
    // `partial_coverage: {complete: true, reasons: []}` and exit 0 - asserting it had seen a route
    // it never opened. Measured on a two-route fixture before this line existed.
    //
    // This is a coverage gap and deliberately not an enforcement demotion: findings the scan did
    // establish stay enforced and the exit code is unchanged, exactly as EW-2 separated the two.
    // The check stops claiming completeness it does not have; it does not become a kill-switch.
    //
    // Note this is a different use of `checkData.completeness` than the one rejected at S1-01
    // above. There it was proposed as a substitute for detecting check-time demotion, which it
    // cannot see. Here it is being asked what it actually measures: what the scan managed to read.
    .concat(
      (checkData.completeness ?? [])
        .filter((entry) => entry.scope === "repo" && !entry.complete)
        .flatMap((entry) => entry.reasons ?? [])
        .map((reason) => `scan_incomplete:${reason}`)
    );

  // S1-01: did incomplete coverage silently weaken enforcement?
  //
  // Uses the engine's own completeness, which collect-scan-data already carries - no protocol change.
  // A finding whose convention would enforce but whose enforcement_result is "none" is one the engine
  // zeroed for coverage, and the check must refuse rather than report a clean run.
  const enforcementDegraded = enforcementDegradedByCompleteness({
    findings: findings.map((finding) => ({
      enforcement_result: finding.enforcement_result,
      convention: {
        enforcement_mode: contract.conventions.find(
          (convention) => convention.id === finding.convention_id
        )?.enforcement_mode
      }
    }))
  });

  // BB-4: a dead contract does not change the verdict by itself - a removed data layer is a
  // legitimate refactor, and blocking it would be a false positive on a repo that did nothing
  // wrong. `--strict-contract` opts into the fail-closed reading for CI users who would rather
  // stop than run a gate whose trigger is unplugged.
  //
  // Decided here, once, above both consumers. It used to be decided at the return statement, which
  // put it on the exit code and not on the status.
  const contractStaleRefusal = staleness.length > 0 && parsed.flags.has("strict-contract");

  // E-1 (S1-02): status and exit code are one decision - a refused check records
  // "refused", never "pass" (B-3's contradiction, recorded on every eval baseline row).
  const checkStatus: CheckRun["status"] = checkStatusFor({
    blockingCount,
    enforcementDegraded,
    contractStaleRefusal,
    fullScopeCannotBlockRefusal
  });

  // W8-2: the refusal's cause, derived from the same terms as the status and the exit code so a
  // refusal can never arrive without one - which is what made the reference workflow print
  // "unknown".
  const refusalFailure = checkRefusalFailureFor({
    blockingCount,
    fullScopeCannotBlockRefusal,
    blockModeConventionIds,
    enforcementDegraded,
    coverageGapReasons,
    contractStaleRefusal,
    repoId
  });

  const fallbackStatus = fallbackStatusForCheck(checkData);
  const capabilityCompleteness = capabilityCompletenessForCheck(checkData, {
    enforcementDegraded,
    coverageComplete: coverageGapReasons.length === 0
  });
  const readiness = readinessForCheck({
    repoId,
    checkScanId,
    checkData,
    capabilityCompleteness,
    now
  });
  const check = checkEnvelope({
    checkId,
    repoId,
    contract,
    contractFingerprintValue,
    checkScanId,
    scope,
    status: checkStatus,
    fallbackStatus,
    capabilityCompleteness,
    machineContractVersions
  });
  storage.upsertCheckRun({
    id: checkId,
    repo_id: repoId,
    repo_contract_id: contract.id,
    contract_fingerprint: contractFingerprintValue,
    scan_id: checkScanId,
    status: checkStatus,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    engine_source: checkData.engineSource,
    fallback_used: fallbackStatus.fallback_used,
    stale_scan: false,
    capability_complete: capabilityCompleteness.complete,
    findings_count: findings.length,
    blocking_count: blockingCount,
    machine_contract_versions: machineContractVersions,
    started_at: now,
    completed_at: now
  });
  if (securityBoundaryProofs.length > 0 && typeof storage.upsertSecurityBoundaryProofRuns === "function") {
    storage.upsertSecurityBoundaryProofRuns({
      repo_id: repoId,
      scan_id: checkScanId,
      check_id: checkId,
      proofs: securityBoundaryProofs,
      created_at: now
    });
  }
  // EW-3: measured on the check's own scan, not a stored one, so it describes the run that
  // produced this verdict. `IMPORT_RESOLVES_TO_MODULE` sources are the resolved imports; external
  // packages resolve to nothing by design and are excluded from both sides of the ratio.
  const importCoverage = importCoverageReport({
    diagnostics: checkData.diagnostics ?? [],
    resolvedLocalImports: new Set(
      checkData.graph_edges
        .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_MODULE")
        .map((edge) => edge.from)
    ).size
  });

  const evaluationReceipts = receipts.list();
  const openNewCount = findings.filter((finding) => finding.status === "new").length;
  const outcome = checkOutcomeSummary(findings, {
    waivedFindingsCount,
    expiredFindingsCount,
    scope: scope as "changed-hunks" | "changed-files" | "full"
  });
  const payload = {
    response_schema: "drift.check.result.v1",
    check,
    // W8-2: present exactly when this run refused, so its presence is the signal and a consumer
    // that finds it never has to guess the cause from prose.
    ...(refusalFailure ? { failure: refusalFailure } : {}),
    readiness,
    machine_contract_versions: machineContractVersions,
    policy,
    governance: preflightGovernance(),
    audit_integrity: storage.verifyAuditChain(repoId),
    summary: {
      repo_id: repoId,
      scope,
      findings_count: findings.length,
      blocking_count: blockingCount,
      // S1-01: name the files whose coverage gap cost us enforcement. The engine's reasons already
      // carry the path (`unsupported_route_namespace_import:<path>`), so pass them through verbatim
      // rather than paraphrasing - a refusal a user cannot act on is barely better than a false pass.
      // Why enforcement was withheld. Populated only when it actually was - a finding that
      // blocked was not blocked "despite" these, it simply did not depend on them.
      // W8-1 adds its own reason here rather than reusing the degradation vocabulary: nothing was
      // degraded, the scope simply cannot express a block. Each block-mode convention that went
      // unenforced is named, because "which rule did not run" is the actionable half.
      blocked_reasons: [
        ...(fullScopeCannotBlockRefusal
          ? [
              "full_scope_cannot_block",
              ...blockModeConventionIds.map((id) => `block_mode_convention_unenforced:${id}`)
            ]
          : []),
        ...(enforcementDegraded
          ? ["enforcement_degraded_by_incomplete_coverage", ...coverageGapReasons]
          : [])
      ],
      // EW-2: what Drift could not see, whether or not that cost anyone an enforcement. This is
      // the explicit signal chosen over a distinct exit code, because the blocking exit code
      // (2) has to keep winning and cannot carry a second meaning. Documented in
      // docs/reference/enforcement.md.
      partial_coverage: {
        // BB-9: a file the diff named and the tree does not have is a coverage gap by definition.
        // Claiming `complete: true` over it is the silent-green this item exists to kill.
        complete: coverageGapReasons.length === 0 && missingFromWorktree.length === 0 &&
          unindexedContractTargets.length === 0 && !enforcementDegraded,
        reasons: [
          ...coverageGapReasons,
          ...missingFromWorktree.map((filePath) => `changed_file_missing_from_worktree:${filePath}`),
          // Same class as the line above: a file a rule named that Drift could not read. The rule
          // did not pass on it, it never ran on it.
          ...unindexedContractTargets.map((filePath) => `contract_target_not_indexed:${filePath}`)
        ]
      },
      // One receipt per convention, on every run that reaches a verdict.
      //
      // Deliberately NOT the house "present only when something is wrong" pattern that
      // `contract_staleness` and `unenforceable_conventions` below follow. Those say "something
      // broke"; this says "here is what each rule did", and a coverage account that appears only
      // when Drift already knows it has a problem is not an account. A consumer has to be able to
      // ask "did convention X run on this check" and get an answer without knowing in advance that
      // the answer is bad - which is exactly what nobody could do for the eight dead conventions.
      //
      // Beside `partial_coverage` rather than inside it, because the two answer different
      // questions. `partial_coverage.reasons` are keyed on file paths and say which FILES Drift
      // could not read; no value it has ever taken reflects which CONVENTIONS ran. A contract of
      // twelve accepted conventions, none of them reached, is `complete: true` by that measure.
      //
      // "Reaches a verdict" is the honest scope and covers every exit this function returns,
      // refusals included - `full_scope_cannot_block` and the coverage-degradation refusal both
      // come back through here and carry their receipts. What it does not cover is the three
      // early returns above, where the engine was unavailable, timed out, or no contract exists:
      // those exit 3 having evaluated nothing and claiming nothing, so there is no pass for a
      // coverage account to qualify. Stated rather than left to be discovered, because "always
      // present" is the sort of promise a consumer writes `payload.summary.evaluation_receipts[0]`
      // against.
      evaluation_receipts: evaluationReceipts,
      // EW-3: the coverage number travels with the verdict. A verdict read without it invites
      // exactly the mistake open beta will produce most - a clean check on a repo shape Drift
      // half-understands, taken as proof the repo is clean.
      import_coverage: importCoverage,
      waived_findings_count: waivedFindingsCount,
      expired_findings_count: expiredFindingsCount,
      skipped_deleted_files: parsedDiff.deletedFiles,
      engine_source: checkData.engineSource,
      affected_scope: affectedScopeSummary(parsedDiff, scope, missingFromWorktree),
      outcome,
      // BB-4: present only when something is actually dead, so its presence is the signal. An
      // always-present empty array would be one more field to skip.
      ...(staleness.length > 0
        ? {
            contract_staleness: staleness,
            contract_staleness_warnings: contractStalenessWarnings(staleness)
          }
        : {}),
      ...(enforcementDemotions.length > 0
        ? { enforcement_demotions: enforcementDemotions }
        : {}),
      // BB-4's pattern, applied to §5.1.4: present only when something is actually dead, so its
      // presence is the signal and an empty array is not one more field to skip.
      ...(unenforceableConventions.length > 0
        ? { unenforceable_conventions: unenforceableConventions }
        : {})
    },
    review_items: findings.map(reviewFinding),
    waived_findings: waivedFindings,
    security_boundary_proofs: securityBoundaryProofs,
    next_commands: checkNextCommands(repoId, {
      findingCount: findings.length,
      openNewCount,
      blockingCount
    }),
    findings
  };

  return {
    // Documented exit-code contract (see docs and `drift --help`):
    //   0 pass · 2 blocked · 3 refused (fail-closed) · 1 operational error
    // `2` is distinct from `1` so CI can tell "this diff violates the contract" from
    // "drift itself failed", and so a crash is never silently read as a clean run.
    // BB-4's `--strict-contract` refusal is `contractStaleRefusal`, decided above and handed to the
    // status and to this exit code from the same variable. A real block still outranks it - the
    // refusal must never mask a violation Drift did manage to prove - which `checkExitCodeFor`
    // already guarantees by answering blockingCount first, so the explicit `blockingCount === 0`
    // this expression used to carry is redundant rather than lost.
    exitCode: checkExitCodeFor({
      blockingCount,
      enforcementDegraded,
      contractStaleRefusal,
      fullScopeCannotBlockRefusal
    }),
    payload: parsed.flags.has("json") ? payload : formatCheckText(payload)
  };
}

function fallbackStatusForCheck(checkData: ScanData): ScanData["fallbackStatus"] {
  return checkData.fallbackStatus;
}

/**
 * W8-3: the verdict a killed engine gets - which is no verdict, said out loud.
 *
 * Built by hand rather than through the normal payload path because there is nothing to build it
 * from: the engine was killed, so there are no facts, no snapshots and no diagnostics, and every
 * derived section would be a shape invented to fill a key. What a consumer needs is here - the
 * status, the cause, the scope that was attempted - and what is not measurable is absent rather
 * than defaulted. `readiness` in particular is omitted: it reports what a scan observed, and no
 * scan finished.
 *
 * The check run is still recorded. A refusal is an event in the repo's history and `drift checks`
 * should show it; an unrecorded refusal is how "it was fine yesterday" survives.
 */
function engineTimeoutRefusal(input: {
  storage: SqliteDriftStorage;
  parsed: ParsedArgs;
  repoId: string;
  contract: RepoContract;
  contractFingerprintValue: string;
  checkId: string;
  checkScanId: string;
  scope: string;
  machineContractVersions: MachineContractVersions;
  policy: ReturnType<typeof authorizeContextExport>;
  expiredFindingsCount: number;
  deletedFiles: string[];
  error: { timeoutMs: number };
  now: string;
}): CommandPayload {
  const message = input.error instanceof Error ? input.error.message : "The Drift Rust engine was killed after exceeding its time cap.";
  const capabilityCompleteness = {
    complete: false,
    missing_capabilities: ["graph", "graph_evidence", "deterministic_enforcement"],
    can_block: false
  };
  const fallbackStatus: ScanData["fallbackStatus"] = {
    engine_source: "rust",
    // Not a fallback: nothing answered in the engine's place. Saying `true` here would claim the
    // TypeScript scanner ran, and a payload that names a scanner that never ran is the class of
    // lie this whole change is about.
    fallback_used: false,
    fallback_reason: null,
    engine_error_message: message,
    degraded_capabilities: capabilityCompleteness.missing_capabilities,
    enforcement_degraded: true,
    engine_resolution: null,
    engine_build_profile: null
  };
  const check = checkEnvelope({
    checkId: input.checkId,
    repoId: input.repoId,
    contract: input.contract,
    contractFingerprintValue: input.contractFingerprintValue,
    checkScanId: input.checkScanId,
    scope: input.scope,
    status: "refused",
    fallbackStatus,
    capabilityCompleteness,
    machineContractVersions: input.machineContractVersions
  });
  input.storage.upsertCheckRun({
    id: input.checkId,
    repo_id: input.repoId,
    repo_contract_id: input.contract.id,
    contract_fingerprint: input.contractFingerprintValue,
    scan_id: input.checkScanId,
    status: "refused",
    scope: input.scope as "changed-hunks" | "changed-files" | "full",
    engine_source: "rust",
    fallback_used: false,
    stale_scan: false,
    capability_complete: false,
    findings_count: 0,
    blocking_count: 0,
    machine_contract_versions: input.machineContractVersions,
    started_at: input.now,
    completed_at: input.now
  });
  const payload = {
    response_schema: "drift.check.result.v1",
    check,
    failure: {
      code: ENGINE_TIMEOUT_FAILURE_CODE,
      type: "refusal",
      message,
      remediation:
        `The engine was killed after ${input.error.timeoutMs}ms. Raise DRIFT_ENGINE_TIMEOUT_MS if this repository legitimately needs longer, then rerun; if it hangs again the engine is stuck rather than slow.`,
      recovery_commands: ["drift doctor --json", `drift scan status --repo ${input.repoId} --json`]
    } satisfies CheckFailure,
    machine_contract_versions: input.machineContractVersions,
    policy: input.policy,
    governance: preflightGovernance(),
    audit_integrity: input.storage.verifyAuditChain(input.repoId),
    summary: {
      repo_id: input.repoId,
      scope: input.scope,
      findings_count: 0,
      blocking_count: 0,
      waived_findings_count: 0,
      expired_findings_count: input.expiredFindingsCount,
      skipped_deleted_files: input.deletedFiles,
      engine_source: "rust" as const,
      blocked_reasons: [ENGINE_TIMEOUT_FAILURE_CODE],
      // Nothing was examined, so `complete: false` is the only honest answer - the same reasoning
      // BB-9 applied to a file the diff named and the tree did not have, one level up.
      partial_coverage: {
        complete: false,
        reasons: [`engine_killed_after_ms:${input.error.timeoutMs}`]
      }
    },
    review_items: [],
    waived_findings: [],
    diagnostics: [],
    security_boundary_proofs: [],
    next_commands: ["drift doctor --json", `drift scan status --repo ${input.repoId} --json`],
    findings: []
  };
  return {
    exitCode: CHECK_EXIT_REFUSED,
    payload: input.parsed.flags.has("json") ? payload : formatCheckText(payload)
  };
}

/**
 * E-6 (decision D-2): the standing demotion record for a contract's conventions.
 *
 * For every convention currently running weaker than block, the latest
 * `enforcement_demoted` audit event (written when an accept or contract import moved it
 * off block) is surfaced in the check summary. A convention promoted back to block stops
 * being reported - the record follows the effective state, not the history.
 */
interface EnforcementDemotion {
  convention_id: string;
  from: string;
  to: string;
  at: string;
  actor: string;
  coverage_direction?: unknown;
}

function enforcementDemotionsForContract(
  storage: SqliteDriftStorage,
  repoId: string,
  contract: RepoContract
): EnforcementDemotion[] {
  const weakConventionIds = new Set(
    contract.conventions
      .filter((convention) => convention.enforcement_mode !== "block")
      .map((convention) => convention.id)
  );
  if (weakConventionIds.size === 0) {
    return [];
  }
  const latestByConvention = new Map<string, EnforcementDemotion>();
  for (const event of storage.listAuditEvents(repoId)) {
    if (event.action !== "enforcement_demoted" || !weakConventionIds.has(event.target_id)) {
      continue;
    }
    const metadata = event.metadata as {
      from?: unknown;
      to?: unknown;
      coverage_direction?: unknown;
    };
    latestByConvention.set(event.target_id, {
      convention_id: event.target_id,
      from: typeof metadata.from === "string" ? metadata.from : "block",
      to: typeof metadata.to === "string" ? metadata.to : "warn",
      at: event.created_at,
      actor: event.actor,
      ...(metadata.coverage_direction !== undefined
        ? { coverage_direction: metadata.coverage_direction }
        : {})
    });
  }
  return [...latestByConvention.values()];
}

function capabilityCompletenessForCheck(
  checkData: ScanData,
  options?: { enforcementDegraded?: boolean; coverageComplete?: boolean }
): {
  complete: boolean;
  missing_capabilities: string[];
  can_block: boolean;
} {
  return {
    complete: checkData.engineSource === "rust" && !checkData.fallbackStatus.fallback_used,
    missing_capabilities: checkData.fallbackStatus.fallback_used
      ? checkData.fallbackStatus.degraded_capabilities
      : [],
    // E-1 (S1-02 / B-3): derived from what the check actually DID, not recomputed
    // optimistically from engine source alone. A check whose findings were zeroed for
    // incomplete coverage (the S1-01 refusal) cannot claim it could have blocked - that
    // optimistic answer is how the kill-switch payloads read `can_block: true` while the
    // engine had already demoted everything.
    //
    // EW-2: coverage is now a separate input, because withheld enforcement and incomplete
    // coverage came apart. A check that enforced every finding it established while failing to
    // resolve part of the diff must not answer this "yes" - it could block *those* findings,
    // and has no idea what it did not see. Reading `enforcementDegraded` alone would flip this
    // back to the optimistic answer the moment EW-2 stopped zeroing findings, which is the same
    // defect as B-3 arriving by a different route.
    can_block:
      checkData.engineSource === "rust" &&
      !checkData.fallbackStatus.enforcement_degraded &&
      !(options?.enforcementDegraded ?? false) &&
      (options?.coverageComplete ?? true)
  };
}

function readinessForCheck(input: {
  repoId: string;
  checkScanId: string;
  checkData: ScanData;
  capabilityCompleteness: ReturnType<typeof capabilityCompletenessForCheck>;
  now: string;
}) {
  const parserGaps = parserGapsFromDiagnostics({
    repoId: input.repoId,
    scanId: input.checkScanId,
    diagnostics: input.checkData.graph_diagnostics.length > 0
      ? input.checkData.graph_diagnostics
      : input.checkData.diagnostics,
    createdAt: input.now
  });
  const graphAvailable = input.checkData.graph_nodes.length > 0;
  return buildReadiness({
    repo_id: input.repoId,
    scan_id: input.checkScanId,
    surface: "check",
    graph_available: graphAvailable,
    graph_complete: input.capabilityCompleteness.complete && input.capabilityCompleteness.can_block,
    parser_gaps: parserGaps,
    completeness_reasons: graphAvailable ? [] : ["graph_missing"],
    required_capabilities: ["direct_data_access_check"],
    missing_capabilities: input.capabilityCompleteness.missing_capabilities
  });
}

/**
 * BB-5: give every finding up to three files that obey the convention it broke, plus the sentence
 * that explains why the baselined violations around them are not precedent.
 *
 * Trials on 2026-08-03: agents told a rule opened the neighbouring files, found those violate it
 * too, and defected - one of them saying so in writing. The nearest files by path are the most
 * likely to share the violation (dub's invite routes are exactly this shape), so "nearby" is the
 * wrong selector on its own and the zero-open-findings filter is what makes the list safe to read.
 */
function attachConformingExemplars(input: {
  findings: Finding[];
  conventions: RepoContract["conventions"];
  scanFiles: string[];
  facts: FactRecord[];
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  scope: string;
}): void {
  const conventionsById = new Map(input.conventions.map((convention) => [convention.id, convention]));
  const roleByFile = new Map<string, string>();
  // The same facts array already in hand, read for what it actually proves about each file. Before
  // this it was consulted only for file_role_detected, while the import facts that decide whether a
  // file complies sat unread beside it.
  const importsByFile = new Map<string, string[]>();
  for (const fact of input.facts) {
    if (fact.kind === "file_role_detected") {
      roleByFile.set(fact.file_path, fact.name);
    }
    if (fact.kind === "import_used" && fact.value) {
      const sources = importsByFile.get(fact.file_path) ?? [];
      sources.push(fact.value);
      importsByFile.set(fact.file_path, sources);
    }
  }
  // A file in scope with no import facts at all still has to be provable, so seed an empty list for
  // every scanned file: "scanned and imports nothing forbidden" is a proof, "never scanned" is not.
  for (const filePath of input.scanFiles) {
    if (!importsByFile.has(filePath)) {
      importsByFile.set(filePath, []);
    }
  }

  // Every file the check's own scan saw, as a synthetic diff, so scope membership is decided by the
  // same `filesForConvention` the enforcement path uses. A second scope implementation here would
  // eventually disagree with the first, and the disagreement would show up as an exemplar that is
  // not actually in scope.
  const allFilesDiff = {
    files: input.scanFiles.map((path) => ({ path, changedLines: new Set<number>(), isAdded: false })),
    deletedFiles: []
  };

  const scopeFilesByConvention = new Map<string, string[]>();
  const violatingByConvention = new Map<string, Set<string>>();

  // A baselined violation is still a violation. Citing one as an exemplar is precisely the
  // defection trigger observed in trial B1, so the baseline feeds this set rather than excusing it.
  for (const entry of input.baseline) {
    if (entry.status !== "active") {
      continue;
    }
    const set = violatingByConvention.get(entry.convention_id) ?? new Set<string>();
    set.add(entry.file_path);
    violatingByConvention.set(entry.convention_id, set);
  }
  for (const finding of input.findings) {
    const set = violatingByConvention.get(finding.convention_id) ?? new Set<string>();
    for (const ref of finding.evidence_refs) {
      set.add(ref.file_path);
    }
    violatingByConvention.set(finding.convention_id, set);
  }

  const violatingFilesAnyConvention = new Set<string>();
  for (const files of violatingByConvention.values()) {
    for (const file of files) {
      violatingFilesAnyConvention.add(file);
    }
  }

  for (const finding of input.findings) {
    const convention = conventionsById.get(finding.convention_id);
    if (!convention) {
      continue;
    }
    let scopeFiles = scopeFilesByConvention.get(convention.id);
    if (!scopeFiles) {
      scopeFiles = filesForConvention(allFilesDiff, convention, "full");
      scopeFilesByConvention.set(convention.id, scopeFiles);
    }
    const result = conformingExemplars({
      scopeFiles,
      // CV-5: every file violating ANY accepted convention. A file conforming to the convention this
      // finding is about can violate a different accepted one, and offering it as an example sends an
      // agent to open a file that breaks another rule - trial B1's defection trigger.
      violatingFiles: violatingFilesAnyConvention,
      roleByFile,
      referenceFile: finding.evidence_refs[0]?.file_path,
      // The scope pool above is the WHOLE repo (hardcoded "full"), while violatingFiles comes from
      // findings computed over the diff. On a changed-hunks run that is 1 file in and 139 out, so
      // absence of a finding certified 138 unexamined routes as conforming. These two arguments are
      // what make it a proof instead of an assumption - and the facts were already in hand here,
      // used only for file_role_detected.
      forbiddenImports: convention.matcher?.forbidden_imports ?? [],
      importsByFile
    });
    if (result.conforming_examples.length > 0) {
      finding.conforming_examples = result.conforming_examples;
    }
    const sentence = migrationSentence(
      input.baseline.filter(
        (entry) => entry.status === "active" && entry.convention_id === convention.id
      ).length
    );
    if (sentence && !finding.message.includes(sentence)) {
      finding.message = `${finding.message} ${sentence}`;
    }
  }
}

function attachFindingVersionBindings(
  findings: Finding[],
  machineContractVersions: MachineContractVersions
): void {
  for (const finding of findings) {
    finding.created_by_engine_version = machineContractVersions.scanner_version;
    finding.created_by_rule_engine_version = machineContractVersions.rule_engine_version;
    finding.contract_schema_version = machineContractVersions.contract_schema_version;
  }
}

function checkEnvelope(input: {
  checkId: string;
  repoId: string;
  contract: RepoContract;
  contractFingerprintValue: string;
  checkScanId: string;
  scope: string;
  status: CheckRun["status"];
  fallbackStatus: ScanData["fallbackStatus"];
  capabilityCompleteness: ReturnType<typeof capabilityCompletenessForCheck>;
  machineContractVersions: MachineContractVersions;
}): {
  id: string;
  repo_id: string;
  repo_contract_id: string;
  contract_fingerprint: string;
  scope: string;
  status: CheckRun["status"];
  scan_status: {
    mode: "check_time_collection";
    stored_scan_required: false;
    stale: false;
    scan_id: string;
  };
  fallback_status: ScanData["fallbackStatus"];
  capability_completeness: ReturnType<typeof capabilityCompletenessForCheck>;
  machine_contract_versions: MachineContractVersions;
} {
  return {
    id: input.checkId,
    repo_id: input.repoId,
    repo_contract_id: input.contract.id,
    contract_fingerprint: input.contractFingerprintValue,
    scope: input.scope,
    status: input.status,
    scan_status: {
      mode: "check_time_collection",
      stored_scan_required: false,
      stale: false,
      scan_id: input.checkScanId
    },
    fallback_status: input.fallbackStatus,
    capability_completeness: input.capabilityCompleteness,
    machine_contract_versions: input.machineContractVersions
  };
}

function directDataAccessSuggestedFix(): string {
  return "Move data access behind a service layer before returning from the route.";
}

function waiverReapprovalFinding(input: {
  repoId: string;
  repoContractId: string;
  conventionId: string;
  checkId: string;
  scanId: string;
  filePath: string;
  line: number;
  // Absent for a bindingless side-effect import (S10): nothing was bound.
  symbol?: string;
  importSource: string;
  fileHash: string;
  waiverId: string;
  now: string;
}): Finding {
  const fingerprint = hashStable([
    "waiver-reapproval-required",
    input.waiverId,
    input.conventionId,
    input.filePath
  ].join(":"));
  return {
    id: `finding_${fingerprint.slice(0, 16)}`,
    repo_id: input.repoId,
    convention_id: input.conventionId,
    check_id: input.checkId,
    repo_contract_id: input.repoContractId,
    fingerprint,
    title: "Waiver requires reapproval after file change",
    message: `${input.filePath} matches waiver ${input.waiverId}, but the file hash no longer matches the approved waiver state.`,
    severity: "warning",
    confidence_label: "certain",
    drift_category: "worsened_violation",
    introduced_by_diff: true,
    affected_contract: input.repoContractId,
    enforcement_result: "warn",
    status: "new",
    diff_status: "touched_existing",
    evidence_refs: [{
      id: `evidence_${fingerprint.slice(0, 16)}`,
      kind: "violation",
      file_path: input.filePath,
      start_line: input.line,
      end_line: input.line,
      symbol: input.symbol,
      import_source: input.importSource,
      fact_ids: [],
      scan_id: input.scanId,
      file_hash: input.fileHash,
      redaction_state: "none"
    }],
    expected_layer: "approved_waiver_state",
    actual_layer: "waiver_stale_after_file_change",
    graph_path: [input.filePath, input.waiverId],
    suggested_fix: `Reapprove waiver ${input.waiverId} for the current file content or remove the waiver and fix the violation.`,
    related_node_ids: [],
    created_at: input.now
  };
}

function runCanonicalHelperReuseCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  contractFingerprintValue: string;
  diffHash: string;
  receipts: EvaluationReceiptLedger;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));
  if (changedFiles.size === 0 && input.scope === "full") {
    for (const snapshot of input.checkData.snapshots) {
      changedFiles.add(snapshot.file_path);
    }
  }
  const exportedFacts = input.checkData.facts.filter((fact) =>
    fact.kind === "exported_symbol" && changedFiles.has(fact.file_path)
  );

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "canonical_helper_reuse") {
      input.receipts.skipped(contract.id, "not_dispatched_to_this_evaluator");
      continue;
    }
    const emittedBefore = findings.length;

    for (const helper of contract.canonical_helpers) {
      const forbiddenSymbols = new Set(helper.avoid_new_symbols_matching ?? []);

      for (const exported of exportedFacts) {
        if (isCanonicalHelperModule(exported.file_path, helper.module)) {
          continue;
        }

        const exactDuplicate = forbiddenSymbols.has(exported.name);
        const similarity = exactDuplicate ? null : scoreHelperSimilarity({
          candidate: helperProfileForExport(input.checkData.facts, exported),
          canonical: canonicalHelperProfile(input.checkData.facts, helper),
          blockingThreshold: "deterministic"
        });
        if (!exactDuplicate && similarity?.score_band !== "high") {
          continue;
        }
        const diffStatus = diffStatusFor(exported.file_path, exported.start_line, input.parsedDiff, input.scope);
        const fingerprint = canonicalHelperReuseFindingFingerprint(
          contract.id,
          helper.helper_id,
          exported.file_path,
          exactDuplicate ? exported.name : `${exported.name}:fuzzy:${similarity?.score ?? 0}`
        );
        const snapshot = input.snapshotsByPath.get(exported.file_path);
        // T-06: shared predicate, as above.
        const status = isBaselinedFinding(input.baseline, contract.id, fingerprint)
          ? "pre_existing"
          : preservedGovernanceStatus(input.existingFindings.get(fingerprint)) ?? "new";
        findings.push({
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: input.repoId,
          convention_id: contract.id,
          check_id: input.checkId,
          repo_contract_id: input.contract.id,
          fingerprint,
          title: exactDuplicate ? "Duplicate canonical helper introduced" : "Possible duplicate canonical helper introduced",
          message: exactDuplicate
            ? `${exported.file_path} exports ${exported.name}; reuse ${helper.symbol} from ${helper.module} instead of creating a parallel helper.`
            : `${exported.file_path} exports ${exported.name}; it is highly similar to ${helper.symbol} from ${helper.module}.`,
          severity: exactDuplicate && contract.enforcement === "blocking" ? "error" : "warning",
          enforcement_result: exactDuplicate && contract.enforcement === "blocking" ? "block" : "warn",
          status,
          diff_status: diffStatus,
          evidence_refs: [{
            id: `evidence_${fingerprint.slice(0, 16)}`,
            kind: "violation",
            file_path: exported.file_path,
            start_line: exported.start_line,
            end_line: exported.end_line,
            symbol: exported.name,
            fact_ids: [exported.id, ...(similarity?.evidence_refs ?? [])].filter((value, index, all) =>
              all.indexOf(value) === index
            ),
            scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
            file_hash: snapshot?.content_hash ?? "",
            redaction_state: "none"
          }],
          expected_layer: "canonical_helper",
          actual_layer: exactDuplicate ? "duplicate_helper" : "possible_duplicate_helper",
          graph_path: [exported.file_path, helper.module],
          suggested_fix: canonicalHelperSuggestedFix(helper, exported.name),
          related_node_ids: [],
          created_at: input.now
        });
      }
    }
    // Every path out of this contract's body lands here, so the receipt records what the
    // evaluator saw whether or not it found anything - which is the whole distinction:
    // `findings_emitted: 0` beside `inputs_considered: 0` is a rule that never ran on
    // anything, and beside a positive count it is a rule that ran and was satisfied.
    input.receipts.ran(contract.id, {
      inputsConsidered: exportedFacts.length,
      findingsEmitted: findings.length - emittedBefore
    });
  }

  return findings;
}

function canonicalHelperSuggestedFix(
  helper: CanonicalHelperReuseAgentContract["canonical_helpers"][number],
  duplicateSymbol: string
): string {
  return `Import ${helper.symbol} from ${helper.module} instead of creating ${duplicateSymbol}.`;
}

function helperProfileForExport(facts: FactRecord[], exported: FactRecord): {
  symbol: string;
  file_path: string;
  purpose_tags: string[];
  parameter_shape: string[];
  return_shape: string;
  call_dependencies: string[];
  import_dependencies: string[];
  body_operation_kinds: string[];
  evidence_refs: string[];
} {
  const fileFacts = facts.filter((fact) => fact.file_path === exported.file_path);
  return {
    symbol: exported.name,
    file_path: exported.file_path,
    purpose_tags: helperPurposeTags(exported.name, exported.file_path),
    parameter_shape: ["request"],
    return_shape: helperReturnShape(exported.name),
    call_dependencies: uniqueSorted(fileFacts
      .filter((fact) => fact.kind === "symbol_called")
      .map((fact) => fact.name)),
    import_dependencies: uniqueSorted(fileFacts
      .filter((fact) => fact.kind === "import_used" && fact.value)
      .map((fact) => fact.value as string)),
    body_operation_kinds: helperBodyOperationKinds(fileFacts),
    evidence_refs: fileFacts.map((fact) => fact.id)
  };
}

function canonicalHelperProfile(
  facts: FactRecord[],
  helper: CanonicalHelperReuseAgentContract["canonical_helpers"][number]
): {
  symbol: string;
  module: string;
  purpose_tags: string[];
  parameter_shape: string[];
  return_shape: string;
  call_dependencies: string[];
  import_dependencies: string[];
  body_operation_kinds: string[];
  evidence_refs: string[];
} {
  const helperFacts = facts.filter((fact) => isCanonicalHelperModule(fact.file_path, helper.module));
  return {
    symbol: helper.symbol,
    module: helper.module,
    purpose_tags: helper.purpose_tags,
    parameter_shape: ["request"],
    return_shape: helperReturnShape(helper.symbol),
    call_dependencies: uniqueSorted(helperFacts
      .filter((fact) => fact.kind === "symbol_called")
      .map((fact) => fact.name)),
    import_dependencies: uniqueSorted(helperFacts
      .filter((fact) => fact.kind === "import_used" && fact.value)
      .map((fact) => fact.value as string)),
    body_operation_kinds: helperBodyOperationKinds(helperFacts, helper.purpose_tags),
    evidence_refs: helperFacts.map((fact) => fact.id)
  };
}

function helperPurposeTags(symbol: string, filePath: string): string[] {
  const text = `${symbol} ${filePath}`.toLowerCase();
  return uniqueSorted([
    text.includes("auth") || text.includes("user") ? "auth" : "",
    text.includes("user") ? "user" : "",
    text.includes("valid") || text.includes("schema") ? "validation" : ""
  ].filter(Boolean));
}

function helperReturnShape(symbol: string): string {
  return /user/i.test(symbol) ? "user" : "unknown";
}

function helperBodyOperationKinds(facts: FactRecord[], fallbackTags: string[] = []): string[] {
  const names = facts.map((fact) => `${fact.name} ${fact.value ?? ""}`).join(" ").toLowerCase();
  return uniqueSorted([
    names.includes("session") || fallbackTags.includes("auth") ? "auth_guard" : "",
    names.includes("schema") || fallbackTags.includes("validation") ? "validation" : "",
    ...facts.filter((fact) => fact.kind === "data_operation_detected").map((fact) => fact.name)
  ].filter(Boolean));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isCanonicalHelperModule(filePath: string, moduleSpecifier: string): boolean {
  const normalizedFile = filePath.replaceAll("\\", "/").replace(/\.[cm]?[jt]sx?$/, "");
  const normalizedModule = moduleSpecifier
    .replace(/^@\//, "")
    .replaceAll("\\", "/")
    .replace(/\.[cm]?[jt]sx?$/, "");
  return normalizedFile.endsWith(normalizedModule);
}

function runModulePlacementCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  receipts: EvaluationReceiptLedger;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "module_placement") {
      input.receipts.skipped(contract.id, "not_dispatched_to_this_evaluator");
      continue;
    }
    const emittedBefore = findings.length;

    const roleFacts = input.checkData.facts.filter((fact) =>
      fact.kind === "file_role_detected" &&
      fact.name === contract.target_role &&
      changedFiles.has(fact.file_path)
    );
    for (const roleFact of roleFacts) {
      if (modulePlacementAllowed(roleFact.file_path, contract.allowed_paths, contract.forbidden_paths ?? [])) {
        continue;
      }

      const diffStatus = diffStatusFor(roleFact.file_path, roleFact.start_line, input.parsedDiff, input.scope);
      const fingerprint = agentContractFindingFingerprint(
        "module-placement",
        contract.id,
        roleFact.file_path,
        roleFact.name,
        contract.allowed_paths.join("|")
      );
      const snapshot = input.snapshotsByPath.get(roleFact.file_path);
      const status = findingStatusForAgentContract(
        input.baseline,
        input.existingFindings,
        contract.id,
        fingerprint
      );
      findings.push({
        id: `finding_${fingerprint.slice(0, 16)}`,
        repo_id: input.repoId,
        convention_id: contract.id,
        check_id: input.checkId,
        repo_contract_id: input.contract.id,
        fingerprint,
        title: "Module placement contract violated",
        message: `${roleFact.file_path} is classified as ${contract.target_role}, but that role is not allowed in this path by ${contract.id}.`,
        severity: contract.enforcement === "blocking" ? "error" : "warning",
        enforcement_result: contract.enforcement === "blocking" ? "block" : "warn",
        status,
        diff_status: diffStatus,
        evidence_refs: [{
          id: `evidence_${fingerprint.slice(0, 16)}`,
          kind: "violation",
          file_path: roleFact.file_path,
          start_line: roleFact.start_line,
          end_line: roleFact.end_line,
          symbol: roleFact.name,
          fact_ids: [roleFact.id],
          scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        expected_layer: contract.target_role,
        actual_layer: "misplaced_module",
        graph_path: [roleFact.file_path, ...contract.allowed_paths],
        suggested_fix: modulePlacementSuggestedFix(roleFact.file_path, contract.allowed_paths),
        related_node_ids: [],
        created_at: input.now
      });
    }
    // Every path out of this contract's body lands here, so the receipt records what the
    // evaluator saw whether or not it found anything - which is the whole distinction:
    // `findings_emitted: 0` beside `inputs_considered: 0` is a rule that never ran on
    // anything, and beside a positive count it is a rule that ran and was satisfied.
    input.receipts.ran(contract.id, {
      inputsConsidered: roleFacts.length,
      findingsEmitted: findings.length - emittedBefore
    });
  }

  return findings;
}

function runImportBoundaryCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  receipts: EvaluationReceiptLedger;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "import_boundary") {
      input.receipts.skipped(contract.id, "not_dispatched_to_this_evaluator");
      continue;
    }
    const emittedBefore = findings.length;

    const sourceFiles = filesWithRoles(input.checkData.facts, changedFiles, contract.source_roles);
    for (const importUsed of input.checkData.facts.filter((fact) =>
      fact.kind === "import_used" &&
      fact.value &&
      sourceFiles.has(fact.file_path)
    )) {
      const importSource = importUsed.value as string;
      if (!isForbiddenImport(importSource, contract.forbidden_imports ?? [])) {
        continue;
      }
      if (isForbiddenImport(importSource, contract.allowed_imports ?? [])) {
        continue;
      }

      const diffStatus = diffStatusFor(importUsed.file_path, importUsed.start_line, input.parsedDiff, input.scope);
      const fingerprint = agentContractFindingFingerprint(
        "import-boundary",
        contract.id,
        importUsed.file_path,
        importUsed.name,
        importSource
      );
      const snapshot = input.snapshotsByPath.get(importUsed.file_path);
      const status = findingStatusForAgentContract(
        input.baseline,
        input.existingFindings,
        contract.id,
        fingerprint
      );
      findings.push({
        id: `finding_${fingerprint.slice(0, 16)}`,
        repo_id: input.repoId,
        convention_id: contract.id,
        check_id: input.checkId,
        repo_contract_id: input.contract.id,
        fingerprint,
        title: "Import boundary contract violated",
        message: `${importUsed.file_path} imports ${importPhrase(importUsed.name, importSource)}, which is forbidden for ${contract.source_roles.join(", ")}.`,
        severity: contract.enforcement === "blocking" ? "error" : "warning",
        enforcement_result: contract.enforcement === "blocking" ? "block" : "warn",
        status,
        diff_status: diffStatus,
        evidence_refs: [{
          id: `evidence_${fingerprint.slice(0, 16)}`,
          kind: "violation",
          file_path: importUsed.file_path,
          start_line: importUsed.start_line,
          end_line: importUsed.end_line,
          symbol: evidenceSymbol(importUsed.name),
          import_source: importSource,
          fact_ids: [importUsed.id],
          scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        expected_layer: "allowed_import_boundary",
        actual_layer: "forbidden_import",
        graph_path: [importUsed.file_path, importSource],
        suggested_fix: importBoundarySuggestedFix(importSource),
        related_node_ids: [],
        created_at: input.now
      });
    }
    // Every path out of this contract's body lands here, so the receipt records what the
    // evaluator saw whether or not it found anything - which is the whole distinction:
    // `findings_emitted: 0` beside `inputs_considered: 0` is a rule that never ran on
    // anything, and beside a positive count it is a rule that ran and was satisfied.
    input.receipts.ran(contract.id, {
      inputsConsidered: sourceFiles.size,
      findingsEmitted: findings.length - emittedBefore
    });
  }

  return findings;
}

/**
 * Changed files an agent contract claims to govern that the scan never indexed.
 *
 * Deliberately NOT "every non-TypeScript file in the diff". A README or a lockfile in a diff is
 * not a coverage gap - Drift never claimed to check it, and reporting one per diff would make the
 * signal worthless. The gap is narrower and real: a rule that *names* a file Drift cannot read.
 * The agent-contract evaluators glob the parsed diff, which carries no extension filter, so
 * `prisma/*.prisma` selects a file with no facts and no content hash. Evaluating it would answer
 * "does it export X" and "does it import Y" from absence, which reads as a violation rather than
 * as ignorance; skipping it silently reports a clean pass over a rule that ran on nothing.
 *
 * So the files are skipped by the evaluators and named here, and `partial_coverage` goes false.
 */
function unindexedAgentContractTargets(
  contract: RepoContract,
  parsedDiff: ReturnType<typeof parseUnifiedDiff>,
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>
): string[] {
  const changedFiles = parsedDiff.files.map((file) => file.path);
  // Unindexed covers both "no snapshot at all" and "snapshotted but not parsed" (a declaration
  // file). Both mean the same thing to a rule: Drift has no facts about this file.
  const unindexed = changedFiles.filter((filePath) => snapshotsByPath.get(filePath)?.indexed !== true);
  if (unindexed.length === 0) {
    return [];
  }
  const globs: string[] = [];
  for (const agentContract of contract.agent_contracts ?? []) {
    if (agentContract.kind === "file_role") {
      globs.push(...agentContract.roles.flatMap((role) => role.path_globs));
    }
    if (agentContract.kind === "required_change_checks") {
      globs.push(...agentContract.rules.flatMap((rule) => rule.applies_to.path_globs ?? []));
    }
  }
  if (globs.length === 0) {
    return [];
  }
  return unindexed
    .filter((filePath) => globs.some((glob) => matchesGlob(filePath, glob)))
    .sort();
}

function runFileRoleCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  receipts: EvaluationReceiptLedger;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "file_role") {
      input.receipts.skipped(contract.id, "not_dispatched_to_this_evaluator");
      continue;
    }
    const emittedBefore = findings.length;
    // Summed across roles rather than measured once: a file_role contract declares several roles
    // with independent globs, and "this contract examined 4 files" is the claim a reader checks.
    let filesConsidered = 0;

    for (const role of contract.roles) {
      // Scoped off the parsed diff, which carries no extension filter, so a glob like
      // `prisma/*.prisma` selects files the scan never indexed. Those are dropped here and
      // reported as a coverage gap by the caller rather than evaluated: with no facts and no
      // content hash, every question this rule asks ("does it export X", "does it import Y")
      // would be answered from absence, which reads as a violation rather than as ignorance.
      const files = [...changedFiles].filter((filePath) =>
        role.path_globs.some((glob) => matchesGlob(filePath, glob)) &&
        // `indexed`, not merely present. A declaration file is snapshotted for its hash and path
        // without being parsed, so it has a snapshot and no facts - evaluating it would answer
        // "does it export X" from absence and report a violation where Drift simply has not read.
        input.snapshotsByPath.get(filePath)?.indexed === true
      );
      filesConsidered += files.length;
      for (const filePath of files) {
        const imports = input.checkData.facts.filter((fact) =>
          fact.kind === "import_used" &&
          fact.file_path === filePath &&
          fact.value &&
          isForbiddenImport(fact.value, role.forbidden_imports ?? [])
        );
        for (const importUsed of imports) {
          const importSource = importUsed.value as string;
          findings.push(agentContractFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            agentContractId: contract.id,
            checkId: input.checkId,
            checkScanId: input.checkScanId,
            checkData: input.checkData,
            snapshotsByPath: input.snapshotsByPath,
            baseline: input.baseline,
            existingFindings: input.existingFindings,
            parsedDiff: input.parsedDiff,
            scope: input.scope,
            now: input.now,
            fingerprintKind: "file-role-forbidden-import",
            title: "File role contract violated",
            message: `${filePath} is in the ${role.role} role and imports forbidden dependency ${importSource}.`,
            severity: role.confidence === "deterministic" ? "error" : "warning",
            enforcementResult: role.confidence === "deterministic" ? "block" : "warn",
            filePath,
            startLine: importUsed.start_line,
            endLine: importUsed.end_line,
            symbol: evidenceSymbol(importUsed.name),
            importSource,
            factIds: [importUsed.id],
            expectedLayer: role.role,
            actualLayer: "forbidden_import",
            graphPath: [filePath, importSource],
            suggestedFix: `Remove forbidden import ${importSource} from ${role.role} files.`
          }));
        }

        const exportedSymbols = new Set(input.checkData.facts
          .filter((fact) => fact.kind === "exported_symbol" && fact.file_path === filePath)
          .map((fact) => fact.name));
        for (const requiredExport of role.required_exports ?? []) {
          if (exportedSymbols.has(requiredExport)) {
            continue;
          }
          const fileFact = fileDetectedFact(input.checkData.facts, filePath);
          findings.push(agentContractFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            agentContractId: contract.id,
            checkId: input.checkId,
            checkScanId: input.checkScanId,
            checkData: input.checkData,
            snapshotsByPath: input.snapshotsByPath,
            baseline: input.baseline,
            existingFindings: input.existingFindings,
            parsedDiff: input.parsedDiff,
            scope: input.scope,
            now: input.now,
            fingerprintKind: "file-role-required-export",
            title: "File role contract violated",
            message: `${filePath} is in the ${role.role} role but does not export required symbol ${requiredExport}.`,
            severity: role.confidence === "deterministic" ? "error" : "warning",
            enforcementResult: role.confidence === "deterministic" ? "block" : "warn",
            filePath,
            startLine: 1,
            endLine: fileFact?.end_line ?? 1,
            symbol: requiredExport,
            factIds: fileFact ? [fileFact.id] : [],
            expectedLayer: role.role,
            actualLayer: "missing_required_export",
            graphPath: [filePath, requiredExport],
            suggestedFix: `Export ${requiredExport} from ${role.role} files.`
          }));
        }
      }
    }
    // Every path out of this contract's body lands here, so the receipt records what the
    // evaluator saw whether or not it found anything - which is the whole distinction:
    // `findings_emitted: 0` beside `inputs_considered: 0` is a rule that never ran on
    // anything, and beside a positive count it is a rule that ran and was satisfied.
    input.receipts.ran(contract.id, {
      inputsConsidered: filesConsidered,
      findingsEmitted: findings.length - emittedBefore
    });
  }

  return findings;
}

function runEntrypointFlowCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  receipts: EvaluationReceiptLedger;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "entrypoint_flow") {
      input.receipts.skipped(contract.id, "not_dispatched_to_this_evaluator");
      continue;
    }
    const emittedBefore = findings.length;

    const entryFiles = filesWithRoles(input.checkData.facts, changedFiles, contract.entry_roles);
    for (const filePath of entryFiles) {
      const proof = buildEntrypointFlowProof({
        contract,
        entry_file_path: filePath,
        facts: input.checkData.facts
      });
      const callNames = new Set(input.checkData.facts
        .filter((fact) => fact.kind === "symbol_called" && fact.file_path === filePath)
        .map((fact) => fact.name));
      const importSources = new Set(input.checkData.facts
        .filter((fact) => fact.kind === "import_used" && fact.file_path === filePath && fact.value)
        .map((fact) => fact.value as string));

      for (const step of contract.required_steps) {
        const stepCalls = "calls" in step ? step.calls ?? [] : [];
        const stepImports = "imports" in step ? step.imports ?? [] : [];
        for (const callName of stepCalls) {
          if (callNames.has(callName)) {
            continue;
          }
          const fileFact = fileDetectedFact(input.checkData.facts, filePath);
          findings.push(agentContractFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            agentContractId: contract.id,
            checkId: input.checkId,
            checkScanId: input.checkScanId,
            checkData: input.checkData,
            snapshotsByPath: input.snapshotsByPath,
            baseline: input.baseline,
            existingFindings: input.existingFindings,
            parsedDiff: input.parsedDiff,
            scope: input.scope,
            now: input.now,
            fingerprintKind: `entrypoint-flow-missing-call-${step.kind}`,
            title: "Entrypoint flow contract violated",
            message: `${filePath} is missing required ${step.kind} call ${callName}.`,
            severity: contract.enforcement === "blocking" ? "error" : "warning",
            enforcementResult: contract.enforcement === "blocking" ? "block" : "warn",
            filePath,
            startLine: 1,
            endLine: fileFact?.end_line ?? 1,
            symbol: callName,
            factIds: fileFact ? [fileFact.id] : [],
            expectedLayer: step.kind,
            actualLayer: "missing_required_call",
            graphPath: [filePath, callName],
            suggestedFix: `Call ${callName} before completing this entrypoint.`
          }));
        }

        for (const importSource of stepImports) {
          if (importSources.has(importSource)) {
            continue;
          }
          const fileFact = fileDetectedFact(input.checkData.facts, filePath);
          findings.push(agentContractFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            agentContractId: contract.id,
            checkId: input.checkId,
            checkScanId: input.checkScanId,
            checkData: input.checkData,
            snapshotsByPath: input.snapshotsByPath,
            baseline: input.baseline,
            existingFindings: input.existingFindings,
            parsedDiff: input.parsedDiff,
            scope: input.scope,
            now: input.now,
            fingerprintKind: `entrypoint-flow-missing-import-${step.kind}`,
            title: "Entrypoint flow contract violated",
            message: `${filePath} is missing required ${step.kind} import ${importSource}.`,
            severity: contract.enforcement === "blocking" ? "error" : "warning",
            enforcementResult: contract.enforcement === "blocking" ? "block" : "warn",
            filePath,
            startLine: 1,
            endLine: fileFact?.end_line ?? 1,
            symbol: importSource,
            importSource,
            factIds: fileFact ? [fileFact.id] : [],
            expectedLayer: step.kind,
            actualLayer: "missing_required_import",
            graphPath: [filePath, importSource],
            suggestedFix: `Import ${importSource} before completing this entrypoint.`
          }));
        }
      }

      for (const forbiddenStep of proof.forbidden_steps) {
        if (!forbiddenStep.present) {
          continue;
        }
        const evidenceFact = input.checkData.facts.find((fact) =>
          forbiddenStep.evidence_refs.includes(fact.id)
        ) ?? fileDetectedFact(input.checkData.facts, filePath);
        findings.push(agentContractFinding({
          repoId: input.repoId,
          repoContractId: input.contract.id,
          agentContractId: contract.id,
          checkId: input.checkId,
          checkScanId: input.checkScanId,
          checkData: input.checkData,
          snapshotsByPath: input.snapshotsByPath,
          baseline: input.baseline,
          existingFindings: input.existingFindings,
          parsedDiff: input.parsedDiff,
          scope: input.scope,
          now: input.now,
          fingerprintKind: `entrypoint-flow-forbidden-${forbiddenStep.step_kind}`,
          title: "Entrypoint flow contract violated",
          message: `${filePath} includes forbidden ${forbiddenStep.step_kind} in its entrypoint flow.`,
          severity: contract.enforcement === "blocking" ? "error" : "warning",
          enforcementResult: contract.enforcement === "blocking" ? "block" : "warn",
          filePath,
          startLine: evidenceFact?.start_line ?? 1,
          endLine: evidenceFact?.end_line ?? 1,
          symbol: forbiddenStep.step_kind,
          importSource: evidenceFact?.value,
          factIds: forbiddenStep.evidence_refs,
          expectedLayer: "service_delegation",
          actualLayer: forbiddenStep.step_kind,
          graphPath: forbiddenStep.graph_path,
          suggestedFix: "Delegate data access and business logic through an accepted service layer."
        }));
      }
    }
    // Every path out of this contract's body lands here, so the receipt records what the
    // evaluator saw whether or not it found anything - which is the whole distinction:
    // `findings_emitted: 0` beside `inputs_considered: 0` is a rule that never ran on
    // anything, and beside a positive count it is a rule that ran and was satisfied.
    input.receipts.ran(contract.id, {
      inputsConsidered: entryFiles.size,
      findingsEmitted: findings.length - emittedBefore
    });
  }

  return findings;
}

function runRequiredCheckProofCheck(input: {
  repoId: string;
  contract: RepoContract;
  storage: SqliteDriftStorage;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  contractFingerprintValue: string;
  diffHash: string;
  receipts: EvaluationReceiptLedger;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));
  if (changedFiles.size === 0 && input.scope === "full") {
    for (const snapshot of input.checkData.snapshots) {
      changedFiles.add(snapshot.file_path);
    }
  }
  const changedRoles = new Set(input.checkData.facts
    .filter((fact) => fact.kind === "file_role_detected" && changedFiles.has(fact.file_path))
    .map((fact) => fact.name));

  for (const agentContract of input.contract.agent_contracts ?? []) {
    if (agentContract.kind !== "required_change_checks") {
      input.receipts.skipped(agentContract.id, "not_dispatched_to_this_evaluator");
      continue;
    }
    const emittedBefore = findings.length;
    for (const rule of agentContract.rules) {
      const pathMatch = !rule.applies_to.path_globs?.length ||
        [...changedFiles].some((file) =>
          rule.applies_to.path_globs!.some((glob) => matchesGlob(file, glob))
        );
      const roleMatch = !rule.applies_to.file_roles?.length ||
        rule.applies_to.file_roles.some((role) => changedRoles.has(role));
      if (!pathMatch || !roleMatch) {
        continue;
      }
      for (const requiredCheck of rule.required_checks) {
        if (!requiredCheck.required_for_release) {
          continue;
        }
        const latest = input.storage.latestRequiredCheckExecution(input.repoId, requiredCheck.command);
        if (
          latest?.status === "passed" &&
          latest.repo_contract_id === input.contract.id &&
          latest.agent_contract_id === agentContract.id &&
          latest.contract_fingerprint === input.contractFingerprintValue &&
          latest.diff_hash === input.diffHash
        ) {
          continue;
        }
        const proofState = requiredCheckProofState(
          latest,
          input.contract.id,
          agentContract.id,
          input.contractFingerprintValue,
          input.diffHash
        );
        // This finding is about a missing command proof, not about a file - the path is only a
        // place to anchor evidence. Prefer an indexed changed file so the evidence carries a real
        // content hash: the alphabetically-first changed file may be one the scan never indexed
        // (a lockfile, a schema), which has no hash to attach.
        const firstFile = [...changedFiles].sort().find((file) => input.snapshotsByPath.has(file))
          ?? input.checkData.snapshots[0]?.file_path
          ?? "required-checks";
        const firstChangedLine = [...(input.parsedDiff.files.find((file) => file.path === firstFile)
          ?.changedLines ?? [])].sort((left, right) => left - right)[0];
        const fileFact = fileDetectedFact(input.checkData.facts, firstFile);
        const evidenceStartLine = firstChangedLine ?? fileFact?.start_line ?? 1;
        findings.push(agentContractFinding({
          repoId: input.repoId,
          repoContractId: input.contract.id,
          agentContractId: agentContract.id,
          checkId: input.checkId,
          checkScanId: input.checkScanId,
          checkData: input.checkData,
          snapshotsByPath: input.snapshotsByPath,
          baseline: input.baseline,
          existingFindings: input.existingFindings,
          parsedDiff: input.parsedDiff,
          scope: input.scope,
          now: input.now,
          fingerprintKind: "required-check-not-run",
          title: proofState.title,
          message: proofState.message(requiredCheck.command),
          severity: "error",
          enforcementResult: "block",
          filePath: firstFile,
          startLine: evidenceStartLine,
          endLine: Math.max(evidenceStartLine, fileFact?.end_line ?? evidenceStartLine),
          symbol: requiredCheck.command,
          factIds: fileFact ? [fileFact.id] : [],
          expectedLayer: "required_check_execution",
          actualLayer: proofState.actualLayer,
          graphPath: [firstFile, requiredCheck.command],
          suggestedFix: `Run drift checks run --repo ${input.repoId} --command "${requiredCheck.command}" --json.`
        }));
      }
    }
    // Every path out of this contract's body lands here, so the receipt records what the
    // evaluator saw whether or not it found anything - which is the whole distinction:
    // `findings_emitted: 0` beside `inputs_considered: 0` is a rule that never ran on
    // anything, and beside a positive count it is a rule that ran and was satisfied.
    input.receipts.ran(agentContract.id, {
      inputsConsidered: changedFiles.size,
      findingsEmitted: findings.length - emittedBefore
    });
  }

  return findings;
}

function requiredCheckProofState(
  latest: RequiredCheckExecution | null,
  repoContractId: string,
  agentContractId: string,
  contractFingerprintValue: string,
  diffHash: string
): {
  title: string;
  actualLayer: string;
  message: (command: string) => string;
} {
  if (!latest) {
    return {
      title: "Required check has not been proven",
      actualLayer: "required_check_not_run",
      message: (command) =>
        `${command} is required for this change, but Drift has no passing execution proof for the active contract.`
    };
  }
  if (latest.status !== "passed") {
    return {
      title: "Required check has not passed",
      actualLayer: "required_check_failed",
      message: (command) =>
        `${command} is required for this change, but the latest execution proof did not pass.`
    };
  }
  if (latest.repo_contract_id !== repoContractId || latest.agent_contract_id !== agentContractId) {
    return {
      title: "Required check proof belongs to another contract",
      actualLayer: "required_check_wrong_contract",
      message: (command) =>
        `${command} has passing proof, but it was recorded for a different repo or agent contract.`
    };
  }
  if (latest.contract_fingerprint !== contractFingerprintValue) {
    return {
      title: "Required check proof is stale for the active contract",
      actualLayer: "required_check_stale_contract",
      message: (command) =>
        `${command} has passing proof, but the active contract fingerprint changed after it ran.`
    };
  }
  if (latest.diff_hash !== diffHash) {
    return {
      title: "Required check proof is stale for this diff",
      actualLayer: "required_check_stale_proof",
      message: (command) =>
        `${command} has passing proof, but it was recorded for a different diff.`
    };
  }
  return {
    title: "Required check has not been proven",
    actualLayer: "required_check_not_run",
    message: (command) =>
      `${command} is required for this change, but Drift has no passing execution proof for the active contract.`
  };
}

function modulePlacementAllowed(filePath: string, allowedPaths: string[], forbiddenPaths: string[]): boolean {
  if (forbiddenPaths.some((glob) => matchesGlob(filePath, glob))) {
    return false;
  }
  return allowedPaths.length === 0 || allowedPaths.some((glob) => matchesGlob(filePath, glob));
}

function modulePlacementSuggestedFix(filePath: string, allowedPaths: string[]): string {
  const target = allowedPaths[0] ?? "an accepted module path";
  return `Move ${filePath} under ${target}.`;
}

function importBoundarySuggestedFix(importSource: string): string {
  return `Import through an accepted delegate instead of importing ${importSource} directly.`;
}

function filesWithRoles(facts: FactRecord[], files: Set<string>, roles: FileRole[]): Set<string> {
  return new Set(facts
    .filter((fact) =>
      fact.kind === "file_role_detected" &&
      files.has(fact.file_path) &&
      roles.includes(fact.name as FileRole)
    )
    .map((fact) => fact.file_path));
}

function fileDetectedFact(facts: FactRecord[], filePath: string): FactRecord | undefined {
  return facts.find((fact) => fact.kind === "file_detected" && fact.file_path === filePath);
}

function agentContractFinding(input: {
  repoId: string;
  repoContractId: string;
  agentContractId: string;
  checkId: string;
  checkScanId: string;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  scope: "changed-hunks" | "changed-files" | "full";
  now: string;
  fingerprintKind: string;
  title: string;
  message: string;
  severity: Finding["severity"];
  enforcementResult: Finding["enforcement_result"];
  filePath: string;
  startLine: number;
  endLine: number;
  // Absent for a bindingless side-effect import (S10): nothing was bound.
  symbol?: string;
  importSource?: string;
  factIds: string[];
  expectedLayer: string;
  actualLayer: string;
  graphPath: string[];
  suggestedFix: string;
}): Finding {
  const fingerprint = agentContractFindingFingerprint(
    input.fingerprintKind,
    input.agentContractId,
    input.filePath,
    // The fingerprint keeps the sentinel. It is an identity, not a message: "this file, no
    // binding, this specifier" is a stable and distinct thing to be, and substituting the
    // empty string would collide with any other symbol-less shape added later.
    input.symbol ?? SIDE_EFFECT_IMPORT_BINDING,
    input.importSource ?? input.actualLayer
  );
  const snapshot = input.snapshotsByPath.get(input.filePath);
  // Fail closed rather than emit a finding Drift cannot substantiate.
  //
  // `file_hash` fell back to `""` here, which `EvidenceRefSchema` rejects (min(1)) at
  // `upsertFinding`. The throw surfaced as a raw Zod trace and exit 1, killing the whole check -
  // including conventions that had evaluated cleanly. It is reachable from any agent contract
  // whose `path_globs` match a file the scan does not index, which today means any non-TypeScript
  // path: the evaluators glob the parsed diff, which carries no extension filter.
  //
  // Callers are expected to skip unindexed files before reaching here; this is the backstop that
  // keeps a missed guard a legible refusal instead of a crash.
  if (!snapshot?.content_hash) {
    throw new DriftError(
      `Refusing to report a finding for ${input.filePath}: it is named by agent contract ${input.agentContractId} but carries no indexed scan snapshot, so Drift has no content hash to attach as evidence.`,
      {
        code: "unindexed_contract_target",
        userAction:
          "Narrow the contract's path_globs to files Drift indexes, or wait for support for this file type. Drift indexes TypeScript and JavaScript sources.",
        recoveryCommands: ["drift contract show --repo <repo_id> --json"],
        safeToRetry: false,
      }
    );
  }
  const status = findingStatusForAgentContract(
    input.baseline,
    input.existingFindings,
    input.agentContractId,
    fingerprint
  );
  return {
    id: `finding_${fingerprint.slice(0, 16)}`,
    repo_id: input.repoId,
    convention_id: input.agentContractId,
    check_id: input.checkId,
    repo_contract_id: input.repoContractId,
    fingerprint,
    title: input.title,
    message: input.message,
    severity: input.severity,
    enforcement_result: input.enforcementResult,
    status,
    diff_status: diffStatusFor(input.filePath, input.startLine, input.parsedDiff, input.scope),
    evidence_refs: [{
      id: `evidence_${fingerprint.slice(0, 16)}`,
      kind: "violation",
      file_path: input.filePath,
      start_line: input.startLine,
      end_line: input.endLine,
      symbol: input.symbol,
      import_source: input.importSource,
      fact_ids: input.factIds,
      scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
      file_hash: snapshot.content_hash,
      redaction_state: "none"
    }],
    expected_layer: input.expectedLayer,
    actual_layer: input.actualLayer,
    graph_path: input.graphPath,
    suggested_fix: input.suggestedFix,
    related_node_ids: [],
    created_at: input.now
  };
}

/**
 * T-06: whether an active baseline row grandfathers this finding, current or legacy fingerprint.
 *
 * The engine has always matched legacy fingerprints as well as current ones
 * (`check_command.rs`), which is how a fingerprint formula can change without un-baselining what
 * it identifies. The TypeScript path had three hand-copied match expressions and no legacy
 * concept at all, so the two halves of the product disagreed about what "already baselined"
 * means - and the next change to a TypeScript-side formula would have silently un-grandfathered
 * every finding that path owns, with no test able to see it.
 *
 * One predicate, used by all three, so the halves cannot drift apart again.
 */
export function isBaselinedFinding(
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>,
  conventionId: string,
  fingerprint: string,
  legacyFingerprints: string[] = []
): boolean {
  const candidates = new Set([fingerprint, ...legacyFingerprints]);
  return baseline.some((entry) =>
    entry.status === "active" &&
    entry.convention_id === conventionId &&
    candidates.has(entry.finding_fingerprint)
  );
}

function findingStatusForAgentContract(
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>,
  existingFindings: Map<string, Finding>,
  contractId: string,
  fingerprint: string,
  legacyFingerprints: string[] = []
): Finding["status"] {
  return isBaselinedFinding(baseline, contractId, fingerprint, legacyFingerprints)
    ? "pre_existing"
    : preservedGovernanceStatus(existingFindings.get(fingerprint)) ?? "new";
}

function graphPathForFinding(
  relatedNodeIds: string[],
  filePath: string,
  importSource: string | undefined
): string[] {
  if (relatedNodeIds.length > 0) {
    return relatedNodeIds;
  }
  return [filePath, importSource].filter((value): value is string => Boolean(value));
}

function affectedScopeSummary(
  parsedDiff: ReturnType<typeof parseUnifiedDiff>,
  scope: string,
  missingFiles: string[] = []
): {
  mode: string;
  changed_file_count: number;
  changed_line_count: number;
  deleted_file_count: number;
  deleted_files: string[];
  renamed_file_count: number;
  missing_file_count: number;
  missing_files: string[];
} {
  const missingCount = missingFiles.length;
  return {
    mode: scope,
    changed_file_count: parsedDiff.files.length,
    changed_line_count: parsedDiff.files.reduce((total, file) => total + file.changedLines.size, 0),
    deleted_file_count: parsedDiff.deletedFiles.length,
    deleted_files: parsedDiff.deletedFiles,
    // BB-1: so `Checked 0 files` can name a rename as its reason, the same way it names a deletion.
    renamed_file_count: (parsedDiff.renamedFiles ?? []).length,
    // BB-9: files the diff named that the working tree does not have.
    missing_file_count: missingCount,
    missing_files: missingFiles
  };
}

function checkOutcomeSummary(
  findings: Finding[],
  input: {
    waivedFindingsCount: number;
    expiredFindingsCount: number;
    scope: "changed-hunks" | "changed-files" | "full";
  }
): {
  status_counts: Partial<Record<Finding["status"], number>>;
  diff_status_counts: Partial<Record<Finding["diff_status"], number>>;
  enforcement_counts: Partial<Record<Finding["enforcement_result"], number>>;
  blocking_reasons: Array<{ reason: string; count: number }>;
  warning_reasons: Array<{ reason: string; count: number }>;
  non_blocking_reasons: Array<{ reason: string; count: number }>;
} {
  const statusCounts = countFindingsBy(findings, (finding) => finding.status);
  const diffStatusCounts = countFindingsBy(findings, (finding) => finding.diff_status);
  const enforcementCounts = countFindingsBy(findings, (finding) => finding.enforcement_result);
  // Same rule as blockingCount above; see the T121 note there.
  const blockingNewHunks = findings.filter((finding) =>
    finding.diff_status === "new_in_diff" &&
    finding.enforcement_result === "block" &&
    !isClosedFindingStatus(finding.status) &&
    finding.status !== "needs_review"
  ).length;
  const warnings = findings.filter((finding) =>
    finding.diff_status === "new_in_diff" &&
    finding.enforcement_result === "warn" &&
    !isClosedFindingStatus(finding.status)
  ).length;
  // Counted non-blocking only when the line itself was not changed; a baselined violation whose
  // line is new code in this diff is counted above instead.
  const preExisting = findings.filter(
    (finding) => finding.status === "pre_existing" && finding.diff_status !== "new_in_diff"
  ).length;
  const touchedExisting = findings.filter((finding) =>
    finding.status === "new" && finding.diff_status === "touched_existing"
  ).length;
  const outsideDiff = findings.filter((finding) =>
    finding.status === "new" && finding.diff_status === "outside_diff"
  ).length;

  return {
    status_counts: statusCounts,
    diff_status_counts: diffStatusCounts,
    enforcement_counts: enforcementCounts,
    blocking_reasons: compactReasons([
      ["new_blocking_violation_in_changed_hunk", blockingNewHunks]
    ]),
    warning_reasons: compactReasons([
      ["new_warning_violation_in_changed_hunk", warnings]
    ]),
    non_blocking_reasons: compactReasons([
      ["pre_existing_baseline", preExisting],
      ["touched_existing_not_new_hunk", touchedExisting],
      ["outside_diff", outsideDiff],
      ["waived_by_contract", input.waivedFindingsCount],
      ["expired_convention_findings", input.expiredFindingsCount],
      [input.scope === "changed-files" ? "changed_files_mode_does_not_infer_new_hunks" : "", input.scope === "changed-files" ? touchedExisting : 0],
      [input.scope === "full" ? "full_scope_reports_existing_violations_without_blocking" : "", input.scope === "full" ? touchedExisting : 0]
    ])
  };
}

function countFindingsBy<T extends string>(
  findings: Finding[],
  selector: (finding: Finding) => T
): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const finding of findings) {
    const key = selector(finding);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function compactReasons(entries: Array<[string, number]>): Array<{ reason: string; count: number }> {
  return entries
    .filter(([reason, count]) => reason.length > 0 && count > 0)
    .map(([reason, count]) => ({ reason, count }));
}

async function runEngineOwnedDirectDataAccessCheck(input: {
  repoId: string;
  repoRoot: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  contractFingerprintValue: string;
  diffHash: string;
  receipts: EvaluationReceiptLedger;
}): Promise<{ findings: Finding[]; waivedFindings: WaivedFinding[]; waivedFindingsCount: number }> {
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  let waivedFindingsCount = 0;

  for (const convention of input.contract.conventions) {
    // Split from one four-cause `continue` for the reason given on
    // ENGINE_OWNED_AUTH_CONVENTION_KINDS: a receipt can only name the cause the code distinguished.
    if (convention.kind !== "api_route_no_direct_data_access") {
      input.receipts.skipped(convention.id, "not_dispatched_to_this_evaluator");
      continue;
    }
    if (convention.enforcement_mode === "off") {
      input.receipts.skipped(convention.id, "enforcement_mode_off");
      continue;
    }
    if (convention.enforcement_capability !== "deterministic_check") {
      input.receipts.skipped(convention.id, "capability_not_deterministic");
      continue;
    }
    if (!isActiveConvention(convention, input.now)) {
      input.receipts.skipped(convention.id, "convention_expired");
      continue;
    }

    const files = filesForConvention(input.parsedDiff, convention, input.scope)
      .filter((filePath) => isApiRoutePath(filePath) && !isExceptedPath(filePath, convention, input.now));
    const fileSet = new Set(files);
    const skippedImportFactIds = new Set<string>();
    const importFactsByEvidence = new Map<string, ReturnType<typeof importFactsForFile>[number]>();
    const allowedGraphImportFacts = new Map<string, ReturnType<typeof importFactsForFile>[number]>();

    for (const filePath of files) {
      for (const importUsed of importFactsForFile(input.checkData.facts, filePath)) {
        const forbiddenImports = convention.matcher.forbidden_imports ?? [];
        const directlyForbidden = isForbiddenImport(importUsed.value, forbiddenImports);
        const graphForbidden = graphImportResolvesToForbidden(input.checkData, filePath, importUsed, forbiddenImports);
        if (isExceptedImport(
          filePath,
          importUsed.name,
          importUsed.value,
          convention,
          input.now,
          exceptionContextForImport(input.checkData, filePath, importUsed)
        )) {
          skippedImportFactIds.add(importUsed.fact_id);
          continue;
        }
        const waiver = findContractWaiverForImport(filePath, importUsed.name, importUsed.value, input.contract, input.now);
        if (waiver) {
          const staleWaiver = waiverRequiresReapproval(
            waiver,
            filePath,
            input.snapshotsByPath.get(filePath)?.content_hash
          );
          if (staleWaiver) {
            findings.push(waiverReapprovalFinding({
              repoId: input.repoId,
              repoContractId: input.contract.id,
              conventionId: convention.id,
              checkId: input.checkId,
              scanId: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
              filePath,
              line: importUsed.start_line,
              symbol: evidenceSymbol(importUsed.name),
              importSource: importUsed.value,
              fileHash: input.snapshotsByPath.get(filePath)?.content_hash ?? "",
              waiverId: waiver.id,
              now: input.now
            }));
          } else {
          skippedImportFactIds.add(importUsed.fact_id);
          if (directlyForbidden || graphForbidden) {
            waivedFindingsCount += 1;
            waivedFindings.push({
              waiver_id: waiver.id,
              convention_id: convention.id,
              file_path: filePath,
              symbol: evidenceSymbol(importUsed.name),
              import_source: importUsed.value,
              line: importUsed.start_line,
              reason: waiver.reason
            });
          }
          continue;
          }
        }
        allowedGraphImportFacts.set(importFactGraphKey(filePath, importUsed), importUsed);
        importFactsByEvidence.set(`${filePath}:${importUsed.start_line}`, importUsed);
        if (!directlyForbidden && !graphForbidden) {
          continue;
        }
      }
    }

    const facts = input.checkData.facts.filter((fact) =>
      fileSet.has(fact.file_path) && !skippedImportFactIds.has(fact.id)
    );
    const snapshots = input.checkData.snapshots.filter((snapshot) => fileSet.has(snapshot.file_path));
    const graph = graphForEngineCheck(input.checkData, fileSet, allowedGraphImportFacts);
    // Computed from the full graph, before it is scoped to the diff. That ordering is the whole
    // point of computing them here: `graph` above is already narrowed to the changed files, and the
    // imports that establish what a specifier MEANS routinely live outside the diff.
    const forbiddenModuleFiles = [
      ...resolvedModuleFilesFor(input.checkData, convention.matcher.forbidden_imports ?? [])
    ];
    const acceptedHelperModuleFiles = resolvedHelperIdentities(input.checkData, convention);
    const result = await runEngineCheck({
      forbiddenModuleFiles,
      acceptedHelperModuleFiles,
      repoId: input.repoId,
      repoRoot: input.repoRoot,
      scanId: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
      contractId: input.contract.id,
      contractSchemaVersion: input.contract.contract_schema_version,
      contractWaivers: input.contract.waivers,
      facts,
      snapshots,
      graphNodes: graph.nodes,
      graphEdges: graph.edges,
      graphEvidence: graph.evidence,
      graphDiagnostics: graph.diagnostics,
      conventions: [convention],
      baseline: input.baseline,
      diff: input.parsedDiff,
      scope: input.scope
    });
    // Unlike the auth loop below, this one does NOT skip an empty file set - it hands the engine
    // whatever it has, because the graph half of this rule can flag a route through an import the
    // diff never touched. So the receipt records a genuine zero rather than a skip: the evaluator
    // ran, on nothing, which is the state (b) this mechanism exists to separate from (a).
    input.receipts.ran(convention.id, {
      inputsConsidered: fileSet.size,
      findingsEmitted: result.findings.length
    });
    input.receipts.applyEngineReceipts(result.evaluation_receipts ?? []);
    for (const engineFinding of result.findings) {
      const evidence = engineFinding.evidence[0];
      if (!evidence) {
        continue;
      }
      const importUsed = importFactsByEvidence.get(`${evidence.file_path}:${evidence.start_line ?? 1}`);
      const snapshot = input.snapshotsByPath.get(evidence.file_path);
      const preserved = preservedGovernanceStatus(input.existingFindings.get(engineFinding.fingerprint));
      findings.push({
        id: engineFinding.id,
        repo_id: input.repoId,
        convention_id: engineFinding.convention_id,
        check_id: input.checkId,
        repo_contract_id: input.contract.id,
        fingerprint: engineFinding.fingerprint,
        title: engineFinding.title,
        message: engineFinding.message,
        severity: engineFinding.severity,
        enforcement_result: engineFinding.enforcement_result,
        status: engineFinding.status_hint === "pre_existing" ? "pre_existing" : preserved ?? "new",
        diff_status: engineFinding.diff_status,
        evidence_refs: [{
          id: evidence.evidence_id ?? `evidence_${engineFinding.fingerprint.slice(0, 16)}`,
          kind: "violation",
          file_path: evidence.file_path,
          start_line: evidence.start_line,
          // The engine reports a violation at a single line (`end_line: finding.line`,
          // check_command.rs:336), which flattens a multiline import to its first line. The
          // import fact carries the real span and is already the source of truth for the symbol,
          // source and fact id below, so prefer it here too. Surfaced when onboarding stopped
          // using its own baseline pass, which read the fact directly and got 1-3 where this
          // path got 1-1.
          end_line: importUsed?.end_line ?? evidence.end_line,
          symbol: evidenceSymbol(importUsed?.name),
          import_source: importUsed?.value,
          fact_ids: importUsed?.fact_id ? [importUsed.fact_id] : [],
          scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        expected_layer: "service",
        actual_layer: "data_access",
        graph_path: graphPathForFinding(engineFinding.related_node_ids, evidence.file_path, importUsed?.value),
        suggested_fix: directDataAccessSuggestedFix(),
        related_node_ids: engineFinding.related_node_ids,
        created_at: input.now
      });
    }
  }

  return { findings, waivedFindings, waivedFindingsCount };
}

/**
 * The twelve kinds this evaluator dispatches, as a set rather than a twelve-clause negation.
 *
 * Extracted so the loop can ask "is this mine?" before it asks anything else, which is what lets
 * every other outcome carry its own receipt reason. As a negated chain the twelve kind tests, the
 * mode test, the capability test and the expiry test were one `continue` with four unrelated
 * causes behind it, and a receipt cannot say which one applied if the code never distinguished
 * them either.
 */
const ENGINE_OWNED_AUTH_CONVENTION_KINDS = new Set([
  "api_route_requires_auth_helper",
  "api_route_requires_request_validation",
  "api_route_forbids_untrusted_ssrf",
  "api_route_forbids_raw_sql_without_params",
  "api_route_cors_must_match_policy",
  "api_route_requires_csrf_for_mutation",
  "api_route_requires_rate_limit",
  "api_route_forbids_sensitive_response_fields",
  "api_route_forbids_secret_exposure",
  "session_object_must_come_from_trusted_helper",
  "api_route_requires_authorization",
  "api_route_requires_tenant_scope"
]);

async function runEngineOwnedAuthCheck(input: {
  repoId: string;
  repoRoot: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  receipts: EvaluationReceiptLedger;
}): Promise<{
  findings: Finding[];
  waivedFindings: WaivedFinding[];
  waivedFindingsCount: number;
  securityBoundaryProofs: SecurityBoundaryProof[];
  /** Engine diagnostics naming an accepted convention that is configured to enforce nothing. */
  unenforceableConventions: string[];
}> {
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  let waivedFindingsCount = 0;
  const securityBoundaryProofs: SecurityBoundaryProof[] = [];
  const unenforceableConventions: string[] = [];

  for (const convention of input.contract.conventions) {
    const dispatchedHere = ENGINE_OWNED_AUTH_CONVENTION_KINDS.has(convention.kind);
    if (!dispatchedHere) {
      // Another evaluator's convention. Recorded rather than passed over in silence so that a kind
      // no evaluator claims ends the run with `not_dispatched_to_this_evaluator` still on its
      // receipt - the seeded default surviving every loop is exactly the signal.
      input.receipts.skipped(convention.id, "not_dispatched_to_this_evaluator");
      continue;
    }
    if (convention.enforcement_mode === "off") {
      input.receipts.skipped(convention.id, "enforcement_mode_off");
      continue;
    }
    if (convention.enforcement_capability !== "deterministic_check") {
      // The arm below requires `deterministic_check`, so this convention cannot reach it whatever
      // the repo contains. That is the api_route_requires_service_delegation shape, and naming it
      // on the receipt is how it stops being invisible.
      input.receipts.skipped(convention.id, "capability_not_deterministic");
      continue;
    }
    if (!isActiveConvention(convention, input.now)) {
      input.receipts.skipped(convention.id, "convention_expired");
      continue;
    }
    const files = filesForConvention(input.parsedDiff, convention, input.scope)
      .filter((filePath) => isApiRoutePath(filePath) && !isExceptedPath(filePath, convention, input.now));
    const fileSet = new Set(files);
    if (fileSet.size === 0) {
      // THE COLLAPSE POINT. Twelve security kinds are dispatched from this one loop, and this
      // `continue` dropped every one of them - accepted, in scope, never evaluated - leaving the
      // run indistinguishable from one that evaluated them and found nothing. `findings: 0`,
      // `partial_coverage.complete: true`, `status: pass`, exit 0. Nothing downstream could tell
      // the difference, because nothing downstream was told.
      //
      // Still a `continue`: calling the engine with an empty file set would cost a process launch
      // to be handed nothing. What changes is that the run now says so.
      input.receipts.skipped(convention.id, "no_matching_files");
      continue;
    }

    const result = await runEngineCheck({
      repoId: input.repoId,
      repoRoot: input.repoRoot,
      scanId: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
      contractId: input.contract.id,
      contractSchemaVersion: input.contract.contract_schema_version,
      contractWaivers: input.contract.waivers,
      facts: input.checkData.facts.filter((fact) => fileSet.has(fact.file_path)),
      snapshots: input.checkData.snapshots.filter((snapshot) => fileSet.has(snapshot.file_path)),
      conventions: [convention],
      baseline: input.baseline,
      diff: input.parsedDiff,
      scope: input.scope
    });
    // The convention was evaluated. Recorded from the engine's own answer rather than from the
    // fact that we called it: the engine has skips of its own (an unreadable route source, a kind
    // it does not own) and reports them as receipts, which `applyEngineReceipts` folds in below.
    input.receipts.ran(convention.id, {
      inputsConsidered: fileSet.size,
      findingsEmitted: result.findings.length
    });
    input.receipts.applyEngineReceipts(result.evaluation_receipts ?? []);
    securityBoundaryProofs.push(
      ...result.security_boundary_proofs.map((proof) => SecurityBoundaryProofSchema.parse(proof))
    );
    // §5.1.4: dead config. Carried by message, not code alone, because the message is the part
    // that tells the user which convention and what to do about it.
    unenforceableConventions.push(
      ...(result.diagnostics ?? [])
        .filter((diagnostic) =>
          diagnostic.code === "convention_config_unenforceable" ||
          diagnostic.code === "convention_config_unreadable"
        )
        .map((diagnostic) => diagnostic.message)
    );

    for (const engineFinding of result.findings) {
      const evidence = engineFinding.evidence[0];
      if (!evidence) {
        continue;
      }
      const evidenceStartLine = evidence.start_line ?? 1;
      const evidenceEndLine = evidence.end_line ?? evidenceStartLine;
      const snapshot = input.snapshotsByPath.get(evidence.file_path);
      const evidenceFacts = input.checkData.facts
        .filter((fact) =>
          fact.file_path === evidence.file_path &&
          fact.start_line >= evidenceStartLine &&
          fact.end_line <= evidenceEndLine
        )
        .map((fact) => fact.id);
      const preserved = preservedGovernanceStatus(input.existingFindings.get(engineFinding.fingerprint));
      const isRequestValidationFinding = engineFinding.rule_id === "api_route_requires_request_validation";
      const isPhase6Finding = isPhase6SecurityFinding(engineFinding.rule_id);
      const isPhase5Finding = isPhase5SecurityFinding(engineFinding.rule_id);
      const isPhase4Finding = isPhase4SecurityFinding(engineFinding.rule_id);
      const proofForFinding = result.security_boundary_proofs.find((proof) =>
        proof.result.finding_ids.includes(engineFinding.id)
      );
      const waiver = isPhase4Finding || isPhase5Finding
        ? findContractWaiverForImport(
            evidence.file_path,
            isPhase5Finding
              ? phase5ExpectedLayer(engineFinding.rule_id)
              : phase4ExpectedLayer(engineFinding.rule_id),
            isPhase5Finding
              ? phase5ActualLayer(proofForFinding, engineFinding.rule_id)
              : phase4ActualLayer(proofForFinding),
            input.contract,
            input.now
          )
        : undefined;
      if (waiver) {
        const staleWaiver = waiverRequiresReapproval(
          waiver,
          evidence.file_path,
          snapshot?.content_hash
        );
        if (staleWaiver) {
          findings.push(waiverReapprovalFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            conventionId: engineFinding.convention_id,
            checkId: input.checkId,
            scanId: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
            filePath: evidence.file_path,
            line: evidenceStartLine,
            symbol: isPhase5Finding
              ? phase5ExpectedLayer(engineFinding.rule_id)
              : phase4ExpectedLayer(engineFinding.rule_id),
            importSource: isPhase5Finding
              ? phase5ActualLayer(proofForFinding, engineFinding.rule_id)
              : phase4ActualLayer(proofForFinding),
            fileHash: snapshot?.content_hash ?? "",
            waiverId: waiver.id,
            now: input.now
          }));
        } else {
          waivedFindingsCount += 1;
          waivedFindings.push({
            waiver_id: waiver.id,
            convention_id: engineFinding.convention_id,
            file_path: evidence.file_path,
            symbol: isPhase5Finding
              ? phase5ExpectedLayer(engineFinding.rule_id)
              : phase4ExpectedLayer(engineFinding.rule_id),
            import_source: isPhase5Finding
              ? phase5ActualLayer(proofForFinding, engineFinding.rule_id)
              : phase4ActualLayer(proofForFinding),
            line: evidenceStartLine,
            reason: waiver.reason
          });
        }
        continue;
      }
      findings.push({
        id: engineFinding.id,
        repo_id: input.repoId,
        convention_id: engineFinding.convention_id,
        check_id: input.checkId,
        repo_contract_id: input.contract.id,
        fingerprint: engineFinding.fingerprint,
        title: engineFinding.title,
        message: engineFinding.message,
        severity: engineFinding.severity,
        enforcement_result: engineFinding.enforcement_result,
        status: engineFinding.status_hint === "pre_existing" ? "pre_existing" : preserved ?? "new",
        diff_status: engineFinding.diff_status,
        evidence_refs: [{
          id: evidence.evidence_id ?? `evidence_${engineFinding.fingerprint.slice(0, 16)}`,
          kind: "violation",
          file_path: evidence.file_path,
          start_line: evidenceStartLine,
          end_line: evidenceEndLine,
          // T-03: the symbol the engine says this finding is about - the handler name, for kinds
          // enforced per handler. Spread rather than assigned so a finding with no symbol keeps
          // the key absent instead of gaining an explicit null.
          ...(evidence.symbol ? { symbol: evidence.symbol } : {}),
          fact_ids: evidenceFacts,
          scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        expected_layer: isRequestValidationFinding
          ? "request_validation"
          : isPhase6Finding
            ? phase6ExpectedLayer(engineFinding.rule_id)
          : isPhase5Finding
            ? phase5ExpectedLayer(engineFinding.rule_id)
          : isPhase4Finding
            ? phase4ExpectedLayer(engineFinding.rule_id)
            : "auth_guard",
        actual_layer: isRequestValidationFinding
          ? requestValidationActualLayer(proofForFinding)
          : isPhase6Finding
            ? phase6ActualLayer(proofForFinding)
          : isPhase5Finding
            ? phase5ActualLayer(proofForFinding, engineFinding.rule_id)
          : isPhase4Finding
            ? phase4ActualLayer(proofForFinding)
            : "missing_auth_guard",
        graph_path: [evidence.file_path],
        suggested_fix: isRequestValidationFinding
          ? "Validate request input with an accepted validator before using it at protected route sinks."
          : isPhase6Finding
            ? "Add accepted Phase 6 proof before SSRF, raw SQL, CORS, CSRF, or rate-limit protected sinks."
          : isPhase5Finding
            ? phase5SuggestedFix(engineFinding.rule_id)
          : isPhase4Finding
            ? "Add accepted session trust, authorization, and tenant-scope proof before protected route sinks."
            : "Call an accepted auth helper before route data operations or response sinks.",
        related_node_ids: engineFinding.related_node_ids,
        created_at: input.now
      });
    }
  }

  return {
    findings,
    waivedFindings,
    waivedFindingsCount,
    securityBoundaryProofs,
    unenforceableConventions
  };
}

function isPhase5SecurityFinding(ruleId: string): boolean {
  return ruleId === "api_route_forbids_sensitive_response_fields" ||
    ruleId === "api_route_forbids_secret_exposure";
}

function isPhase6SecurityFinding(ruleId: string): boolean {
  return ruleId === "api_route_forbids_untrusted_ssrf" ||
    ruleId === "api_route_forbids_raw_sql_without_params" ||
    ruleId === "api_route_cors_must_match_policy" ||
    ruleId === "api_route_requires_csrf_for_mutation" ||
    ruleId === "api_route_requires_rate_limit";
}

function phase6ExpectedLayer(ruleId: string): string {
  if (ruleId === "api_route_forbids_untrusted_ssrf") {
    return "outbound_request";
  }
  if (ruleId === "api_route_forbids_raw_sql_without_params") {
    return "raw_sql";
  }
  if (ruleId === "api_route_cors_must_match_policy") {
    return "cors_policy";
  }
  if (ruleId === "api_route_requires_csrf_for_mutation") {
    return "csrf_guard";
  }
  if (ruleId === "api_route_requires_rate_limit") {
    return "rate_limit_guard";
  }
  return "security_boundary";
}

function phase6ActualLayer(proof: unknown): string {
  if (!proof || typeof proof !== "object") {
    return "missing_phase6_proof";
  }
  const candidate = proof as {
    parser_gaps?: Array<{ code?: unknown }>;
    missing_proof?: Array<{ code?: unknown }>;
  };
  const parserGapCode = candidate.parser_gaps?.find((gap) =>
    typeof gap.code === "string"
  )?.code;
  if (typeof parserGapCode === "string") {
    return parserGapCode;
  }
  const missingProofCode = candidate.missing_proof?.find((missing) =>
    typeof missing.code === "string"
  )?.code;
  return typeof missingProofCode === "string" ? missingProofCode : "missing_phase6_proof";
}

function isPhase4SecurityFinding(ruleId: string): boolean {
  return ruleId === "session_object_must_come_from_trusted_helper" ||
    ruleId === "api_route_requires_authorization" ||
    ruleId === "api_route_requires_tenant_scope";
}

function phase5ExpectedLayer(ruleId: string): string {
  return ruleId === "api_route_forbids_sensitive_response_fields"
    ? "response_shape"
    : "secret_exposure";
}

function phase5SuggestedFix(ruleId: string): string {
  return ruleId === "api_route_forbids_sensitive_response_fields"
    ? "Filter accepted sensitive response fields with an accepted serializer before responding."
    : "Keep secret reads out of responses and accepted log sinks.";
}

function phase5ActualLayer(proof: unknown, ruleId: string): string {
  if (!proof || typeof proof !== "object") {
    return ruleId === "api_route_forbids_sensitive_response_fields"
      ? "dynamic_response_shape_missing_proof"
      : "secret_exposure_not_excluded";
  }
  const candidate = proof as {
    parser_gaps?: Array<{ code?: unknown }>;
    missing_proof?: Array<{ code?: unknown }>;
    response_shape?: {
      sensitive_leaks?: unknown[];
    };
    sinks?: {
      secrets?: unknown[];
    };
  };
  const missingProofCode = candidate.missing_proof?.find((missing) =>
    typeof missing.code === "string"
  )?.code;
  if (typeof missingProofCode === "string") {
    return missingProofCode;
  }
  const parserGapCode = candidate.parser_gaps?.find((gap) =>
    typeof gap.code === "string"
  )?.code;
  if (typeof parserGapCode === "string") {
    return parserGapCode;
  }
  if (ruleId === "api_route_forbids_sensitive_response_fields") {
    return (candidate.response_shape?.sensitive_leaks?.length ?? 0) > 0
      ? "sensitive_response_field_unfiltered"
      : "dynamic_response_shape_missing_proof";
  }
  return (candidate.sinks?.secrets?.length ?? 0) > 0
    ? "secret_exposure_not_excluded"
    : "secret_exposure_not_excluded";
}

function phase4ExpectedLayer(ruleId: string): string {
  if (ruleId === "session_object_must_come_from_trusted_helper") {
    return "session_trust";
  }
  if (ruleId === "api_route_requires_authorization") {
    return "authorization";
  }
  if (ruleId === "api_route_requires_tenant_scope") {
    return "tenant_scope";
  }
  return "security_boundary";
}

function phase4ActualLayer(proof: SecurityBoundaryProof | undefined): string {
  return proof?.missing_proof[0]?.code ?? proof?.parser_gaps[0]?.code ?? "missing_proof";
}

function requestValidationActualLayer(proof: unknown): string {
  if (!proof || typeof proof !== "object") {
    return "request_input_not_validated";
  }
  const candidate = proof as {
    parser_gaps?: Array<{ code?: unknown }>;
    missing_proof?: Array<{ code?: unknown }>;
    request_validation?: {
      unvalidated_uses?: Array<{ reason?: unknown }>;
    };
  };
  const parserGapCode = candidate.parser_gaps?.find((gap) =>
    typeof gap.code === "string"
  )?.code;
  if (typeof parserGapCode === "string") {
    return parserGapCode;
  }
  const missingProofCode = candidate.missing_proof?.find((missing) =>
    typeof missing.code === "string"
  )?.code;
  if (typeof missingProofCode === "string") {
    return missingProofCode;
  }
  const unvalidatedReason = candidate.request_validation?.unvalidated_uses?.find((use) =>
    typeof use.reason === "string"
  )?.reason;
  return typeof unvalidatedReason === "string" ? unvalidatedReason : "request_input_not_validated";
}

function graphForEngineCheck(
  checkData: ScanData,
  fileSet: Set<string>,
  allowedImportFacts: Map<string, ReturnType<typeof importFactsForFile>[number]>
): {
  nodes: ScanData["graph_nodes"];
  edges: ScanData["graph_edges"];
  evidence: ScanData["graph_evidence"];
  diagnostics: ScanData["graph_diagnostics"];
} {
  const evidenceById = new Map(checkData.graph_evidence.map((evidence) => [evidence.id, evidence]));
  const nodesById = new Map(checkData.graph_nodes.map((node) => [node.id, node]));
  const allowedImportNodeIds = new Set(
    checkData.graph_nodes
      .filter((node) => node.kind === "import_decl")
      .filter((node) => {
        const key = importNodeGraphKey(node, evidenceById);
        return key ? allowedImportFacts.has(key) : false;
      })
      .map((node) => node.id)
  );
  const allowedNodeIds = new Set<string>();

  for (const node of checkData.graph_nodes) {
    const filePath = stringMetadata(node.metadata, "file_path") ?? stringMetadata(node.metadata, "path");
    if (filePath && fileSet.has(filePath)) {
      allowedNodeIds.add(node.id);
    }
    if (node.kind === "file_role") {
      allowedNodeIds.add(node.id);
    }
  }
  for (const importNodeId of allowedImportNodeIds) {
    allowedNodeIds.add(importNodeId);
  }

  const edgeKindsForCheck = new Set([
    "FILE_HAS_ROLE",
    "FILE_DEFINES_MODULE",
    "IMPORT_DECL_REFERENCES_MODULE",
    "IMPORT_RESOLVES_TO_MODULE",
    "MODULE_IMPORTS_MODULE",
    // T100: without these the engine cannot follow a barrel to the module it re-exports, so
    // `import { prisma } from "@/lib/barrel"` passed while the direct import blocked. The edges
    // exist in the scan; they were simply filtered out before the engine saw them.
    "MODULE_REEXPORTS_MODULE"
  ]);
  const keptEdges = checkData.graph_edges.filter((edge) => {
    if (!edgeKindsForCheck.has(edge.kind)) {
      return false;
    }
    if (edge.kind.startsWith("IMPORT_") && !allowedImportNodeIds.has(edge.from)) {
      return false;
    }
    if (edge.kind === "MODULE_IMPORTS_MODULE") {
      const from = nodesById.get(edge.from);
      const fromPath = from ? stringMetadata(from.metadata, "file_path") : undefined;
      if (!fromPath || !fileSet.has(fromPath)) {
        return false;
      }
    }
    if (edge.kind === "FILE_HAS_ROLE" || edge.kind === "FILE_DEFINES_MODULE") {
      const from = nodesById.get(edge.from);
      const fromPath = from ? stringMetadata(from.metadata, "path") : undefined;
      if (!fromPath || !fileSet.has(fromPath)) {
        return false;
      }
    }
    allowedNodeIds.add(edge.from);
    allowedNodeIds.add(edge.to);
    return true;
  });

  const keptEvidenceIds = new Set<string>();
  const keptNodes = checkData.graph_nodes.filter((node) => {
    if (!allowedNodeIds.has(node.id)) {
      return false;
    }
    for (const evidenceId of node.evidence_ids) {
      keptEvidenceIds.add(evidenceId);
    }
    return true;
  });
  for (const edge of keptEdges) {
    for (const evidenceId of edge.evidence_ids) {
      keptEvidenceIds.add(evidenceId);
    }
  }

  return {
    nodes: keptNodes,
    edges: keptEdges,
    evidence: checkData.graph_evidence.filter((evidence) => keptEvidenceIds.has(evidence.id)),
    diagnostics: checkData.graph_diagnostics.filter((diagnostic) =>
      !diagnostic.file_path || fileSet.has(diagnostic.file_path)
    )
  };
}

/**
 * Loop-invariant graph lookups, built once per ScanData.
 *
 * `graphImportResolvesToForbidden` and `exceptionContextForImport` are called once per import per
 * in-scope file (:2510, :2517). Each used to rebuild, on every call, a Map over every evidence row
 * and a Map over every node, then scan all nodes linearly to find one import. On dub that is 4,239
 * calls against a 112,773-node / 205,019-edge graph - measured at 55.8ms and 36.2ms per call, 359s
 * of a 367s `check --scope full`. Cost is `imports_in_scope x graph_size`, so it is quadratic in
 * repo size at fixed route density: openstatus (2,185 files, 37 in scope) ran 3x faster than
 * papermark (1,346 files, 283 in scope) despite a 78% larger graph.
 *
 * `resolvedModuleFilesFor` was already hoisted per convention at its other call site; this
 * gives the same treatment to the rest.
 *
 * Keyed on ScanData identity. The arrays indexed here are read-only for the lifetime of a check -
 * `graphForEngineCheck` derives new arrays with `.filter()` rather than mutating in place.
 */
interface GraphIndex {
  nodesById: Map<string, ScanData["graph_nodes"][number]>;
  /** First node per key, matching the `.find()` this replaced. */
  importNodeByKey: Map<string, ScanData["graph_nodes"][number]>;
  resolvedModuleEdgesByFrom: Map<string, ScanData["graph_edges"]>;
  resolvedSymbolEdgesByFrom: Map<string, ScanData["graph_edges"]>;
  endpointNodesByFile: Map<string, ScanData["graph_nodes"]>;
  dataOperationNodesByFile: Map<string, ScanData["graph_nodes"]>;
  reexportTargets: Map<string, string[]>;
  /** Specifiers joined by NUL -> the files they resolve to. Shared by every specifier list. */
  resolvedModuleFilesByKey: Map<string, Set<string>>;
  /** Specifiers joined by NUL -> the module NODES they resolve to, before re-export walking. */
  resolvedModuleNodesByKey: Map<string, Set<string>>;
}

const graphIndexes = new WeakMap<ScanData, GraphIndex>();

function graphIndexFor(checkData: ScanData): GraphIndex {
  const cached = graphIndexes.get(checkData);
  if (cached) {
    return cached;
  }

  const evidenceById = new Map(checkData.graph_evidence.map((evidence) => [evidence.id, evidence]));
  const nodesById = new Map(checkData.graph_nodes.map((node) => [node.id, node]));
  const importNodeByKey = new Map<string, ScanData["graph_nodes"][number]>();
  const endpointNodesByFile = new Map<string, ScanData["graph_nodes"]>();
  const dataOperationNodesByFile = new Map<string, ScanData["graph_nodes"]>();

  for (const node of checkData.graph_nodes) {
    if (node.kind === "import_decl") {
      const key = importNodeGraphKey(node, evidenceById);
      // First wins: `.find()` returned the earliest match in array order.
      if (key !== undefined && !importNodeByKey.has(key)) {
        importNodeByKey.set(key, node);
      }
      continue;
    }
    if (node.kind !== "endpoint" && node.kind !== "data_operation") {
      continue;
    }
    const nodeFilePath = stringMetadata(node.metadata, "file_path");
    if (!nodeFilePath) {
      continue;
    }
    const byFile = node.kind === "endpoint" ? endpointNodesByFile : dataOperationNodesByFile;
    const existing = byFile.get(nodeFilePath);
    if (existing) {
      existing.push(node);
    } else {
      byFile.set(nodeFilePath, [node]);
    }
  }

  const resolvedModuleEdgesByFrom = new Map<string, ScanData["graph_edges"]>();
  const resolvedSymbolEdgesByFrom = new Map<string, ScanData["graph_edges"]>();
  for (const edge of checkData.graph_edges) {
    const byFrom = edge.kind === "IMPORT_RESOLVES_TO_MODULE"
      ? resolvedModuleEdgesByFrom
      : edge.kind === "IMPORT_RESOLVES_TO_SYMBOL"
        ? resolvedSymbolEdgesByFrom
        : undefined;
    if (!byFrom) {
      continue;
    }
    const existing = byFrom.get(edge.from);
    if (existing) {
      existing.push(edge);
    } else {
      byFrom.set(edge.from, [edge]);
    }
  }

  const index: GraphIndex = {
    nodesById,
    importNodeByKey,
    resolvedModuleEdgesByFrom,
    resolvedSymbolEdgesByFrom,
    endpointNodesByFile,
    dataOperationNodesByFile,
    reexportTargets: moduleReexportTargets(checkData),
    resolvedModuleFilesByKey: new Map(),
    resolvedModuleNodesByKey: new Map()
  };
  graphIndexes.set(checkData, index);
  return index;
}

function graphImportResolvesToForbidden(
  checkData: ScanData,
  filePath: string,
  importUsed: ReturnType<typeof importFactsForFile>[number],
  forbiddenImports: string[]
): boolean {
  if (forbiddenImports.length === 0) {
    return false;
  }
  const { nodesById, importNodeByKey, resolvedModuleEdgesByFrom, reexportTargets } =
    graphIndexFor(checkData);
  const importNode = importNodeByKey.get(importFactGraphKey(filePath, importUsed));
  if (!importNode) {
    return false;
  }

  // T100: compare resolved identity, not strings.
  //
  // This previously called isForbiddenImport(resolvedPath, forbiddenImports) - a resolved file
  // path like `src/lib/prisma.ts` against specifiers like `@/lib/prisma`. That can only match when
  // a forbidden entry happens to be a path, which is why two bypasses survived (T93):
  // `../../../lib/prisma` resolves to the same file and passed, and a barrel re-exporting the
  // client passed.
  //
  // The repository tells us what a specifier means: wherever any file imports a forbidden
  // specifier and the resolver placed that edge, the target is the file it names.
  const forbiddenFiles = resolvedModuleFilesFor(checkData, forbiddenImports);

  return (resolvedModuleEdgesByFrom.get(importNode.id) ?? [])
    .some((edge) => {
      const resolved = nodesById.get(edge.to);
      const resolvedPath = resolved ? stringMetadata(resolved.metadata, "file_path") : undefined;
      if (!resolvedPath) {
        return false;
      }
      if (forbiddenFiles.has(resolvedPath)) {
        return true;
      }
      // A barrel that re-exports the client is still a dependency on the client.
      if (reachesForbiddenViaReexport(edge.to, reexportTargets, nodesById, forbiddenFiles)) {
        return true;
      }
      // Retained for bare package names that resolve to no local file.
      return isForbiddenImport(resolvedPath, forbiddenImports);
    });
}

/**
 * Repo files that a set of import specifiers actually resolve to.
 *
 * Derived from the repo's own resolved imports rather than by re-resolving, so it needs no second
 * resolver and cannot disagree with the one that built the graph.
 *
 * This began as `forbiddenModuleFiles_`, which answered only for forbidden lists. The question -
 * "what does this specifier MEAN, as opposed to how is it spelled" - is not specific to forbidden
 * imports; the accepted-security-helper side needs the identical answer about a different specifier
 * list. A second walk over `IMPORT_RESOLVES_TO_MODULE` written for that caller could drift out of
 * agreement with this one, and two resolvers that disagree about module identity is precisely the
 * defect this pipeline already has at the string level.
 *
 * Empty is a real and common answer, not a failure: the Rust `resolve_import` filters to paths
 * inside the scan snapshot, so a bare package name (`next-auth`, anything under `node_modules`)
 * produces no edge by design. Callers must classify that emptiness themselves rather than read it
 * as "no such module" - see `resolvedHelperIdentities`.
 *
 * A lookalike module (`@/lib/prisma-legacy`) resolves to its own distinct file and never lands
 * here, which is what keeps the T03 negative control green.
 *
 * Two specifier relations, and they are NOT interchangeable - see `SpecifierMatch`.
 */
export function resolvedModuleFilesFor(
  checkData: ScanData,
  specifiers: string[],
  match: SpecifierMatch = "specifier_or_subpath"
): Set<string> {
  const index = graphIndexFor(checkData);
  // Memoised per specifier set: called once per import via graphImportResolvesToForbidden, once per
  // convention when building the engine request, and once per accepted helper. Same specifier set
  // means same answer, so forbidden and accepted callers can share one cache without interfering -
  // as long as the relation is part of the key, because the two relations give different answers.
  const cacheKey = `${match}\0${specifiers.join("\0")}`;
  const cached = index.resolvedModuleFilesByKey.get(cacheKey);
  if (cached) {
    return cached;
  }
  const files = moduleFilesForNodeIds(resolvedModuleNodeIdsFor(checkData, specifiers, match), index);
  index.resolvedModuleFilesByKey.set(cacheKey, files);
  return files;
}

/**
 * How a resolved import's specifier is compared against a convention's specifier list.
 *
 * `specifier_or_subpath` is `isForbiddenImport`: the specifier, or anything beneath it at a `/`
 *   boundary. Right for a PROHIBITION, where `@/lib/prisma` is meant to cover `@/lib/prisma/edge`
 *   as well - broadening a ban only ever bans more.
 * `exact_specifier` is equality. Right for an ACCEPTANCE, where the specifier names one module.
 *
 * Using the first relation on an accepted-helper list is a laundering bug, not a nuance. A helper
 * accepted at `@/lib` would silently absorb `@/lib/attacker-controlled`, so any module a caller can
 * add under that prefix becomes the accepted helper's module and produces a passing auth proof.
 * Broadening a ban is safe; broadening an acceptance is the exact failure this sprint exists to
 * stop shipping.
 */
export type SpecifierMatch = "specifier_or_subpath" | "exact_specifier";

function specifierMatches(source: string, specifiers: string[], match: SpecifierMatch): boolean {
  return match === "exact_specifier"
    ? specifiers.includes(source)
    : isForbiddenImport(source, specifiers);
}

/**
 * The same resolution, stopped one step earlier: the module NODES the specifiers reach.
 *
 * `resolvedModuleFilesFor` is the answer nearly every caller wants, but a re-export chain is walked
 * over node ids, and a file path cannot be walked back to a node without a second index. Splitting
 * here keeps one walk over `IMPORT_RESOLVES_TO_MODULE` behind both answers. The file-level answer is
 * pinned literally, list by list, in `resolved-module-files.test.ts`.
 */
function resolvedModuleNodeIdsFor(
  checkData: ScanData,
  specifiers: string[],
  match: SpecifierMatch
): Set<string> {
  const index = graphIndexFor(checkData);
  const cacheKey = `${match}\0${specifiers.join("\0")}`;
  const cached = index.resolvedModuleNodesByKey.get(cacheKey);
  if (cached) {
    return cached;
  }
  const nodeIds = new Set<string>();
  const { nodesById } = index;
  for (const edge of checkData.graph_edges) {
    if (edge.kind !== "IMPORT_RESOLVES_TO_MODULE") {
      continue;
    }
    const importNode = nodesById.get(edge.from);
    const source = importNode ? stringMetadata(importNode.metadata, "source") : undefined;
    if (!source || !specifierMatches(source, specifiers, match)) {
      continue;
    }
    nodeIds.add(edge.to);
  }
  index.resolvedModuleNodesByKey.set(cacheKey, nodeIds);
  return nodeIds;
}

function moduleFilesForNodeIds(nodeIds: Set<string>, index: GraphIndex): Set<string> {
  const files = new Set<string>();
  for (const nodeId of nodeIds) {
    const node = index.nodesById.get(nodeId);
    const filePath = node ? stringMetadata(node.metadata, "file_path") : undefined;
    if (filePath) {
      files.add(filePath);
    }
  }
  return files;
}

/**
 * How the answer about a helper's module was arrived at - which is as much of the answer as the
 * files are.
 *
 * `repo_resolved` - the specifier produced resolution edges, so the helper has a file identity and
 *   matching can compare resolved files, re-export chains included.
 * `external` - a bare package specifier that resolved to nothing. NOT a failure: the Rust
 *   `resolve_import` filters to paths inside the scan snapshot, so anything in `node_modules`
 *   resolves to nothing by design. Matching stays on the specifier, plus a local-shadow check.
 * `unresolved` - a repo-relative specifier that resolved to nothing. Matching stays on the
 *   specifier too, but this one is a degradation and has to be recorded as one, because a repo
 *   specifier that resolves to nothing means the graph could not answer.
 */
export type AcceptedHelperResolutionMode = "repo_resolved" | "external" | "unresolved";

export interface AcceptedHelperIdentity {
  symbol: string;
  mode: AcceptedHelperResolutionMode;
  /** Repo-relative, sorted, deduped. Empty for every mode but `repo_resolved`. */
  files: string[];
  /**
   * The tsconfig-paths hijack shape: the contract names what looks like a package, and the repo has
   * quietly pointed that name at a file it controls. Present only when true, and never silently
   * accepted - a resolution-based matcher that swallowed this would be worse than the string one it
   * replaces.
   */
  external_specifier_resolves_in_repo?: true;
}

/**
 * The `requires` keys that carry accepted security helpers, and the three different names the
 * module field goes by underneath them.
 *
 * `auth_helpers` and `validators` spell it `import`; the Phase 6 kinds (`csrf_helpers`,
 * `rate_limit_helpers`, `outbound_url_allowlist_helpers`) spell it `module`; `response_serializers`
 * spells it `import_source`. Those are the spellings `check_command.rs` emits and reads back -
 * `phase6_helpers_from_requires` and `security_helpers_from_requires` take `module`,
 * `accepted_auth_helpers_for_convention` takes the auth shape. A resolver that knew only one
 * spelling would return a confident, silently partial answer, which is the failure mode this whole
 * sprint exists to stop reproducing.
 */
const ACCEPTED_HELPER_REQUIRES_KEYS = [
  "auth_helpers",
  "validators",
  "csrf_helpers",
  "rate_limit_helpers",
  "outbound_url_allowlist_helpers",
  "response_serializers"
] as const;

const HELPER_SYMBOL_KEYS = ["symbol", "name", "imported_name", "local_name"] as const;
const HELPER_MODULE_KEYS = ["import", "module", "import_source"] as const;

/**
 * What each accepted security helper's import specifier actually resolves to, and how we know.
 *
 * This is tier-2 identity: resolved module, not imported name (tier 0, which accepts any module
 * exporting the right symbol - the laundering shape) and not the specifier as typed (tier 1, which
 * makes `../../lib/auth` and `@/lib/auth` disagree about one file and fails every barrel and every
 * renamed import). Tier 1 is not a stronger tier 0; only this dominates both.
 *
 * It lives in TypeScript because it structurally cannot live in Rust. The engine receives a graph
 * scoped to the CHANGED FILES, so it cannot derive what a specifier means - the imports that
 * establish the meaning live in files outside the diff. The CLI has the whole graph.
 *
 * The mode is per HELPER, never per convention, and that is the load-bearing decision. A
 * per-convention "the table came back empty, fall back to strings" would permanently and silently
 * retain tier-1 semantics for every external auth helper - `next-auth`, `@clerk/nextjs`, the most
 * common real-world contract there is - because those resolve to nothing by design and always will.
 * Recording the mode is what makes that degradation visible instead of assumed.
 *
 * Helpers with no module specifier at all (the engine accepts a bare string in `auth_helpers`) are
 * absent from the result rather than reported as `unresolved`. There is no specifier to resolve, so
 * there is no tier-2 answer to give, and saying `unresolved` would misrepresent "never asked" as
 * "asked and got nothing".
 *
 * `files` is sorted and deduped here. The repo's determinism digest covers findings and never
 * proofs, so nothing downstream would catch an unstable order.
 */
export function resolvedHelperIdentities(
  checkData: ScanData,
  convention: AcceptedConvention
): AcceptedHelperIdentity[] {
  const requires = (convention as AcceptedConvention & { requires?: unknown }).requires;
  if (!requires || typeof requires !== "object" || Array.isArray(requires)) {
    return [];
  }
  const index = graphIndexFor(checkData);
  // Keyed by symbol because that is the join key the engine itself uses - both
  // `accepted_auth_helpers_for_convention` and `phase4_policy_for_convention` normalise into a
  // BTreeMap keyed by symbol, last write winning. Mirroring that keeps this from disagreeing with
  // the reader it is computed for.
  const bySymbol = new Map<string, AcceptedHelperIdentity>();
  for (const key of ACCEPTED_HELPER_REQUIRES_KEYS) {
    const entries = (requires as Record<string, unknown>)[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const symbol = firstStringValue(record, HELPER_SYMBOL_KEYS);
      const specifier = firstStringValue(record, HELPER_MODULE_KEYS);
      if (!symbol || !specifier) {
        continue;
      }
      bySymbol.set(symbol, helperIdentityFor(checkData, index, symbol, specifier));
    }
  }
  return [...bySymbol.values()].sort((left, right) => (left.symbol < right.symbol ? -1 : 1));
}

function helperIdentityFor(
  checkData: ScanData,
  index: GraphIndex,
  symbol: string,
  specifier: string
): AcceptedHelperIdentity {
  // A barrel is a module that re-exports the helper's real module, so the chain is part of the
  // identity: `import { requireUser } from "@/lib"` reaches `src/lib/auth.ts` and the contract
  // naming either one is describing the same helper.
  //
  // `exact_specifier`, never the subpath relation the forbidden path uses: an accepted helper at
  // `@/lib` must not absorb `@/lib/attacker-controlled` just because it sits beneath it. Widening
  // an acceptance is laundering. The re-export chain is a different thing entirely - it follows
  // what the repo actually re-exports, which is a fact about the code rather than about spelling.
  const reachable = reexportClosureFor(
    resolvedModuleNodeIdsFor(checkData, [specifier], "exact_specifier"),
    index
  );
  const files = moduleFilesForNodeIds(reachable, index);
  const bare = isBarePackageSpecifier(specifier);
  // Classified on whether a usable FILE identity came back, not merely on whether an edge existed.
  // An edge to a node carrying no `file_path` leaves nothing to match against, and calling that
  // `repo_resolved` would hand Sprint 4 an empty file list to enforce - turning a silent miss into
  // a false alarm on every compliant route, which is the one direction this refactor must not move.
  if (files.size === 0) {
    return { symbol, mode: bare ? "external" : "unresolved", files: [] };
  }
  return {
    symbol,
    mode: "repo_resolved",
    files: [...files].sort(),
    ...(bare ? { external_specifier_resolves_in_repo: true as const } : {})
  };
}

/** Every module reachable from `startNodeIds` by `MODULE_REEXPORTS_MODULE`, the starts included. */
function reexportClosureFor(startNodeIds: Set<string>, index: GraphIndex): Set<string> {
  const seen = new Set<string>();
  const queue = [...startNodeIds];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of index.reexportTargets.get(current) ?? []) {
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Whether a specifier names a package rather than something inside this repo.
 *
 * Node resolution semantics: `./`, `../` and `/` are paths, everything else is a package name.
 * `@/` is excluded because it is not a valid npm scope (scopes cannot be empty) and is the near
 * universal tsconfig alias for the repo root; `~` and `#` are the other two common repo-internal
 * prefixes, the latter being Node's own subpath imports.
 *
 * A repo whose alias has no sigil at all (`src/lib/auth` via `baseUrl`) reads as a package here and
 * is classified `external` rather than `unresolved` when it resolves to nothing. Both modes match on
 * the exact specifier, so the practical difference is only whether the degradation is recorded - and
 * if such a specifier DOES resolve repo-locally, `external_specifier_resolves_in_repo` fires and it
 * is visible rather than silent.
 */
function isBarePackageSpecifier(specifier: string): boolean {
  return !(
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("~") ||
    specifier.startsWith("#")
  );
}

function firstStringValue(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/** module id -> modules it re-exports, for chain walking. */
function moduleReexportTargets(checkData: ScanData): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  for (const edge of checkData.graph_edges) {
    if (edge.kind !== "MODULE_REEXPORTS_MODULE") {
      continue;
    }
    targets.set(edge.from, [...(targets.get(edge.from) ?? []), edge.to]);
  }
  return targets;
}

/** Does a re-export chain from `moduleId` reach one of the forbidden files? */
function reachesForbiddenViaReexport(
  moduleId: string,
  reexportTargets: Map<string, string[]>,
  nodesById: Map<string, ScanData["graph_nodes"][number]>,
  forbiddenFiles: Set<string>
): boolean {
  const seen = new Set<string>();
  const queue = [moduleId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of reexportTargets.get(current) ?? []) {
      const node = nodesById.get(next);
      const path = node ? stringMetadata(node.metadata, "file_path") : undefined;
      if (path && forbiddenFiles.has(path)) {
        return true;
      }
      queue.push(next);
    }
  }
  return false;
}

function exceptionContextForImport(
  checkData: ScanData,
  filePath: string,
  importUsed: ReturnType<typeof importFactsForFile>[number]
): {
  endpointPaths: string[];
  methods: string[];
  resolvedModules: string[];
  resolvedSymbols: string[];
  dataStores: string[];
  operationKinds: string[];
} {
  const {
    nodesById,
    importNodeByKey,
    resolvedModuleEdgesByFrom,
    resolvedSymbolEdgesByFrom,
    endpointNodesByFile,
    dataOperationNodesByFile
  } = graphIndexFor(checkData);
  const importNode = importNodeByKey.get(importFactGraphKey(filePath, importUsed));
  const endpointNodes = endpointNodesByFile.get(filePath) ?? [];
  const dataOperationNodes = (dataOperationNodesByFile.get(filePath) ?? []).filter((node) =>
    stringMetadata(node.metadata, "receiver_root") === importUsed.name
  );
  const resolvedModules = importNode
    ? (resolvedModuleEdgesByFrom.get(importNode.id) ?? [])
        .map((edge) => nodesById.get(edge.to))
        .flatMap((node) => node ? [stringMetadata(node.metadata, "file_path")] : [])
        .filter((value): value is string => typeof value === "string")
    : [];
  const resolvedSymbols = importNode
    ? (resolvedSymbolEdgesByFrom.get(importNode.id) ?? [])
        .map((edge) => nodesById.get(edge.to)?.label)
        .filter((value): value is string => typeof value === "string")
    : [];

  return {
    endpointPaths: uniqueStrings(endpointNodes.flatMap((node) => metadataValues(node.metadata, "route_pattern"))),
    methods: uniqueStrings(endpointNodes.flatMap((node) => metadataValues(node.metadata, "method"))),
    resolvedModules: uniqueStrings(resolvedModules),
    resolvedSymbols: uniqueStrings(resolvedSymbols),
    dataStores: uniqueStrings(dataOperationNodes.flatMap((node) => metadataValues(node.metadata, "store_name"))),
    operationKinds: uniqueStrings(dataOperationNodes.flatMap((node) => metadataValues(node.metadata, "operation_kind")))
  };
}

function metadataValues(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return typeof value === "string" ? [value] : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function importFactGraphKey(filePath: string, importUsed: ReturnType<typeof importFactsForFile>[number]): string {
  return `${filePath}:${importUsed.name}:${importUsed.value}:${importUsed.start_line}`;
}

function importNodeGraphKey(
  node: ScanData["graph_nodes"][number],
  evidenceById: Map<string, ScanData["graph_evidence"][number]>
): string | undefined {
  const filePath = stringMetadata(node.metadata, "file_path");
  const localName = stringMetadata(node.metadata, "local_name");
  const source = stringMetadata(node.metadata, "source");
  const line = node.evidence_ids
    .map((id) => evidenceById.get(id)?.start_line)
    .find((startLine): startLine is number => typeof startLine === "number");
  if (!filePath || !localName || !source || !line) {
    return undefined;
  }
  return `${filePath}:${localName}:${source}:${line}`;
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

export function expireFindingsForExpiredConventions(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  repoId: string,
  contract: RepoContract,
  now: string
): number {
  const expiredConventionIds = new Set(
    contract.conventions
      .filter((convention) => convention.expires_at && convention.expires_at <= now)
      .map((convention) => convention.id)
  );
  if (expiredConventionIds.size === 0) {
    return 0;
  }

  let expiredCount = 0;
  const actor = actorFlag(parsed);
  for (const finding of storage.listFindings(repoId)) {
    if (!expiredConventionIds.has(finding.convention_id) || isClosedFindingStatus(finding.status)) {
      continue;
    }

    const updated: Finding = {
      ...finding,
      status: "expired"
    };
    storage.upsertFinding(updated);
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_finding_expired_${repoId}_${finding.id}_${now}`,
      repoId,
      actor,
      action: "finding_resolved",
      targetType: "finding",
      targetId: finding.id,
      metadata: {
        status: "expired",
        reason: "convention_expired",
        convention_id: finding.convention_id
      },
      createdAt: now
    }));
    expiredCount += 1;
  }
  return expiredCount;
}

export function checkNextCommands(
  repoId: string,
  summary: { findingCount: number; openNewCount: number; blockingCount: number }
): string[] {
  const commands = [
    summary.openNewCount > 0
      ? `drift findings list --repo ${repoId} --status new --json`
      : `drift findings list --repo ${repoId} --json`,
    `drift prepare "task" --repo ${repoId} --json`
  ];
  if (summary.findingCount > 0) {
    commands.push(`drift baseline create --repo ${repoId} --from main --confirm --json`);
  }
  if (summary.blockingCount > 0) {
    commands.push(`drift audit list --repo ${repoId} --action finding_resolved --json`);
  }
  return commands;
}
