import { type AcceptedConvention,DRIFT_CONTRACT_SCHEMA_VERSION,type RepoContract } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { detectPackageManager,matchesGlob } from "./repo-paths.js";

export function assertUniqueImportedConventionIds(contract: RepoContract): void {
  const seen = new Set<string>();
  for (const convention of contract.conventions) {
    if (seen.has(convention.id)) {
      throw new Error(`Contract import contains duplicate convention id: ${convention.id}`);
    }
    seen.add(convention.id);
  }
}

export function hasUniqueAgentPermissions(
  agentPermissions: RepoContract["agent_permissions"]
): boolean {
  const agents = new Set<string>();
  for (const entry of agentPermissions) {
    if (agents.has(entry.agent) || !hasUniqueIds(entry.permissions)) {
      return false;
    }
    agents.add(entry.agent);
  }
  return true;
}

export function hasUniqueConventionExceptionIds(contract: RepoContract): boolean {
  return contract.conventions.every((convention) =>
    hasUniqueIds(convention.exceptions.map((exception) => exception.id))
  );
}

export function hasUniqueActiveWaiverSelectors(waivers: RepoContract["waivers"]): boolean {
  const selectors = new Set<string>();
  for (const waiver of waivers) {
    const key = waiverSelectorKey(waiver);
    if (!key) {
      continue;
    }
    if (selectors.has(key)) {
      return false;
    }
    selectors.add(key);
  }
  return true;
}

export function waiverSelectorKey(waiver: RepoContract["waivers"][number]): string | undefined {
  const pathGlobs = [...(waiver.path_globs ?? [])].sort();
  const symbols = [...(waiver.symbols ?? [])].sort();
  const imports = [...(waiver.imports ?? [])].sort();
  if (pathGlobs.length === 0 && symbols.length === 0 && imports.length === 0) {
    return undefined;
  }
  return JSON.stringify({
    path_globs: pathGlobs,
    symbols,
    imports
  });
}

export function hasUniqueCommands(commands: Array<{ command: string }>): boolean {
  return hasUniqueIds(commands.map((entry) => entry.command));
}

export function hasUniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

export function summarizeImportedConventions(
  existingContract: RepoContract | undefined,
  importedContract: RepoContract
): {
  added_count: number;
  changed_count: number;
  removed_count: number;
  unchanged_count: number;
} {
  const existingById = new Map(
    (existingContract?.conventions ?? []).map((convention) => [convention.id, convention])
  );
  const importedIds = new Set(importedContract.conventions.map((convention) => convention.id));
  let addedCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const convention of importedContract.conventions) {
    const existing = existingById.get(convention.id);
    if (!existing) {
      addedCount += 1;
      continue;
    }
    if (JSON.stringify(existing) === JSON.stringify(convention)) {
      unchangedCount += 1;
    } else {
      changedCount += 1;
    }
  }

  const removedCount = (existingContract?.conventions ?? [])
    .filter((convention) => !importedIds.has(convention.id)).length;
  return {
    added_count: addedCount,
    changed_count: changedCount,
    removed_count: removedCount,
    unchanged_count: unchangedCount
  };
}

export function contractSummary(contract: RepoContract): {
  convention_count: number;
  risky_area_count: number;
  required_check_count: number;
  safe_command_count: number;
  waiver_count: number;
  rejected_inference_count: number;
} {
  return {
    convention_count: contract.conventions.length,
    risky_area_count: contract.risky_areas.length,
    required_check_count: contract.required_checks.length,
    safe_command_count: contract.safe_commands.length,
    waiver_count: contract.waivers.length,
    rejected_inference_count: contract.rejected_inferences.length
  };
}

export function waiverReviewItem(
  waiver: RepoContract["waivers"][number],
  now: string,
  matchedFiles: string[] = []
): {
  id: string;
  status: "active" | "expired";
  reason: string;
  path_globs: string[];
  symbols: string[];
  imports: string[];
  expires_at: string | null;
  matched_files: string[];
} {
  return {
    id: waiver.id,
    status: waiverStatus(waiver, now),
    reason: waiver.reason,
    path_globs: waiver.path_globs ?? [],
    symbols: waiver.symbols ?? [],
    imports: waiver.imports ?? [],
    expires_at: waiver.expires_at ?? null,
    matched_files: matchedFiles
  };
}

export function waiverMatchesPath(waiver: RepoContract["waivers"][number], filePath: string): boolean {
  const pathGlobs = waiver.path_globs ?? [];
  if (pathGlobs.length === 0) {
    return true;
  }
  return pathGlobs.some((glob) => matchesGlob(filePath, glob));
}

export function waiverStatus(
  waiver: RepoContract["waivers"][number],
  now: string
): "active" | "expired" {
  return waiver.expires_at && waiver.expires_at <= now ? "expired" : "active";
}

export function waiverListSummary(
  allItems: Array<{ status: "active" | "expired" }>,
  listedItems: Array<{ status: "active" | "expired" }>
): {
  total_count: number;
  active_count: number;
  expired_count: number;
  listed_count: number;
} {
  return {
    total_count: allItems.length,
    active_count: allItems.filter((item) => item.status === "active").length,
    expired_count: allItems.filter((item) => item.status === "expired").length,
    listed_count: listedItems.length
  };
}

export function contractWaiverNextCommands(repoId: string): string[] {
  return [
    `drift contract show --repo ${repoId} --json`,
    `drift contract waivers list --repo ${repoId} --status active --json`,
    `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`,
    `drift audit list --repo ${repoId} --action policy_changed --target-type contract_waiver --json`
  ];
}

