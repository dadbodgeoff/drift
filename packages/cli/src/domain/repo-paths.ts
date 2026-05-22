import { DRIFT_CONTRACT_SCHEMA_VERSION,type ConventionCandidate,type RepoContract,type RepoRecord } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync,mkdirSync,readFileSync,statSync } from "node:fs";
import { dirname,join } from "node:path";
import { hashStable,repoIdForRoot } from "./identifiers.js";

export function requiredRepoContract(storage: SqliteDriftStorage, repoId: string): RepoContract {
  requiredRepo(storage, repoId);
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
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
      denied_globs: [".env*", "**/*.pem", "**/*.key", "**/*.crt"],
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
  const candidate = storage.getConventionCandidate(id);
  if (!candidate) {
    throw new Error(`Convention candidate not found: ${id}`);
  }
  return candidate;
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
    fingerprint: hashStable(repoRoot),
    created_at: now,
    updated_at: now
  };
}

export function isApiRoutePath(filePath: string): boolean {
  return (
    /(^|\/)app\/api\/.+\/route\.[jt]sx?$/.test(filePath) ||
    /(^|\/)pages\/api\/.+\.[jt]sx?$/.test(filePath)
  );
}

export function matchesGlob(filePath: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}

export function isRepoRelativePolicyPattern(value: string): boolean {
  return value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]+/).includes("..");
}
