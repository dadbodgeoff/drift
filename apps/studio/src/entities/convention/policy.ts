// Parsing the files Drift writes: `.drift/conventions.yaml` and `drift.lock`.
import { parse } from "yaml";
import type { Convention, ConventionsFile, FromMap, Mode, PolicyDifferentKind, PolicyException, Status } from "@/shared/contract/drift";

const STATUSES: Status[] = ["accepted", "proposed", "rejected"];
const MODES: Mode[] = ["advise", "block"];
const FROM_MAP: readonly FromMap[] = ["practice", "layering", "manifest"];

/** Which of Drift's maps a convention was proposed from (`from_map`), or null: a mined one, or a value this Studio does not know. */
export function fromMapOf(v: unknown): FromMap | null {
  return typeof v === "string" && (FROM_MAP as readonly string[]).includes(v) ? (v as FromMap) : null;
}

/** `{ from_map }` when Drift wrote one of its maps, else nothing. */
function fromMapField(v: unknown): { from_map?: FromMap } {
  const m = fromMapOf(v);
  return m ? { from_map: m } : {};
}

export class PolicyError extends Error {}

/** Parse `.drift/conventions.yaml`. Unknown fields are ignored; malformed entries are rejected. */
export function parseConventions(text: string): ConventionsFile {
  let doc: unknown;
  try {
    // Plain data only: no custom tags, no aliases blow-up.
    doc = parse(text, { maxAliasCount: 0, prettyErrors: false });
  } catch (e) {
    throw new PolicyError(`conventions.yaml is not valid YAML: ${(e as Error).message}`);
  }
  if (!doc || typeof doc !== "object") throw new PolicyError("conventions.yaml is empty");
  const d = doc as Record<string, unknown>;
  const list = Array.isArray(d.conventions) ? d.conventions : [];
  const conventions: Convention[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== "string" || !/^D-[0-9a-f]{6}$/.test(c.id)) continue;
    const status = STATUSES.includes(c.status as Status) ? (c.status as Status) : "proposed";
    const mode = MODES.includes(c.mode as Mode) ? (c.mode as Mode) : "advise";
    conventions.push({
      id: c.id,
      status,
      mode,
      summary: String(c.summary ?? ""),
      role: c.role as Convention["role"],
      rule: c.rule as Convention["rule"],
      evidence: c.evidence as Convention["evidence"],
      example: String(c.example ?? ""),
      ...(Array.isArray(c.exceptions) ? { exceptions: parseExceptions(c.exceptions) } : {}),
      ...(Array.isArray(c.different_kind) ? { different_kind: parseDifferentKind(c.different_kind) } : {}),
      // A practice a person promoted from the practice map: the variant id it came from (`P-…`).
      ...(typeof c.promoted_from_practice === "string" && /^P-[0-9a-f]{6}$/.test(c.promoted_from_practice) ? { promoted_from_practice: c.promoted_from_practice } : {}),
      // Proposed from Drift's map of the code, not mined (newer drift): absent on everything the miner proposed.
      ...fromMapField(c.from_map),
    });
  }
  const fk = (d.file_kinds ?? {}) as Record<string, unknown>;
  return {
    version: Number(d.version ?? 1),
    engine: String(d.engine ?? ""),
    file_kinds: {
      literal_stems: Array.isArray(fk.literal_stems) ? fk.literal_stems.map(String) : [],
      suffixes: Array.isArray(fk.suffixes) ? fk.suffixes.map(String) : [],
    },
    // As Drift reads it: `on` (or YAML 1.1's true) turns it on; anything else leaves it off.
    ...(d.review_log === "on" || d.review_log === true ? { review_log: "on" as const } : {}),
    conventions,
  };
}

/** A convention's `exceptions`: entries with a string member and reason, sorted by member, one per member (as Drift reads them). */
function parseExceptions(list: unknown[]): PolicyException[] {
  const out = new Map<string, string>();
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    if (typeof x.member !== "string" || typeof x.reason !== "string" || !x.member.includes("#")) continue;
    if (!out.has(x.member)) out.set(x.member, x.reason);
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([member, reason]) => ({ member, reason }));
}

/** A convention's `different_kind`: files set apart as a different kind, sorted by path, one per path, with the entry points confirmed (as Drift reads them). */
function parseDifferentKind(list: unknown[]): PolicyDifferentKind[] {
  const out = new Map<string, string[]>();
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    if (typeof x.path !== "string" || !x.path || out.has(x.path)) continue;
    out.set(x.path, Array.isArray(x.entry_points) ? [...new Set(x.entry_points.filter((s): s is string => typeof s === "string"))].sort() : []);
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, entry_points]) => (entry_points.length ? { path, entry_points } : { path }));
}

export interface LockEntry {
  id: string;
  /** `path#symbol` */
  key: string;
}

/**
 * Parse `drift.lock`: `<id> <path#symbol>` per line, `#` comments. A member's fingerprint
 * line, `#~ <id> <fingerprint> <path#symbol>`, is a comment and is skipped with them.
 */
export function parseLock(text: string): LockEntry[] {
  const out: LockEntry[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(" ");
    if (i < 0) continue;
    const key = t.slice(i + 1).trim();
    // `<id> ~<fingerprint> <path#symbol>`, the form a fingerprint line was first written
    // in: the second key of a member line, not another entry.
    if (/^~[0-9a-f]+ /.test(key)) continue;
    out.push({ id: t.slice(0, i), key });
  }
  return out;
}
