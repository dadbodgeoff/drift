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

  if (isApiRoutePath(input.filePath)) {
    facts.push(factRecord(input, "file_role_detected", "api_route", undefined, 1, 1));
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

export function factRecord(
  input: { repoId: string; scanId: string; filePath: string },
  kind: FactRecord["kind"],
  name: string,
  value: string | undefined,
  startLine: number,
  endLine: number
): FactRecord {
  const id = `fact_${hashStable(`${input.scanId}:${input.filePath}:${kind}:${name}:${value ?? ""}:${startLine}`).slice(0, 16)}`;
  return {
    id,
    repo_id: input.repoId,
    scan_id: input.scanId,
    kind,
    file_path: input.filePath,
    name,
    value,
    start_line: startLine,
    end_line: endLine
  };
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
  const importPattern = /^\s*import\s+([\s\S]+?)\s+from\s+["']([^"']+)["']/gm;
  for (const match of source.matchAll(importPattern)) {
    const startLine = lineNumberForOffset(source, match.index ?? 0);
    const endLine = lineNumberForOffset(source, (match.index ?? 0) + match[0].length);
    for (const name of parseImportNames(match[1])) {
      imports.push({
        name,
        source: match[2],
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

export function parseImportNames(importClause: string): string[] {
  const named = importClause.match(/\{([^}]+)\}/);
  if (named) {
    return named[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/).at(-1)?.trim())
      .filter((name): name is string => Boolean(name));
  }

  const defaultImport = importClause.split(",")[0]?.trim();
  return defaultImport ? [defaultImport] : ["import"];
}
