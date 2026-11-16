// A practice made a convention (`drift practices promote`, docs/v2/PROMOTE-A-PRACTICE.md), where the view or the
// fixture API needs it. The main process builds the real argv (electron/ops.ts `promoteFlags`); a unit test keeps the
// two equal. In the desktop app every count comes from Drift; only fixture mode, which has no binary, makes a stand-in
// result (`fixturePromote`), from the fixture's own practice map and never by reading code.
import type { Convention, PracticeConcern, PracticeExample, PracticeVariant, PracticesReport, PromoteCandidate, PromoteList, PromoteOutcome, PromotePlace, PromoteRefused, PromoteResult, PromoteWay } from "@/shared/contract/drift";
import type { PromoteRequest } from "@/shared/ipc/contract";

/** `drift practices promote` arguments after the subcommand, as electron/ops.ts `promoteFlags` builds them. */
export function promoteFlags(req: PromoteRequest, dryRun: boolean): string[] {
  const others = [...new Set(req.with)].filter((w) => w !== req.id);
  return [req.id, "--in", req.place, ...others.flatMap((w) => ["--with", w]), ...(req.block ? ["--block"] : []), ...(dryRun ? ["--dry-run"] : []), "--json"];
}

/** The command a promotion runs, as the Studio shows it. */
export function promoteCommand(root: string, req: PromoteRequest, dryRun: boolean): string {
  return `drift --root ${root} practices promote ${promoteFlags(req, dryRun).join(" ")}`;
}

/** A refusal (`drift practices promote` exit 2): nothing was written, and `message` says why. */
export function isRefused(o: PromoteOutcome): o is PromoteRefused {
  return "refused" in o;
}

// ---------- fixture mode: a stand-in for the binary ----------

/** The counts Drift gates promotion on (crates/drift-mine: `MIN_ROLE_SIZE`, `PLACE_SHARE`, `MAX_UNKNOWN_SHARE`). */
const MIN_UNITS = 8;
const PLACE_SHARE = 0.8;
const MAX_UNKNOWN_SHARE = 0.2;

/** The longest package of the report that holds `shown` ("" the root package), and the directory below it. */
function placeOf(r: PracticesReport, shown: string): PromotePlace {
  if (shown === ".") return { package: "", dir: "" };
  const pkgs = [...new Set(r.concerns.flatMap((c) => c.by_package.map((p) => p.package)))].filter((p) => p !== "" && (shown === p || shown.startsWith(`${p}/`)));
  const pkg = pkgs.sort((a, b) => b.length - a.length)[0] ?? "";
  return { package: pkg, dir: pkg ? shown.slice(pkg.length + 1) : shown };
}

/** A variant's units in a place, from what the map lists: the package's count for a whole package, a listed directory's count otherwise. */
function membersIn(v: PracticeVariant, place: PromotePlace, shown: string): number {
  if (!place.dir) return v.where.packages.find((p) => p.package === place.package)?.members ?? (place.package === "" && shown === "." ? v.members : 0);
  return v.where.dirs.find((d) => d.dir === shown)?.members ?? 0;
}

const inPlace = (shown: string, path: string) => shown === "." || path === shown || path.startsWith(`${shown}/`);

function refused(refusal: PromoteRefused["refused"], message: string): PromoteRefused {
  return { refused: refusal, message };
}

/** A stable `D-` id for the fixture's convention (FNV-1a of concern and place); Drift's own id is its own. */
function fixtureId(concern: string, shown: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${concern}\0${shown}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `D-${(h & 0xffffff).toString(16).padStart(6, "0")}`;
}

const unitWords = (unit: string, n: number) => {
  const w = unit.replace(/_/g, " ");
  return n === 1 ? w : w.endsWith("s") ? w : `${w}s`;
};
const at = (e: PracticeExample) => `${e.path}:${e.line} ${e.symbol}`;

/** The text the command prints before it writes, in the shape of the design's example (section 2). */
function previewText(c: PracticeConcern, cand: PromoteCandidate, shown: string, id: string, block: boolean): string {
  const ways = cand.ways.map((w) => w.label).join(" or ");
  const n = cand.exceptions.length;
  return [
    `${c.title} in ${shown}: ${cand.follows} of ${cand.total} ${unitWords(cand.unit, cand.total)} use ${ways}.`,
    `  ${n} do not, and are recorded as they are${n ? ` (${cand.exceptions.slice(0, 3).map(at).join(", ")}${n > 3 ? `, and ${n - 3} more` : ""})` : ""}.`,
    `  ${cand.unknown} could not be read; those are never reported.`,
    `From now on \`drift check\` reports a new ${unitWords(cand.unit, 1)} here that does it another way, or not at all.`,
    block ? "Mode: block." : `Mode: advise (it never fails a check). \`drift review --block ${id}\` makes it fail one.`,
  ].join("\n");
}

/**
 * What `drift practices promote --json` would answer on a fixture's practice map: the same gates (at least 8 readable
 * units, the accepted ways at least 80% of them, at most 20% unknown), counted from the variants' listed places and
 * exceptions. Block mode is refused: it needs a replay of git history, which fixture mode does not have.
 */
