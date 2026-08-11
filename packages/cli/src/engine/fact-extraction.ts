import type { FactRecord,FileSnapshot } from "@drift/core";
import { createHash } from "node:crypto";
import { readFileSync,statSync } from "node:fs";
import { basename,join } from "node:path";
import { hashStable } from "../domain/identifiers.js";
import { isApiRoutePath } from "../domain/repo-paths.js";

export function extractFactsFromFile(input: {
  repoId: string;
  scanId: string;
  repoRoot: string;
  filePath: string;
}): FactRecord[] {
  const source = readFileSync(join(input.repoRoot, input.filePath), "utf8");
  const facts: FactRecord[] = [
    factRecord(input, "file_detected", basename(input.filePath), undefined, 1, 1)
  ];

  for (const role of fileRoles(input.filePath)) {
    facts.push(factRecord(input, "file_role_detected", role, undefined, 1, 1));
  }

  for (const importUsed of extractImports(source)) {
    facts.push(
      factRecord(
        input,
        "import_used",
        importUsed.name,
        importUsed.source,
        importUsed.line,
        importUsed.line
      )
    );
  }

  return facts;
}

function fileRoles(filePath: string): string[] {
  const roles = new Set<string>();
  if (isApiRoutePath(filePath)) {
    roles.add("api_route");
  }
  if (filePath.includes("/services/") || filePath.endsWith(".service.ts") || filePath.endsWith(".service.tsx")) {
    roles.add("service_module");
  }
  if (filePath.includes("/db/") || filePath.includes("/database/") || filePath.endsWith("/db.ts") || filePath.endsWith("/prisma.ts")) {
    roles.add("data_access_module");
  }
  if (filePath.startsWith("packages/cli/src/commands/") || filePath.includes("/cli/src/commands/")) {
    roles.add("cli_command_module");
  }
  if (filePath.startsWith("packages/storage/src/") || filePath.includes("/storage/src/")) {
    roles.add("storage_module");
  }
  if (filePath.startsWith("packages/cli/src/engine/") || filePath.includes("/cli/src/engine/")) {
    roles.add("engine_bridge_module");
  }
  if (filePath.startsWith("packages/mcp/src/") || filePath.includes("/mcp/src/")) {
    roles.add("mcp_module");
  }
  if (isTestPath(filePath)) {
    roles.add("test");
  }
  if (isConfigPath(filePath)) {
    roles.add("config");
  }
  return [...roles].sort();
}

function isTestPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.includes("/test/") ||
    lower.includes("/tests/") ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(lower);
}

function isConfigPath(filePath: string): boolean {
  const fileName = basename(filePath).toLowerCase();
  return fileName.includes(".config.") ||
    [
      "vite.config.ts",
      "vitest.config.ts",
      "eslint.config.js",
      "eslint.config.mjs",
      "next.config.js",
      "next.config.mjs",
      "next.config.ts"
    ].includes(fileName);
}

export function factRecord(
  input: { repoId: string; scanId: string; filePath: string },
  kind: FactRecord["kind"],
  name: string,
  value: string | undefined,
  startLine: number,
  endLine: number,
  quality: Partial<Pick<FactRecord,
    | "source_span"
    | "ast_node_kind"
    | "imported_name"
    | "runtime_use"
    | "extraction_method"
    | "extractor_version"
    | "parser_version"
    | "confidence"
    | "confidence_label"
    | "evidence_level"
    | "resolution_status"
    | "staleness_status"
    | "last_seen_scan_id"
  >> = {}
): FactRecord {
  // EW-6 (DET-1): the column is part of a fact's identity.
  //
  // Without it, `db.query(); db.query();` on one line hashed to one id, and the storage layer's
  // `ON CONFLICT(id) DO UPDATE` collapsed the two into a single row. The visible symptom was that
  // the full-scan path (counting engine emissions) and the incremental path (counting stored rows)
  // reported different fact counts; the real cost was that the second call was gone.
  //
  // Migration note: this changes every fact id. No migration is needed and none is provided,
  // because a fact id is scoped to its scan (`input.scanId` is the first component) and is only
  // ever compared within one - evidence `fact_ids` reference facts from the same scan, and nothing
  // reads a fact id from a previous scan. Ids from existing scans stay valid for those scans; the
  // next scan writes new ones, as it already did.
  const startColumn = quality.source_span?.start_column ?? 1;
  const id = `fact_${hashStable(`${input.scanId}:${input.filePath}:${kind}:${name}:${value ?? ""}:${startLine}:${startColumn}`).slice(0, 16)}`;
  return {
    id,
    repo_id: input.repoId,
    scan_id: input.scanId,
    kind,
    file_path: input.filePath,
    name,
    value,
    imported_name: quality.imported_name,
    runtime_use: quality.runtime_use,
    start_line: startLine,
    end_line: endLine,
    source_span: quality.source_span ?? {
      start_line: startLine,
      start_column: 1,
      end_line: endLine,
      end_column: 1
    },
    ast_node_kind: quality.ast_node_kind ?? null,
    extraction_method: quality.extraction_method ?? extractionMethodForKind(kind),
    extractor_version: quality.extractor_version ?? "0.1.0",
    parser_version: quality.parser_version ?? "0.1.0",
    confidence: quality.confidence ?? confidenceForKind(kind),
    confidence_label: quality.confidence_label ?? confidenceLabelForKind(kind),
    evidence_level: quality.evidence_level ?? evidenceLevelForKind(kind),
    resolution_status: quality.resolution_status ?? "resolved",
    staleness_status: quality.staleness_status ?? "fresh",
    last_seen_scan_id: quality.last_seen_scan_id ?? input.scanId
  };
}

