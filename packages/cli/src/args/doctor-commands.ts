import { resolve } from "node:path";
import type { ParsedArgs } from "../app/command-types.js";
import { stringFlag } from "./flag-readers.js";

export interface DoctorNextCommandState {
  exists: boolean;
  compatible: boolean;
  repo_registered: boolean;
  contract_ready: boolean;
  repo_id?: string | null;
  scan_stale: boolean;
}

export function doctorNextCommand(repoRoot: string, parsed: ParsedArgs): string {
  return doctorStartCommand(repoRoot, parsed);
}

export function doctorStartCommand(repoRoot: string, parsed: ParsedArgs): string {
  const stateRoot = stringFlag(parsed, "state-root");
  return [
    "drift start",
    `--repo-root ${repoRoot}`,
    stateRoot ? `--state-root ${resolve(stateRoot)}` : "",
    "--accept-defaults"
  ].filter(Boolean).join(" ");
}

export function doctorCommand(repoRoot: string, parsed: ParsedArgs): string {
  const stateRoot = stringFlag(parsed, "state-root");
  return [
    "drift doctor",
    `--repo-root ${repoRoot}`,
    stateRoot ? `--state-root ${resolve(stateRoot)}` : "",
    "--json"
  ].filter(Boolean).join(" ");
}

export function doctorScanCommand(repoRoot: string, parsed: ParsedArgs): string {
  const stateRoot = stringFlag(parsed, "state-root");
  return [
    "drift scan",
    `--repo-root ${repoRoot}`,
    stateRoot ? `--state-root ${resolve(stateRoot)}` : "",
    "--json"
  ].filter(Boolean).join(" ");
}

export function doctorNextCommands(
  repoRoot: string,
  parsed: ParsedArgs,
  stateSummary: DoctorNextCommandState
): string[] {
  if (stateSummary.exists && stateSummary.compatible && stateSummary.repo_registered && stateSummary.contract_ready && stateSummary.repo_id) {
    if (stateSummary.scan_stale) {
      return [
        doctorScanCommand(repoRoot, parsed),
        `drift scan status --repo ${stateSummary.repo_id} --json`,
        `drift prepare "task" --repo ${stateSummary.repo_id} --json`,
        `drift audit verify --repo ${stateSummary.repo_id} --json`,
        `drift backup list --repo ${stateSummary.repo_id} --json`
      ];
    }
    return [
      `drift scan status --repo ${stateSummary.repo_id} --json`,
      `drift prepare "task" --repo ${stateSummary.repo_id} --json`,
      `drift audit verify --repo ${stateSummary.repo_id} --json`,
      `drift backup list --repo ${stateSummary.repo_id} --json`,
      `drift backup create --repo ${stateSummary.repo_id} --confirm`
    ];
  }
  return [doctorStartCommand(repoRoot, parsed)];
}
