import { type RepoContract,RepoContractSchema } from "@drift/core";
import { readFileSync } from "node:fs";

export function parseJsonFile(filePath: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} must contain valid JSON: ${filePath}`);
    }
    throw error;
  }
}

export function parseContractFile(contractPath: string): RepoContract {
  const parsed = RepoContractSchema.safeParse(parseJsonFile(contractPath, "Contract file"));
  if (!parsed.success) {
    throw new Error("Contract file does not match the Drift contract schema.");
  }
  return parsed.data;
}
