// Proposals from Drift's map (`drift census --from-map --json` `from_map`, crates/drift-cli/src/from_map_cli.rs
// `census_json`), shaped for the Proposals from the map view. Pure functions over what Drift printed: which ones are
// proposed, the counts, why one is not proposed (Drift's own words) and the notes are Drift's; nothing here decides what
// should be proposed. Whether one is in `.drift/conventions.yaml`, and as what, is read from the policy file as it is.
import type { ConventionsFile } from "@/shared/contract/drift";

/** What a proposal rests on: a practice of the practice map, a layer of the structure map, or a lint configuration's declaration. */
export type FromMapBasis = "practice" | "layering" | "declared";

export interface FromMapProposal {
  id: string;
  /** `practice`, `layering`, `declared` (from_map_cli.rs `Convention::from_map`), or one this Studio does not know. */
  kind: string;
  basis: FromMapBasis | null;
  summary: string;
  /** Units (a practice) or files (layering, declared) that follow it. */
  follows: number;
  /** Units recorded as differing today (0 for layering). */
  differ: number;
  /** Units Drift could not read: never reported, never counted against it. */
  unknown: number;
  /** A practice: how many of today's named departures accepting it would settle. */
  settles: number | null;
  /** Rules Drift already has that say the same thing (accepting both reports one departure twice). */
  sameRule: { id: string; summary: string; status: string }[];
  /** The place a practice proposal covers (`apps/web`, `apps/web/lib`), from its candidate. */
  place: string | null;
  /** The convention's mode as `drift init` would write it (always `advise` today). */
  mode: string | null;
}

export interface FromMapHeld {
  id: string;
  kind: string;
  summary: string;
  /** from_map_cli.rs `Reason::code`. */
  reason: string;
  /** The same, in Drift's words. */
  why: string;
}

/** Information from the map that is no proposal and is never written (declared::Note, wiring_proposals). */
export interface FromMapNote {
  /** `also_declared`, `not_expressed`, `instructions`, `wiring`, `wiring_more`, or one this Studio does not know. */
  note: string;
  kind: string;
  id: string | null;
  text: string;
}

