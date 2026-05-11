import type { PolicyDecision, RepoContract } from "@drift/core";
import { openDriftStorage } from "@drift/storage";

export interface DriftMcpOptions {
  databasePath: string;
}

export interface DriftMcpHandlers {
  get_scan_status(input: { repo_id: string }): unknown;
  get_repo_contract(input: { repo_id: string }): unknown;
  get_task_preflight(input: { repo_id: string; task: string }): unknown;
  get_conventions(input: { repo_id: string }): unknown;
  get_findings(input: { repo_id: string }): unknown;
  get_allowed_context(input: {
    repo_id: string;
    path: string;
    surface?: PolicyDecision["surface"];
  }): unknown;
}

export function createReadOnlyMcpHandlers(options: DriftMcpOptions): DriftMcpHandlers {
  return {
    get_scan_status: ({ repo_id }) => withStorage(options, (storage) => {
      const scans = storage.listScanManifests(repo_id);
      return {
        repo_id,
        latest_scan: scans[0] ?? null,
        scan_count: scans.length
      };
    }),

    get_repo_contract: ({ repo_id }) => withStorage(options, (storage) => ({
      repo_id,
      contract: requiredContract(storage.getRepoContract(repo_id), repo_id)
    })),

    get_task_preflight: ({ repo_id, task }) => withStorage(options, (storage) => {
      const contract = requiredContract(storage.getRepoContract(repo_id), repo_id);
      return {
        repo_id,
        task,
        policy: authorizeContextExport(contract, "mcp"),
        conventions: contract.conventions.map((convention) => ({
          id: convention.id,
          kind: convention.kind,
          statement: convention.statement,
          enforcement_mode: convention.enforcement_mode,
          enforcement_capability: convention.enforcement_capability,
          scope: convention.scope,
          matcher: convention.matcher,
          exceptions: convention.exceptions
        })),
        findings: storage.listFindings(repo_id).filter((finding) =>
          !["fixed", "false_positive", "suppressed"].includes(finding.status)
        )
      };
    }),

    get_conventions: ({ repo_id }) => withStorage(options, (storage) => ({
      repo_id,
      conventions: storage.listAcceptedConventions(repo_id)
    })),

    get_findings: ({ repo_id }) => withStorage(options, (storage) => ({
      repo_id,
      findings: storage.listFindings(repo_id)
    })),

    get_allowed_context: ({ repo_id, path, surface = "mcp" }) =>
      withStorage(options, (storage) => {
        const contract = requiredContract(storage.getRepoContract(repo_id), repo_id);
        return {
          repo_id,
          path,
          decision: authorizeContextExport(contract, surface, { path })
        };
      })
  };
}

function withStorage<T>(options: DriftMcpOptions, fn: (storage: ReturnType<typeof openDriftStorage>) => T): T {
  const storage = openDriftStorage({ databasePath: options.databasePath });
  storage.migrate();
  try {
    return fn(storage);
  } finally {
    storage.close();
  }
}

function requiredContract(contract: RepoContract | undefined, repoId: string): RepoContract {
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }
  return contract;
}

function authorizeContextExport(
  contract: RepoContract,
  surface: PolicyDecision["surface"],
  input: { path?: string } = {}
): PolicyDecision {
  if (
    input.path &&
    contract.context_egress.denied_globs.some((glob) => matchesGlob(input.path!, glob))
  ) {
    return {
      allowed: false,
      surface,
      mode: "denied",
      reason: `path matches denied context glob: ${input.path}`,
      max_snippet_chars: 0
    };
  }

  const mode = contract.context_egress.default_mode;
  if (mode === "approval_required") {
    return {
      allowed: false,
      surface,
      mode,
      reason: "context export requires approval",
      max_snippet_chars: contract.context_egress.max_snippet_chars
    };
  }

  return {
    allowed: true,
    surface,
    mode,
    reason: input.path ? "context path is allowed by repo policy" : "metadata-only local preflight packet",
    max_snippet_chars: contract.context_egress.max_snippet_chars
  };
}

function matchesGlob(filePath: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}
