import {
  DRIFT_CONTRACT_SCHEMA_VERSION,
  isNextApiRoutePath,
  type ConventionCandidate,
  type RepoContract,
  type RepoRecord
} from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { DriftError } from "../app/drift-error.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,statSync } from "node:fs";
import { dirname,join,relative } from "node:path";
import { hashStable,repoIdForRoot } from "./identifiers.js";
import { repoIdentityFor } from "./repo-identity.js";

export function requiredRepoContract(storage: SqliteDriftStorage, repoId: string): RepoContract {
  requiredRepo(storage, repoId);
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    throw new DriftError(`No repo contract exists for ${repoId}.`, {
      code: "missing_contract",
      userAction: "Accept or import a repo contract before running contract-backed enforcement.",
      recoveryCommands: [
        "drift conventions list --status candidate --json",
        "drift contract import <contract.json> --dry-run --json"
      ]
    });
  }
  return contract;
}

export function repoContractOrDefault(storage: SqliteDriftStorage, repoId: string): RepoContract {
  const repo = requiredRepo(storage, repoId);
  return storage.getRepoContract(repoId) ?? {
    id: `contract_default_${repoId}`,
    repo_id: repoId,
    contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    repo_fingerprint: repo.fingerprint,
    created_at: repo.created_at,
    updated_at: repo.updated_at,
    conventions: [],
    rejected_inferences: [],
    waivers: [],
    risky_areas: [],
    safe_commands: [],
    required_checks: [],
    context_egress: {
      default_mode: "local_only",
      denied_globs: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.crt", "**/*.p12", "**/id_rsa", "**/id_ed25519"],
      max_snippet_chars: 1200,
      allow_full_file_content: false
    },
    agent_permissions: []
  };
}

export function requiredRepo(storage: SqliteDriftStorage, repoId: string): RepoRecord {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  return repo;
}

export function requiredCandidate(storage: SqliteDriftStorage, id: string): ConventionCandidate {
  const candidate = storage.getConventionCandidate(id) ?? storage.getConventionCandidate(candidateIdFor(id));
  if (!candidate) {
    throw new Error(
      `Convention candidate not found: ${id}. Run \`drift conventions list --status candidate\` to see the ids this repo has.`
    );
  }
  return candidate;
}

/**
 * Accept an accepted-convention id wherever a candidate id is expected.
 *
 * The two share a content hash and differ only in prefix, and the id a user is holding is almost
 * always the `convention_` one - it is what `drift start` prints. Worse, the acceptance disclosure
 * builds its "To make this a gate" command from exactly that id, so the single remediation Drift
 * hands a user for a warn-mode convention was:
 *
 *   drift conventions accept convention_<hash> --mode block --confirm
 *   Convention candidate not found: convention_<hash>
 *
 * Telling someone precisely what to run and handing them a command that errors is worse than not
 * offering one. Rather than rewriting the id at each printing site - there are several, and the
 * next one added would get it wrong again - the lookup accepts both forms.
 */
function candidateIdFor(id: string): string {
  return id.startsWith("convention_") ? `candidate_${id.slice("convention_".length)}` : id;
}

export function ensureDatabasePath(databasePath: string): void {
  if (existsSync(databasePath) && statSync(databasePath).isDirectory()) {
    throw new Error("--db must be a file path, not a directory.");
  }
  mkdirSync(dirname(databasePath), { recursive: true });
}

export function assertRepoRootDirectory(repoRoot: string): void {
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    throw new Error(`--repo-root must be a directory: ${repoRoot}`);
  }
}

