/**
 * EW-7 / DET-2: refuse to measure a contaminated worktree.
 *
 * The one cal.com findings flap did not reproduce in 26 consecutive clean runs, and was attributed
 * to cross-agent harness contamination - another process editing the evaluation repo while the
 * measurement ran. That attribution is plausible. It is also, as it stands, unfalsifiable: nothing
 * detects contamination, so "it was contamination" and "determinism is not what we claim" produce
 * identical evidence.
 *
 * What made it undetectable is not an oversight so much as a habit. Every harness opens with
 * `git reset --hard && git clean -fd`, which is correct hygiene and also destroys the only evidence
 * that anything was there. So this check runs *before* the reset, and refuses rather than tidying.
 *
 * Refusing is the point. A contaminated run does not produce a wrong number, it produces a number
 * about a repo nobody chose - and reporting that is worse than reporting nothing, because it looks
 * like a measurement. The refusal names every file it found, so the next question ("what touched
 * this?") is answerable instead of speculative.
 */

import { execFileSync } from "node:child_process";

/**
 * Inspect a worktree for foreign state.
 *
 * Returns `{ clean, entries, head }`. `entries` carries the porcelain status codes as well as the
 * paths, because the code distinguishes a stray untracked file (`??`) from a modified tracked one
 * (` M`) - and those point at different culprits.
 */
export function inspectWorktree(root) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let status;
  let head;
  try {
    status = git("status", "--porcelain");
    head = git("rev-parse", "HEAD").trim();
  } catch (error) {
    return {
      clean: false,
      unreadable: true,
      entries: [],
      head: null,
      reason: `worktree could not be inspected: ${error.message}`
    };
  }
  const entries = status
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
  return { clean: entries.length === 0, unreadable: false, entries, head, reason: null };
}

/**
 * The refusal message, or `null` when the worktree is clean.
 *
 * Separated from the check so a harness can decide what to do with it - external-eval refuses one
 * repo and carries on with the rest, which is more useful than aborting the suite, while still
 * never publishing a number for the contaminated one.
 */
export function contaminationRefusal(root, label = root) {
  const inspection = inspectWorktree(root);
  if (inspection.unreadable) {
    return { refused: true, reason: inspection.reason, entries: [], head: null };
  }
  if (inspection.clean) {
    return { refused: false, reason: null, entries: [], head: inspection.head };
  }
  // Cap the listing: a truly broken checkout can carry thousands of entries, and a refusal nobody
  // reads is a refusal that gets suppressed. The count is always exact even when the list is cut.
  const shown = inspection.entries.slice(0, 20);
  const omitted = inspection.entries.length - shown.length;
  return {
    refused: true,
    entries: inspection.entries,
    head: inspection.head,
    reason:
      `${label} has ${inspection.entries.length} uncommitted change(s) before measurement began, ` +
      `so any number from it would describe a repo nobody chose:\n` +
      shown.map((entry) => `      ${entry.status} ${entry.path}`).join("\n") +
      (omitted > 0 ? `\n      ... and ${omitted} more` : "") +
      `\n    Reset it deliberately (git -C ${root} reset --hard && git -C ${root} clean -fd) ` +
      `and rerun, or pass --allow-contaminated to record the numbers as untrusted.`
  };
}

/**
 * Whether the operator has explicitly accepted measuring a dirty tree.
 *
 * Deliberately not a silent env var: the escape hatch has to appear in the command line that
 * produced the numbers, so a result recorded this way can be recognised as one later.
 */
export function contaminationAllowed(argv) {
  return argv.includes("--allow-contaminated");
}
