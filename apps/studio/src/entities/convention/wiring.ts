// Experimental wiring rules (#38): "you added one, but didn't wire it up". Presentation
// only: the words and states are Drift's (crates/drift-mine/src/{check,wiring,cochange}.rs).
import type { Census, Rule, WireHint } from "@/shared/contract/drift";

/** Rule kinds of the experimental wiring feature: suggestions that never block. */
export const WIRING_RULE_KINDS = ["registered_in", "mirrors_keys"] as const;

export function isWiringRule(rule: Pick<Rule, "type">): boolean {
  return (WIRING_RULE_KINDS as readonly string[]).includes(rule.type);
}

/**
 * Whether the experimental flag was on for the census the Studio has: census --json carries
 * `wiring` only while it is on. `unknown` without a census.
 */
export function wiringState(census: Pick<Census, "wiring"> | null | undefined): "on" | "off" | "unknown" {
  if (!census) return "unknown";
  return census.wiring?.enabled ? "on" : "off";
}

export const WIRING_FLAG_HELP = "experimental: [wiring] in .drift/config.yaml (or DRIFT_EXPERIMENTAL=wiring)";

/** `path:line`, or the path when the line is unknown (a barrel's re-exports). */
export function wireAt(w: Pick<WireHint, "path" | "line">): string {
  return w.line > 0 ? `${w.path}:${w.line}` : w.path;
}

/**
 * The fix in one line, as Drift words it (`WireHint::describe`): "add RefundsService to
 * Module() providers in src/app.module.ts:10 (like BillingService, line 12)".
 */
export function wireFix(w: WireHint, what: string): string {
  const like = w.like ? (w.like.line > 0 ? ` (like ${w.like.name}, line ${w.like.line})` : ` (like ${w.like.name})`) : "";
  return `add ${what} to ${w.label} in ${wireAt(w)}${like}`;
}

/** A violation's short state: "Not registered" or "Key not mirrored". */
export function wireTitle(w: Pick<WireHint, "action">): string {
  return w.action === "mirror" ? "Key not mirrored" : w.action === "register" ? "Not registered" : `Not wired (${w.action})`;
}

/**
 * Why a registry census saw was or was not proposed (`wiring.registries[].status`).
 * `minCoverage` is census's own `wiring.params.min_coverage`.
 */
export function registryStatus(status: string, minCoverage?: number): { label: string; why: string; tone: "success" | "neutral" | "warning" | "info" } {
  if (status.startsWith("autodiscovered")) {
    const why = status.slice("autodiscovered".length).replace(/^:/, "");
    return { label: "autodiscovered", why: `Its members are found at run time${why ? ` (${why})` : ""}, so nothing has to be listed by hand.`, tone: "info" };
  }
  const bar = minCoverage != null ? `${Math.round(minCoverage * 100)}%` : "the coverage bar";
  switch (status) {
    case "proposed":
      return { label: "proposed", why: `Names ${bar} or more of a role's members: proposed as a wiring rule.`, tone: "success" };
    case "subsumed":
      return { label: "subsumed", why: "A single list, or another proposed registry, already covers the same role.", tone: "neutral" };
    case "below_threshold":
      return { label: "below threshold", why: `Names less than ${bar} of the role: taken to list a subset by design.`, tone: "neutral" };
    case "opaque":
      return { label: "opaque", why: "A list it reaches holds something Drift cannot read (a call, a lazy import, a package's spread), so whether a member is registered is unknown and nothing is reported.", tone: "warning" };
    default:
      return { label: status, why: `Drift's status "${status}"`, tone: "neutral" };
  }
}

/** The co-change history read (`wiring.cochange.history`). Each degraded state gives no rules, never a guess. */
export function historyStatus(history: string): { label: string; why: string; ok: boolean } {
  switch (history) {
    case "read":
      return { label: "read", why: "Git history was read, within Drift's bounds.", ok: true };
    case "shallow":
      return { label: "shallow clone", why: "A shallow clone: too little history to mine co-change, so no key rules.", ok: false };
    case "partial_clone":
      return { label: "partial clone", why: "A partial clone would fetch from the network to read patches, so history is not read.", ok: false };
    case "no_git":
      return { label: "no git", why: "Not a git repository: no co-change rules.", ok: false };
    case "failed":
      return { label: "failed", why: "Reading git history failed: no co-change rules.", ok: false };
    case "timeout":
      return { label: "timed out", why: "A git call ran past Drift's time limit and was stopped: no co-change rules.", ok: false };
    case "too_large":
      return { label: "too large", why: "Git output passed Drift's size cap: no co-change rules.", ok: false };
    default:
      return { label: history, why: `Drift's history state "${history}"`, ok: false };
  }
}
