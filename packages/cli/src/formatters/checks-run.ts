import type { RequiredCheckExecution } from "@drift/core";

/**
 * W4/D-CL2: `drift checks run` had no human path.
 *
 * Without `--json`, `formatOutput` falls through to compact single-line JSON, so the result of
 * running a required check - the thing whose exit code gates a merge - arrived as an unreadable
 * blob containing a full execution proof.
 */
export function formatChecksRunText(payload: {
  repo_id: string;
  execution: RequiredCheckExecution;
  summary: {
    command: string;
    status: string;
    passed: boolean;
    exit_code: number | null;
    timed_out: boolean;
    worktree_dirty: boolean;
    diff_hash: string;
    contract_fingerprint: string;
  };
}): string {
  const { summary } = payload;
  return [
    `Required check ${summary.passed ? "PASSED" : "FAILED"}`,
    "",
    `Repo: ${payload.repo_id}`,
    `Command: ${summary.command}`,
    `Status: ${summary.status}`,
    // `exit_code` is null exactly when the process never exited, so printing the raw value would
    // put the word "null" where a number belongs and say nothing about why.
    summary.exit_code === null
      ? "Exit code: none - the command did not exit"
      : `Exit code: ${summary.exit_code}`,
    // Distinguished from a plain failure: a timeout says nothing about the code under test, and a
    // reader who cannot tell them apart will act on a verdict that was never reached.
    ...(summary.timed_out ? ["Timed out: yes - no verdict was reached"] : []),
    "",
    `Execution: ${payload.execution.execution_id}`,
    `Contract fingerprint: ${summary.contract_fingerprint}`,
    `Diff hash: ${summary.diff_hash}`,
    // The proof is only about the tree that was measured, so a dirty worktree is a caveat on the
    // result rather than a detail about the environment.
    ...(summary.worktree_dirty
      ? ["Worktree: DIRTY - this proof describes uncommitted state"]
      : ["Worktree: clean"]),
    "",
    "Next commands:",
    `  drift checks run --repo ${payload.repo_id} --json`,
    `  drift audit verify --repo ${payload.repo_id}`,
    "",
    ""
  ].join("\n");
}
