import {
  SIDE_EFFECT_IMPORT_BINDING,
  SecurityBoundaryProofSchema,
  authorizeContextExport,
  type CanonicalHelperReuseAgentContract,
  type CheckRun,
  type FactRecord,
  type FileRole,
  type Finding,
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
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
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
}): number {
  if (input.blockingCount > 0) {
    return CHECK_EXIT_BLOCKED;
  }
  return input.enforcementDegraded || input.contractStaleRefusal
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
}): "pass" | "fail" | "refused" {
  switch (checkExitCodeFor(input)) {
    case CHECK_EXIT_BLOCKED:
      return "fail";
    case CHECK_EXIT_REFUSED:
      return "refused";
    default:
      return "pass";
  }
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
        exitCode: CHECK_EXIT_REFUSED
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
        exitCode: CHECK_EXIT_REFUSED
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
  } finally {
    cleanupScanReuseManifest(reuseManifest);
  }
  const snapshotsByPath = new Map(checkData.snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
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
      exitCode: CHECK_EXIT_REFUSED,
      payload: parsed.flags.has("json") ? payload : formatCheckText(payload)
    };
  }
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  const securityBoundaryProofs: SecurityBoundaryProof[] = [];
  let waivedFindingsCount = 0;

  const engineOwned = await runEngineOwnedDirectDataAccessCheck({
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
  for (const finding of engineOwnedAuth.findings) {
    storage.upsertFinding(finding);
  }

  const helperReuseFindings = runCanonicalHelperReuseCheck({
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
    contractStaleRefusal
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

  const openNewCount = findings.filter((finding) => finding.status === "new").length;
  const outcome = checkOutcomeSummary(findings, {
    waivedFindingsCount,
    expiredFindingsCount,
    scope: scope as "changed-hunks" | "changed-files" | "full"
  });
  const payload = {
    response_schema: "drift.check.result.v1",
    check,
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
      blocked_reasons: enforcementDegraded
        ? ["enforcement_degraded_by_incomplete_coverage", ...coverageGapReasons]
        : [],
      // EW-2: what Drift could not see, whether or not that cost anyone an enforcement. This is
      // the explicit signal chosen over a distinct exit code, because the blocking exit code
      // (2) has to keep winning and cannot carry a second meaning. Documented in
      // docs/reference/enforcement.md.
      partial_coverage: {
        // BB-9: a file the diff named and the tree does not have is a coverage gap by definition.
        // Claiming `complete: true` over it is the silent-green this item exists to kill.
        complete: coverageGapReasons.length === 0 && missingFromWorktree.length === 0 && !enforcementDegraded,
        reasons: [
          ...coverageGapReasons,
          ...missingFromWorktree.map((filePath) => `changed_file_missing_from_worktree:${filePath}`)
        ]
      },
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
    exitCode: checkExitCodeFor({ blockingCount, enforcementDegraded, contractStaleRefusal }),
    payload: parsed.flags.has("json") ? payload : formatCheckText(payload)
  };
}

function fallbackStatusForCheck(checkData: ScanData): ScanData["fallbackStatus"] {
  return checkData.fallbackStatus;
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
      continue;
    }

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
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "module_placement") {
      continue;
    }

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
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "import_boundary") {
      continue;
    }

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
  }

  return findings;
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
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "file_role") {
      continue;
    }

    for (const role of contract.roles) {
      const files = [...changedFiles].filter((filePath) =>
        role.path_globs.some((glob) => matchesGlob(filePath, glob))
      );
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
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "entrypoint_flow") {
      continue;
    }

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
      continue;
    }
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
        const firstFile = [...changedFiles].sort()[0] ?? input.checkData.snapshots[0]?.file_path ?? "required-checks";
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
      file_hash: snapshot?.content_hash ?? "",
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
}): Promise<{ findings: Finding[]; waivedFindings: WaivedFinding[]; waivedFindingsCount: number }> {
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  let waivedFindingsCount = 0;

  for (const convention of input.contract.conventions) {
    if (
      convention.kind !== "api_route_no_direct_data_access" ||
      convention.enforcement_mode === "off" ||
      convention.enforcement_capability !== "deterministic_check" ||
      !isActiveConvention(convention, input.now)
    ) {
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
    // Computed from the full graph, before it is scoped to the diff.
    const forbiddenModuleFiles = [
      ...forbiddenModuleFiles_(input.checkData, convention.matcher.forbidden_imports ?? [])
    ];
    const result = await runEngineCheck({
      forbiddenModuleFiles,
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
          end_line: evidence.end_line,
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
}): Promise<{
  findings: Finding[];
  waivedFindings: WaivedFinding[];
  waivedFindingsCount: number;
  securityBoundaryProofs: SecurityBoundaryProof[];
}> {
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  let waivedFindingsCount = 0;
  const securityBoundaryProofs: SecurityBoundaryProof[] = [];

  for (const convention of input.contract.conventions) {
    if (
      (
        convention.kind !== "api_route_requires_auth_helper" &&
        convention.kind !== "api_route_requires_request_validation" &&
        convention.kind !== "api_route_forbids_untrusted_ssrf" &&
        convention.kind !== "api_route_forbids_raw_sql_without_params" &&
        convention.kind !== "api_route_cors_must_match_policy" &&
        convention.kind !== "api_route_requires_csrf_for_mutation" &&
        convention.kind !== "api_route_requires_rate_limit" &&
        convention.kind !== "api_route_forbids_sensitive_response_fields" &&
        convention.kind !== "api_route_forbids_secret_exposure" &&
        convention.kind !== "session_object_must_come_from_trusted_helper" &&
        convention.kind !== "api_route_requires_authorization" &&
        convention.kind !== "api_route_requires_tenant_scope"
      ) ||
      convention.enforcement_mode === "off" ||
      convention.enforcement_capability !== "deterministic_check" ||
      !isActiveConvention(convention, input.now)
    ) {
      continue;
    }

    const files = filesForConvention(input.parsedDiff, convention, input.scope)
      .filter((filePath) => isApiRoutePath(filePath) && !isExceptedPath(filePath, convention, input.now));
    const fileSet = new Set(files);
    if (fileSet.size === 0) {
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
    securityBoundaryProofs.push(
      ...result.security_boundary_proofs.map((proof) => SecurityBoundaryProofSchema.parse(proof))
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

  return { findings, waivedFindings, waivedFindingsCount, securityBoundaryProofs };
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

function graphImportResolvesToForbidden(
  checkData: ScanData,
  filePath: string,
  importUsed: ReturnType<typeof importFactsForFile>[number],
  forbiddenImports: string[]
): boolean {
  if (forbiddenImports.length === 0) {
    return false;
  }
  const evidenceById = new Map(checkData.graph_evidence.map((evidence) => [evidence.id, evidence]));
  const nodesById = new Map(checkData.graph_nodes.map((node) => [node.id, node]));
  const importKey = importFactGraphKey(filePath, importUsed);
  const importNode = checkData.graph_nodes.find((node) =>
    node.kind === "import_decl" && importNodeGraphKey(node, evidenceById) === importKey
  );
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
  const forbiddenFiles = forbiddenModuleFiles_(checkData, forbiddenImports);
  const reexportTargets = moduleReexportTargets(checkData);

  return checkData.graph_edges
    .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_MODULE" && edge.from === importNode.id)
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
 * Files that the convention's forbidden specifiers actually resolve to.
 *
 * Derived from the repo's own resolved imports rather than by re-resolving, so it needs no second
 * resolver and cannot disagree with the one that built the graph. Empty when nothing imports a
 * forbidden specifier resolvably, in which case matching falls back to specifiers exactly as
 * before - a repo that never exercised the resolver cannot regress.
 *
 * A lookalike module (`@/lib/prisma-legacy`) resolves to its own distinct file and never lands
 * here, which is what keeps the T03 negative control green.
 */
function forbiddenModuleFiles_(checkData: ScanData, forbiddenImports: string[]): Set<string> {
  const files = new Set<string>();
  const nodesById = new Map(checkData.graph_nodes.map((node) => [node.id, node]));
  for (const edge of checkData.graph_edges) {
    if (edge.kind !== "IMPORT_RESOLVES_TO_MODULE") {
      continue;
    }
    const importNode = nodesById.get(edge.from);
    const source = importNode ? stringMetadata(importNode.metadata, "source") : undefined;
    if (!source || !isForbiddenImport(source, forbiddenImports)) {
      continue;
    }
    const target = nodesById.get(edge.to);
    const targetPath = target ? stringMetadata(target.metadata, "file_path") : undefined;
    if (targetPath) {
      files.add(targetPath);
    }
  }
  return files;
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
  const evidenceById = new Map(checkData.graph_evidence.map((evidence) => [evidence.id, evidence]));
  const nodesById = new Map(checkData.graph_nodes.map((node) => [node.id, node]));
  const importKey = importFactGraphKey(filePath, importUsed);
  const importNode = checkData.graph_nodes.find((node) =>
    node.kind === "import_decl" && importNodeGraphKey(node, evidenceById) === importKey
  );
  const endpointNodes = checkData.graph_nodes.filter((node) =>
    node.kind === "endpoint" && stringMetadata(node.metadata, "file_path") === filePath
  );
  const dataOperationNodes = checkData.graph_nodes.filter((node) =>
    node.kind === "data_operation" &&
    stringMetadata(node.metadata, "file_path") === filePath &&
    stringMetadata(node.metadata, "receiver_root") === importUsed.name
  );
  const resolvedModules = importNode
    ? checkData.graph_edges
        .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_MODULE" && edge.from === importNode.id)
        .map((edge) => nodesById.get(edge.to))
        .flatMap((node) => node ? [stringMetadata(node.metadata, "file_path")] : [])
        .filter((value): value is string => typeof value === "string")
    : [];
  const resolvedSymbols = importNode
    ? checkData.graph_edges
        .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_SYMBOL" && edge.from === importNode.id)
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

export function runFullRepoCheck(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  repoId: string,
  now: string
): Finding[] {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    return [];
  }
  const checkId = `check_full_${hashStable(`${repoId}:${now}`).slice(0, 16)}`;

  // Bindings we detected but could not reconcile against an engine import fact.
  // Collected rather than thrown so a single unparseable file degrades that file
  // instead of aborting onboarding. See the reconciliation site below.
  const importFactReconciliationGaps: Array<{
    filePath: string;
    line: number;
    // Absent for a bindingless side-effect import (S10): nothing was bound.
    symbol?: string;
    importSource: string;
  }> = [];

  const files = walkIndexableFiles(repo.root_path).filter(isApiRoutePath);
  const diff = {
    // Full-repo baseline sweep over files that already exist: nothing here is added.
    files: files.map((path) => ({ path, changedLines: new Set<number>(), isAdded: false })),
    deletedFiles: []
  };
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    return [];
  }
  const latestScan = storage.listScanManifests(repoId).find((scan) => scan.status === "completed");
  const snapshotsByPath = new Map(
    latestScan
      ? storage.listFileSnapshots(repoId, latestScan.id).map((snapshot) => [snapshot.file_path, snapshot])
      : []
  );
  // Engine import facts, grouped by file. This is the authoritative set: the engine decides
  // what counts as a value import, including dropping bindings used only in type positions.
  //
  // Baseline materialization used to re-derive imports from source with the CLI's own regex
  // and then look the results up here by evidence key. Any disagreement between the two
  // parsers produced a finding with no fact behind it - originally a crash (F2), later a
  // reported parser gap (A3.3). Reading the facts directly removes the possibility: there is
  // one parser, and it is the engine's.
  const importFactsByFile = new Map<string, FactRecord[]>();
  if (latestScan) {
    for (const fact of storage.listFacts(latestScan.id, { kind: "import_used" })) {
      importFactsByFile.set(fact.file_path, [...(importFactsByFile.get(fact.file_path) ?? []), fact]);
    }
  }

  const findings: Finding[] = [];
  for (const convention of contract.conventions) {
    if (convention.kind !== "api_route_no_direct_data_access") {
      continue;
    }

    for (const filePath of filesForConvention(diff, convention, "full")) {
      if (isExceptedPath(filePath, convention, now)) {
        continue;
      }
      for (const fact of importFactsByFile.get(filePath) ?? []) {
        const importUsed = {
          name: fact.name,
          source: String(fact.value ?? ""),
          line: fact.start_line,
          end_line: fact.end_line
        };
        if (!importUsed.source) {
          continue;
        }
        if (!isForbiddenImport(importUsed.source, convention.matcher.forbidden_imports ?? [])) {
          continue;
        }
        if (isExceptedImport(filePath, importUsed.name, importUsed.source, convention, now)) {
          continue;
        }
        const snapshot = snapshotsByPath.get(filePath);
        const waiver = findContractWaiverForImport(filePath, importUsed.name, importUsed.source, contract, now);
        if (waiver) {
          const staleWaiver = waiverRequiresReapproval(
            waiver,
            filePath,
            snapshot?.content_hash
          );
          if (staleWaiver) {
            findings.push(waiverReapprovalFinding({
              repoId,
              repoContractId: contract.id,
              conventionId: convention.id,
              checkId,
              scanId: snapshot?.scan_id ?? checkId,
              filePath,
              line: importUsed.line,
              symbol: evidenceSymbol(importUsed.name),
              importSource: importUsed.source,
              fileHash: snapshot?.content_hash ?? "",
              waiverId: waiver.id,
              now
            }));
          } else {
            continue;
          }
        }

        const fingerprint = findingFingerprint(convention.id, filePath, importUsed.name, importUsed.source);
        const factId: string | undefined = fact.id;
        if (!factId) {
          // A binding we detected has no corresponding engine fact, which means the two
          // import parsers disagree about this file. That is a parser gap in one file,
          // not grounds for aborting the whole run: throwing here left repos with no
          // database at all and no way to onboard. Record it and skip the binding so the
          // divergence is visible and attributable instead of fatal.
          importFactReconciliationGaps.push({
            filePath,
            line: importUsed.line,
            symbol: evidenceSymbol(importUsed.name),
            importSource: importUsed.source
          });
          continue;
        }
        const finding: Finding = {
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: repoId,
          convention_id: convention.id,
          fingerprint,
          title: "API route imports data access directly",
          message: directDataAccessMessage(filePath, importUsed.name, importUsed.source),
          severity: convention.severity,
          enforcement_result: enforcementResultFor(convention.enforcement_mode),
          status: "new",
          diff_status: "touched_existing",
          evidence_refs: [{
            id: `evidence_${fingerprint.slice(0, 16)}`,
            kind: "violation",
            file_path: filePath,
            start_line: importUsed.line,
            end_line: importUsed.end_line,
            symbol: evidenceSymbol(importUsed.name),
            import_source: importUsed.source,
            fact_ids: [factId],
            scan_id: latestScan?.id ?? `scan_check_${hashStable(`${repoId}:${now}`).slice(0, 16)}`,
            file_hash: snapshot?.content_hash ?? fileContentHash(join(repo.root_path, filePath)),
            redaction_state: "none"
          }],
          created_at: now
        };
        storage.upsertFinding(finding);
        findings.push(finding);
      }
    }
  }

  if (importFactReconciliationGaps.length > 0) {
    const affectedFiles = [...new Set(importFactReconciliationGaps.map((gap) => gap.filePath))];
    process.stderr.write(
      `drift: ${importFactReconciliationGaps.length} import binding(s) across ${affectedFiles.length} file(s) ` +
        `could not be reconciled against engine facts and were skipped during baseline materialization. ` +
        `Enforcement for those bindings is degraded. Report at ` +
        `https://github.com/dadbodgeoff/drift/issues with the paths below.\n` +
        importFactReconciliationGaps
          .slice(0, 20)
          .map((gap) => `  ${gap.filePath}:${gap.line} ${gap.symbol} from ${gap.importSource}\n`)
          .join("") +
        (importFactReconciliationGaps.length > 20
          ? `  ... and ${importFactReconciliationGaps.length - 20} more\n`
          : "")
    );
  }

  return findings;
}

function importFactEvidenceKey(filePath: string, line: number, name: string, source: string): string {
  return `${filePath}\0${line}\0${name}\0${source}`;
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
