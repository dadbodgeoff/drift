// `drift upgrade --json` (crates/drift-cli/src/upgrade.rs, schema `drift-upgrade` v1), read for the Upgrade view. Pure
// functions over what Drift printed: what is left and who does it (`left[].by`), the files and what they record, the
// conventions then and now, the violations by cause. Nothing here decides what an upgrade should do: `--apply` does what
// Drift says it does, and the Studio offers it only for the work Drift lists as `apply` or `security_baseline`.
import {
  SUPPORTED_UPGRADE,
  UPGRADE_SCHEMA,
  type UpgradeConvention,
  type UpgradeFile,
  type UpgradeIntegration,
  type UpgradeOutcome,
  type UpgradeReport,
  type UpgradeTodo,
  type UpgradeViolation,
} from "@/shared/contract/screens";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strs = (v: unknown): string[] => arr<unknown>(v).filter((x): x is string => typeof x === "string");

/** The report or refusal as Drift printed it, with every list present; a schema or version this Studio does not read is an error, said with what it got. */
export function readUpgrade(raw: unknown): UpgradeOutcome {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (d.schema !== UPGRADE_SCHEMA) throw new Error(`drift upgrade printed a document of another schema (${String(d.schema)}); this Studio reads ${UPGRADE_SCHEMA}`);
  if (typeof d.version !== "number" || !SUPPORTED_UPGRADE.includes(d.version))
    throw new Error(`drift upgrade printed ${UPGRADE_SCHEMA} version ${String(d.version)}; this Studio reads version ${SUPPORTED_UPGRADE.join("/")} (choose a matching Drift in Settings)`);
  const drift = typeof d.drift === "string" ? d.drift : "";
  if (d.refused === true) return { schema: UPGRADE_SCHEMA, version: d.version, drift, refused: true, newer: strs(d.newer), unreadable: strs(d.unreadable) };
  const v = (d.violations && typeof d.violations === "object" ? d.violations : {}) as Record<string, unknown>;
  const s = (d.security && typeof d.security === "object" ? d.security : {}) as Partial<UpgradeReport["security"]>;
  return {
    schema: UPGRADE_SCHEMA,
    version: d.version,
    drift,
    apply: d.apply === true,
    files: arr<UpgradeFile>(d.files).map((f) => ({ ...f, notes: strs(f.notes) })),
    conventions: arr<UpgradeConvention>(d.conventions).map((c) => ({ ...c, classes: strs(c.classes), now: c.now ?? { not_checked: 0 } })),
    violations: { reading_only: arr<UpgradeViolation>(v.reading_only), changed_code: arr<UpgradeViolation>(v.changed_code), cannot_tell: arr<UpgradeViolation>(v.cannot_tell) },
    security: {
      present: s.present === true,
      ...(typeof s.inventory === "number" ? { inventory: s.inventory } : {}),
      stamped: s.stamped === true,
      this_inventory: typeof s.this_inventory === "number" ? s.this_inventory : 0,
      new_in_drift: s.new_in_drift && typeof s.new_in_drift === "object" ? s.new_in_drift : {},
      new_in_drift_total: typeof s.new_in_drift_total === "number" ? s.new_in_drift_total : 0,
      failing_not_in_baseline: typeof s.failing_not_in_baseline === "number" ? s.failing_not_in_baseline : 0,
    },
    integrations: arr<UpgradeIntegration>(d.integrations),
    done: strs(d.done),
    ...(typeof d.failed === "string" ? { failed: d.failed } : {}),
    left: arr<UpgradeTodo>(d.left).filter((t) => t && typeof t.what === "string"),
    pending: d.pending === true,
  };
}

export type Who = "apply" | "security_baseline" | "person" | "other";

export const WHO_TEXT: Record<Who, string> = {
  apply: "drift upgrade --apply does it",
  security_baseline: "drift upgrade --apply --security-baseline does it",
  person: "for a person",
  other: "Drift names someone this Studio does not know",
};

