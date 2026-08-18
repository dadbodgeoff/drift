import type { AcceptedConvention } from "@drift/core";

import type { ScanData } from "../engine/collect-scan-data.js";
import { isForbiddenImport } from "./rule-evaluation.js";

/**
 * BB-4: is this contract's trigger still connected to anything?
 *
 * `resolvedModuleFilesFor` derives a forbidden module's identity from the repo's own resolved import
 * edges, falling back to specifier-string matching when resolution yields nothing. That is the right
 * design - it is what closed the `../../../lib/prisma` and barrel-re-export bypasses (T93) - but it
 * has a silent failure mode. Rename `apps/web/lib/prisma` to `apps/web/lib/database` and update every
 * import, as any refactor would, and the accepted convention matches **nothing, forever**: the old
 * specifier no longer appears as a string and no longer resolves. The check reports `status: "pass"`
 * with no findings and no signal.
 *
 * This is the enforcement-integrity class of bug, a cousin of the kill-switch: the gate reports green
 * while its trigger has been unplugged. So the check measures, per forbidden specifier, whether the
 * repo still contains anything it could match - and says so when it does not.
 *
 * Deliberately *not* an exit-code change on its own. A removed data layer is a legitimate refactor,
 * and blocking it would be a false positive on a repo that did nothing wrong. `--strict-contract`
 * exists for CI users who would rather fail than continue with a dead contract.
 */
export interface ContractStalenessEntry {
  convention_id: string;
  specifier: string;
  /** How many modules the resolver connected this specifier to. */
  resolved_modules: number;
  /** How many import facts name this specifier as a literal string. */
  string_matches: number;
  /** What to run to re-derive the contract against the repo as it is now. */
  remediation: string;
}

export function contractStaleness(input: {
  checkData: ScanData;
  conventions: readonly AcceptedConvention[];
  repoId: string;
}): ContractStalenessEntry[] {
  const nodesById = new Map(input.checkData.graph_nodes.map((node) => [node.id, node]));
  const entries: ContractStalenessEntry[] = [];

  for (const convention of input.conventions) {
    const forbidden = convention.matcher.forbidden_imports ?? [];
    if (forbidden.length === 0) {
      continue;
    }
    for (const specifier of forbidden) {
      // Resolution side: edges whose import node names this specifier and which the resolver
      // connected to a module. This is the same evidence enforcement uses, so a specifier with a
      // resolved module here is exactly a specifier enforcement can act on.
      let resolvedModules = 0;
      for (const edge of input.checkData.graph_edges) {
        if (edge.kind !== "IMPORT_RESOLVES_TO_MODULE") {
          continue;
        }
        const importNode = nodesById.get(edge.from);
        const source = importNode ? importNodeSource(importNode.metadata) : undefined;
        if (source && isForbiddenImport(source, [specifier]) && nodesById.has(edge.to)) {
          resolvedModules += 1;
        }
      }

      // String side: the fallback path enforcement uses when resolution yields nothing. Counted
      // separately because "resolves to nothing but is still written somewhere" is a different repo
      // state from "appears nowhere at all", and only the second is a dead contract.
      const stringMatches = input.checkData.facts.filter(
        (fact) =>
          // `import_used` is the only import fact kind the engine emits; there is no
          // `import_declared`. Checked against FactKind rather than assumed.
          fact.kind === "import_used" &&
          typeof fact.value === "string" &&
          isForbiddenImport(fact.value, [specifier])
      ).length;

      if (resolvedModules === 0 && stringMatches === 0) {
        entries.push({
          convention_id: convention.id,
          specifier,
          resolved_modules: 0,
          string_matches: 0,
          remediation: `drift conventions list --repo ${input.repoId} --status candidate` +
            " # the module this rule names is gone; re-derive the contract against the current tree"
        });
      }
    }
  }

  // Deterministic ordering: the check payload is byte-compared by eval:determinism.
  return entries.sort(
    (left, right) =>
      left.convention_id.localeCompare(right.convention_id) || left.specifier.localeCompare(right.specifier)
  );
}

/**
 * The human warning. One line per dead specifier, naming it and what to do - a warning that says
 * only "contract may be stale" is the kind a reader learns to ignore.
 */
export function contractStalenessWarnings(entries: readonly ContractStalenessEntry[]): string[] {
  return entries.map(
    (entry) =>
      `warning: convention ${entry.convention_id} forbids "${entry.specifier}", which this repo no longer ` +
      `contains (0 resolved modules, 0 string matches). This rule currently enforces nothing. ${entry.remediation}`
  );
}

/** The specifier an import node names, when its metadata carries one as a string. */
function importNodeSource(metadata: Record<string, unknown>): string | undefined {
  const value = metadata.source;
  return typeof value === "string" ? value : undefined;
}