export function detectPackageManager(repoRoot: string): string {
  if (existsSync(join(repoRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(repoRoot, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(repoRoot, "bun.lockb")) || existsSync(join(repoRoot, "bun.lock"))) {
    return "bun";
  }
  if (existsSync(join(repoRoot, "package-lock.json")) || existsSync(join(repoRoot, "npm-shrinkwrap.json"))) {
    return "npm";
  }
  return "unknown";
}

export function detectWorkspace(repoRoot: string): string {
  if (existsSync(join(repoRoot, "pnpm-workspace.yaml"))) {
    return "pnpm-workspace.yaml";
  }
  if (existsSync(join(repoRoot, "lerna.json"))) {
    return "lerna.json";
  }

  const packageJsonPath = join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return "unknown";
  }

  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { workspaces?: unknown };
    if (Array.isArray(manifest.workspaces)) {
      return "package.json workspaces";
    }
    if (
      typeof manifest.workspaces === "object" &&
      manifest.workspaces !== null &&
      Array.isArray((manifest.workspaces as { packages?: unknown }).packages)
    ) {
      return "package.json workspaces";
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

export function repoRecordForRoot(repoRoot: string, now: string): RepoRecord {
  return {
    id: repoIdForRoot(repoRoot),
    root_path: repoRoot,
    // T120: the fingerprint is the *portable* identity — it must be equal for two checkouts of
    // the same repository, because it is what `contract import` compares to decide whether a
    // committed contract belongs here. It was hash(repoRoot), which made every checkout a
    // different repo and left a shared drift.lock unimportable by anyone.
    //
    // The `id` above stays path-derived on purpose. It names the local state directory
    // (~/.drift/repos/<id>/), so changing it would orphan every existing database and require
    // re-keying twenty-three tables. Keeping it local and making the fingerprint portable achieves
    // what portability needs without that risk.
    fingerprint: repoIdentityFor(repoRoot).id.replace(/^repo_/, ""),
    vcs_provider: detectVcsProvider(repoRoot),
    remote_url_hash: remoteUrlHash(repoRoot),
    package_manager: detectPackageManager(repoRoot),
    lockfile_hashes: lockfileHashes(repoRoot),
    resolver_input_hash: resolverInputHash(repoRoot),
    created_at: now,
    updated_at: now
  };
}

function detectVcsProvider(repoRoot: string): "git" | "none" {
  return existsSync(join(repoRoot, ".git")) || Boolean(gitOutput(repoRoot, ["rev-parse", "--show-toplevel"]))
    ? "git"
    : "none";
}

function remoteUrlHash(repoRoot: string): string | null {
  const remoteUrl = gitOutput(repoRoot, ["config", "--get", "remote.origin.url"]);
  return remoteUrl ? hashStable(remoteUrl) : null;
}

function lockfileHashes(repoRoot: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const filePath of ["pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb"]) {
    const absolutePath = join(repoRoot, filePath);
    if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
      result[filePath] = createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
    }
  }
  return result;
}

function resolverInputHash(repoRoot: string): string {
  const inputs = resolverInputPaths(repoRoot).map((filePath) => {
    const absolutePath = join(repoRoot, filePath);
    return {
      path: filePath,
      hash: createHash("sha256").update(readFileSync(absolutePath)).digest("hex")
    };
  });
  return hashStable(JSON.stringify(inputs));
}

function resolverInputPaths(repoRoot: string): string[] {
  const results: string[] = [];
  collectResolverInputs(repoRoot, repoRoot, results);
  return results.sort();
}

function collectResolverInputs(repoRoot: string, current: string, results: string[]): void {
  if (!existsSync(current) || !statSync(current).isDirectory()) {
    return;
  }
  for (const entry of readdirSafe(current)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".drift") {
      continue;
    }
    const absolutePath = join(current, entry);
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) {
      continue;
    }
    if (stats.isDirectory()) {
      collectResolverInputs(repoRoot, absolutePath, results);
      continue;
    }
    if (entry === "package.json" || entry === "jsconfig.json" || /^tsconfig.*\.json$/.test(entry)) {
      results.push(relative(repoRoot, absolutePath).split("\\").join("/"));
    }
  }
}

function readdirSafe(path: string): string[] {
  try {
    return existsSync(path) ? readdirSync(path) : [];
  } catch {
    return [];
  }
}

function gitOutput(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

export function isApiRoutePath(filePath: string): boolean {
  return isNextApiRoutePath(filePath);
}

// Re-exported from @drift/core so the CLI, policy layer, and engine contract
// share one glob implementation. See packages/core/src/globs.ts.
export { matchesGlob } from "@drift/core";

export function isRepoRelativePolicyPattern(value: string): boolean {
  return value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]+/).includes("..");
}

/**
 * T-07: refuse a check against a contract that accepts nothing.
 *
 * `requiredRepoContract` throws only when the contract ROW is missing, and `start` writes a row
 * even when it accepts zero conventions - so a repo with an empty contract produced output
 * indistinguishable from a genuinely enforced clean run. Measured on a fully-conforming repo:
 * `contract_ready: true`, one pending candidate, zero accepted conventions, and a check over a
 * newly added violating route returning exit 0 with no findings and no error.
 *
 * Exit 3, because this is a refusal rather than a failure: Drift is declining to claim anything,
 * which CI must be able to tell apart from "the diff is clean".
 *
 * Deliberately NOT folded into `requiredRepoContract`. Inspecting an empty contract is legitimate -
 * `contract show` and `conventions list` are how a user finds out it is empty and fixes it - so
 * only the enforcement path refuses.
 */
export function assertEnforceableContract(
  storage: SqliteDriftStorage,
  repoId: string,
  contract: RepoContract
): void {
  // "Enforceable" is not "has conventions". A contract can carry agent contracts, a layer
  // architecture, file-role and entrypoint-flow rules, or required checks with zero accepted
  // conventions, and those all produce findings - the fast gate caught this refusing ten tests
  // whose contracts enforce exactly that way. Refuse only when NOTHING would be evaluated.
  const enforceable =
    contract.conventions.length +
    (contract.agent_contracts?.length ?? 0) +
    contract.required_checks.length +
    (contract.layer_architecture ? 1 : 0) +
    (contract.active_convention_rule_ids?.length ?? 0) +
    (contract.active_semantic_capability_ids?.length ?? 0);
  if (enforceable > 0) {
    return;
  }
  const pending = storage.listConventionCandidates(repoId)
    .filter((candidate) => candidate.status === "candidate").length;
  throw new DriftError(
    `The contract for ${repoId} enforces nothing: it accepts no conventions and carries no other ` +
      "enforceable rules, so this check would examine the diff against an empty ruleset. " +
      `${pending} candidate${pending === 1 ? "" : "s"} awaiting review. Reporting a pass here would be ` +
      "indistinguishable from a repo that was actually checked, so Drift refuses instead.",
    {
      code: "empty_contract",
      userAction:
        "Accept a convention, or declare your data layer with --data-modules at onboarding, then rerun.",
      recoveryCommands: [
        `drift conventions list --repo ${repoId} --status candidate --json`,
        `drift conventions accept <candidate-id> --repo ${repoId} --confirm`
      ],
      safeToRetry: false,
      exitCode: 3
    }
  );
}
