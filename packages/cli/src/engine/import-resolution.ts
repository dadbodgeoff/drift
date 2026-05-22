import { existsSync,readFileSync,statSync } from "node:fs";
import { dirname,join } from "node:path";

export function resolveImportTarget(
  repoRoot: string,
  importerFile: string,
  importSource: string
): string | undefined {
  if (importSource.startsWith(".")) {
    return firstExistingImportCandidate(repoRoot, join(dirname(importerFile), importSource));
  }

  if (importSource.startsWith("@/")) {
    const withoutAlias = importSource.slice(2);
    return (
      firstExistingImportCandidate(repoRoot, withoutAlias) ??
      firstExistingImportCandidate(repoRoot, join("src", withoutAlias))
    );
  }

  for (const target of tsconfigImportTargets(repoRoot, importSource)) {
    const resolved = firstExistingImportCandidate(repoRoot, target);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

export function firstExistingImportCandidate(repoRoot: string, target: string): string | undefined {
  const normalized = target.replaceAll("\\", "/").replace(/^\/+/, "");
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    join(normalized, "index.ts").replaceAll("\\", "/"),
    join(normalized, "index.tsx").replaceAll("\\", "/"),
    join(normalized, "index.js").replaceAll("\\", "/"),
    join(normalized, "index.jsx").replaceAll("\\", "/")
  ];

  return candidates.find((candidate) => {
    const absolutePath = join(repoRoot, candidate);
    return existsSync(absolutePath) && statSync(absolutePath).isFile();
  });
}

export function tsconfigImportTargets(repoRoot: string, importSource: string): string[] {
  const tsconfigPath = join(repoRoot, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    return [];
  }

  const tsconfig = parseJsonWithComments(readFileSync(tsconfigPath, "utf8"));
  const compilerOptions = objectValue(tsconfig.compilerOptions);
  const paths = objectValue(compilerOptions.paths);
  const baseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".";
  const targets: string[] = [];

  for (const [pattern, rawMappings] of Object.entries(paths)) {
    const mappings = Array.isArray(rawMappings) ? rawMappings : [];
    const wildcard = pattern.indexOf("*");
    const match = wildcard >= 0
      ? matchWildcardPattern(importSource, pattern)
      : importSource === pattern ? "" : undefined;
    if (match === undefined) {
      continue;
    }

    for (const mapping of mappings) {
      if (typeof mapping !== "string") {
        continue;
      }
      const mapped = wildcard >= 0 ? mapping.replace("*", match) : mapping;
      targets.push(join(baseUrl, mapped).replaceAll("\\", "/"));
    }
  }

  return targets;
}

export function matchWildcardPattern(value: string, pattern: string): string | undefined {
  const [prefix, suffix = ""] = pattern.split("*", 2);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return undefined;
  }
  return value.slice(prefix.length, value.length - suffix.length);
}

export function parseJsonWithComments(source: string): Record<string, unknown> {
  try {
    return JSON.parse(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
  } catch {
    return {};
  }
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function fileLooksLikeDataAccess(absolutePath: string): boolean {
  if (!existsSync(absolutePath)) {
    return false;
  }

  const source = readFileSync(absolutePath, "utf8");
  return /@prisma\/client|new\s+PrismaClient|drizzle\s*\(|mongoose\.connect|sequelize|typeorm|pgTable|mysqlTable/i
    .test(source);
}