export function fixturePromote(r: PracticesReport, req: PromoteRequest, written: boolean): PromoteOutcome {
  const c = r.concerns.find((x) => x.variants.some((v) => v.id === req.id));
  const v = c?.variants.find((x) => x.id === req.id);
  if (!c || !v) return refused({ code: "unknown_variant", id: req.id }, `No variant of the practice map has the id ${req.id}.`);
  if (v.kind !== "known") return refused({ code: "not_a_way", id: req.id, why: v.label }, `${req.id} (${v.label}) is not a way to hold new code to.`);
  const extra: PracticeVariant[] = [];
  for (const w of [...new Set(req.with)].filter((x) => x !== req.id)) {
    const other = r.concerns.find((x) => x.variants.some((y) => y.id === w));
    if (other && other.id !== c.id) return refused({ code: "other_concern", id: w, concern: other.id }, `${w} is a way of ${other.title}, not of ${c.title}: only ways of one concern are accepted together.`);
    const ov = c.variants.find((y) => y.id === w);
    if (!ov) return refused({ code: "unknown_variant", id: w }, `No variant of the practice map has the id ${w}.`);
    extra.push(ov);
  }
  const shown = req.place;
  const place = placeOf(r, shown);
  const accepted = [v, ...extra];
  const acceptedIds = new Set(accepted.map((x) => x.id));
  const way = (x: PracticeVariant): PromoteWay => ({ id: x.id, key: x.key, label: x.label, members: membersIn(x, place, shown) });
  const ways = accepted.map(way);
  const otherWays = c.variants
    .filter((x) => x.kind === "known" && !acceptedIds.has(x.id))
    .map(way)
    .filter((w) => w.members > 0)
    .sort((a, b) => b.members - a.members || (a.id < b.id ? -1 : 1));
  const follows = ways.reduce((s, w) => s + w.members, 0);
  const exceptions = accepted
    .flatMap((x) => x.exceptions)
    .filter((e) => inPlace(shown, e.path) && !acceptedIds.has(e.variant))
    .map(({ path, symbol, line }) => ({ path, symbol, line }))
    .filter((e, i, xs) => xs.findIndex((y) => y.path === e.path && y.symbol === e.symbol && y.line === e.line) === i)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)));
  const bp = !place.dir ? c.by_package.find((p) => p.package === place.package) : undefined;
  const unknown = bp ? Math.max(0, bp.total - bp.variants.reduce((s, x) => s + x.members, 0)) : 0;
  const total = follows + exceptions.length + unknown;
  const read = follows + exceptions.length;
  if (total === 0) return refused({ code: "no_such_place", place: shown }, `${shown} holds no ${unitWords(c.unit, 2)} of ${c.title} that the practice map lists.`);
  if (read < MIN_UNITS) return refused({ code: "too_small", place: shown, units: read, min: MIN_UNITS }, `${shown} has ${read} ${unitWords(c.unit, read)} of ${c.title} Drift could read; a convention needs at least ${MIN_UNITS}.`);
  if (unknown / total > MAX_UNKNOWN_SHARE) return refused({ code: "too_unknown", place: shown, unknown, total }, `Drift cannot tell what ${unknown} of the ${total} ${unitWords(c.unit, total)} in ${shown} do; it cannot hold code to what it cannot read (see drift practices --hints).`);
  if (follows / read < PLACE_SHARE) return refused({ code: "below_share", place: shown, follows, read }, `${follows} of the ${read} ${unitWords(c.unit, read)} Drift could read in ${shown} do it the accepted ways, under 80%.`);
  if (req.block)
    return refused(
      { code: "block_needs_replay" },
      `Block mode needs a replay of the ${unitWords(c.unit, 2)} most recently added to ${shown}, read from git history, and fixture mode has none, so block is refused. Advise always works.`,
    );
  const example = v.examples.find((e) => inPlace(shown, e.path)) ?? null;
  const candidate: PromoteCandidate = { concern: c.id, unit: c.unit, place, ways, other_ways: otherWays, follows, exceptions, unknown, total, example, forced: false };
  const id = fixtureId(c.id, shown);
  const result: PromoteResult = {
    written,
    place: shown,
    convention: { id, summary: `${c.title} in ${shown}: ${ways.map((w) => w.label).join(" or ")}`, status: "accepted", mode: "advise", promoted_from_practice: v.id },
    candidate,
    baselined: exceptions.length,
    replay: null,
    preview: previewText(c, candidate, shown, id, false),
  };
  return result;
}

/** The convention a fixture promotion records in this tab (as conventions.yaml holds a promoted practice). */
export function fixtureConvention(res: PromoteResult): Convention {
  const c = res.candidate;
  const read = c.follows + c.exceptions.length;
  return {
    id: res.convention.id,
    status: "accepted",
    mode: res.convention.mode,
    summary: res.convention.summary,
    role: { package: c.place.package, dir: c.place.dir || "**", file: "*", entry: "-", kind: "function" },
    rule: { type: "practice", concern: c.concern, any_of: c.ways.map((w) => w.key) },
    evidence: { holders: c.follows, total: read, lower_bound: read ? c.follows / read : 0, lift: 1 },
    example: c.example ? `${c.example.path}#${c.example.symbol}` : "",
    agents: "show",
    promoted_from_practice: res.convention.promoted_from_practice,
  };
}

/**
 * A fixture's `drift practices promote --list --json` less what this tab promoted (`promoted`: the conventions'
 * ids): a candidate in a place this tab promoted the same concern in is left out, and the convention is named under
 * `promoted`, as Drift does for a promoted practice that covers one.
 */
export function fixtureListOpen(list: PromoteList, promoted: readonly string[]): PromoteList {
  const ids = new Set(promoted);
  const covered = new Set<string>();
  const open = (x: PromoteList["candidates"][number]) => {
    const id = fixtureId(x.candidate.concern, x.place);
    if (!ids.has(id)) return true;
    covered.add(id);
    return false;
  };
  const candidates = list.candidates.filter(open);
  // A newer Drift lists the candidates followed by doing nothing apart (`passive`).
  const passive = list.passive?.filter(open);
  return { ...list, candidates, ...(passive ? { passive } : {}), promoted: [...new Set([...list.promoted, ...covered])].sort() };
}