export function contractWaiverListNextCommands(repoId: string): string[] {
  return [
    `drift contract waiver add --repo ${repoId} --path "apps/**" --reason "..." --confirm --json`,
    `drift contract show --repo ${repoId} --json`,
    `drift audit list --repo ${repoId} --action policy_changed --target-type contract_waiver --json`
  ];
}

export function contractWaiverShowNextCommands(repoId: string, waiverId: string): string[] {
  return [
    `drift contract waivers list --repo ${repoId} --status active --json`,
    `drift contract waiver remove ${waiverId} --repo ${repoId} --confirm --json`
  ];
}

export function contractImportConfirmCommand(options: {
  databasePath: string;
  contractPath: string;
  repoId: string;
}): string {
  return [
    "drift",
    "--db", options.databasePath,
    "contract", "import", options.contractPath,
    "--repo", options.repoId,
    "--confirm"
  ].join(" ");
}

export function assertExpectedRepoFingerprint(actual: string | undefined, expected: string | undefined): void {
  if (expected && actual && actual !== expected) {
    throw new Error(`Backup repo fingerprint mismatch: expected ${expected}, got ${actual}.`);
  }
}

export function materializeRepoContract(
  storage: SqliteDriftStorage,
  repoId: string,
  contractId: string,
  now: string
): RepoContract {
  const existing = storage.getRepoContract(repoId);
  const repo = storage.getRepo(repoId);
  if (!repo && !existing) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const acceptedConventions = storage.listAcceptedConventions(repoId);

  return {
    id: contractId,
    repo_id: repoId,
    contract_schema_version: existing?.contract_schema_version ?? DRIFT_CONTRACT_SCHEMA_VERSION,
    repo_fingerprint: repo?.fingerprint ?? existing?.repo_fingerprint ?? "unknown",
    created_at: existing?.created_at ?? now,
    updated_at: now,
    conventions: acceptedConventions,
    rejected_inferences: existing?.rejected_inferences ?? [],
    waivers: existing?.waivers ?? [],
    risky_areas: existing?.risky_areas.length
      ? existing.risky_areas
      : defaultRiskyAreasForConventions(acceptedConventions),
    safe_commands: existing?.safe_commands.length
      ? existing.safe_commands
      : defaultSafeCommandsForRepo(repo?.root_path),
    required_checks: existing?.required_checks.length
      ? existing.required_checks
      : defaultRequiredChecksForConventions(repoId, acceptedConventions),
    context_egress: existing?.context_egress ?? {
      default_mode: "local_only",
      denied_globs: [".env*", "**/*.pem", "**/*.key", "**/*.crt"],
      max_snippet_chars: 1200,
      allow_full_file_content: false
    },
    agent_permissions: existing?.agent_permissions ?? []
  };
}

export function defaultRequiredChecksForConventions(
  repoId: string,
  conventions: AcceptedConvention[]
): RepoContract["required_checks"] {
  const deterministicConventions = conventions.filter((convention) =>
    convention.enforcement_capability === "deterministic_check" &&
    convention.enforcement_mode !== "off"
  );
  if (deterministicConventions.length === 0) {
    return [];
  }

  return [{
    command: `drift check --diff main...HEAD --repo ${repoId} --scope changed-hunks --json`,
    applies_to: mergeConventionScopes(deterministicConventions),
    reason: "Block newly introduced deterministic convention violations before code is merged."
  }];
}

export function defaultRiskyAreasForConventions(
  conventions: AcceptedConvention[]
): RepoContract["risky_areas"] {
  const dataAccessConvention = conventions.find((convention) =>
    convention.kind === "api_route_no_direct_data_access"
  );
  if (!dataAccessConvention) {
    return [];
  }

  return [{
    id: "risk_data_access_api_routes",
    path_globs: dataAccessConvention.scope.path_globs,
    risk_kind: "data_access",
    reason: "API route changes can bypass the accepted data-access layering convention."
  }];
}

export function defaultSafeCommandsForRepo(repoRoot: string | undefined): RepoContract["safe_commands"] {
  if (!repoRoot || !hasPackageScript(repoRoot, "test")) {
    return [];
  }

  const packageManager = detectPackageManager(repoRoot);
  const command = packageManager === "pnpm"
    ? "pnpm test"
    : packageManager === "yarn"
      ? "yarn test"
      : packageManager === "bun"
        ? "bun test"
        : "npm test";
  return [{
    command,
    reason: "Run the repo test script after AI-assisted changes.",
    requires_explicit_run: true
  }];
}

export function mergeConventionScopes(conventions: AcceptedConvention[]): AcceptedConvention["scope"] {
  return {
    path_globs: uniqueSorted(conventions.flatMap((convention) => convention.scope.path_globs)),
    package_names: optionalUniqueSorted(conventions.flatMap((convention) => convention.scope.package_names ?? [])),
    file_roles: optionalUniqueSorted(conventions.flatMap((convention) => convention.scope.file_roles ?? [])),
    include_symbols: optionalUniqueSorted(conventions.flatMap((convention) => convention.scope.include_symbols ?? [])),
    exclude_path_globs: optionalUniqueSorted(conventions.flatMap((convention) => convention.scope.exclude_path_globs ?? []))
  };
}

export function optionalUniqueSorted<T extends string>(values: T[]): T[] | undefined {
  return values.length > 0 ? uniqueSorted(values) : undefined;
}

export function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

export function hasPackageScript(repoRoot: string, scriptName: string): boolean {
  const packageJsonPath = join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, unknown> };
    return typeof manifest.scripts?.[scriptName] === "string" &&
      manifest.scripts[scriptName].trim().length > 0;
  } catch {
    return false;
  }
}