export interface FromMapRead {
  proposals: FromMapProposal[];
  held: FromMapHeld[];
  notes: FromMapNote[];
  /** Entries this Studio could not read (another shape), counted so nothing disappears silently. */
  unreadable: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function placeOf(candidate: Record<string, unknown> | null): string | null {
  const p = obj(candidate?.place);
  if (!p) return null;
  const parts = [str(p.package), str(p.dir)].filter(Boolean);
  const where = parts.join("/") || ".";
  const file = str(p.file);
  const route = str(p.route);
  return file ? `${where} (${file})` : route ? `${where} (${route})` : where;
}

/** What a note says, built from its fields as `drift census --from-map` prints it (declared.rs `notes`, wiring_proposals.rs). */
function noteText(e: Record<string, unknown>): string {
  switch (e.note) {
    case "also_declared":
      return `also declared in ${strs(e.configs).join(", ")}: ${str(e.scope)} must not import ${str(e.target)} (${strs(e.written).join(", ")}); not proposed again, ${str(e.by) || "a convention"} already says it`;
    case "not_expressed":
      return `${str(e.config)}: ${str(e.scope)} restricts ${strs(e.written).join(", ")}; not proposed: ${str(e.why)}`;
    case "instructions": {
      const block = e.drift_block === true ? "it holds a block `drift export agents-md` wrote" : e.drift_block === false ? "it holds no block `drift export agents-md` wrote" : "it is a link or could not be read, so Drift did not open it";
      const add = strs(e.would_add);
      return `${str(e.path)} exists: instructions people wrote for agents; Drift does not read rules out of its prose; ${block}${add.length ? `. \`drift export agents-md --write ${str(e.path)}\` would add the ones you accept of ${add.length} proposal(s)` : ""}`;
    }
    case "wiring": {
      const w = obj(e.wiring);
      const facts = w ? `: ${num(w.registered)} of ${num(w.members)} registered in ${str(w.label)} (${str(w.registry)}); ${num(w.not_read)} registration site(s) could not be read (never reported)` : "";
      return `${w ? str(w.summary) : str(e.id)}${facts}. ${str(e.needs)}`;
    }
    case "wiring_more":
      return `${num(e.more)} more wiring regularities (listed by drift census --from-map)`;
    default:
      return `a note of a kind this Studio does not know (${str(e.note) || "?"}); drift census --from-map prints it`;
  }
}

/** The entries of `from_map`, apart: proposals in Drift's order, then those not proposed, then the notes. */
export function readFromMap(raw: unknown): FromMapRead {
  const list = Array.isArray(obj(raw)?.from_map) ? (obj(raw)!.from_map as unknown[]) : [];
  const out: FromMapRead = { proposals: [], held: [], notes: [], unreadable: 0 };
  for (const x of list) {
    const e = obj(x);
    if (!e) {
      out.unreadable++;
      continue;
    }
    if (typeof e.note === "string") {
      out.notes.push({ note: e.note, kind: str(e.kind), id: str(e.id) || null, text: noteText(e) });
    } else if (e.proposed === true && typeof e.id === "string") {
      const candidate = obj(e.candidate);
      const basis: FromMapBasis | null = candidate ? "practice" : obj(e.layering) ? "layering" : obj(e.declared) ? "declared" : null;
      const conv = obj(e.convention);
      out.proposals.push({
        id: e.id,
        kind: str(e.kind),
        basis,
        summary: str(e.summary),
        follows: num(e.follows),
        differ: num(e.differ),
        unknown: num(e.unknown),
        settles: typeof e.settles === "number" ? e.settles : null,
        sameRule: (Array.isArray(e.same_rule) ? e.same_rule : []).map(obj).filter((t): t is Record<string, unknown> => !!t && typeof t.id === "string").map((t) => ({ id: str(t.id), summary: str(t.summary), status: str(t.status) })),
        place: placeOf(candidate),
        mode: conv ? str(conv.mode) || null : null,
      });
    } else if (e.proposed === false && typeof e.id === "string") {
      out.held.push({ id: e.id, kind: str(e.kind), summary: str(e.summary), reason: str(e.reason), why: str(e.why) });
    } else out.unreadable++;
  }
  return out;
}

/** The members a proposal counts, by what it rests on: entry points (a practice), files (layering, declared). */
export function unitWord(p: Pick<FromMapProposal, "basis">, n: number): string {
  return p.basis === "practice" ? (n === 1 ? "entry point" : "entry points") : n === 1 ? "file" : "files";
}

/** What Drift counted, in the words `drift census --from-map` uses. */
export function countsText(p: FromMapProposal): string {
  const read = p.follows + p.differ;
  const settled = p.settles !== null && p.differ > 0 ? ` (${p.settles} named as departures today)` : "";
  return `${p.follows} of the ${read} ${unitWord(p, read)} Drift could read here follow it, ${p.differ} ${p.differ === 1 ? "differs" : "differ"}${settled}; ${p.unknown} could not be read (never reported)`;
}

export type PolicyState = "accepted" | "proposed" | "rejected" | "absent" | "unknown";

/**
 * Where a convention stands in `.drift/conventions.yaml` as it is now: accepted, proposed (undecided), rejected, absent
 * (not in the file: `drift init` writes the proposals from the map), or unknown (there is no policy file to read).
 */
export function policyState(id: string, policy: Pick<ConventionsFile, "conventions"> | null): PolicyState {
  if (!policy) return "unknown";
  const c = policy.conventions.find((x) => x.id === id);
  if (!c) return "absent";
  return c.status === "accepted" || c.status === "proposed" || c.status === "rejected" ? c.status : "unknown";
}

export const POLICY_STATE_TEXT: Record<PolicyState, string> = {
  accepted: "accepted in .drift/conventions.yaml",
  proposed: "undecided in .drift/conventions.yaml",
  rejected: "rejected in .drift/conventions.yaml (not offered again)",
  absent: "not in .drift/conventions.yaml yet: drift init writes it as a proposal",
  unknown: "no .drift/conventions.yaml to read",
};

/** The proposals, those not proposed grouped by Drift's reason (in the order Drift listed them), and the notes. */
export function heldByReason(held: readonly FromMapHeld[]): { reason: string; why: string; rows: FromMapHeld[] }[] {
  const groups: { reason: string; why: string; rows: FromMapHeld[] }[] = [];
  for (const h of held) {
    // `overlaps` and `same_as_mined` name another id in their words: one group per wording.
    const g = groups.find((x) => x.reason === h.reason && x.why === h.why);
    if (g) g.rows.push(h);
    else groups.push({ reason: h.reason, why: h.why, rows: [h] });
  }
  return groups;
}
