import type {
  EntrypointFlowAgentContract,
  EntrypointFlowProof,
  FactRecord
} from "@drift/core";

export interface BuildEntrypointFlowProofInput {
  contract: EntrypointFlowAgentContract;
  entry_file_path: string;
  facts: FactRecord[];
  graph_path?: string[];
}

export function buildEntrypointFlowProof(input: BuildEntrypointFlowProofInput): EntrypointFlowProof {
  const fileFacts = input.facts.filter((fact) => fact.file_path === input.entry_file_path);
  const callNames = new Set(fileFacts
    .filter((fact) => fact.kind === "symbol_called")
    .map((fact) => fact.name));
  const importSources = new Set(fileFacts
    .filter((fact) => fact.kind === "import_used" && fact.value)
    .map((fact) => fact.value as string));
  const roleNamesByFile = rolesByFile(input.facts);
  const importedRoleNames = new Set(input.facts
    .filter((fact) => fact.kind === "file_role_detected")
    .filter((fact) => [...importSources].some((source) => moduleLooksLikePath(source, fact.file_path)))
    .map((fact) => fact.name));
  const directDataAccess = fileFacts.filter((fact) =>
    fact.kind === "import_used" &&
    fact.value &&
    (looksLikeDataAccessImport(fact.value) || roleNamesByFile.get(fact.file_path)?.has("data_access_module"))
  );

  const required_steps = input.contract.required_steps.map((step) => {
    const calls = "calls" in step ? step.calls ?? [] : [];
    const imports = "imports" in step ? step.imports ?? [] : [];
    const targetRoles = "target_roles" in step ? step.target_roles ?? [] : [];
    const matchedCalls = calls.filter((call) => callNames.has(call));
    const matchedImports = imports.filter((source) => importSources.has(source));
    const roleSatisfied = targetRoles.length > 0 && targetRoles.some((role) => importedRoleNames.has(role));
    const satisfied = matchedCalls.length > 0 || matchedImports.length > 0 || roleSatisfied;
    const evidence_refs = fileFacts
      .filter((fact) =>
        matchedCalls.includes(fact.name) ||
        (fact.value && matchedImports.includes(fact.value))
      )
      .map((fact) => fact.id);

    return {
      step_kind: step.kind,
      satisfied,
      evidence_refs,
      graph_path: satisfied ? graphPath(input.entry_file_path, [...matchedImports, ...targetRoles]) : []
    };
  });

  const forbidden_steps = (input.contract.forbidden_steps ?? []).map((step) => {
    if (step.kind === "direct_data_access") {
      return {
        step_kind: step.kind,
        present: directDataAccess.length > 0,
        evidence_refs: directDataAccess.map((fact) => fact.id),
        graph_path: directDataAccess.length > 0
          ? graphPath(input.entry_file_path, directDataAccess.map((fact) => fact.value ?? fact.name))
          : []
      };
    }

    return {
      step_kind: step.kind,
      present: false,
      evidence_refs: [],
      graph_path: []
    };
  });

  return {
    schema_version: "drift.entrypoint_flow_proof.v1",
    entry_file_path: input.entry_file_path,
    contract_id: input.contract.id,
    required_steps,
    forbidden_steps,
    missing_evidence: [
      ...required_steps.filter((step) => !step.satisfied).map((step) => `missing_required_step:${step.step_kind}`),
      ...(fileFacts.length === 0 ? ["entry_file_not_indexed"] : [])
    ]
  };
}

function rolesByFile(facts: FactRecord[]): Map<string, Set<string>> {
  const roles = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (fact.kind !== "file_role_detected") {
      continue;
    }
    const fileRoles = roles.get(fact.file_path) ?? new Set<string>();
    fileRoles.add(fact.name);
    roles.set(fact.file_path, fileRoles);
  }
  return roles;
}

function moduleLooksLikePath(moduleSpecifier: string, filePath: string): boolean {
  const normalizedModule = moduleSpecifier.replace(/^@\//, "").replace(/\.[cm]?[jt]sx?$/, "");
  const normalizedFile = filePath.replace(/\.[cm]?[jt]sx?$/, "");
  return normalizedFile.endsWith(normalizedModule);
}

function looksLikeDataAccessImport(importSource: string): boolean {
  return /(?:prisma|db|database|repo|repository|data|storage)/i.test(importSource);
}

function graphPath(entryFile: string, targets: string[]): string[] {
  return [entryFile, ...targets.filter(Boolean)].filter((value, index, all) => all.indexOf(value) === index);
}
