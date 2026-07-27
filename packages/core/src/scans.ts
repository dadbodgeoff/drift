import type { FileSnapshot, ScanManifest } from "./domain.js";

export interface CanonicalScanStateInput {
  manifest: ScanManifest;
  snapshots: FileSnapshot[];
}

export function canonicalScanStateJson(input: CanonicalScanStateInput): string {
  return `${stableJsonStringify({
    manifest: input.manifest,
    snapshots: [...input.snapshots].sort((a, b) =>
      a.file_path.localeCompare(b.file_path)
    )
  })}\n`;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}
