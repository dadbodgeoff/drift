import type { FileRole } from "@drift/core";
import { RepoMapFile } from "../domain/repo-map.js";
import { formatCounts } from "./findings.js";

export function formatRepoMapText(payload: {
  repo_id: string;
  summary: {
    indexed_file_count: number;
    filtered_file_count: number;
    listed_file_count: number;
    role_counts: Record<string, number>;
    import_count: number;
    export_count: number;
    call_count: number;
  };
  filters: { role: FileRole | null; path: string | null };
  pagination: {
    limit: number | null;
    offset: number;
    returned_count: number;
    has_more: boolean;
    next_offset: number | null;
  };
  files: RepoMapFile[];
  next_commands: string[];
}): string {
  const rows = payload.files.length > 0
    ? payload.files.map((file) =>
        `  ${file.path} roles:${file.roles.join(",") || "none"} imports:${file.imports.length} exports:${file.exported_symbols.length} calls:${file.calls.length}`
      )
    : ["  none"];
  return [
    "Drift repo map",
    "",
    `Repo: ${payload.repo_id}`,
    `Files: ${payload.summary.listed_file_count} of ${payload.summary.indexed_file_count}`,
    `Filtered: ${payload.summary.filtered_file_count}`,
    `Page: offset ${payload.pagination.offset}, returned ${payload.pagination.returned_count}, next offset ${payload.pagination.next_offset ?? "none"}`,
    `Filter role: ${payload.filters.role ?? "all"}`,
    `Filter path: ${payload.filters.path ?? "all"}`,
    `Roles: ${formatCounts(payload.summary.role_counts)}`,
    `Imports: ${payload.summary.import_count}`,
    `Exports: ${payload.summary.export_count}`,
    `Calls: ${payload.summary.call_count}`,
    "",
    "Files:",
    ...rows,
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}
