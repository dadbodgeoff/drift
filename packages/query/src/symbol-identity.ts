import type { SymbolIdentity } from "@drift/core";

export interface BuildSymbolIdentityInput {
  repo_id: string;
  scan_id: string;
  symbol_name: string;
  declared_in: string;
  exported_from: string[];
  imported_as: Array<{ file_path: string; local_name: string }>;
  call_sites: Array<{ file_path: string; start_line: number; end_line?: number }>;
  kind?: SymbolIdentity["kind"];
}

export function buildSymbolIdentity(input: BuildSymbolIdentityInput): SymbolIdentity {
  const exportedFrom = uniqueSorted(input.exported_from);
  return {
    schema_version: "drift.symbol_identity.v1",
    symbol_id: `symbol:${input.declared_in}#${input.symbol_name}`,
    repo_id: input.repo_id,
    scan_id: input.scan_id,
    symbol_name: input.symbol_name,
    kind: input.kind ?? "function",
    declared_in: input.declared_in,
    exported_from: exportedFrom,
    imported_as: [...input.imported_as].sort((left, right) =>
      `${left.file_path}:${left.local_name}`.localeCompare(`${right.file_path}:${right.local_name}`)
    ),
    re_export_chain: exportedFrom.filter((filePath) => filePath !== input.declared_in),
    canonical_definition: `${input.declared_in}#${input.symbol_name}`,
    call_sites: input.call_sites.map((site) => ({
      file_path: site.file_path,
      start_line: site.start_line,
      end_line: site.end_line ?? site.start_line
    })),
    references: input.imported_as.map((reference) => ({
      file_path: reference.file_path,
      start_line: 1,
      end_line: 1
    })),
    visibility: exportedFrom.length > 0 ? "exported" : "module"
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