export function whoOf(t: Pick<UpgradeTodo, "by">): Who {
  const by: string = t.by;
  return by === "apply" || by === "security_baseline" || by === "person" ? by : "other";
}

/** What is left, by who does it, each in Drift's order. */
export function leftBy(r: Pick<UpgradeReport, "left">): Record<Who, UpgradeTodo[]> {
  const out: Record<Who, UpgradeTodo[]> = { apply: [], security_baseline: [], person: [], other: [] };
  for (const t of r.left) out[whoOf(t)].push(t);
  return out;
}

/**
 * Whether the Studio offers `--apply`: only when Drift lists work it does itself (`by: apply`, or `security_baseline`
 * for `--security-baseline`), and never after a write of an earlier apply failed (the report says what was written).
 */
export function canApply(r: UpgradeReport): { apply: boolean; securityBaseline: boolean } {
  if (r.failed) return { apply: false, securityBaseline: false };
  const by = leftBy(r);
  return { apply: by.apply.length > 0 || by.security_baseline.length > 0, securityBaseline: by.security_baseline.length > 0 };
}

/** The command the confirmed action runs, as a person would type it. */
export function applyCommand(securityBaseline: boolean): string {
  return `drift upgrade --apply${securityBaseline ? " --security-baseline" : ""}`;
}

/** The work an apply would do, as Drift listed it: `apply` always, `security_baseline` only when ticked. */
export function applyWork(r: UpgradeReport, securityBaseline: boolean): UpgradeTodo[] {
  const by = leftBy(r);
  return [...by.apply, ...(securityBaseline ? by.security_baseline : [])];
}

/** One file's line, as `drift upgrade` prints it: its writer and format, and what this Drift reads of it. */
export function fileLine(f: UpgradeFile): string {
  if (!f.present) return "not there";
  const parts = [f.written_by ?? "records no Drift version", ...(f.format ? [`format ${f.format}`] : [])];
  return `${parts.join(", ")}${f.this_drift ? ` (this Drift: ${f.this_drift})` : ""}`;
}

const CLASS_TEXT: Record<string, string> = {
  stale: "stale now: it advises until a person decides",
  newly_violated_by_unchanged_code: "newly violated by code that did not change",
  no_longer_checkable: "Drift cannot tell any of its members now: nothing of it is checked",
  unchanged: "unchanged",
};

/** A convention's classes in words; one this Studio does not know is quoted as Drift wrote it. */
export const classText = (c: string): string => CLASS_TEXT[c] ?? c;

/** Conventions that read differently now, then those that do not. */
export function splitConventions(cs: readonly UpgradeConvention[]): { changed: UpgradeConvention[]; unchanged: UpgradeConvention[] } {
  const same = (c: UpgradeConvention) => c.classes.every((x) => x === "unchanged") && c.reading_only + c.changed_code + c.cannot_tell === 0;
  return { changed: cs.filter((c) => !same(c)), unchanged: cs.filter(same) };
}

/** What this Drift reads of a convention now, in the words `drift upgrade` uses. */
export function nowText(c: UpgradeConvention): string {
  const n = c.now;
  if (n.unchecked) return `not checked: ${n.unchecked}`;
  const parts: string[] = [];
  if (typeof n.holders === "number" && typeof n.members === "number") parts.push(`${n.holders} of ${n.members} follow it`);
  parts.push(`${n.not_checked} not checked`);
  if (typeof n.role === "number") parts.push(`${n.role} in its role`);
  return `${parts.join(", ")}${n.mode ? `; mode ${n.mode}` : ""}`;
}

/** What it was accepted on, or that the file did not keep it. */
export function acceptedText(c: UpgradeConvention): string {
  const a = c.accepted;
  return a ? `${a.holders} of ${a.total} followed it, ${a.role_size} in its role` : "not recorded (accepted before Drift kept it)";
}