function extractionMethodForKind(kind: FactRecord["kind"]): string {
  if (kind === "file_role_detected") {
    return "path_role_classifier";
  }
  if (kind === "file_detected") {
    return "filesystem_scanner";
  }
  return "typescript_fallback_parser";
}

function evidenceLevelForKind(kind: FactRecord["kind"]): FactRecord["evidence_level"] {
  if (kind === "file_role_detected" || kind === "file_detected") {
    return "path";
  }
  return "text";
}

function confidenceForKind(kind: FactRecord["kind"]): number {
  if (kind === "file_role_detected") {
    return 0.9;
  }
  return 1;
}

function confidenceLabelForKind(kind: FactRecord["kind"]): FactRecord["confidence_label"] {
  if (kind === "file_role_detected") {
    return "high";
  }
  return "certain";
}

export function importFactsForFile(facts: FactRecord[], filePath: string): Array<{
  fact_id: string;
  name: string;
  value: string;
  start_line: number;
}> {
  return facts
    .filter((fact) => fact.kind === "import_used" && fact.file_path === filePath && fact.value)
    .map((fact) => ({
      fact_id: fact.id,
      name: fact.name,
      value: fact.value as string,
      start_line: fact.start_line
    }));
}

export function fileSnapshotForFile(input: {
  repoId: string;
  scanId: string;
  repoRoot: string;
  filePath: string;
}): FileSnapshot {
  const absolutePath = join(input.repoRoot, input.filePath);
  const source = readFileSync(absolutePath);
  return {
    repo_id: input.repoId,
    scan_id: input.scanId,
    file_path: input.filePath,
    content_hash: createHash("sha256").update(source).digest("hex"),
    byte_size: statSync(absolutePath).size,
    indexed: true
  };
}

export interface ImportUsed {
  name: string;
  source: string;
  line: number;
  end_line: number;
}

export function extractImports(source: string): ImportUsed[] {
  const imports: ImportUsed[] = [];
  // `[ \t]*` rather than `\s*`: `\s` matches newlines, so a blank line before an
  // import made the match index point at the blank line and reported the import one
  // line early. That line number is part of the evidence key used to reconcile these
  // bindings against engine facts, so an off-by-one broke the lookup outright.
  // The clause may span lines (multi-line named imports) but must not span
  // *statements*. Excluding `;` and quote characters stops a side-effect import such
  // as `import "server-only";` from swallowing the value import that follows it,
  // which previously made the next import invisible to enforcement.
  const importPattern = /^[ \t]*import\s+([^;"']+?)\s+from\s+["']([^"']+)["']/gm;
  for (const match of source.matchAll(importPattern)) {
    const names = parseImportNames(match[1]!);
    if (names.length === 0) {
      continue;
    }
    // Line of the `import` keyword itself, not of any leading whitespace.
    const keywordOffset = (match.index ?? 0) + match[0].indexOf("import");
    const startLine = lineNumberForOffset(source, keywordOffset);
    const endLine = lineNumberForOffset(source, (match.index ?? 0) + match[0].length);
    for (const name of names) {
      imports.push({
        name,
        source: match[2]!,
        line: startLine,
        end_line: endLine
      });
    }
  }
  return imports;
}

export function lineNumberForOffset(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
}

/**
 * Value bindings introduced by an import clause, matching the engine's semantics in
 * `crates/drift-engine/src/facts.rs`. These names are reconciled against engine
 * `import_used` facts by evidence key, so any divergence here is a correctness bug.
 *
 * Type-only bindings are excluded: they are erased at compile time and create no
 * runtime dependency on the module. The engine already skips them, so emitting them
 * here produced findings with no corresponding fact.
 */
export function parseImportNames(importClause: string): string[] {
  const clause = importClause.trim();

  // `import type { ... } from "x"` / `import type X from "x"` - entirely type-only.
  if (/^type\s/.test(clause)) {
    return [];
  }

  const names: string[] = [];

  // Named bindings: `{ a, b as c, type D }`.
  const named = clause.match(/\{([^}]*)\}/);
  if (named) {
    for (const part of named[1]!.split(",")) {
      const specifier = part.trim();
      if (!specifier) {
        continue;
      }
      // Inline type modifier: `{ type Foo }`. Previously the `type ` prefix was folded
      // into the binding name, producing symbols like "type Foo" that matched no fact.
      if (/^type\s/.test(specifier)) {
        continue;
      }
      const bound = specifier.split(/\s+as\s+/).at(-1)?.trim();
      if (bound) {
        names.push(bound);
      }
    }
  }

  // Default and namespace bindings sit before the braces: `d`, `* as ns`, `d, * as ns`.
  const beforeBraces = named ? clause.slice(0, clause.indexOf("{")) : clause;
  for (const part of beforeBraces.split(",")) {
    const specifier = part.trim().replace(/,$/, "").trim();
    if (!specifier) {
      continue;
    }
    const namespace = specifier.match(/^\*\s*as\s+(.+)$/);
    if (namespace) {
      names.push(namespace[1]!.trim());
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(specifier)) {
      names.push(specifier);
    }
  }

  return [...new Set(names)];
}
